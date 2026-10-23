import { createHash, randomBytes } from 'node:crypto';
import { hash as bcryptHash } from 'bcrypt';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Prisma } from '@prisma/client';
import { normalizeSearchText } from '../../src/busqueda/utils/search-normalizer';
import { BasicDocumentTextExtractor, InvalidPdfError } from '../../src/corpus/document-text-extractor';
import { LocalDocumentStorageAdapter } from '../../src/corpus/document-storage.adapter';
import { PrismaService } from '../../src/prisma/prisma.service';

const workspaceRoot = path.resolve(process.cwd(), '..');
const sourceRoot = path.join(workspaceRoot, 'digesto', 'server', 'pdfs');
const reportRoot = path.join(workspaceRoot, '_recovery-work', 'sprint10', 'digesto');
const reportPath = path.join(reportRoot, 'local-scan.json');
const sourceCode = 'DIGESTO_LOCAL';
const collectionNormalized = 'digesto-local-metadata-pendiente';
const repositoryRoot = {
  id: 'digesto-server-pdfs',
  name: 'Digesto local PDFs (workspace snapshot)',
  relativePath: 'digesto/server/pdfs',
  rootType: 'LOCAL_LEGACY_DIGESTO',
  source: 'Local workspace snapshot; read-only source',
  readOnly: true,
  active: true,
};

type Scan = {
  generatedAt: string;
  totals: { physicalPdfs: number; uniqueHashes: number; bytes: number };
  files: Array<{
    relativePath: string;
    sha256: string;
    sizeBytes: number;
    modifiedAt: string;
    validity: string;
    extractionStatus?: string;
    pages?: number;
    characters?: number;
    words?: number;
  }>;
};

