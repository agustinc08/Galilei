import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, open, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { PrismaService } from '../../src/prisma/prisma.service';
import { CorpusIngestionService } from '../../src/corpus/corpus-ingestion.service';
import { BasicDocumentTextExtractor } from '../../src/corpus/document-text-extractor';
import { LocalDocumentStorageAdapter } from '../../src/corpus/document-storage.adapter';
import type { DiscoveredDocument } from '../../src/corpus/document-source.adapter';

const repoRoot = path.resolve(__dirname, '../../..');
const recoveryRoot = path.join(repoRoot, '_recovery-work', 'office-beta-legacy-corpus');
const archiveRoot = 'D:\\_recovery-work\\jurisprudencia-archive-audit-20261028-111413\\extracted';
const sourcePdfRoot = path.join(archiveRoot, 'jurisprudencia', 'consulta', 'PDF');
const reconciliationPath = 'D:\\_recovery-work\\jurisprudencia-archive-audit-20261028-111413\\pdf-source-reconciliation.json';
const archiveSha256 = '26473C5B805EC601E83A8A9178B42002D0C04879D88BC675BB06FFC88B490CBA';
const sourceCode = 'LEGACY_JURISPRUDENCIA_ARCHIVE';
const sourceName = 'Archivo legacy de Jurisprudencia';

type Candidate = { id: number; rel: string; size: number; sha256: string };
type CandidateState = Candidate & {
  sentenciaId: number;
  legacyId: string;
  numeroSentencia: string | null;
  caratula: string | null;
  sala: string | null;
  fecha: Date | null;
  existenteArchivo: boolean;
  hashDocumentIds: string[];
};

function args(): string[] {
  let parsed: unknown;
  try { parsed = JSON.parse(process.env.BJC_OFFICE_BETA_PDFS_ARGS ?? '[]'); }
  catch { throw new Error('OFFICE_PDF_ARGS_INVALID'); }
  if (!Array.isArray(parsed) || parsed.some((value) => typeof value !== 'string'))
    throw new Error('OFFICE_PDF_ARGS_INVALID');
  return parsed as string[];
}

