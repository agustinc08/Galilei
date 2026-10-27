import { createHash, randomBytes, randomUUID } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import * as bcrypt from 'bcrypt';
import { createPrismaClient } from '../../src/prisma/create-prisma-client';
import { LocalDocumentStorageAdapter } from '../../src/corpus/document-storage.adapter';

const qaDatabase = 'galilei_page_aware_suite9_fresh';
const qaHost = '127.0.0.1';
const qaPort = '55435';
const runtimeRoot = resolve(
  process.env.BJC_DEV_DB_GUARD_ENV_FILE
    ? dirname(process.env.BJC_DEV_DB_GUARD_ENV_FILE)
    : '',
);
const evidenceRoot = join(runtimeRoot, 'evidence');
const manifestPath = join(evidenceRoot, 'browser-fixture-private.json');
const scannedFixturePath = join(evidenceRoot, 'browser-scanned-fixture.json');
const sizeFixturePath = join(evidenceRoot, 'viewer-size-fixtures.json');
const setupEvidencePath = join(evidenceRoot, 'real-browser-setup.json');
const expectedCorpusStorageRoot = resolve(runtimeRoot, 'runtime', 'corpus');

function assertQaConfiguration() {
  if (
    process.env.BJC_SPRINT9_PAGE_AWARE_ALLOW_ISOLATED_DATABASE !== 'true' ||
    process.env.BJC_DEPLOYMENT_ENV !== 'development' ||
    !process.env.BJC_DEV_DB_GUARD_ENV_FILE ||
    !process.env.DATABASE_URL
  ) {
    throw new Error('SUITE9_BROWSER_FIXTURE_GUARD_REQUIRED');
  }
  const url = new URL(process.env.DATABASE_URL);
  if (
    url.protocol !== 'postgresql:' ||
    url.hostname !== qaHost ||
    url.port !== qaPort ||
    decodeURIComponent(url.username) !== 'bjc_dev' ||
    url.pathname !== `/${qaDatabase}`
  ) {
    throw new Error('SUITE9_BROWSER_FIXTURE_DATABASE_REJECTED');
  }
  if (!runtimeRoot.startsWith('C:\\proyecto triple\\_recovery-work\\')) {
    throw new Error('SUITE9_BROWSER_FIXTURE_RUNTIME_ROOT_REJECTED');
  }
  if (
    resolve(process.env.BJC_CORPUS_STORAGE_PATH ?? '') !==
    expectedCorpusStorageRoot
  ) {
    throw new Error('SUITE9_BROWSER_FIXTURE_STORAGE_ROOT_REJECTED');
  }
}