async function main() {
  const scan = JSON.parse(await readFile(reportPath, 'utf8')) as Scan;
  if (scan.files.length !== scan.totals.physicalPdfs || scan.totals.physicalPdfs !== 278) {
    throw new Error('DIGESTO_SCAN_COUNT_CHANGED; regenerate and review scan before importing.');
  }
  const reportHash = sha256(await readFile(reportPath));
  const prisma = new PrismaService();
  const storage = new LocalDocumentStorageAdapter();
  const extractor = new BasicDocumentTextExtractor();
  const outcomes: Array<{ path: string; documentId?: string; sha256: string; status: string; reused?: boolean; error?: string }> = [];
  try {
    await prisma.$connect();
    const actorId = await auditUser(prisma);
    const source = await prisma.corpusSourceSystem.upsert({
      where: { code: sourceCode },
      create: { code: sourceCode, name: 'Digesto local (snapshot)', sourceType: 'LOCAL_LEGACY', description: 'PDFs del workspace local; no representa conexión ni sincronización institucional.' },
      update: { name: 'Digesto local (snapshot)', sourceType: 'LOCAL_LEGACY', description: 'PDFs del workspace local; no representa conexión ni sincronización institucional.' },
    });
    await prisma.corpusDocumentRepositoryRoot.upsert({
      where: { id: repositoryRoot.id },
      create: repositoryRoot,
      update: repositoryRoot,
    });
    const collection = await prisma.digestoCollection.upsert({
      where: { normalized: collectionNormalized },
      create: { name: 'Digesto local — metadatos pendientes', normalized: collectionNormalized, description: 'Colección técnica de staging para archivos locales sin export legacy de catálogos. No equivale a las colecciones institucionales.' },
      update: { description: 'Colección técnica de staging para archivos locales sin export legacy de catálogos. No equivale a las colecciones institucionales.' },
    });
    const runId = `sprint10-digesto-${reportHash.slice(0, 24)}`;
    const previousRun = await prisma.corpusImportRun.findUnique({ where: { id: runId }, select: { status: true } });
    if (previousRun?.status === 'SUCCESS') {
      console.log(JSON.stringify({ status: 'DIGESTO_IMPORT_ALREADY_COMPLETE', runId, reportHash }, null, 2));
      return;
    }
    await prisma.corpusImportRun.upsert({
      where: { id: runId },
      create: {
        id: runId, scanId: `digesto-local-${reportHash.slice(0, 24)}`, manifestSha256: reportHash,
        sourceCode, roots: [repositoryRoot], scanned: scan.files.length, physicalFiles: scan.files.length,
        uniqueHashes: scan.totals.uniqueHashes, bytesProcessed: BigInt(scan.totals.bytes), status: 'RUNNING',
      },
      update: { status: 'RUNNING', finishedAt: null, errorSummary: Prisma.DbNull },
    });

    for (let index = 0; index < scan.files.length; index += 1) {
      const item = scan.files[index];
      try {
        const absolutePath = path.join(sourceRoot, item.relativePath);
        const [content, fileStat] = await Promise.all([readFile(absolutePath), stat(absolutePath)]);
        if (content.length !== item.sizeBytes || sha256(content) !== item.sha256) throw new Error('SOURCE_CHANGED_SINCE_SCAN');
        if (item.validity !== 'VALID') throw new Error(`SCAN_REJECTED_${item.validity}`);
        const itemKey = item.relativePath;
        const idempotencyKey = sha256(`${source.id}\0${itemKey}\0${item.sha256}`);
        const existingIngestion = await prisma.corpusIngestionRecord.findUnique({ where: { idempotencyKey }, select: { id: true, documentId: true, fileId: true, status: true } });
        if (existingIngestion) {
          await prisma.$transaction(async (tx) => {
            await tx.digestoCollectionMembership.upsert({
              where: { collectionId_documentId: { collectionId: collection.id, documentId: existingIngestion.documentId } },
              create: { collectionId: collection.id, documentId: existingIngestion.documentId }, update: {},
            });
            await tx.corpusDocumentLocation.upsert({
              where: { rootId_relativePath: { rootId: repositoryRoot.id, relativePath: item.relativePath } },
              create: { documentId: existingIngestion.documentId, rootId: repositoryRoot.id, relativePath: item.relativePath, originalFilename: item.relativePath, sourceType: 'LOCAL_LEGACY_DIGESTO', source: 'DIGESTO_LOCAL', sizeBytes: BigInt(item.sizeBytes), sha256: item.sha256, modifiedAt: new Date(item.modifiedAt), sourceMissing: false },
              update: { documentId: existingIngestion.documentId, originalFilename: item.relativePath, sizeBytes: BigInt(item.sizeBytes), sha256: item.sha256, modifiedAt: new Date(item.modifiedAt), sourceMissing: false },
            });
            await tx.corpusImportRunItem.upsert({
              where: { runId_itemKey: { runId, itemKey } },
              create: { runId, itemKey, documentId: existingIngestion.documentId, status: 'SUCCESS', extractionStatus: existingIngestion.status, bytes: BigInt(item.sizeBytes), pages: item.pages ?? 0, characters: item.characters ?? 0, finishedAt: new Date() },
              update: { documentId: existingIngestion.documentId, status: 'SUCCESS', extractionStatus: existingIngestion.status, bytes: BigInt(item.sizeBytes), pages: item.pages ?? 0, characters: item.characters ?? 0, errorStage: null, errorMessage: null, finishedAt: new Date() },
            });
          });
          outcomes.push({ path: itemKey, documentId: existingIngestion.documentId, sha256: item.sha256, status: existingIngestion.status, reused: true });
          continue;
        }
        let document = await prisma.corpusDocumentFile.findFirst({
          where: { sha256: item.sha256 },
          orderBy: { createdAt: 'asc' },
          select: { document: true, id: true },
        });
        let fileId: string;
        let documentId: string;
        let status: string;
        let extractionId: string | null = null;
        let reused = Boolean(document);
        if (document) {
          documentId = document.document.id;
          fileId = document.id;
          status = document.document.status;
          extractionId = document.document.latestExtractionId;
        } else {
          const stored = await storage.put(item.relativePath, content);
          const extracted = await extractor.extract(item.relativePath, 'application/pdf', content);
          const created = await prisma.$transaction(async (tx) => {
            const corpusDocument = await tx.corpusDocument.create({
              data: {
                title: path.basename(item.relativePath, path.extname(item.relativePath)),
                documentType: 'DIGESTO_LEGACY_UNMAPPED', jurisdiction: 'UNSPECIFIED',
                visibility: 'INTERNAL', status: extracted.status === 'OCR_REQUIRED' ? 'OCR_REQUIRED' : 'INDEXED',
                editorialStatus: 'NO_REVIEWED', anonymizationStatus: 'REVIEW_REQUIRED',
                metadata: { source: sourceCode, taxonomyStatus: 'PENDING_LEGACY_METADATA', classification: 'NOT_INFERRED' },
                metadataOriginal: { sourceCode, sourceRelativePath: item.relativePath, originalFilename: item.relativePath, sha256: item.sha256, sizeBytes: item.sizeBytes, sourceModifiedAt: fileStat.mtime.toISOString(), scanGeneratedAt: scan.generatedAt, legacyId: null, crosswalk: 'NO_LOCAL_RECORD_EXPORT' },
                searchText: normalizeSearchText([item.relativePath, extracted.text].join(' ')),
              },
            });
            const corpusFile = await tx.corpusDocumentFile.create({
              data: { documentId: corpusDocument.id, storageKey: stored.storageKey, originalFilename: item.relativePath, mimeType: 'application/pdf', sizeBytes: BigInt(content.length), sha256: item.sha256, pageCount: extracted.pages.length || item.pages || null, version: 1 },
            });
            const extraction = await tx.corpusExtraction.create({
              data: { documentId: corpusDocument.id, fileId: corpusFile.id, extractor: extracted.extractor, extractorVersion: extracted.extractorVersion, status: extracted.status, text: extracted.text, pages: { create: extracted.pages.map((page) => ({ pageNumber: page.pageNumber, text: page.text })) } },
            });
            await tx.corpusDocument.update({ where: { id: corpusDocument.id }, data: { latestExtractionId: extraction.id } });
            return { corpusDocument, corpusFile, extraction };
          });
          documentId = created.corpusDocument.id;
          fileId = created.corpusFile.id;
          extractionId = created.extraction.id;
          status = extracted.status === 'OCR_REQUIRED' ? 'OCR_REQUIRED' : 'INDEXED';
        }
        await prisma.$transaction(async (tx) => {
          await tx.corpusIngestionRecord.create({
            data: {
              sourceSystemId: source.id, documentId, fileId, externalId: item.relativePath,
              sourceReference: item.relativePath, checksum: item.sha256, idempotencyKey,
              originalFilename: item.relativePath, sourcePath: item.relativePath,
              metadataOriginal: { rootId: repositoryRoot.id, relativePath: item.relativePath, legacyId: null, legacyMetadata: 'NOT_AVAILABLE_IN_LOCAL_EXPORT', reportHash },
              status,
            },
          });
          await tx.corpusDocumentLocation.upsert({
            where: { rootId_relativePath: { rootId: repositoryRoot.id, relativePath: item.relativePath } },
            create: { documentId, rootId: repositoryRoot.id, relativePath: item.relativePath, originalFilename: item.relativePath, sourceType: 'LOCAL_LEGACY_DIGESTO', source: sourceCode, sizeBytes: BigInt(item.sizeBytes), sha256: item.sha256, modifiedAt: new Date(item.modifiedAt), sourceMissing: false },
            update: { documentId, originalFilename: item.relativePath, sizeBytes: BigInt(item.sizeBytes), sha256: item.sha256, modifiedAt: new Date(item.modifiedAt), sourceMissing: false },
          });
          await tx.digestoCollectionMembership.upsert({
            where: { collectionId_documentId: { collectionId: collection.id, documentId } },
            create: { collectionId: collection.id, documentId }, update: {},
          });
          await tx.corpusImportRunItem.upsert({
            where: { runId_itemKey: { runId, itemKey } },
            create: { runId, itemKey, documentId, status: 'SUCCESS', extractionStatus: status, bytes: BigInt(item.sizeBytes), pages: item.pages ?? 0, characters: item.characters ?? 0, finishedAt: new Date() },
            update: { documentId, status: 'SUCCESS', extractionStatus: status, bytes: BigInt(item.sizeBytes), pages: item.pages ?? 0, characters: item.characters ?? 0, errorStage: null, errorMessage: null, finishedAt: new Date() },
          });
          await tx.accionLog.create({
            data: { usuarioId: actorId, entidad: 'CorpusDocument', entidadId: null, accion: reused ? 'DIGESTO_LOCAL_MEMBERSHIP_IMPORTED' : 'DIGESTO_LOCAL_DOCUMENT_IMPORTED', descripcion: `documentId=${documentId}`, datosAntes: Prisma.JsonNull, datosDespues: { documentId, sourceCode, relativePath: item.relativePath, sha256: item.sha256, collectionId: collection.id, status, extractionId, reusedExactHash: reused, legacyId: null } },
          });
        });
        outcomes.push({ path: itemKey, documentId, sha256: item.sha256, status, reused });
      } catch (error) {
        const message = error instanceof Error ? error.message.slice(0, 500) : 'DIGESTO_IMPORT_FAILED';
        await prisma.corpusImportRunItem.upsert({
          where: { runId_itemKey: { runId, itemKey: item.relativePath } },
          create: { runId, itemKey: item.relativePath, status: 'FAILED', errorStage: 'IMPORT', errorMessage: message, finishedAt: new Date(), bytes: BigInt(item.sizeBytes) },
          update: { status: 'FAILED', errorStage: 'IMPORT', errorMessage: message, finishedAt: new Date() },
        });
        outcomes.push({ path: item.relativePath, sha256: item.sha256, status: 'FAILED', error: message });
      }
      if ((index + 1) % 25 === 0) console.log(`DIGESTO_PROGRESS=${index + 1}/${scan.files.length}`);
    }
    const counts = {
      physicalFiles: scan.files.length,
      processed: outcomes.length,
      newDocuments: outcomes.filter((item) => !item.reused && item.status !== 'FAILED').length,
      reusedDocuments: outcomes.filter((item) => item.reused && item.status !== 'FAILED').length,
      indexed: outcomes.filter((item) => item.status === 'TEXT_EXTRACTED' || item.status === 'INDEXED').length,
      ocrRequired: outcomes.filter((item) => item.status === 'OCR_REQUIRED').length,
      failed: outcomes.filter((item) => item.status === 'FAILED').length,
    };
    await prisma.corpusImportRun.update({
      where: { id: runId },
      data: { status: counts.failed ? 'PARTIAL' : 'SUCCESS', processed: counts.processed, newDocuments: counts.newDocuments, reusedDocuments: counts.reusedDocuments, extracted: counts.indexed, ocrRequired: counts.ocrRequired, failed: counts.failed, finishedAt: new Date(), errorSummary: counts.failed ? { failures: outcomes.filter((item) => item.status === 'FAILED').slice(0, 20) } : Prisma.DbNull },
    });
    const result = { status: counts.failed ? 'PARTIAL' : 'SUCCESS', runId, reportHash, collection: { id: collection.id, name: collection.name, description: collection.description }, counts, files: outcomes };
    await writeFile(path.join(reportRoot, 'import-result.json'), `${JSON.stringify(result, null, 2)}\n`, { flag: 'w' });
    console.log(JSON.stringify({ ...result, files: undefined }, null, 2));
  } finally {
    await prisma.$disconnect();
  }
}

function sha256(data: Buffer | string) { return createHash('sha256').update(data).digest('hex'); }

async function auditUser(prisma: PrismaService) {
  const email = 'sistema-corpus@jurisprudencia.local';
  const existing = await prisma.usuario.findUnique({ where: { email }, select: { id: true, activo: true } });
  if (existing) {
    if (existing.activo) throw new Error('SYSTEM_AUDIT_USER_MUST_REMAIN_INACTIVE');
    return existing.id;
  }
  const role = await prisma.rol.upsert({ where: { nombre: 'OPERADOR' }, update: {}, create: { nombre: 'OPERADOR', descripcion: 'Operadores de carga y consulta' }, select: { id: true } });
  const passwordHash = await bcryptHash(randomBytes(32).toString('hex'), 10);
  const user = await prisma.usuario.create({ data: { nombre: 'Sistema', apellido: 'Corpus', email, passwordHash, activo: false, rolId: role.id } });
  return user.id;
}

if (require.main === module) main().catch((error) => {
  console.error(error instanceof Error ? error.message : 'DIGESTO_IMPORT_FAILED');
  process.exitCode = 1;
});
