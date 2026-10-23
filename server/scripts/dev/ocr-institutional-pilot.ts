import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { hash as bcryptHash } from 'bcrypt';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { LocalDocumentStorageAdapter } from '../../src/corpus/document-storage.adapter';
import { CorpusSearchSourceAdapter } from '../../src/corpus/corpus-search.adapter';
import { normalizeSearchText } from '../../src/busqueda/utils/search-normalizer';
import { parseSearchQuery } from '../../src/busqueda/utils/search-parser';
import { PrismaService } from '../../src/prisma/prisma.service';

const execFileAsync = promisify(execFile);
const workspaceRoot = path.resolve(process.cwd(), '..');
const outputRoot = path.join(workspaceRoot, '_recovery-work', 'sprint9', 'ocr');
const tesseract = 'C:\\Program Files\\Tesseract-OCR\\tesseract.exe';
const tessdata = path.join(outputRoot, 'tessdata');
const bundledPoppler = path.join(process.env.USERPROFILE ?? '', '.cache', 'codex-runtimes', 'codex-primary-runtime', 'dependencies', 'native', 'poppler', 'Library', 'bin');
const pdfInfo = path.join(bundledPoppler, 'pdfinfo.exe');
const pdfToPpm = path.join(bundledPoppler, 'pdftoppm.exe');
const modelSha256 = 'E2C1FFDAD8B30F26C45D4017A9183D3A7F9AA69E59918BE4F88B126FAC99AB2C';
const toolVersion = '5.5.3.20260724';
const popplerVersion = '26.07.0';
const institutional = { ingestions: { some: { sourceSystem: { code: 'JURISPRUDENCIA_LOCAL_PDF' } } } };

type Candidate = { id: string; title: string; status: string; files: Array<{ storageKey: string; sha256: string; sizeBytes: bigint; originalFilename: string; mimeType: string; version: number }> };

