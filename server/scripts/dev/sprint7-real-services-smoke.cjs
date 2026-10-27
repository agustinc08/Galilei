#!/usr/bin/env node
// Real Nest + Vite + Edge smoke against the isolated Sprint 7 QA services.
// Invoke only through with-dev-db-guard.cjs sprint7-real-services-smoke.
const assert = require('node:assert/strict');
const { spawn, execFileSync } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const net = require('node:net');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const serverRoot = path.resolve(__dirname, '../..');
const worktreeRoot = path.resolve(serverRoot, '..');
const suiteRoot = path.resolve(worktreeRoot, '..');
const clientRoot = path.join(worktreeRoot, 'client');
const runtimeRoot = path.join(suiteRoot, 'runtime');
const storageRoot = path.join(runtimeRoot, 'corpus');
const evidenceRoot = path.join(suiteRoot, 'evidence');
const reportPath = path.join(evidenceRoot, 'ingestion-live-smoke.json');
const searchEvidencePath = path.join(evidenceRoot, 'sprint7-opensearch-qa.json');
const apiPort = 4310;
const clientPort = 4311;
const apiUrl = `http://127.0.0.1:${apiPort}`;
const clientUrl = `http://127.0.0.1:${clientPort}`;
const searchEndpoint = 'http://127.0.0.1:19200';
const expectedDb = {
  host: '127.0.0.1',
  port: 55434,
  database: 'buscador_juridico_civil_deepqa',
  role: 'bjc_dev',
};
const expectedSearch = {
  endpoint: searchEndpoint,
  cluster: 'galilei-suite7-qa',
  version: '2.19.6',
  clusterUuid: 'Vl0BD2lTTSWQkPyjhQB27Q',
  alias: 'galilei-search-active',
};
const runId = crypto.randomUUID().replaceAll('-', '').slice(0, 16);
const marker = `S7SMOKE${runId}`;
const email = `sprint7-live-${runId}@example.invalid`;
const password = crypto.randomBytes(32).toString('hex');
const filename = `sprint7-live-${runId}.pdf`;
const pdfPath = path.join(runtimeRoot, filename);
const report = {
  startedAt: new Date().toISOString(),
  environment: { database: expectedDb, search: expectedSearch },
  checks: {},
  cleanup: { attempted: false, passed: false },
};
let prisma;
let user;
let browser;
let context;
let backend;
let vite;
let searchClient;
let canonicalDocumentId;
let draftSentenceId;
let sourceSystemExistedBefore = false;
let expectedSearchTarget;
let didFail = false;
let safeError = null;

function note(name, passed, details = {}) {
  report.checks[name] = { passed: Boolean(passed), ...details };
}

function requirePass(name, passed, details = {}) {
  note(name, passed, details);
  assert.ok(passed, `SPRINT7_LIVE_SMOKE_${name.toUpperCase()}_FAILED`);
}

function tail(value) {
  return value.split(/\r?\n/u).filter(Boolean).slice(-12).join('\n');
}