function makePdf(prefix: string, pages: string[]) {
  const objects = new Map<number, string>();
  objects.set(1, '<< /Type /Catalog /Pages 2 0 R >>');
  const pageRefs: string[] = [];
  for (let index = 0; index < pages.length; index += 1) {
    const pageId = 3 + index * 2;
    const contentId = pageId + 1;
    pageRefs.push(`${pageId} 0 R`);
    const text = `${prefix} ${pages[index]}`
      .replaceAll('\\', '\\\\')
      .replaceAll('(', '\\(')
      .replaceAll(')', '\\)');
    const stream = `BT /F1 12 Tf 48 720 Td (${text}) Tj ET`;
    objects.set(
      pageId,
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 ${3 + pages.length * 2} 0 R >> >> /Contents ${contentId} 0 R >>`,
    );
    objects.set(
      contentId,
      `<< /Length ${Buffer.byteLength(stream, 'latin1')} >>\nstream\n${stream}\nendstream`,
    );
  }
  objects.set(
    2,
    `<< /Type /Pages /Kids [${pageRefs.join(' ')}] /Count ${pages.length} >>`,
  );
  objects.set(
    3 + pages.length * 2,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  );
  const maxId = 3 + pages.length * 2;
  let output = `%PDF-1.4\n% Synthetic Suite 9 viewer QA ${prefix}\n`;
  const offsets: number[] = [0];
  for (let id = 1; id <= maxId; id += 1) {
    offsets[id] = Buffer.byteLength(output, 'latin1');
    output += `${id} 0 obj\n${objects.get(id)}\nendobj\n`;
  }
  const xrefOffset = Buffer.byteLength(output, 'latin1');
  output += `xref\n0 ${maxId + 1}\n0000000000 65535 f \n`;
  for (let id = 1; id <= maxId; id += 1) {
    output += `${String(offsets[id]).padStart(10, '0')} 00000 n \n`;
  }
  output += `trailer\n<< /Size ${maxId + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return Buffer.from(output, 'latin1');
}

function writeJson(path: string, value: unknown) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

async function assertDatabaseIdentity(prisma: ReturnType<typeof createPrismaClient>) {
  const rows = await prisma.$queryRaw<Array<{
    database: string;
    role: string;
    host: string;
    port: number;
    version: number;
  }>>`SELECT current_database() AS database, current_user AS role, inet_server_addr()::text AS host, inet_server_port() AS port, current_setting('server_version_num')::integer AS version`;
  const identity = rows[0];
  if (
    !identity ||
    identity.database !== qaDatabase ||
    identity.role !== 'bjc_dev' ||
    identity.host.split('/')[0] !== qaHost ||
    Number(identity.port) !== Number(qaPort) ||
    Number(identity.version) < 160000
  ) {
    throw new Error('SUITE9_BROWSER_FIXTURE_CONNECTED_DATABASE_REJECTED');
  }
}

async function createFixtures() {
  assertQaConfiguration();
  if (existsSync(manifestPath)) {
    throw new Error('SUITE9_BROWSER_FIXTURE_MANIFEST_ALREADY_EXISTS');
  }
  const runId = randomUUID().replaceAll('-', '').slice(0, 12);
  const titlePrefix = `suite9-browser-${runId}-`;
  const email = `${titlePrefix}admin@example.invalid`;
  const password = randomBytes(32).toString('hex');
  const manifest: Record<string, unknown> = {
    runId,
    titlePrefix,
    email,
    password,
    storageRoot: expectedCorpusStorageRoot,
    documentIds: [],
    storageKeys: [],
    syntheticOnly: true,
  };
  writeJson(manifestPath, manifest);

  const prisma = createPrismaClient();
  const storage = new LocalDocumentStorageAdapter(
    process.env.BJC_CORPUS_STORAGE_PATH,
  );
  try {
    await prisma.$connect();
    await assertDatabaseIdentity(prisma);
    const role = await prisma.rol.upsert({
      where: { nombre: 'ADMIN' },
      create: { nombre: 'ADMIN', descripcion: 'Synthetic Suite 9 browser QA' },
      update: {},
    });
    const user = await prisma.usuario.create({
      data: {
        nombre: 'Suite 9 Synthetic QA',
        email,
        passwordHash: await bcrypt.hash(password, 10),
        rolId: role.id,
      },
    });
    manifest.userId = user.id;
    writeJson(manifestPath, manifest);

    const searchBase = process.env.OPENSEARCH_NODE;
    if (searchBase !== 'http://127.0.0.1:19284') {
      throw new Error('SUITE9_BROWSER_FIXTURE_OPENSEARCH_TARGET_REJECTED');
    }
    const aliasResponse = await fetch(
      `${searchBase}/_alias/galilei-search-active`,
      { signal: AbortSignal.timeout(5_000) },
    );
    if (!aliasResponse.ok) {
      throw new Error('SUITE9_BROWSER_FIXTURE_OPENSEARCH_ALIAS_UNAVAILABLE');
    }
    const alias = (await aliasResponse.json()) as Record<string, unknown>;
    const searchTarget = Object.keys(alias)[0] ?? '';
    if (!/^galilei-search-v004-\d{8}t\d{9}z-[a-f0-9]{8}$/u.test(searchTarget)) {
      throw new Error('SUITE9_BROWSER_FIXTURE_OPENSEARCH_ALIAS_REJECTED');
    }
    manifest.searchTarget = searchTarget;

    const scanned = await prisma.corpusDocument.findFirst({
      where: {
        title: { contains: 'suite9-scanned-outage-' },
        status: 'INDEXED',
      },
      orderBy: { createdAt: 'desc' },
      include: {
        files: { orderBy: { version: 'desc' }, take: 1 },
        latestExtraction: {
          include: { pages: { where: { pageNumber: 50 }, take: 1 } },
        },
      },
    });
    const scannedFile = scanned?.files[0];
    const scannedPage = scanned?.latestExtraction?.pages[0];
    if (
      !scanned ||
      scanned.latestExtraction?.status !== 'OCR_HUMAN_APPROVED' ||
      !scannedFile ||
      scannedFile.pageCount !== 50 ||
      scannedPage?.pageNumber !== 50 ||
      !scannedPage.text.includes('suite9 approved page fifty')
    ) {
      throw new Error('SUITE9_BROWSER_FIXTURE_APPROVED_PAGE_50_NOT_FOUND');
    }
    const scannedBytes = await storage.get(scannedFile.storageKey);
    if (
      scannedBytes.subarray(0, 5).toString('ascii') !== '%PDF-' ||
      createHash('sha256').update(scannedBytes).digest('hex') !==
        scannedFile.sha256
    ) {
      throw new Error('SUITE9_BROWSER_FIXTURE_SOURCE_PDF_INTEGRITY_FAILED');
    }
    manifest.documentIds = [scanned.id];
    manifest.scannedStorageKey = scannedFile.storageKey;
    writeJson(manifestPath, manifest);
    writeJson(scannedFixturePath, {
      documentId: scanned.id,
      pageNumber: 50,
      pageCount: 50,
      sizeBytes: Number(scannedFile.sizeBytes),
      mimeType: scannedFile.mimeType,
      originalPdfSha256: scannedFile.sha256,
      syntheticOnly: true,
    });
    manifest.documentTitle = scanned.title;
    manifest.approvedPhrase = scannedPage.text;

    const targetCaseNumber = '987654/2026';
    if (!scannedPage.text.includes(`civ ${targetCaseNumber}`)) {
      throw new Error('SUITE9_BROWSER_FIXTURE_CITATION_IDENTIFIER_MISSING');
    }
    const sourceSlug = `${titlePrefix}ocr-source`;
    const targetSlug = `${titlePrefix}citation-target`;
    const decisionDate = new Date('2026-01-15T00:00:00.000Z');
    const sourceSentence = await prisma.sentencia.create({
      data: {
        slugPublico: sourceSlug,
        caratula: 'Suite 9 synthetic OCR citation source',
        tipoFallo: 'SENTENCIA',
        sala: 'Sala QA',
        fecha: decisionDate,
        expediente: '111111/2026',
        tribunalOrigen: 'Synthetic Tribunal',
        estadoCarga: 'PUBLICADO',
        publicado: true,
        publishedAt: decisionDate,
        activo: true,
        tienePdf: true,
        archivosPdf: {
          create: {
            nombreArchivo: `${titlePrefix}source.pdf`,
            nombreOriginal: `${titlePrefix}source.pdf`,
            rutaArchivo: resolve(storage.root, scannedFile.storageKey),
            mimeType: 'application/pdf',
            tamanioBytes: Number(scannedFile.sizeBytes),
          },
        },
      },
    });
    const targetSentence = await prisma.sentencia.create({
      data: {
        slugPublico: targetSlug,
        caratula: 'Suite 9 synthetic OCR citation target',
        tipoFallo: 'SENTENCIA',
        sala: 'Sala QA',
        fecha: new Date('2025-12-10T00:00:00.000Z'),
        expediente: targetCaseNumber,
        tribunalOrigen: 'Synthetic Tribunal',
        estadoCarga: 'PUBLICADO',
        publicado: true,
        publishedAt: decisionDate,
        activo: true,
      },
    });
    await prisma.corpusDocumentLink.create({
      data: {
        documentId: scanned.id,
        targetDomain: 'JURISPRUDENCIA',
        targetType: 'SENTENCIA',
        targetId: String(sourceSentence.id),
        relationship: 'ASSOCIATED_WITH',
        metadata: { syntheticOnly: true, purpose: 'suite9-ocr-citation-e2e' },
      },
    });
    manifest.sentenceIds = [sourceSentence.id, targetSentence.id];
    manifest.sourceSentenceId = sourceSentence.id;
    manifest.targetSentenceId = targetSentence.id;
    manifest.sourceSlug = sourceSlug;
    manifest.targetSlug = targetSlug;
    manifest.citationIdentifier = targetCaseNumber;
    writeJson(manifestPath, manifest);
    writeJson(scannedFixturePath, {
      documentId: scanned.id,
      pageNumber: 50,
      pageCount: 50,
      sizeBytes: Number(scannedFile.sizeBytes),
      mimeType: scannedFile.mimeType,
      originalPdfSha256: scannedFile.sha256,
      sourceSentenceId: sourceSentence.id,
      targetSentenceId: targetSentence.id,
      sourceSlug,
      targetSlug,
      citationIdentifier: targetCaseNumber,
      syntheticOnly: true,
    });

    const sizeFixtures: Array<{
      category: 'small' | 'medium';
      documentId: string;
      pageCount: number;
      bytes: number;
      sha256: string;
    }> = [];
    for (const category of ['small', 'medium'] as const) {
      const pageCount = category === 'small' ? 1 : 20;
      const pages = Array.from({ length: pageCount }, (_, index) =>
        `${category} fixture page ${index + 1} ${'controlled synthetic viewer text '.repeat(10)}`,
      );
      const bytes = makePdf(`${titlePrefix}${category}`, pages);
      if (
        (category === 'small' && bytes.byteLength > 4 * 1024) ||
        (category === 'medium' && bytes.byteLength <= 4 * 1024) ||
        bytes.byteLength > 32 * 1024
      ) {
        throw new Error(`SUITE9_BROWSER_FIXTURE_${category.toUpperCase()}_SIZE_REJECTED`);
      }
      const stored = await storage.put(`${titlePrefix}${category}.pdf`, bytes);
      const document = await prisma.corpusDocument.create({
        data: {
          documentType: 'JUDGMENT',
          title: `${titlePrefix}${category}`,
          jurisdiction: 'ARGENTINA',
          court: 'Synthetic Tribunal',
          chamber: 'Sala QA',
          caseNumber: runId,
          visibility: 'INTERNAL',
          documentScope: 'GENERAL',
          status: 'INDEXED',
          searchText: `${titlePrefix}${category}`,
          files: {
            create: {
              storageKey: stored.storageKey,
              originalFilename: `${titlePrefix}${category}.pdf`,
              mimeType: 'application/pdf',
              sizeBytes: BigInt(stored.sizeBytes),
              sha256: stored.sha256,
              pageCount,
            },
          },
        },
        include: { files: true },
      });
      const file = document.files[0];
      if (!file) throw new Error('SUITE9_BROWSER_FIXTURE_FILE_RECORD_MISSING');
      const extraction = await prisma.corpusExtraction.create({
        data: {
          documentId: document.id,
          fileId: file.id,
          extractor: 'suite9-synthetic-native-pdf-fixture',
          extractorVersion: '1',
          status: 'TEXT_NATIVE',
          text: pages
            .map((page) => `${titlePrefix}${category} ${page}`)
            .join('\n'),
          pages: {
            create: pages.map((page, index) => ({
              pageNumber: index + 1,
              text: `${titlePrefix}${category} ${page}`,
              textKind: 'NATIVE',
              processingStatus: 'TEXT_NATIVE',
            })),
          },
        },
      });
      await prisma.corpusDocument.update({
        where: { id: document.id },
        data: { latestExtractionId: extraction.id },
      });
      (manifest.documentIds as string[]).push(document.id);
      (manifest.storageKeys as string[]).push(stored.storageKey);
      writeJson(manifestPath, manifest);
      sizeFixtures.push({
        category,
        documentId: document.id,
        pageCount,
        bytes: stored.sizeBytes,
        sha256: stored.sha256,
      });
    }
    writeJson(sizeFixturePath, {
      database: `127.0.0.1:${qaPort}/${qaDatabase}`,
      syntheticOnly: true,
      fixtures: sizeFixtures,
    });
    writeJson(manifestPath, manifest);
    console.log(
      `SUITE9_BROWSER_FIXTURE_CREATED ${JSON.stringify({
        syntheticOnly: true,
        userCreated: true,
        smallAndMediumFixtures: sizeFixtures.length,
        approvedPage50: true,
        searchTarget,
      })}`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

async function cleanupFixtures() {
  assertQaConfiguration();
  const preserveApprovedOcrFixture =
    process.env.BJC_SPRINT9_PRESERVE_APPROVED_OCR_FIXTURE === 'true';
  const hasManifest = existsSync(manifestPath);
  const manifest = (hasManifest
    ? JSON.parse(readFileSync(manifestPath, 'utf8'))
    : {}) as {
    runId: string;
    titlePrefix: string;
    email: string;
    documentIds?: string[];
    storageKeys?: string[];
      storageRoot?: string;
      scannedStorageKey?: string;
      sentenceIds?: number[];
      searchTarget?: string;
  };
  if (
    hasManifest &&
    (!manifest.runId ||
      !manifest.titlePrefix?.startsWith('suite9-browser-'))
  ) {
    throw new Error('SUITE9_BROWSER_FIXTURE_MANIFEST_REJECTED');
  }
  const prisma = createPrismaClient();
  const storageRoot = resolve(manifest.storageRoot ?? process.env.BJC_CORPUS_STORAGE_PATH ?? '');
  if (storageRoot !== expectedCorpusStorageRoot) {
    throw new Error('SUITE9_BROWSER_FIXTURE_STORAGE_ROOT_REJECTED');
  }
  try {
    await prisma.$connect();
    await assertDatabaseIdentity(prisma);
    const documents = await prisma.corpusDocument.findMany({
      where: {
        OR: [
          { title: { startsWith: manifest.titlePrefix ?? 'suite9-browser-' } },
          ...(manifest.scannedStorageKey && !preserveApprovedOcrFixture
            ? [{ title: { startsWith: 'suite9-scanned-outage-' } }]
            : []),
        ],
      },
      select: { id: true, files: { select: { storageKey: true } } },
    });
    const documentIds = [
      ...new Set([
        ...(manifest.documentIds ?? []).filter(
          (id) =>
            !(
              preserveApprovedOcrFixture &&
              id === manifest.documentIds?.[0]
            ),
        ),
        ...documents.map(({ id }) => id),
      ]),
    ];
    const setup = existsSync(setupEvidencePath)
      ? (JSON.parse(readFileSync(setupEvidencePath, 'utf8')) as {
          collectionId?: string;
        })
      : null;
    if (setup?.collectionId) {
      await prisma.digestoCollectionMembership.deleteMany({
        where: { collectionId: setup.collectionId },
      });
      await prisma.digestoCollection.deleteMany({
        where: { id: setup.collectionId },
      });
    }
    const reviewRows = await prisma.ocrHumanReview.findMany({
      where: { documentId: { in: documentIds } },
      select: { id: true },
    });
    const reviewIds = reviewRows.map(({ id }) => id);
    if (reviewIds.length) {
      await prisma.ocrHumanReviewApproval.deleteMany({
        where: { reviewId: { in: reviewIds } },
      });
      await prisma.ocrHumanReview.deleteMany({ where: { id: { in: reviewIds } } });
    }
    await prisma.institutionalIngestion.deleteMany({
      where: { documentId: { in: documentIds } },
    });
    if (manifest.sentenceIds?.length) {
      await prisma.sentencia.deleteMany({
        where: { id: { in: manifest.sentenceIds } },
      });
    }
    await prisma.corpusDocument.deleteMany({ where: { id: { in: documentIds } } });
    await prisma.searchIndexOutbox.deleteMany({
      where: {
        documentKey: { in: documentIds.map((id) => `CORPUS:${id}`) },
      },
    });
    const orphanOutboxRowsRemoved = await prisma.$executeRaw`
      DELETE FROM "SearchIndexOutbox" AS outbox
       WHERE outbox."documentKey" LIKE 'CORPUS:%'
         AND (outbox."processedAt" IS NULL OR outbox."failedAt" IS NOT NULL)
         AND NOT EXISTS (
           SELECT 1
             FROM "CorpusDocument" AS document
            WHERE outbox."documentKey" = 'CORPUS:' || document."id"
         )
    `;
    const userDeleted = await prisma.usuario.deleteMany({
      where: {
        OR: [
          ...(manifest.email ? [{ email: manifest.email }] : []),
          { email: { startsWith: 'suite9-browser-' } },
        ],
      },
    });
    const storageKeys = [
      ...(manifest.storageKeys ?? []),
      ...(manifest.scannedStorageKey && !preserveApprovedOcrFixture
        ? [manifest.scannedStorageKey]
        : []),
      ...documents.flatMap(({ files }) => files.map(({ storageKey }) => storageKey)),
    ];
    const uniqueStorageKeys = [...new Set(storageKeys)];
    let storageFilesDeleted = 0;
    for (const storageKey of uniqueStorageKeys) {
      if (!/^[a-f0-9]{2}\/[a-f0-9]{64}\.[a-z0-9]{1,10}$/u.test(storageKey)) {
        throw new Error('SUITE9_BROWSER_FIXTURE_STORAGE_KEY_REJECTED');
      }
      const target = resolve(storageRoot, storageKey);
      if (!target.startsWith(`${storageRoot}${sep}`)) {
        throw new Error('SUITE9_BROWSER_FIXTURE_STORAGE_ESCAPE');
      }
      if (existsSync(target)) {
        unlinkSync(target);
        storageFilesDeleted += 1;
      }
    }
    const residualUsers = await prisma.usuario.count({
      where: { email: { startsWith: 'suite9-browser-' } },
    });
    const residualDocuments = await prisma.corpusDocument.count({
      where: {
        OR: [
          { title: { startsWith: 'suite9-browser-' } },
          ...(manifest.scannedStorageKey && !preserveApprovedOcrFixture
            ? [{ title: { startsWith: 'suite9-scanned-outage-' } }]
            : []),
        ],
      },
    });
    const syntheticSentences = await prisma.sentencia.findMany({
      where: {
        OR: [
          ...(manifest.sentenceIds?.length
            ? [{ id: { in: manifest.sentenceIds } }]
            : []),
          { slugPublico: { startsWith: 'suite9-browser-' } },
        ],
      },
      select: { id: true },
    });
    const syntheticSentenceIds = syntheticSentences.map(({ id }) => id);
    if (syntheticSentenceIds.length) {
      await prisma.sentencia.deleteMany({
        where: { id: { in: syntheticSentenceIds } },
      });
    }
    const residualSentences = await prisma.sentencia.count({
      where: { slugPublico: { startsWith: 'suite9-browser-' } },
    });
    const outboxState = await prisma.searchIndexOutbox.aggregate({
      _count: {
        _all: true,
      },
      where: {
        OR: [
          { processedAt: null, failedAt: null },
          { failedAt: { not: null } },
        ],
      },
    });
    const residualPendingOrFailedOutbox = outboxState._count._all;
    if (
      residualUsers !== 0 ||
      residualDocuments !== 0 ||
      residualSentences !== 0 ||
      residualPendingOrFailedOutbox !== 0
    ) {
      throw new Error(
        `SUITE9_BROWSER_FIXTURE_CLEANUP_RESIDUALS_DETECTED ${JSON.stringify({
          preserveApprovedOcrFixture,
          residualUsers,
          residualDocuments,
          residualSentences,
          residualPendingOrFailedOutbox,
        })}`,
      );
    }
    if (documentIds.length) {
      const searchBase = process.env.OPENSEARCH_NODE;
      if (searchBase !== 'http://127.0.0.1:19284') {
        throw new Error('SUITE9_BROWSER_FIXTURE_OPENSEARCH_TARGET_REJECTED');
      }
      const aliasResponse = await fetch(`${searchBase}/_alias/galilei-search-active`, {
        signal: AbortSignal.timeout(5_000),
      });
      if (!aliasResponse.ok) {
        throw new Error('SUITE9_BROWSER_FIXTURE_OPENSEARCH_ALIAS_UNAVAILABLE');
      }
      const alias = (await aliasResponse.json()) as Record<string, unknown>;
      const activeSearchTarget = Object.keys(alias)[0] ?? '';
      const expectedSearchTarget = manifest.searchTarget ?? activeSearchTarget;
      if (
        Object.keys(alias).length !== 1 ||
        activeSearchTarget !== expectedSearchTarget ||
        !/^galilei-search-v004-\d{8}t\d{9}z-[a-f0-9]{8}$/u.test(expectedSearchTarget)
      ) {
        throw new Error('SUITE9_BROWSER_FIXTURE_OPENSEARCH_ALIAS_REJECTED');
      }
      for (const documentId of documentIds) {
        const response = await fetch(
          `${searchBase}/${encodeURIComponent(expectedSearchTarget)}/_doc/${encodeURIComponent(documentId)}`,
          { method: 'DELETE', signal: AbortSignal.timeout(5_000) },
        );
        if (!response.ok && response.status !== 404) {
          throw new Error('SUITE9_BROWSER_FIXTURE_OPENSEARCH_DOCUMENT_CLEANUP_FAILED');
        }
      }
    }
    writeJson(join(evidenceRoot, 'browser-fixture-cleanup.json'), {
      syntheticOnly: true,
      database: `127.0.0.1:${qaPort}/${qaDatabase}`,
      documentsDeleted: documentIds.length,
      usersDeleted: userDeleted.count,
      storageFilesDeleted,
      orphanOutboxRowsRemoved,
      residualPendingOrFailedOutbox,
      residualUsers,
      residualDocuments,
      residualSentences,
      completedAt: new Date().toISOString(),
    });
    if (hasManifest) unlinkSync(manifestPath);
    console.log(
      `SUITE9_BROWSER_FIXTURE_CLEANUP_PASS ${JSON.stringify({
        documentsDeleted: documentIds.length,
        usersDeleted: userDeleted.count,
        storageFilesDeleted,
        orphanOutboxRowsRemoved,
        residualPendingOrFailedOutbox,
        residualUsers,
        residualDocuments,
        residualSentences,
      })}`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

async function main() {
  const action = process.argv[2];
  if (action === 'create') return createFixtures();
  if (action === 'cleanup') return cleanupFixtures();
  throw new Error('SUITE9_BROWSER_FIXTURE_ACTION_REJECTED');
}

main().catch((error: unknown) => {
  const safeMessage = String(error instanceof Error ? error.message : error)
    .replace(/postgres(?:ql)?:\/\/[^\s"']+/giu, '[redacted-postgresql-url]')
    .slice(0, 1600);
  console.error(safeMessage);
  process.exitCode = 1;
});