async function main() {
  if (hash(await readFile(path.join(tessdata, 'spa.traineddata'))) !== modelSha256.toLowerCase()) throw new Error('SPANISH_MODEL_SHA256_MISMATCH');
  const runId = randomUUID();
  const runDir = path.join(outputRoot, `pilot-${runId}`);
  const sampleLockPath = path.join(outputRoot, 'pilot-sample.json');
  const previousLock = await readFile(sampleLockPath, 'utf8').catch(() => null);
  if (previousLock) {
    const lock = JSON.parse(previousLock) as { runId: string; sampleSize: number };
    const completed = await readFile(path.join(outputRoot, `pilot-${lock.runId}`, 'ocr-pilot-report.json'), 'utf8').catch(() => null);
    if (!completed) throw new Error('OCR_PILOT_SAMPLE_LOCKED_WITHOUT_COMPLETION_REPORT; manual reconciliation required.');
    console.log(JSON.stringify({ status: 'OCR_PILOT_ALREADY_PROCESSED', runId: lock.runId, sampleSize: lock.sampleSize, newDocumentsProcessed: 0 }, null, 2));
    return;
  }
  const tmpRoot = path.join(runDir, 'tmp');
  await mkdir(tmpRoot, { recursive: true });
  const prisma = new PrismaService();
  const storage = new LocalDocumentStorageAdapter();
  const search = new CorpusSearchSourceAdapter();
  const selected: Array<{ candidate: Candidate; pdfPath: string; pages: number; originalSha: string }> = [];
  const outcomes: Array<Record<string, unknown>> = [];
  const startedAt = new Date();
  try {
    await prisma.$connect();
    const auditUserId = await systemAuditUser(prisma);
    const candidates = await prisma.corpusDocument.findMany({
      where: { ...institutional, status: 'OCR_REQUIRED', visibility: { in: ['INTERNAL', 'PUBLIC'] } },
      orderBy: [{ id: 'asc' }], take: 500,
      select: { id: true, title: true, status: true, files: { orderBy: { version: 'desc' }, take: 1, select: { storageKey: true, sha256: true, sizeBytes: true, originalFilename: true, mimeType: true, version: true } } },
    });
    candidates.sort((a, b) => (a.files[0]?.sha256 ?? '').localeCompare(b.files[0]?.sha256 ?? '') || a.id.localeCompare(b.id));
    for (const candidate of candidates) {
      const file = candidate.files[0];
      if (!file || file.mimeType !== 'application/pdf' || Number(file.sizeBytes) > 25 * 1024 * 1024) continue;
      const content = await storage.get(file.storageKey);
      const sourceSha = hash(content);
      if (sourceSha !== file.sha256) { outcomes.push({ documentId: candidate.id, result: 'FAILED_SOURCE_CHECKSUM' }); continue; }
      const folder = path.join(tmpRoot, candidate.id);
      await mkdir(folder, { recursive: true });
      const pdfPath = path.join(folder, 'source.pdf');
      await writeFile(pdfPath, content, { flag: 'wx' });
      const info = await execFileAsync(pdfInfo, [pdfPath], { windowsHide: true, maxBuffer: 128 * 1024 });
      const pageMatch = info.stdout.match(/^Pages:\s+(\d+)/mu);
      const pages = Number(pageMatch?.[1] ?? 0);
      if (!pages || pages > 20) continue;
      selected.push({ candidate, pdfPath, pages, originalSha: sourceSha });
      if (selected.length === 20) break;
    }
    if (selected.length < 20) throw new Error(`OCR_PILOT_SAMPLE_TOO_SMALL:${selected.length}`);
    await writeFile(sampleLockPath, `${JSON.stringify({ runId, selectedAt: new Date().toISOString(), sampleSize: selected.length, documentIds: selected.map((item) => item.candidate.id), originalSha256: selected.map((item) => ({ documentId: item.candidate.id, sha256: item.originalSha })) }, null, 2)}\n`, { flag: 'wx' });

    for (const [index, item] of selected.entries()) {
      const documentStart = Date.now();
      const folder = path.dirname(item.pdfPath);
      const prefix = path.join(folder, 'page');
      try {
        await execFileAsync(pdfToPpm, ['-f', '1', '-l', String(item.pages), '-r', '160', '-gray', '-png', item.pdfPath, prefix], { windowsHide: true, maxBuffer: 256 * 1024 });
        const images = (await readdir(folder)).filter((name) => /^page-\d+\.png$/u.test(name)).sort((a, b) => Number(a.match(/\d+/u)?.[0]) - Number(b.match(/\d+/u)?.[0]));
        if (images.length !== item.pages) throw new Error(`RENDERED_PAGE_COUNT_MISMATCH:${images.length}/${item.pages}`);
        const pages: Array<{ pageNumber: number; text: string }> = [];
        for (let pageIndex = 0; pageIndex < images.length; pageIndex += 1) {
          const imagePath = path.join(folder, images[pageIndex]);
          const result = await execFileAsync(tesseract, [imagePath, 'stdout', '-l', 'spa', '--tessdata-dir', tessdata, '--psm', '6'], { windowsHide: true, maxBuffer: 8 * 1024 * 1024 });
          const text = result.stdout.replace(/\u0000/gu, '').trim();
          pages.push({ pageNumber: pageIndex + 1, text });
        }
        const extracted = pages.map((page) => page.text).filter(Boolean).join('\n\n').trim();
        if (extracted.length < 30) throw new Error('OCR_TEXT_TOO_SHORT');
        const derived = Buffer.from(extracted, 'utf8');
        const derivedSha = hash(derived);
        const stored = await storage.put(`${item.candidate.id}.ocr.txt`, derived);
        if (stored.sha256 !== derivedSha) throw new Error('DERIVED_STORAGE_CHECKSUM_MISMATCH');
        const timestamp = new Date();
        await prisma.$transaction(async (tx) => {
          const derivedFile = await tx.corpusDocumentFile.upsert({
            where: { documentId_sha256: { documentId: item.candidate.id, sha256: derivedSha } },
            update: { storageKey: stored.storageKey, originalFilename: `${item.candidate.files[0].originalFilename}.ocr.txt`, mimeType: 'text/plain', sizeBytes: BigInt(stored.sizeBytes), pageCount: item.pages },
            create: { documentId: item.candidate.id, storageKey: stored.storageKey, originalFilename: `${item.candidate.files[0].originalFilename}.ocr.txt`, mimeType: 'text/plain', sizeBytes: BigInt(stored.sizeBytes), sha256: derivedSha, pageCount: item.pages, version: 0 },
          });
          const extraction = await tx.corpusExtraction.create({ data: {
            documentId: item.candidate.id, fileId: derivedFile.id, extractor: 'Tesseract OCR', extractorVersion: `${toolVersion}; language=spa; modelSha256=${modelSha256.toLowerCase()}; poppler=${popplerVersion}`,
            status: 'TEXT_EXTRACTED', text: extracted,
            pages: { create: pages.map((page) => ({ pageNumber: page.pageNumber, text: page.text })) },
          } });
          await tx.corpusDocument.update({ where: { id: item.candidate.id }, data: { status: 'INDEXED', latestExtractionId: extraction.id, searchText: normalizeSearchText(extracted) } });
          await tx.corpusDocumentFile.updateMany({ where: { documentId: item.candidate.id, sha256: item.originalSha }, data: { pageCount: item.pages } });
          const ingestion = await tx.corpusIngestionRecord.findFirst({ where: { documentId: item.candidate.id, checksum: item.originalSha }, orderBy: { ingestedAt: 'desc' } });
          await tx.accionLog.create({ data: { usuarioId: auditUserId, entidad: 'CorpusDocument', entidadId: null, accion: 'OCR_PILOT_COMPLETED', descripcion: `documentId=${item.candidate.id}`, datosAntes: { status: 'OCR_REQUIRED', sourceSha256: item.originalSha }, datosDespues: { documentId: item.candidate.id, status: 'INDEXED', extractionId: extraction.id, derivedSha256: derivedSha, pageCount: item.pages, language: 'spa', tool: 'Tesseract OCR', toolVersion, modelSha256: modelSha256.toLowerCase(), popplerVersion, completedAt: timestamp.toISOString(), ingestionId: ingestion?.id ?? null } } });
        });
        const wordCount = extracted.split(/\s+/u).filter(Boolean).length;
        outcomes.push({ sample: index + 1, documentId: item.candidate.id, originalSha256: item.originalSha, derivedSha256: derivedSha, pages: item.pages, characters: extracted.length, words: wordCount, elapsedMs: Date.now() - documentStart, result: 'INDEXED' });
      } catch (error) {
        outcomes.push({ sample: index + 1, documentId: item.candidate.id, originalSha256: item.originalSha, pages: item.pages, elapsedMs: Date.now() - documentStart, result: 'FAILED', error: error instanceof Error ? error.message : 'OCR_FAILED' });
      }
    }

    const firstSuccess = outcomes.find((item) => item.result === 'INDEXED') as { documentId: string; derivedSha256: string } | undefined;
    let searchSmoke: Record<string, unknown> = { status: 'NO_SUCCESSFUL_OCR' };
    if (firstSuccess) {
      const extraction = await prisma.corpusExtraction.findFirstOrThrow({ where: { documentId: firstSuccess.documentId }, orderBy: { extractedAt: 'desc' }, select: { text: true } });
      const term = extraction.text.match(/[\p{L}]{7,}/u)?.[0];
      if (term) {
        const result = await search.search(parseSearchQuery(term), { visibility: 'INTERNAL', dialect: 'modern', publicationPolicy: 'published-active-only', page: 1, pageSize: 100 });
        searchSmoke = { status: result.results.some((row) => row.sourceId === firstSuccess.documentId) ? 'PASS' : 'MISS', documentId: firstSuccess.documentId, termLength: term.length, matchedPage: result.results.find((row) => row.sourceId === firstSuccess.documentId)?.metadata.pageNumber ?? null, total: result.total };
      } else searchSmoke = { status: 'NO_SEARCH_TERM' };
    }
    const finishedAt = new Date();
    const successes = outcomes.filter((item) => item.result === 'INDEXED');
    const report = { status: 'OCR_PILOT_COMPLETE', runId, tool: 'Tesseract OCR', toolVersion, license: 'Apache-2.0', language: 'spa', languageModelSha256: modelSha256.toLowerCase(), pdfRenderer: 'Poppler pdfinfo/pdftoppm', pdfRendererVersion: popplerVersion, selection: { method: 'first 20 eligible documents sorted by original PDF SHA-256 then document ID', maximumPdfBytes: 25 * 1024 * 1024, maximumPagesPerDocument: 20, renderDpi: 160 }, sampleSize: selected.length, successes: successes.length, failures: outcomes.length - successes.length, pagesProcessed: successes.reduce((sum, item) => sum + Number(item.pages ?? 0), 0), charactersExtracted: successes.reduce((sum, item) => sum + Number(item.characters ?? 0), 0), wordCount: successes.reduce((sum, item) => sum + Number(item.words ?? 0), 0), elapsedMs: finishedAt.getTime() - startedAt.getTime(), searchSmoke, originalsVerifiedUnchanged: outcomes.every((item) => !item.originalSha256 || selected.some((candidate) => candidate.candidate.id === item.documentId && candidate.originalSha === item.originalSha256)), outcomes };
    await writeFile(path.join(runDir, 'ocr-pilot-report.json'), `${JSON.stringify(report, null, 2)}\n`, { flag: 'wx' });
    console.log(JSON.stringify({ ...report, outcomes: report.outcomes.map(({ documentId, result, pages, characters, words, elapsedMs, derivedSha256, error }) => ({ documentId, result, pages, characters, words, elapsedMs, derivedSha256, error })) }, null, 2));
  } finally {
    await search.close();
    await prisma.$disconnect();
    await rm(tmpRoot, { recursive: true, force: true });
  }
}

function hash(buffer: Buffer) { return createHash('sha256').update(buffer).digest('hex'); }

async function systemAuditUser(prisma: PrismaService) {
  const existing = await prisma.usuario.findUnique({ where: { email: 'sistema-corpus@jurisprudencia.local' }, select: { id: true } });
  if (existing) return existing.id;
  const role = await prisma.rol.upsert({ where: { nombre: 'OPERADOR' }, update: {}, create: { nombre: 'OPERADOR', descripcion: 'Operadores de carga y consulta' }, select: { id: true } });
  const passwordHash = await bcryptHash(randomBytes(32).toString('hex'), 10);
  const systemUser = await prisma.usuario.create({ data: { nombre: 'Sistema', apellido: 'Corpus', email: 'sistema-corpus@jurisprudencia.local', passwordHash, activo: false, rolId: role.id } });
  return systemUser.id;
}

if (require.main === module) main().catch((error) => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