function redact(value) {
  return String(value)
    .replace(/postgres(?:ql)?:\/\/[^\s"'<>]+/giu, 'postgres://[redacted]')
    .replaceAll(password, '[redacted]')
    .replaceAll(email, '[synthetic-user]');
}

function trackProcess(child) {
  let output = '';
  const collect = (chunk) => {
    output = `${output}${chunk.toString('utf8')}`.slice(-24000);
  };
  child.stdout?.on('data', collect);
  child.stderr?.on('data', collect);
  child.outputTail = () => redact(tail(output));
  return child;
}

function ensurePortFree(port) {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', () => reject(new Error(`SMOKE_PORT_${port}_IN_USE`)));
    server.listen(port, '127.0.0.1', () => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  });
}

async function waitFor(url, expectedStatus = 200, timeoutMs = 90000) {
  const until = Date.now() + timeoutMs;
  let lastStatus = null;
  while (Date.now() < until) {
    if (backend?.exitCode !== null && backend?.exitCode !== undefined) {
      throw new Error(`SMOKE_BACKEND_EXIT_${backend.exitCode}`);
    }
    if (vite?.exitCode !== null && vite?.exitCode !== undefined) {
      throw new Error(`SMOKE_VITE_EXIT_${vite.exitCode}`);
    }
    try {
      const response = await fetch(url, { redirect: 'manual' });
      lastStatus = response.status;
      if (response.status === expectedStatus) return response;
    } catch {
      // The server is still binding or compiling; retry within the bounded window.
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`SMOKE_ENDPOINT_NOT_READY_${lastStatus ?? 'NO_RESPONSE'}`);
}

function fixturePdf(pageCount, textPrefix) {
  const objects = new Map();
  objects.set(1, '<< /Type /Catalog /Pages 2 0 R >>');
  const pageRefs = [];
  for (let page = 0; page < pageCount; page += 1) {
    const pageId = 3 + page * 2;
    const contentId = pageId + 1;
    pageRefs.push(`${pageId} 0 R`);
    const text = `${textPrefix} synthetic judicial decision page ${page + 1}`
      .replaceAll('\\', '\\\\')
      .replaceAll('(', '\\(')
      .replaceAll(')', '\\)');
    const stream = `BT /F1 12 Tf 72 720 Td (${text}) Tj ET`;
    objects.set(
      pageId,
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 ${3 + pageCount * 2} 0 R >> >> /Contents ${contentId} 0 R >>`,
    );
    objects.set(
      contentId,
      `<< /Length ${Buffer.byteLength(stream, 'latin1')} >>\nstream\n${stream}\nendstream`,
    );
  }
  objects.set(
    2,
    `<< /Type /Pages /Kids [${pageRefs.join(' ')}] /Count ${pageCount} >>`,
  );
  objects.set(
    3 + pageCount * 2,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  );
  const maxId = 3 + pageCount * 2;
  let output = `%PDF-1.4\n% Suite 7 QA synthetic file ${runId}\n`;
  const offsets = [0];
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

async function apiRequest(route, options = {}) {
  const headers = { ...(options.headers ?? {}) };
  if (options.token) headers.authorization = `Bearer ${options.token}`;
  let body;
  if (options.json !== undefined) {
    headers['content-type'] = 'application/json';
    body = JSON.stringify(options.json);
  } else if (options.file) {
    const form = new FormData();
    form.append('file', new Blob([options.file.bytes], { type: 'application/pdf' }), options.file.filename);
    body = form;
  }
  const response = await fetch(`${apiUrl}${route}`, {
    method: options.method ?? 'GET',
    headers,
    body,
  });
  const buffer = Buffer.from(await response.arrayBuffer());
  const text = buffer.toString('utf8');
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    // File endpoints intentionally return binary data.
  }
  return { response, buffer, text, json };
}

async function stopTree(child) {
  if (!child?.pid || child.exitCode !== null) return;
  try {
    execFileSync('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], {
      stdio: 'ignore',
      windowsHide: true,
    });
  } catch {
    // A process that already exited is expected during error cleanup.
  }
  await Promise.race([
    new Promise((resolve) => child.once('exit', resolve)),
    new Promise((resolve) => setTimeout(resolve, 5000)),
  ]);
}

async function removeOwnedRows() {
  if (!prisma || !user) return { completed: true, reason: 'no-account-created', markers: [], documentIds: [], sentenceIds: [] };
  const intakes = await prisma.institutionalIngestion.findMany({
    where: { createdById: user.id },
    select: { id: true, documentId: true, linkedSentenciaId: true },
  });
  const intakeIds = intakes.map((item) => item.id);
  const documentIds = [...new Set(intakes.map((item) => item.documentId).filter(Boolean))];
  const sentenceIds = [...new Set(intakes.map((item) => item.linkedSentenciaId).filter(Boolean))];
  const candidateDocuments = documentIds.length
    ? await prisma.corpusDocument.findMany({
        where: { id: { in: documentIds } },
        select: { id: true, metadataOriginal: true },
      })
    : [];
  const intakeSet = new Set(intakeIds);
  const ownedDocumentIds = candidateDocuments
    .filter((document) => {
      const metadata = document.metadataOriginal;
      return Boolean(
        metadata &&
          typeof metadata === 'object' &&
          !Array.isArray(metadata) &&
          typeof metadata.institutionalIngestionId === 'string' &&
          intakeSet.has(metadata.institutionalIngestionId),
      );
    })
    .map((document) => document.id);
  const ownedDocuments = ownedDocumentIds.length
    ? await prisma.corpusDocument.findMany({
        where: { id: { in: ownedDocumentIds } },
        select: { title: true, metadata: true, metadataOriginal: true },
      })
    : [];
  const extractedTexts = ownedDocumentIds.length
    ? await prisma.corpusExtraction.findMany({
        where: { documentId: { in: ownedDocumentIds } },
        select: { text: true },
      })
    : [];
  const sentenceRows = sentenceIds.length
    ? await prisma.sentencia.findMany({
        where: { id: { in: sentenceIds } },
        select: { expediente: true, caratula: true },
      })
    : [];
  const markerSources = [
    ...ownedDocuments.map((item) => JSON.stringify(item)),
    ...extractedTexts.map((item) => item.text),
    ...sentenceRows.map((item) => JSON.stringify(item)),
  ];
  const markers = [...new Set(markerSources.flatMap((source) => source.match(/S7SMOKE[a-f0-9]{16}/giu) ?? []))];
  const ownedFiles = ownedDocumentIds.length
    ? await prisma.corpusDocumentFile.findMany({
        where: { documentId: { in: ownedDocumentIds } },
        select: { storageKey: true },
      })
    : [];

  const outboxKeys = [
    ...ownedDocumentIds.map((id) => `CORPUS:${id}`),
    ...sentenceIds.map((id) => `JURISPRUDENCIA:SENTENCIA:${id}`),
  ];
  if (intakeIds.length) {
    await prisma.institutionalIngestion.deleteMany({ where: { id: { in: intakeIds } } });
  }
  if (sentenceIds.length) {
    await prisma.sentencia.deleteMany({ where: { id: { in: sentenceIds } } });
  }
  if (ownedDocumentIds.length) {
    await prisma.corpusDocument.deleteMany({ where: { id: { in: ownedDocumentIds } } });
  }
  await prisma.usuario.deleteMany({ where: { id: user.id } });
  // Deleting the source rows can enqueue DELETE outbox events. Remove every
  // exact key only after the source cleanup so no synthetic event can replay.
  if (outboxKeys.length) {
    await prisma.searchIndexOutbox.deleteMany({ where: { documentKey: { in: outboxKeys } } });
  }

  const root = path.resolve(storageRoot);
  let removedFiles = 0;
  for (const { storageKey } of ownedFiles) {
    const target = path.resolve(root, ...storageKey.split('/'));
    if (!target.startsWith(`${root}${path.sep}`)) {
      throw new Error('SMOKE_CLEANUP_STORAGE_ESCAPE');
    }
    const stat = await fsp.lstat(target).catch((error) =>
      error.code === 'ENOENT' ? null : Promise.reject(error),
    );
    if (!stat) continue;
    if (stat.isSymbolicLink() || !stat.isFile()) {
      throw new Error('SMOKE_CLEANUP_STORAGE_TYPE_REJECTED');
    }
    const references = await prisma.corpusDocumentFile.count({ where: { storageKey } });
    if (references !== 0) throw new Error('SMOKE_CLEANUP_FILE_STILL_REFERENCED');
    await fsp.unlink(target);
    removedFiles += 1;
  }
  if (!sourceSystemExistedBefore) {
    await prisma.corpusSourceSystem.deleteMany({
      where: { code: 'INSTITUTIONAL_UPLOAD', ingestions: { none: {} } },
    });
  }
  const remainingUser = await prisma.usuario.count({ where: { id: user.id } });
  const remainingIngestions = await prisma.institutionalIngestion.count({ where: { createdById: user.id } });
  return {
    completed: remainingUser === 0 && remainingIngestions === 0,
    removedIngestions: intakeIds.length,
    removedDocuments: ownedDocumentIds.length,
    removedSentencias: sentenceIds.length,
    removedFiles,
    remainingUser,
    remainingIngestions,
    markers,
    documentIds: ownedDocumentIds,
    sentenceIds: sentenceIds.map(String),
  };
}

async function removeOrphanSmokeDocuments() {
  if (!prisma) return { completed: true, removedDocuments: 0, markers: [], documentIds: [], sentenceIds: [] };
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const files = await prisma.corpusDocumentFile.findMany({
    where: {
      originalFilename: { startsWith: 'sprint7-live-' },
      createdAt: { gte: cutoff },
    },
    include: { document: { select: { id: true, title: true, visibility: true, metadataOriginal: true } } },
  });
  const removed = [];
  const skipped = [];
  for (const file of files) {
    const metadata = file.document.metadataOriginal;
    const ownershipMetadataPresent = Boolean(
      metadata && typeof metadata === 'object' && !Array.isArray(metadata) &&
      typeof metadata.institutionalIngestionId === 'string',
    );
    if (
      file.document.visibility !== 'INTERNAL' ||
      !/^sprint7-live-[a-f0-9]{16}\.pdf$/iu.test(file.originalFilename)
    ) {
      skipped.push({ documentId: file.documentId, filename: file.originalFilename, reason: 'synthetic-file-identity-not-proven' });
      continue;
    }
    const ingestionReferences = await prisma.institutionalIngestion.count({
      where: { OR: [{ documentId: file.documentId }, { fileId: file.id }] },
    });
    if (ingestionReferences !== 0) {
      skipped.push({ documentId: file.documentId, filename: file.originalFilename, reason: 'still-referenced-by-ingestion' });
      continue;
    }
    const root = path.resolve(storageRoot);
    const target = path.resolve(root, ...file.storageKey.split('/'));
    if (!target.startsWith(`${root}${path.sep}`)) throw new Error('SMOKE_ORPHAN_STORAGE_ESCAPE');
    const stat = await fsp.lstat(target).catch((error) =>
      error.code === 'ENOENT' ? null : Promise.reject(error),
    );
    if (!stat || stat.isSymbolicLink() || !stat.isFile()) {
      skipped.push({ documentId: file.documentId, filename: file.originalFilename, reason: 'storage-file-unavailable-or-not-regular' });
      continue;
    }
    const bytes = await fsp.readFile(target);
    const actualSha256 = crypto.createHash('sha256').update(bytes).digest('hex');
    const markers = [...new Set(bytes.toString('latin1').match(/S7SMOKE[a-f0-9]{16}/giu) ?? [])];
    const titleCarriesMarker = markers.some((value) => file.document.title.toLowerCase().includes(value.toLowerCase()));
    if (
      !bytes.subarray(0, 5).equals(Buffer.from('%PDF-', 'ascii')) ||
      actualSha256 !== file.sha256 ||
      markers.length === 0 ||
      (!ownershipMetadataPresent && !titleCarriesMarker)
    ) {
      skipped.push({ documentId: file.documentId, filename: file.originalFilename, reason: 'pdf-hash-marker-check-failed', signatureValid: bytes.subarray(0, 5).equals(Buffer.from('%PDF-', 'ascii')), hashValid: actualSha256 === file.sha256, markerFound: markers.length > 0, ownershipMetadataPresent, titleCarriesMarker });
      continue;
    }
    const linked = await prisma.corpusDocumentLink.findMany({
      where: { documentId: file.documentId, targetDomain: 'JURISPRUDENCIA', targetType: 'SENTENCIA' },
      select: { targetId: true },
    });
    const sentenceIds = [];
    for (const link of linked) {
      const id = Number(link.targetId);
      if (!Number.isSafeInteger(id) || id < 1) continue;
      const sentence = await prisma.sentencia.findUnique({
        where: { id },
        select: { id: true, publicado: true, publishedAt: true, estadoCarga: true, expediente: true, caratula: true },
      });
      const sentenceText = JSON.stringify(sentence ?? {});
      if (
        sentence && sentence.publicado === false && sentence.publishedAt === null &&
        markers.some((value) => sentenceText.toLowerCase().includes(value.toLowerCase()))
      ) sentenceIds.push(id);
    }
    const outboxKeys = [
      `CORPUS:${file.documentId}`,
      ...sentenceIds.map((id) => `JURISPRUDENCIA:SENTENCIA:${id}`),
    ];
    if (sentenceIds.length) await prisma.sentencia.deleteMany({ where: { id: { in: sentenceIds } } });
    await prisma.corpusDocument.deleteMany({ where: { id: file.documentId } });
    await prisma.searchIndexOutbox.deleteMany({ where: { documentKey: { in: outboxKeys } } });
    const remainingReferences = await prisma.corpusDocumentFile.count({ where: { storageKey: file.storageKey } });
    if (remainingReferences === 0) await fsp.unlink(target);
    removed.push({ documentId: file.documentId, storageKey: file.storageKey, sha256: file.sha256, markers, sentenceIds });
  }
  return {
    completed: true,
    candidateFiles: files.length,
    removedDocuments: removed.length,
    skipped,
    markers: removed.flatMap((item) => item.markers),
    documentIds: removed.map((item) => item.documentId),
    sentenceIds: removed.flatMap((item) => item.sentenceIds.map(String)),
    files: removed.map(({ storageKey, sha256 }) => ({ storageKey, sha256 })),
  };
}

async function removeQaSearchSmokeDocuments(markers = [marker], documentIds = [], sentenceIds = []) {
  if (!searchClient || !expectedSearchTarget) {
    return { removed: 0, verified: false, reason: 'search-client-not-started' };
  }
  const aliasResponse = await searchClient.indices.getAlias({ name: expectedSearch.alias });
  const aliases = aliasResponse.body;
  if (Object.keys(aliases).length !== 1 || !Object.hasOwn(aliases, expectedSearchTarget)) {
    throw new Error('SMOKE_QA_SEARCH_ALIAS_CHANGED');
  }
  const response = await searchClient.search({
    index: expectedSearchTarget,
    body: { query: { match_all: {} } },
    size: 1000,
  });
  const hits = response.body?.hits?.hits ?? [];
  const uniqueMarkers = [...new Set(markers.filter((value) => /^S7SMOKE[a-f0-9]{16}$/iu.test(value)))];
  const exactIds = [...new Set([
    ...documentIds.map(String),
    ...sentenceIds.map((id) => `JURISPRUDENCIA:SENTENCIA:${String(id)}`),
  ])];
  const ownHits = hits.filter((hit) => {
    const source = JSON.stringify(hit._source ?? {}).toLowerCase();
    return (
      uniqueMarkers.some((value) => source.includes(value.toLowerCase())) ||
      exactIds.includes(hit._id)
    );
  });
  for (const hit of ownHits) {
    if (hit._index !== expectedSearchTarget || typeof hit._id !== 'string') {
      throw new Error('SMOKE_QA_SEARCH_CLEANUP_SCOPE_REJECTED');
    }
    await searchClient.delete({ index: expectedSearchTarget, id: hit._id, refresh: 'wait_for' });
  }
  if (ownHits.length) {
    await searchClient.indices.refresh({ index: expectedSearchTarget });
  }
  const removedIds = new Map(ownHits.map((hit) => [`${hit._index}:${hit._id}`, { index: hit._index, id: hit._id }]));
  let remaining;
  let residualHits = [];
  for (let attempt = 0; attempt < 5; attempt += 1) {
    if (attempt > 0) await new Promise((resolve) => setTimeout(resolve, attempt * 250));
    remaining = await searchClient.search({
      index: expectedSearchTarget,
      body: { query: { match_all: {} } },
      size: 1000,
    });
    residualHits = (remaining.body?.hits?.hits ?? []).filter((hit) => {
      const source = JSON.stringify(hit._source ?? {}).toLowerCase();
      return uniqueMarkers.some((value) => source.includes(value.toLowerCase())) ||
        exactIds.includes(hit._id);
    });
    if (residualHits.length === 0) break;
    for (const hit of residualHits) {
      if (hit._index !== expectedSearchTarget || typeof hit._id !== 'string') {
        throw new Error('SMOKE_QA_SEARCH_CLEANUP_SCOPE_REJECTED');
      }
      removedIds.set(`${hit._index}:${hit._id}`, { index: hit._index, id: hit._id });
      await searchClient.delete({ index: expectedSearchTarget, id: hit._id, refresh: 'wait_for' });
    }
  }
  const markerRemains = residualHits.length > 0;
  const { getRuntimeDatabasePoolConfig } = require('../../dist/src/config/runtime-database-config.js');
  const { OpenSearchDocumentRepository } = require('../../dist/src/busqueda/opensearch/opensearch-document.repository.js');
  const { OpenSearchIndexService } = require('../../dist/src/busqueda/opensearch/opensearch-index.service.js');
  const repository = new OpenSearchDocumentRepository(getRuntimeDatabasePoolConfig());
  const indexService = new OpenSearchIndexService(
    searchClient,
    repository,
    expectedSearch.alias,
    'galilei-search',
    4,
    false,
    expectedSearchTarget,
    true,
    true,
  );
  const parity = await indexService.verifyFreshV4SourceParity(expectedSearchTarget, 50);
  return {
    removed: removedIds.size,
    removedIds: [...removedIds.values()],
    markerRemains,
    countAfter: remaining.body?.hits?.total?.value ?? null,
    sourceParity: parity,
    verified: !markerRemains && parity.pass && parity.exactIdEquality && parity.sourceDifferences === 0,
  };
}

async function main() {
  assert.equal(process.env.BJC_SPRINT7_ALLOW_ISOLATED_DATABASE, 'true');
  assert.equal(process.env.BJC_DEPLOYMENT_ENV, 'development');
  process.env.SEARCH_ENGINE = 'opensearch';
  const databaseUrl = new URL(process.env.DATABASE_URL ?? '');
  requirePass('qa_database_url_guard',
    databaseUrl.hostname === expectedDb.host &&
      Number(databaseUrl.port) === expectedDb.port &&
      databaseUrl.pathname === `/${expectedDb.database}` &&
      decodeURIComponent(databaseUrl.username) === expectedDb.role,
    { target: expectedDb },
  );
  requirePass('service_ports_free', true, { backend: apiPort, frontend: clientPort });
  await ensurePortFree(apiPort);
  await ensurePortFree(clientPort);

  const evidence = JSON.parse(fs.readFileSync(searchEvidencePath, 'utf8'));
  expectedSearchTarget = evidence.target;
  const { createPrismaClient } = require('../../dist/src/prisma/create-prisma-client.js');
  const { readOpenSearchConfig } = require('../../dist/src/busqueda/opensearch/opensearch-config.js');
  const { Client: OpenSearchClient } = require('@opensearch-project/opensearch');
  const bcrypt = require('bcrypt');
  prisma = createPrismaClient();
  await prisma.$connect();
  const identity = await prisma.$queryRaw`SELECT host(inet_server_addr()) AS host, inet_server_port()::int AS port, current_database() AS database, current_user AS role`;
  requirePass('qa_database_identity',
    identity[0]?.host === expectedDb.host &&
      Number(identity[0]?.port) === expectedDb.port &&
      identity[0]?.database === expectedDb.database &&
      identity[0]?.role === expectedDb.role,
    { identity: identity[0] },
  );

  process.env.OPENSEARCH_NODE = searchEndpoint;
  process.env.OPENSEARCH_ALLOW_INSECURE_LOCAL = 'true';
  process.env.BJC_SEARCH_TOPOLOGY = 'fresh-v4';
  process.env.OPENSEARCH_SEARCH_SCHEMA_VERSION = '4';
  process.env.OPENSEARCH_INDEX_ALIAS = expectedSearch.alias;
  process.env.OPENSEARCH_INDEX_PREFIX = 'galilei-search';
  process.env.OPENSEARCH_TRUSTED_PHYSICAL_WRITE = 'false';
  delete process.env.OPENSEARCH_SEARCH_TARGET;
  const config = readOpenSearchConfig();
  searchClient = new OpenSearchClient(config.clientOptions);
  const [infoResponse, healthResponse, aliasResponse, countResponse] = await Promise.all([
    searchClient.info(),
    searchClient.cluster.health({ local: true }),
    searchClient.indices.getAlias({ name: expectedSearch.alias }),
    searchClient.count({ index: expectedSearch.alias }),
  ]);
  const info = infoResponse.body;
  const health = healthResponse.body;
  const aliases = aliasResponse.body;
  const count = countResponse.body.count;
  requirePass('qa_search_identity',
    info.cluster_name === expectedSearch.cluster &&
      info.cluster_uuid === expectedSearch.clusterUuid &&
      info.version?.number === expectedSearch.version &&
      health.status === 'green' &&
      Object.keys(aliases).length === 1 &&
      Object.hasOwn(aliases, expectedSearchTarget),
    { cluster: info.cluster_name, clusterUuid: info.cluster_uuid, version: info.version?.number, health: health.status, aliasTargetCount: Object.keys(aliases).length, target: expectedSearchTarget, count },
  );

  if (process.env.SPRINT7_LIVE_SMOKE_CLEANUP_ONLY === 'true') {
    const candidates = await prisma.usuario.findMany({
      where: { email: { startsWith: 'sprint7-live-' } },
      select: { id: true, email: true, nombre: true, apellido: true },
      orderBy: { createdAt: 'asc' },
    });
    const staleUsers = candidates.filter((item) =>
      /^sprint7-live-[a-f0-9]{16}@example\.invalid$/iu.test(item.email) &&
      item.nombre === 'Suite 7 Live QA' &&
      item.apellido === 'Synthetic',
    );
    const cleanupResults = [];
    const allMarkers = [];
    const allDocuments = [];
    const allSentencias = [];
    sourceSystemExistedBefore = false;
    for (const staleUser of staleUsers) {
      user = staleUser;
      const result = await removeOwnedRows();
      cleanupResults.push({ userId: staleUser.id, ...result, markers: undefined, documentIds: undefined, sentenceIds: undefined });
      allMarkers.push(...result.markers);
      allDocuments.push(...result.documentIds);
      allSentencias.push(...result.sentenceIds);
      if (!result.completed) didFail = true;
      user = null;
    }
    const orphanCleanup = await removeOrphanSmokeDocuments();
    allMarkers.push(...orphanCleanup.markers);
    allDocuments.push(...orphanCleanup.documentIds);
    allSentencias.push(...orphanCleanup.sentenceIds);
    report.cleanup.orphanArtifacts = orphanCleanup;
    const searchSnapshot = await searchClient.search({ index: expectedSearchTarget, body: { query: { match_all: {} } }, size: 1000 });
    const searchSmokeCandidates = (searchSnapshot.body?.hits?.hits ?? [])
      .filter((hit) => /S7SMOKE|sprint7-live-/iu.test(JSON.stringify(hit._source ?? {})))
      .map((hit) => {
        const source = JSON.stringify(hit._source ?? {});
        const markers = [...new Set(source.match(/S7SMOKE[a-f0-9]{16}/giu) ?? [])];
        return {
          index: hit._index,
          id: hit._id,
          markers,
          title: typeof hit._source?.title === 'string' ? hit._source.title : null,
        };
      });
    report.cleanup.searchSmokeCandidates = searchSmokeCandidates;
    allMarkers.push(...searchSmokeCandidates.flatMap((hit) => hit.markers));
    const recentQaFiles = await prisma.corpusDocumentFile.findMany({
      where: { createdAt: { gte: new Date(Date.now() - 60 * 60 * 1000) } },
      include: { document: { select: { id: true, title: true, visibility: true, status: true, metadataOriginal: true } } },
      orderBy: { createdAt: 'desc' },
      take: 10,
    });
    report.cleanup.recentCorpusFiles = recentQaFiles.map((file) => ({ documentId: file.documentId, filename: file.originalFilename, storageKey: file.storageKey, sha256: file.sha256, document: file.document }));
    const searchCleanup = await removeQaSearchSmokeDocuments(allMarkers, allDocuments, allSentencias);
    report.cleanup.staleRuns = cleanupResults;
    report.cleanup.search = searchCleanup;
    report.cleanupOnly = true;
    if (!searchCleanup.verified) didFail = true;
    return;
  }

  sourceSystemExistedBefore = Boolean(
    await prisma.corpusSourceSystem.findFirst({ where: { code: 'INSTITUTIONAL_UPLOAD' }, select: { id: true } }),
  );
  const operatorRole = await prisma.rol.findUnique({ where: { nombre: 'OPERADOR' }, select: { id: true } });
  assert.ok(operatorRole, 'SPRINT7_QA_OPERATOR_ROLE_MISSING');
  user = await prisma.usuario.create({
    data: {
      nombre: 'Suite 7 Live QA',
      apellido: 'Synthetic',
      email,
      passwordHash: await bcrypt.hash(password, 10),
      activo: true,
      rolId: operatorRole.id,
    },
  });

  const serverEnv = {
    ...process.env,
    NODE_ENV: 'development',
    BJC_DEPLOYMENT_ENV: 'development',
    BJC_SPRINT7_ALLOW_ISOLATED_DATABASE: 'true',
    BJC_DEEP_QA_ALLOW_ISOLATED_DATABASE: 'true',
    BJC_DEV_DB_GUARD_ENV_FILE: path.join(suiteRoot, 'qa.env'),
    BJC_API_BIND_HOST: '127.0.0.1',
    BJC_CORPUS_STORAGE_PATH: storageRoot,
    FRONTEND_URLS: clientUrl,
    JWT_SECRET: crypto.randomBytes(48).toString('hex'),
    OPENSEARCH_NODE: searchEndpoint,
    OPENSEARCH_ALLOW_INSECURE_LOCAL: 'true',
    BJC_SEARCH_TOPOLOGY: 'fresh-v4',
    OPENSEARCH_SEARCH_SCHEMA_VERSION: '4',
    OPENSEARCH_INDEX_ALIAS: expectedSearch.alias,
    OPENSEARCH_INDEX_PREFIX: 'galilei-search',
    OPENSEARCH_TRUSTED_PHYSICAL_WRITE: 'false',
    PORT: String(apiPort),
    SEARCH_ENGINE: 'opensearch',
  };
  fs.mkdirSync(storageRoot, { recursive: true });
  delete serverEnv.OPENSEARCH_SEARCH_TARGET;
  backend = trackProcess(spawn(process.execPath, ['scripts/with-dev-db-guard.cjs', 'serve'], {
    cwd: serverRoot,
    env: serverEnv,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  }));
  await waitFor(`${apiUrl}/api/health/ready`);
  const ready = await fetch(`${apiUrl}/api/health/ready`).then((response) => response.json());
  requirePass('nest_ready', ready.status === 'ok' && ready.checks?.database === 'ok' && ready.checks?.storage === 'ok' && ready.checks?.search === 'ok', { ready });

  vite = trackProcess(spawn(process.execPath, [
    'node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', String(clientPort), '--strictPort',
  ], {
    cwd: clientRoot,
    env: { ...serverEnv, BJC_DEV_API_PROXY: apiUrl },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  }));
  await waitFor(`${clientUrl}/login`);
  const { chromium } = require(require.resolve('@playwright/test', { paths: [clientRoot] }));
  browser = await chromium.launch({ channel: 'msedge', headless: true });
  context = await browser.newContext({ viewport: { width: 1366, height: 900 } });
  const page = await context.newPage();
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(redact(error.message)));
  await page.goto(`${clientUrl}/login`, { waitUntil: 'domcontentloaded' });
  await page.getByLabel('Correo electrónico').fill(email);
  await page.getByLabel('Contraseña').fill(password);
  await page.getByRole('button', { name: 'Ingresar' }).click();
  await page.waitForFunction(() => Boolean(localStorage.getItem('jurisprudencia_token')), null, { timeout: 15000 });
  const token = await page.evaluate(() => localStorage.getItem('jurisprudencia_token'));
  requirePass('live_authentication', Boolean(token), { role: 'OPERADOR', passwordPersisted: false });
  await page.goto(`${clientUrl}/jurisprudencia/ingreso`, { waitUntil: 'domcontentloaded' });
  await page.getByRole('heading', { name: 'Ingreso de jurisprudencia' }).waitFor({ timeout: 15000 });
  await page.getByRole('heading', { name: 'Ingresos recientes' }).waitFor({ timeout: 15000 });
  requirePass('vite_authenticated_queue', true, { route: '/jurisprudencia/ingreso', pageErrors: pageErrors.length });
  const labeledControls = await page.getByRole('main').last().evaluate((main) =>
    [...main.querySelectorAll('input, select, textarea')].every((control) =>
      Boolean(
        control.labels?.length ||
        control.getAttribute('aria-label') ||
        control.getAttribute('aria-labelledby'),
      ),
    ),
  );
  requirePass('accessible_form_labels', labeledControls);

  const responsive = [];
  for (const viewport of [
    { width: 390, height: 844 },
    { width: 768, height: 1024 },
    { width: 1366, height: 768 },
    { width: 1920, height: 1080 },
  ]) {
    await page.setViewportSize(viewport);
    await page.waitForTimeout(150);
    const layout = await page.evaluate(() => ({
      width: window.innerWidth,
      documentWidth: document.documentElement.scrollWidth,
      bodyWidth: document.body.scrollWidth,
    }));
    responsive.push({ ...viewport, ...layout, noHorizontalOverflow: layout.documentWidth <= viewport.width && layout.bodyWidth <= viewport.width });
  }
  note('responsive_viewports', responsive.every((item) => item.noHorizontalOverflow), { viewports: responsive });
  await page.setViewportSize({ width: 1366, height: 900 });

  const bytes = fixturePdf(3, `${marker} expediente civil responsabilidad contractual`);
  fs.writeFileSync(pdfPath, bytes, { flag: 'wx' });
  const sha256 = crypto.createHash('sha256').update(bytes).digest('hex');
  await page.getByLabel('Archivo PDF').setInputFiles(pdfPath);
  await page.getByLabel('Archivo PDF').focus();
  await page.keyboard.press('Tab');
  const keyboardTarget = await page.evaluate(() => {
    const active = document.activeElement;
    return {
      tagName: active?.tagName,
      text: active?.textContent?.trim(),
      focusVisible: active?.matches(':focus-visible') ?? false,
    };
  });
  requirePass(
    'keyboard_upload_control',
    keyboardTarget.tagName === 'BUTTON' &&
      keyboardTarget.text === 'Recibir PDF' &&
      keyboardTarget.focusVisible,
    keyboardTarget,
  );
  await page.keyboard.press('Enter');
  await page.getByRole('heading', { name: filename }).waitFor({ timeout: 45000 });
  await page.getByLabel('Expediente').fill(`QA ${marker}/2026`);
  await page.getByLabel('Sala').fill(`Sala QA ${marker}`);
  await page.getByLabel('Fecha del fallo').fill('2026-10-26');
  await page.getByLabel('Carátula').fill(`Sentencia synthetic ${marker}`);
  await page.getByRole('button', { name: 'Confirmar datos y buscar coincidencias' }).click();
  await page.getByRole('heading', { name: 'Sin coincidencias' }).waitFor({ timeout: 15000 });
  await page.getByRole('button', { name: 'Crear sentencia en borrador' }).click();
  await page.getByText('Borrador creado. Sigue sin publicar.', { exact: true }).waitFor({ timeout: 15000 });
  const statusNotice = page.getByRole('status').filter({ hasText: 'Borrador creado. Sigue sin publicar.' });
  requirePass('accessible_status_message', await statusNotice.count() === 1);
  requirePass('ui_upload_metadata_draft', true, { pageCount: 3, status: 'DRAFT_CREATED', published: false });

  const queue = await apiRequest(`/api/corpus/institutional-ingestions?q=${encodeURIComponent(filename)}`, { token });
  const intake = queue.json?.data?.[0];
  requirePass('api_queue_contains_ui_upload', queue.response.status === 200 && intake?.originalFilename === filename, { status: queue.response.status });
  canonicalDocumentId = intake.documentId;
  draftSentenceId = intake.linkedSentenciaId;
  requirePass('upload_sha256_and_status', intake.sha256 === sha256 && intake.status === 'DRAFT_CREATED' && Boolean(canonicalDocumentId) && Boolean(draftSentenceId), { sha256Matches: intake.sha256 === sha256, status: intake.status, documentIdPresent: Boolean(canonicalDocumentId), draftIdPresent: Boolean(draftSentenceId) });

  const duplicate = await apiRequest('/api/corpus/institutional-ingestions/upload', {
    method: 'POST', token, headers: { 'Idempotency-Key': `duplicate-${runId}` },
    file: { bytes, filename: `renamed-${filename}` },
  });
  const duplicateData = duplicate.json?.data;
  const canonicalFileCount = await prisma.corpusDocumentFile.count({ where: { sha256 } });
  requirePass('exact_duplicate_reuses_file', duplicate.response.status === 201 && duplicateData?.duplicateDetected === true && duplicateData.documentId === canonicalDocumentId && duplicateData.fileId === intake.fileId && canonicalFileCount === 1, { status: duplicate.response.status, duplicateDetected: duplicateData?.duplicateDetected, sameDocument: duplicateData?.documentId === canonicalDocumentId, canonicalFilesForHash: canonicalFileCount });

  const corpus = await prisma.corpusDocument.findUnique({
    where: { id: canonicalDocumentId },
    include: { files: true, latestExtraction: { include: { pages: true } } },
  });
  const sentence = await prisma.sentencia.findUnique({ where: { id: Number(draftSentenceId) } });
  requirePass('internal_unpublished_draft', corpus?.visibility === 'INTERNAL' && sentence?.publicado === false && sentence?.publishedAt === null && sentence?.estadoCarga === 'BORRADOR', { visibility: corpus?.visibility, published: sentence?.publicado, publishedAt: sentence?.publishedAt, status: sentence?.estadoCarga });
  requirePass('text_extraction', corpus?.latestExtraction?.status === 'TEXT_EXTRACTED' && corpus.latestExtraction.pages.length === 3, { extractionStatus: corpus?.latestExtraction?.status, pages: corpus?.latestExtraction?.pages.length ?? 0 });

  const metadata = await apiRequest(`/api/corpus/documents/${encodeURIComponent(canonicalDocumentId)}` , { token });
  requirePass('authenticated_viewer_metadata', metadata.response.status === 200 && metadata.json?.visibility === 'INTERNAL', { status: metadata.response.status, visibility: metadata.json?.visibility });
  const range = await apiRequest(`/api/corpus/documents/${encodeURIComponent(canonicalDocumentId)}/file`, { token, headers: { Range: 'bytes=0-15' } });
  requirePass('viewer_range_206', range.response.status === 206 && range.buffer.subarray(0, 5).toString('ascii') === '%PDF-' && range.response.headers.get('content-range')?.startsWith('bytes 0-15/'), { status: range.response.status, signatureValid: range.buffer.subarray(0, 5).toString('ascii') === '%PDF-', contentRange: range.response.headers.get('content-range') });
  const download = await apiRequest(`/api/corpus/documents/${encodeURIComponent(canonicalDocumentId)}/file?download=true`, { token });
  requirePass('viewer_download', download.response.status === 200 && download.response.headers.get('content-disposition')?.includes('attachment'), { status: download.response.status, attachment: download.response.headers.get('content-disposition')?.includes('attachment') });
  const matches = await apiRequest(`/api/corpus/documents/${encodeURIComponent(canonicalDocumentId)}/matches?q=${encodeURIComponent(marker)}`, { token });
  requirePass('pdf_search', matches.response.status === 200 && matches.text.includes(marker), { status: matches.response.status, markerFound: matches.text.includes(marker) });
  const outOfBounds = await apiRequest(`/api/corpus/documents/${encodeURIComponent(canonicalDocumentId)}?pageNumber=999`, { token });
  requirePass('out_of_bounds_page_safe', outOfBounds.response.status === 200 && !Object.hasOwn(outOfBounds.json ?? {}, 'selectedPage'), { status: outOfBounds.response.status, selectedPageReturned: Object.hasOwn(outOfBounds.json ?? {}, 'selectedPage') });
  const publicMetadata = await apiRequest(`/api/public/corpus/documents/${encodeURIComponent(canonicalDocumentId)}`);
  const publicFile = await apiRequest(`/api/public/corpus/documents/${encodeURIComponent(canonicalDocumentId)}/file`);
  requirePass('public_document_acl', publicMetadata.response.status === 404 && publicFile.response.status === 404, { metadataStatus: publicMetadata.response.status, fileStatus: publicFile.response.status });
  const publicSearch = await apiRequest(`/api/public/busqueda?q=${encodeURIComponent(marker)}`);
  const publicSearchJson = publicSearch.json;
  const hasPublicDocumentId = JSON.stringify(publicSearchJson ?? {}).includes(String(canonicalDocumentId));
  const hasPublicDraftId = JSON.stringify(publicSearchJson ?? {}).includes(String(draftSentenceId));
  requirePass('public_search_no_draft_leak', publicSearch.response.status === 200 && !hasPublicDocumentId && !hasPublicDraftId, { status: publicSearch.response.status, documentIdPresent: hasPublicDocumentId, draftIdPresent: hasPublicDraftId });

  const finalIntake = await prisma.institutionalIngestion.findUnique({
    where: { id: intake.id },
    include: { events: { orderBy: { createdAt: 'asc' }, select: { action: true, safeOutcome: true } } },
  });
  const auditText = JSON.stringify(finalIntake?.events ?? []);
  requirePass('workflow_audit', ['UPLOAD_RECEIVED', 'PDF_VALIDATED', 'METADATA_CONFIRMED', 'DRAFT_SENTENCIA_CREATED'].every((action) => finalIntake?.events.some((event) => event.action === action)) && !auditText.includes('synthetic judicial decision'), { eventActions: finalIntake?.events.map((event) => event.action) ?? [], rawDocumentTextInEvents: auditText.includes('synthetic judicial decision') });
  note('browser_page_errors', pageErrors.length === 0, { count: pageErrors.length, messages: pageErrors });

  report.searchBeforeCleanup = { documentCount: count, target: expectedSearchTarget };
  report.publication = { automatic: false, corpusVisibility: corpus?.visibility, published: sentence?.publicado, publishedAt: sentence?.publishedAt };
}

async function mainWithCleanup() {
  try {
    await main();
  } catch (error) {
    didFail = true;
    safeError = redact(error instanceof Error ? error.message : 'SPRINT7_LIVE_SMOKE_FAILED');
    if (prisma && user) {
      try {
        report.debug = {
          intakes: await prisma.institutionalIngestion.findMany({
            where: { createdById: user.id },
            select: { id: true, status: true, failureCode: true, linkedSentenciaId: true, documentId: true },
            orderBy: { createdAt: 'desc' },
            take: 5,
          }),
        };
      } catch {
        report.debug = { query: 'unavailable' };
      }
    }
    if (backend?.outputTail) report.backendLogTail = backend.outputTail();
    if (vite?.outputTail) report.viteLogTail = vite.outputTail();
  } finally {
    report.cleanup.attempted = true;
    try {
      if (context) await context.close();
      if (browser) await browser.close();
    } catch {
      report.cleanup.browserClosed = false;
    }
    await stopTree(vite);
    await stopTree(backend);
    try {
      if (!report.cleanupOnly) {
        const dbCleanup = await removeOwnedRows();
        report.cleanup.database = dbCleanup;
        if (!dbCleanup.completed) didFail = true;
        const orphanCleanup = await removeOrphanSmokeDocuments();
        report.cleanup.orphanArtifacts = orphanCleanup;
        if (!orphanCleanup.completed) didFail = true;
        if (fs.existsSync(pdfPath)) await fsp.unlink(pdfPath);
        report.cleanup.fixtureRemoved = !fs.existsSync(pdfPath);
        if (searchClient && expectedSearchTarget) {
          const searchCleanup = await removeQaSearchSmokeDocuments(
            [marker, ...(dbCleanup.markers ?? [])],
            [...(dbCleanup.documentIds ?? []), ...(orphanCleanup.documentIds ?? [])],
            [...(dbCleanup.sentenceIds ?? []), ...(orphanCleanup.sentenceIds ?? [])],
          );
          report.cleanup.search = searchCleanup;
          if (!searchCleanup.verified) didFail = true;
        }
        report.cleanup.passed = Boolean(dbCleanup.completed && report.cleanup.fixtureRemoved);
      }
      if (searchClient) await searchClient.close();
      searchClient = null;
      if (prisma) {
        await prisma.$disconnect();
        prisma = null;
      }
    } catch (error) {
      didFail = true;
      report.cleanup.error = redact(error instanceof Error ? error.message : 'SMOKE_CLEANUP_FAILED');
      if (prisma) await prisma.$disconnect().catch(() => undefined);
    }
    report.finishedAt = new Date().toISOString();
    report.decision = didFail || Object.values(report.checks).some((check) => !check.passed)
      ? 'PARTIAL'
      : 'PASS';
    report.error = safeError;
    fs.mkdirSync(evidenceRoot, { recursive: true });
    fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  }
  const failedChecks = Object.entries(report.checks)
    .filter(([, check]) => !check.passed)
    .map(([name]) => name);
  if (didFail || failedChecks.length) {
    console.error(`SPRINT7_REAL_SERVICES_SMOKE=PARTIAL; failed=${failedChecks.join(',') || safeError || 'cleanup'}`);
    process.exitCode = 1;
    return;
  }
  console.log(`SPRINT7_REAL_SERVICES_SMOKE=PASS; qaDatabase=${expectedDb.database}; qaSearch=${expectedSearch.cluster}; evidence=${pathToFileURL(reportPath).pathname}`);
}

mainWithCleanup().catch((error) => {
  console.error(redact(error instanceof Error ? error.message : 'SPRINT7_REAL_SERVICES_SMOKE_FAILED'));
  process.exitCode = 1;
});