function sha(buffer: Buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

function sourceNumericId(value: string | null) {
  return value?.match(/#tb_sentencias\/(\d+)$/u)?.[1] ?? null;
}

function candidatePath(candidate: Candidate) {
  const absolute = path.resolve(sourcePdfRoot, candidate.rel.slice('jurisprudencia/consulta/PDF/'.length));
  if (!absolute.startsWith(`${sourcePdfRoot}${path.sep}`)) throw new Error('OFFICE_PDF_SOURCE_PATH_REJECTED');
  return absolute;
}

async function loadCandidates() {
  const report = JSON.parse(await readFile(reconciliationPath, 'utf8')) as { importCandidates?: Candidate[] };
  if (!Array.isArray(report.importCandidates) || report.importCandidates.length === 0)
    throw new Error('OFFICE_PDF_CANDIDATE_MANIFEST_MISSING');
  const seen = new Set<number>();
  const candidates: Candidate[] = [];
  for (const candidate of report.importCandidates) {
    if (!Number.isSafeInteger(candidate.id) || candidate.id <= 0 || !/^[a-f0-9]{64}$/u.test(candidate.sha256) || !Number.isSafeInteger(candidate.size) || candidate.size <= 0 || !candidate.rel.startsWith('jurisprudencia/consulta/PDF/'))
      throw new Error('OFFICE_PDF_CANDIDATE_MANIFEST_INVALID');
    if (seen.has(candidate.id)) throw new Error('OFFICE_PDF_DUPLICATE_SOURCE_ID');
    seen.add(candidate.id);
    candidates.push(candidate);
  }
  return candidates;
}

async function assertTarget(prisma: PrismaService) {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DEV_DATABASE_URL_MISSING');
  const parsed = new URL(url);
  if (parsed.protocol !== 'postgresql:' || parsed.hostname !== '127.0.0.1' || parsed.port !== '55432' || parsed.pathname !== '/buscador_juridico_civil_dev' || decodeURIComponent(parsed.username) !== 'bjc_dev')
    throw new Error('DEV_DATABASE_TARGET_REJECTED');
  const rows = await prisma.$queryRaw<Array<{ database: string; port: number; role: string }>>`SELECT current_database() AS database, inet_server_port() AS port, current_user AS role`;
  if (rows[0]?.database !== 'buscador_juridico_civil_dev' || Number(rows[0]?.port) !== 55432 || rows[0]?.role !== 'bjc_dev')
    throw new Error('DEV_DATABASE_IDENTITY_REJECTED');
  return { database: rows[0].database, host: '127.0.0.1', port: 55432, role: rows[0].role };
}

async function verifyPdf(candidate: Candidate) {
  const file = candidatePath(candidate);
  const info = await stat(file);
  if (!info.isFile() || info.size !== candidate.size || info.size > 100 * 1024 * 1024)
    throw new Error(`OFFICE_PDF_SIZE_REJECTED:${candidate.id}`);
  const content = await readFile(file);
  if (content.subarray(0, 5).toString('ascii') !== '%PDF-' || !content.subarray(Math.max(0, content.length - 2048)).toString('latin1').includes('%%EOF') || sha(content) !== candidate.sha256)
    throw new Error(`OFFICE_PDF_CHECKSUM_OR_ENVELOPE_REJECTED:${candidate.id}`);
  return content;
}

async function hashFile(filePath: string) {
  const digest = createHash('sha256');
  await new Promise<void>((resolve, reject) => {
    const stream = createReadStream(filePath);
    stream.on('data', (chunk) => digest.update(chunk));
    stream.on('error', reject);
    stream.on('end', resolve);
  });
  return digest.digest('hex');
}

async function createPreflight(candidates: Candidate[], prisma: PrismaService, target: unknown) {
  const sentences = await prisma.sentencia.findMany({
    where: { legacyId: { contains: '#tb_sentencias/' } },
    select: { id: true, legacyId: true, numeroSentencia: true, caratula: true, sala: true, fecha: true, activo: true, publicado: true, estadoCarga: true, tienePdf: true },
  });
  const sentenceBySourceId = new Map<number, (typeof sentences)[number]>();
  const duplicateSourceIds: number[] = [];
  for (const sentence of sentences) {
    const sourceId = sourceNumericId(sentence.legacyId);
    if (sourceId === null) continue;
    const numericId = Number(sourceId);
    if (sentenceBySourceId.has(numericId)) duplicateSourceIds.push(numericId);
    else sentenceBySourceId.set(numericId, sentence);
  }
  const sentenceIds = sentences.map((sentence) => sentence.id);
  const [pdfRows, existingLinks, matchingFiles] = await Promise.all([
    prisma.archivoPdf.findMany({ where: { sentenciaId: { in: sentenceIds } }, select: { sentenciaId: true, rutaArchivo: true, nombreArchivo: true } }),
    prisma.corpusDocumentLink.findMany({ where: { targetDomain: 'JURISPRUDENCIA', targetType: 'SENTENCIA', targetId: { in: sentenceIds.map(String) }, relationship: 'ASSOCIATED_WITH' }, select: { targetId: true, documentId: true } }),
    prisma.corpusDocumentFile.findMany({ where: { sha256: { in: candidates.map((candidate) => candidate.sha256) } }, select: { sha256: true, documentId: true, storageKey: true, mimeType: true, sizeBytes: true, document: { select: { documentScope: true, status: true } } } }),
  ]);
  const hashesByDigest = new Map<string, Map<string, (typeof matchingFiles)[number]>>();
  for (const file of matchingFiles) {
    const ids = hashesByDigest.get(file.sha256) ?? new Map<string, (typeof matchingFiles)[number]>();
    ids.set(file.documentId, file);
    hashesByDigest.set(file.sha256, ids);
  }
  const pdfSentences = new Set(pdfRows.map((row) => row.sentenciaId));
  const linkedSentences = new Set(existingLinks.map((row) => Number(row.targetId)));
  const states: CandidateState[] = [];
  const missingSentenceIds: number[] = [];
  const inactiveOrUnpublished: number[] = [];
  const duplicateHashDocuments: number[] = [];
  const existingStorageFailures: number[] = [];
  const unsafeExistingDocuments: number[] = [];
  const pdfAlreadyPresent: number[] = [];
  const contentAlreadyStored = new Set<number>();
  for (const candidate of candidates) {
    const sentence = sentenceBySourceId.get(candidate.id);
    if (!sentence) { missingSentenceIds.push(candidate.id); continue; }
    if (!sentence.activo || !sentence.publicado || sentence.estadoCarga !== 'PUBLICADA') { inactiveOrUnpublished.push(candidate.id); continue; }
    const existingFile = hashesByDigest.get(candidate.sha256);
    const hashDocumentIds = [...(existingFile?.keys() ?? [])];
    if (hashDocumentIds.length > 1) { duplicateHashDocuments.push(candidate.id); continue; }
    if (pdfSentences.has(sentence.id) || linkedSentences.has(sentence.id)) { pdfAlreadyPresent.push(candidate.id); continue; }
    if (hashDocumentIds.length === 1) {
      const matchingFile = existingFile?.get(hashDocumentIds[0]);
      const sourceBuffer = await verifyPdf(candidate);
      if (!matchingFile || matchingFile.document.documentScope !== 'GENERAL' || matchingFile.mimeType !== 'application/pdf' || Number(matchingFile.sizeBytes) !== candidate.size || sha(sourceBuffer) !== candidate.sha256) {
        unsafeExistingDocuments.push(candidate.id);
        continue;
      }
      const storage = new LocalDocumentStorageAdapter();
      try {
        const storedBuffer = await storage.get(matchingFile.storageKey);
        if (storedBuffer.length !== candidate.size || sha(storedBuffer) !== candidate.sha256) existingStorageFailures.push(candidate.id);
      } catch {
        existingStorageFailures.push(candidate.id);
      }
      contentAlreadyStored.add(candidate.id);
    }
    states.push({
      ...candidate,
      sentenciaId: sentence.id,
      legacyId: sentence.legacyId ?? '',
      numeroSentencia: sentence.numeroSentencia,
      caratula: sentence.caratula,
      sala: sentence.sala,
      fecha: sentence.fecha,
      existenteArchivo: hashDocumentIds.length === 1,
      hashDocumentIds,
    });
  }
  const storage = new LocalDocumentStorageAdapter();
  const storageAvailable = await storage.isAvailable();
  const candidatesBytes = candidates.reduce((sum, candidate) => sum + candidate.size, 0);
  const report = {
    task: 'OFFICE_BETA_LEGACY_PDF_PREFLIGHT',
    generatedAt: new Date().toISOString(),
    target,
    archiveSha256,
    sourceDatabase: 'read-only SQLite jurisprudencia/jurisprudencia_db.sqlite',
    sourceCandidates: candidates.length,
    sourceBytes: candidatesBytes,
    storageRoot: storage.root,
    storageAvailable,
    missingSentenceIds,
    duplicateSourceIds,
    inactiveOrUnpublished,
    duplicateHashDocuments,
    existingStorageFailures,
    unsafeExistingDocuments,
    pdfAlreadyPresent,
    candidateStates: states,
    counts: {
      sourceCandidates: candidates.length,
      attachCandidates: states.length,
      contentAlreadyStored: contentAlreadyStored.size,
      newContentRequired: states.length - contentAlreadyStored.size,
      missingSentenceIds: missingSentenceIds.length,
      inactiveOrUnpublished: inactiveOrUnpublished.length,
      duplicateHashDocuments: duplicateHashDocuments.length,
      existingStorageFailures: existingStorageFailures.length,
      unsafeExistingDocuments: unsafeExistingDocuments.length,
      alreadyLinked: pdfAlreadyPresent.length,
      bytes: candidatesBytes,
    },
  };
  await mkdir(recoveryRoot, { recursive: true });
  const output = path.join(recoveryRoot, 'legacy-pdf-preflight.json');
  await writeFile(output, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify({ task: report.task, generatedAt: report.generatedAt, target, archiveSha256, storageRoot: storage.root, storageAvailable, counts: report.counts, duplicateSourceIds: duplicateSourceIds.length, reportPath: output }, null, 2));
  if (!storageAvailable || missingSentenceIds.length || inactiveOrUnpublished.length || duplicateHashDocuments.length || duplicateSourceIds.length || existingStorageFailures.length || unsafeExistingDocuments.length)
    throw new Error('OFFICE_PDF_PREFLIGHT_REQUIRES_REVIEW');
}

async function importCandidates(preflightPath: string, expectedBackupPath: string, expectedBackupSha: string, prisma: PrismaService) {
  if (!preflightPath || !expectedBackupPath || !/^[a-f0-9]{64}$/iu.test(expectedBackupSha))
    throw new Error('OFFICE_PDF_APPLY_ARGUMENTS_INVALID');
  const preflight = JSON.parse(await readFile(preflightPath, 'utf8')) as { archiveSha256: string; candidateStates: CandidateState[]; counts: { attachCandidates: number } };
  if (preflight.archiveSha256 !== archiveSha256 || !Array.isArray(preflight.candidateStates) || preflight.candidateStates.length !== preflight.counts.attachCandidates)
    throw new Error('OFFICE_PDF_PREFLIGHT_MISMATCH');
  const absoluteBackupPath = path.resolve(expectedBackupPath);
  if (!absoluteBackupPath.startsWith(`${path.join(recoveryRoot, 'backups')}${path.sep}`))
    throw new Error('OFFICE_PDF_BACKUP_PATH_REJECTED');
  const backupInfo = await stat(absoluteBackupPath);
  if (backupInfo.size < 1_000_000) throw new Error('OFFICE_PDF_BACKUP_TOO_SMALL');
  const backupSha = await hashFile(absoluteBackupPath);
  if (backupSha.toUpperCase() !== expectedBackupSha.toUpperCase()) throw new Error('OFFICE_PDF_BACKUP_CHECKSUM_MISMATCH');
  const storage = new LocalDocumentStorageAdapter();
  if (!(await storage.isAvailable())) throw new Error('OFFICE_PDF_STORAGE_UNAVAILABLE');
  const ingestion = new CorpusIngestionService(prisma, storage, new BasicDocumentTextExtractor());
  const completedPath = path.join(recoveryRoot, 'legacy-pdf-import-progress.json');
  const outcomes: Array<{ id: number; status: string; documentId?: string; fileId?: string; sha256: string; reused?: boolean }> = [];
  let created = 0;
  let reused = 0;
  let linked = 0;
  let invalid = 0;
  let sinceCheckpoint = 0;
  for (const candidate of preflight.candidateStates) {
    const filePath = candidatePath(candidate);
    const content = await verifyPdf(candidate);
    const sentence = await prisma.sentencia.findUnique({ where: { id: candidate.sentenciaId }, select: { id: true, legacyId: true, numeroSentencia: true, caratula: true, sala: true, fecha: true, tipoFallo: true, tribunalOrigen: true, expediente: true, activo: true, publicado: true, estadoCarga: true } });
    if (!sentence || sentence.id !== candidate.sentenciaId || !sentence.activo || !sentence.publicado || sentence.estadoCarga !== 'PUBLICADA')
      throw new Error(`OFFICE_PDF_TARGET_SENTENCE_CHANGED:${candidate.id}`);
    const existingLink = await prisma.corpusDocumentLink.findFirst({ where: { targetDomain: 'JURISPRUDENCIA', targetType: 'SENTENCIA', targetId: String(sentence.id), relationship: 'ASSOCIATED_WITH' }, select: { documentId: true } });
    const existingPdf = await prisma.archivoPdf.findFirst({ where: { sentenciaId: sentence.id }, select: { rutaArchivo: true } });
    if (existingLink || existingPdf) {
      outcomes.push({ id: candidate.id, status: 'ALREADY_LINKED', sha256: candidate.sha256, documentId: existingLink?.documentId });
      sinceCheckpoint++;
      continue;
    }
    const item: DiscoveredDocument = {
      filename: `${candidate.id}.pdf`,
      sourcePath: candidate.rel,
      externalId: `legacy-sentencia-pdf:${candidate.id}`,
      sourceReference: [sentence.numeroSentencia, sentence.caratula].filter(Boolean).join(' — ') || `Sentencia legacy ${candidate.id}`,
      obtainedAt: new Date(),
      content,
      mimeType: 'application/pdf',
      documentType: 'JUDGMENT',
      jurisdiction: 'CIVIL',
      visibility: 'INTERNAL',
      title: [sentence.numeroSentencia, sentence.caratula].filter(Boolean).join(' — ') || `Sentencia legacy ${candidate.id}`,
      court: sentence.tribunalOrigen ?? undefined,
      chamber: sentence.sala ?? undefined,
      caseNumber: sentence.expediente ?? undefined,
      decisionDate: candidate.fecha ? new Date(candidate.fecha) : undefined,
      metadata: { intakeChannel: sourceCode, legacySentenceId: candidate.id, archiveSha256, sourcePath: candidate.rel },
      metadataOriginal: { originalFilename: `${candidate.id}.pdf`, sha256: candidate.sha256, sourceArchiveSha256: archiveSha256, sourcePath: candidate.rel, legacySentenceId: candidate.id },
    };
    const priorFiles = await prisma.corpusDocumentFile.findMany({ where: { sha256: candidate.sha256 }, select: { documentId: true } });
    const uniqueDocumentIds = [...new Set(priorFiles.map((row) => row.documentId))];
    let imported;
    if (uniqueDocumentIds.length > 1) throw new Error(`OFFICE_PDF_HASH_BECAME_AMBIGUOUS:${candidate.id}`);
    if (uniqueDocumentIds.length === 1) {
      imported = await ingestion.linkExisting(item, { sourceCode, sourceName, sourceType: 'ARCHIVE' });
      reused++;
    } else {
      imported = await ingestion.ingestOne(item, { sourceCode, sourceName, sourceType: 'ARCHIVE' });
      if (imported.status === 'INVALID_PDF') {
        invalid++;
        outcomes.push({ id: candidate.id, status: 'INVALID_PDF', documentId: imported.documentId, fileId: imported.fileId, sha256: candidate.sha256, reused: imported.reused });
        continue;
      }
      if (imported.reused) reused++;
      else created++;
    }
    const documentFile = await prisma.corpusDocumentFile.findUnique({ where: { documentId_sha256: { documentId: imported.documentId, sha256: candidate.sha256 } }, select: { id: true, storageKey: true, sizeBytes: true, mimeType: true } });
    if (!documentFile) throw new Error(`OFFICE_PDF_CORPUS_FILE_MISSING:${candidate.id}`);
    const stored = await storage.get(documentFile.storageKey);
    if (sha(stored) !== candidate.sha256) throw new Error(`OFFICE_PDF_STORAGE_CHECKSUM_MISMATCH:${candidate.id}`);
    const absolutePath = path.resolve(storage.root, documentFile.storageKey);
    await prisma.$transaction(async (tx) => {
      const oldLegacyPath = await tx.archivoPdf.findFirst({ where: { legacyPath: candidate.rel }, select: { id: true, sentenciaId: true, rutaArchivo: true } });
      if (oldLegacyPath && (oldLegacyPath.sentenciaId !== sentence.id || oldLegacyPath.rutaArchivo !== absolutePath))
        throw new Error(`OFFICE_PDF_LEGACY_PATH_CONFLICT:${candidate.id}`);
      if (!oldLegacyPath) {
        await tx.archivoPdf.create({ data: { legacyId: `jurisprudencia#pdf/${candidate.id}`, legacyPath: candidate.rel, nombreArchivo: `${candidate.sha256}.pdf`, nombreOriginal: `${candidate.id}.pdf`, rutaArchivo: absolutePath, mimeType: 'application/pdf', tamanioBytes: Number(documentFile.sizeBytes), sentenciaId: sentence.id } });
      }
      await tx.sentencia.update({ where: { id: sentence.id }, data: { tienePdf: true } });
      await tx.corpusDocumentLink.upsert({
        where: { documentId_targetDomain_targetType_targetId_relationship: { documentId: imported.documentId, targetDomain: 'JURISPRUDENCIA', targetType: 'SENTENCIA', targetId: String(sentence.id), relationship: 'ASSOCIATED_WITH' } },
        create: { documentId: imported.documentId, targetDomain: 'JURISPRUDENCIA', targetType: 'SENTENCIA', targetId: String(sentence.id), relationship: 'ASSOCIATED_WITH', metadata: { intakeChannel: sourceCode, legacySentenceId: candidate.id, sourceArchiveSha256: archiveSha256, sourcePath: candidate.rel, sha256: candidate.sha256 } },
        update: {},
      });
    });
    linked++;
    outcomes.push({ id: candidate.id, status: imported.status, documentId: imported.documentId, fileId: documentFile.id, sha256: candidate.sha256, reused: imported.reused });
    sinceCheckpoint++;
    if (sinceCheckpoint >= 10) {
      await writeFile(completedPath, `${JSON.stringify({ task: 'OFFICE_BETA_LEGACY_PDF_IMPORT', generatedAt: new Date().toISOString(), sourceArchiveSha256: archiveSha256, total: preflight.candidateStates.length, processed: outcomes.length, created, reused, linked, invalid, outcomes }, null, 2)}\n`, 'utf8');
      console.log(`OFFICE_BETA_LEGACY_PDF_PROGRESS=${outcomes.length}/${preflight.candidateStates.length}; created=${created}; reused=${reused}; linked=${linked}; invalid=${invalid}`);
      sinceCheckpoint = 0;
    }
  }
  await writeFile(completedPath, `${JSON.stringify({ task: 'OFFICE_BETA_LEGACY_PDF_IMPORT', generatedAt: new Date().toISOString(), sourceArchiveSha256: archiveSha256, total: preflight.candidateStates.length, processed: outcomes.length, created, reused, linked, invalid, outcomes }, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify({ task: 'OFFICE_BETA_LEGACY_PDF_IMPORT', status: invalid ? 'PARTIAL' : 'PASS', processed: outcomes.length, created, reused, linked, invalid, reportPath: completedPath }, null, 2));
  if (outcomes.length !== preflight.candidateStates.length || invalid) throw new Error('OFFICE_PDF_IMPORT_INCOMPLETE');
}

async function main() {
  const [mode, preflightArg, backupArg, backupShaArg] = args();
  if (mode !== 'preflight' && mode !== 'apply' && mode !== 'status') throw new Error('OFFICE_PDF_MODE_INVALID');
  if (!process.env.DATABASE_URL) throw new Error('DEV_DATABASE_URL_MISSING');
  const prisma = new PrismaService();
  try {
    await prisma.$connect();
    const target = await assertTarget(prisma);
    if (mode === 'status') {
      const rows = await prisma.$queryRaw<Array<{ archivosPdf: bigint; links: bigint; ingestionRecords: bigint }>>`
        SELECT
          (SELECT count(*) FROM "ArchivoPdf" WHERE "legacyPath" LIKE 'jurisprudencia/consulta/PDF/%') AS "archivosPdf",
          (SELECT count(*) FROM "CorpusDocumentLink" WHERE "targetDomain"='JURISPRUDENCIA' AND "targetType"='SENTENCIA' AND "relationship"='ASSOCIATED_WITH') AS links,
          (SELECT count(*) FROM "CorpusIngestionRecord" i JOIN "CorpusSourceSystem" s ON s.id=i."sourceSystemId" WHERE s.code=${sourceCode} AND i."externalId" LIKE 'legacy-sentencia-pdf:%') AS "ingestionRecords"
      `;
      const storage = new LocalDocumentStorageAdapter();
      const references = await prisma.archivoPdf.findMany({
        where: { legacyPath: { startsWith: 'jurisprudencia/consulta/PDF/' } },
        select: { id: true, rutaArchivo: true, nombreArchivo: true, tamanioBytes: true, sentenciaId: true },
      });
      let pathMissing = 0;
      let wrongStorageRoot = 0;
      let pdfEnvelopeInvalid = 0;
      let hashMismatch = 0;
      let sizeMismatch = 0;
      const storageRoot = path.resolve(storage.root);
      for (const reference of references) {
        const absolutePath = path.resolve(reference.rutaArchivo);
        if (!absolutePath.startsWith(`${storageRoot}${path.sep}`)) wrongStorageRoot++;
        let info;
        try { info = await stat(absolutePath); }
        catch { pathMissing++; continue; }
        if (!info.isFile()) { pathMissing++; continue; }
        if (reference.tamanioBytes !== null && info.size !== reference.tamanioBytes) sizeMismatch++;
        const file = await open(absolutePath, 'r');
        try {
          const head = Buffer.alloc(5);
          const tail = Buffer.alloc(Math.min(2048, info.size));
          const headRead = await file.read(head, 0, head.length, 0);
          const tailRead = await file.read(tail, 0, tail.length, Math.max(0, info.size - tail.length));
          if (headRead.bytesRead !== 5 || head.toString('ascii') !== '%PDF-' || !tail.subarray(0, tailRead.bytesRead).toString('latin1').includes('%%EOF')) pdfEnvelopeInvalid++;
        } finally { await file.close(); }
        const expectedHash = reference.nombreArchivo.replace(/\.pdf$/iu, '').toLowerCase();
        if (!/^[a-f0-9]{64}$/u.test(expectedHash) || await hashFile(absolutePath) !== expectedHash) hashMismatch++;
      }
      const countValues = Object.fromEntries(Object.entries(rows[0] ?? {}).map(([key, value]) => [key, Number(value)]));
      console.log(JSON.stringify({
        task: 'OFFICE_BETA_LEGACY_PDF_STATUS',
        target,
        storageRoot: storage.root,
        counts: {
          ...countValues,
          physicalReferencesAudited: references.length,
          pathMissing,
          wrongStorageRoot,
          pdfEnvelopeInvalid,
          hashMismatch,
          sizeMismatch,
        },
      }, null, 2));
      return;
    }
    const candidates = await loadCandidates();
    if (mode === 'preflight') await createPreflight(candidates, prisma, target);
    else await importCandidates(preflightArg ?? '', backupArg ?? '', backupShaArg ?? '', prisma);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : 'OFFICE_PDF_IMPORT_FAILED';
  const code = error && typeof error === 'object' && 'code' in error ? String((error as { code?: unknown }).code ?? '') : '';
  const safeMessage = message.replace(/[\r\n]+/gu, ' ').slice(0, 240);
  console.error(/^(?:DEV_DATABASE|OFFICE_PDF)_[A-Z0-9_:.-]+$/u.test(message) ? message : `OFFICE_PDF_IMPORT_FAILED; name=${error instanceof Error ? error.name : 'Error'}; code=${code.slice(0, 30)}; detail=${safeMessage}`);
  process.exitCode = 1;
});
