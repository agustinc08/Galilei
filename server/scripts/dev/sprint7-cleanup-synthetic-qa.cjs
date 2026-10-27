#!/usr/bin/env node
// Removes only stale synthetic integration fixtures from the isolated Suite 7 QA services.
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { Client: OpenSearchClient } = require('@opensearch-project/opensearch');
const { Client: PgClient } = require('pg');

const expectedDb = {
  host: '127.0.0.1',
  port: 55434,
  database: 'buscador_juridico_civil_deepqa',
  role: 'bjc_dev',
};
const expectedSearch = {
  endpoint: 'http://127.0.0.1:19200',
  cluster: 'galilei-suite7-qa',
  clusterUuid: 'Vl0BD2lTTSWQkPyjhQB27Q',
  version: '2.19.6',
  alias: 'galilei-search-active',
};
const suiteRoot = path.resolve(__dirname, '../../../../');
const evidenceRoot = path.join(suiteRoot, 'evidence');
const reportPath = path.join(evidenceRoot, 'sprint7-synthetic-fixture-cleanup.json');
const validEmail = /^suite7-(operador|jurisprudencia|lector)-([a-f0-9]{12})@example\.invalid$/u;
const validFilename = /^(decision|fifty|same-name|match|ambiguous|draft|scan|cancel|idem|concurrent-a|concurrent-b)-([a-f0-9]{12})\.pdf$/u;

function assert(condition, code) {
  if (!condition) throw new Error(code);
}

function expectDatabaseUrl() {
  assert(process.env.SPRINT7_QA_FIXTURE_CLEANUP === 'true', 'SYNTHETIC_CLEANUP_NOT_ENABLED');
  assert(process.env.BJC_SPRINT7_ALLOW_ISOLATED_DATABASE === 'true', 'SPRINT7_QA_NOT_ENABLED');
  assert(process.env.BJC_DEPLOYMENT_ENV === 'development', 'SPRINT7_NOT_DEVELOPMENT');
  const raw = process.env.DATABASE_URL;
  assert(typeof raw === 'string' && raw.length > 0, 'QA_DATABASE_URL_MISSING');
  const url = new URL(raw);
  assert(
    url.hostname === expectedDb.host &&
      Number(url.port) === expectedDb.port &&
      url.pathname === `/${expectedDb.database}` &&
      decodeURIComponent(url.username) === expectedDb.role,
    'QA_DATABASE_URL_TARGET_REJECTED',
  );
}

function sentenceRunId(row, runIds) {
  for (const runId of runIds) {
    const exactCases = [
      [`QA ${runId}/2026`, `Sala QA ${runId}`, `Synthetic existing ${runId}`, true],
      [`LINK-RACE ${runId}/2026`, `Sala Link Race ${runId}`, `Link race candidate 1 ${runId}`, false],
      [`LINK-RACE ${runId}/2026`, `Sala Link Race ${runId}`, `Link race candidate 2 ${runId}`, false],
      [`AMB ${runId}/2026`, `Sala Ambigua ${runId}`, `Ambiguous QA 1 ${runId}`, false],
      [`AMB ${runId}/2026`, `Sala Ambigua ${runId}`, `Ambiguous QA 2 ${runId}`, false],
      [`NEW ${runId}/2026`, `Sala Nueva ${runId}`, `New draft ${runId}`, false],
    ];
    if (exactCases.some(([expediente, sala, caratula, publicado]) =>
      row.expediente === expediente && row.sala === sala && row.caratula === caratula && row.publicado === publicado &&
      (publicado ? row.publishedAt !== null : row.publishedAt === null))) return runId;
  }
  return null;
}

async function main() {
  expectDatabaseUrl();
  const storageRoot = path.resolve(process.env.BJC_CORPUS_STORAGE_PATH ?? '');
  const expectedStorage = path.resolve(__dirname, '../../../_recovery-work/galilei-institutional-ingestion-suite7/runtime/corpus');
  assert(storageRoot === expectedStorage, 'QA_STORAGE_ROOT_REJECTED');
  assert(fs.existsSync(storageRoot), 'QA_STORAGE_ROOT_MISSING');

  const bootstrap = JSON.parse(fs.readFileSync(path.join(evidenceRoot, 'sprint7-opensearch-qa.json'), 'utf8'));
  const target = bootstrap.target;
  assert(/^galilei-search-v004-\d{8}t\d{9}z-[a-f0-9]{8}$/u.test(target), 'QA_SEARCH_TARGET_REJECTED');

  const pg = new PgClient({ connectionString: process.env.DATABASE_URL });
  const search = new OpenSearchClient({ node: expectedSearch.endpoint });
  const report = { database: { ...expectedDb }, search: { ...expectedSearch, target }, startedAt: new Date().toISOString() };
  let transactionOpen = false;
  try {
    await pg.connect();
    const identity = (await pg.query('SELECT host(inet_server_addr()) AS host, inet_server_port()::int AS port, current_database() AS database, current_user AS role')).rows[0];
    assert(
      identity.host === expectedDb.host && identity.port === expectedDb.port &&
      identity.database === expectedDb.database && identity.role === expectedDb.role,
      'QA_DATABASE_IDENTITY_REJECTED',
    );

    const [infoResponse, healthResponse, aliasResponse] = await Promise.all([
      search.info(),
      search.cluster.health({ local: true }),
      search.indices.getAlias({ name: expectedSearch.alias }),
    ]);
    const info = infoResponse.body;
    const health = healthResponse.body;
    const aliases = aliasResponse.body;
    assert(
      info.cluster_name === expectedSearch.cluster && info.cluster_uuid === expectedSearch.clusterUuid &&
      info.version?.number === expectedSearch.version && health.status === 'green' &&
      Object.keys(aliases).length === 1 && Object.hasOwn(aliases, target),
      'QA_SEARCH_IDENTITY_REJECTED',
    );
    report.database.identity = identity;
    report.search.identity = { cluster: info.cluster_name, clusterUuid: info.cluster_uuid, version: info.version.number, health: health.status };

    const candidateUsers = (await pg.query(
      'SELECT u.id, u.email, u."passwordHash", u.nombre, u.apellido, r.nombre AS role FROM "Usuario" u JOIN "Rol" r ON r.id = u."rolId" WHERE u.email LIKE $1 ORDER BY u.id',
      ['suite7-%@example.invalid'],
    )).rows;
    const users = candidateUsers.filter((row) => {
      const match = row.email.match(validEmail);
      return match && row.passwordHash === 'synthetic-only-not-authenticated' &&
        row.nombre === 'Suite 7 QA' && row.apellido === null && row.role.toLowerCase() === match[1];
    });
    assert(users.length === candidateUsers.length, 'NON_SYNTHETIC_USER_CANDIDATE_FOUND');
    const userIds = users.map((row) => row.id);
    const runIds = [...new Set(users.map((row) => row.email.match(validEmail)[2]))];
    const intakes = userIds.length ? (await pg.query(
      'SELECT id, "createdById", "documentId" FROM "InstitutionalIngestion" WHERE "createdById" = ANY($1::int[]) ORDER BY id',
      [userIds],
    )).rows : [];
    assert(intakes.every((row) => userIds.includes(row.createdById)), 'NON_SYNTHETIC_INGESTION_FOUND');
    const intakeIds = intakes.map((row) => row.id);
    const documentIds = [...new Set(intakes.map((row) => row.documentId).filter(Boolean))];
    const intakeIdSet = new Set(intakeIds);
    const documents = documentIds.length ? (await pg.query(
      'SELECT id, visibility, "metadataOriginal" FROM "CorpusDocument" WHERE id = ANY($1::text[]) ORDER BY id',
      [documentIds],
    )).rows : [];
    assert(documents.length === documentIds.length, 'SYNTHETIC_CORPUS_DOCUMENT_MISSING');
    assert(documents.every((row) => row.visibility === 'INTERNAL'), 'NON_INTERNAL_SYNTHETIC_DOCUMENT_FOUND');

    const runIdList = runIds.length ? runIds : ['no-synthetic-run'];
    const sentences = runIds.length ? (await pg.query(
      'SELECT id, expediente, sala, caratula, publicado, "publishedAt" FROM "Sentencia" WHERE EXISTS (SELECT 1 FROM unnest($1::text[]) r WHERE position(lower(r) in lower(coalesce(expediente, $2))) > 0 OR position(lower(r) in lower(coalesce(sala, $2))) > 0 OR position(lower(r) in lower(coalesce(caratula, $2))) > 0) ORDER BY id',
      [runIdList, ''],
    )).rows : [];
    const sentenceRunIds = new Map();
    for (const row of sentences) {
      const runId = sentenceRunId(row, runIds);
      assert(runId, 'NON_SYNTHETIC_SENTENCIA_CANDIDATE_FOUND');
      sentenceRunIds.set(row.id, runId);
    }
    const sentenceIds = sentences.map((row) => row.id);
    const sentenceIdSet = new Set(sentenceIds.map(String));

    const metadataOwnedDocs = new Set();
    for (const document of documents) {
      const metadata = document.metadataOriginal;
      const owner = metadata && typeof metadata === 'object' && !Array.isArray(metadata)
        ? metadata.institutionalIngestionId : null;
      if (typeof owner === 'string' && intakeIdSet.has(owner)) metadataOwnedDocs.add(document.id);
      else assert(owner === null || owner === undefined, 'FOREIGN_INGESTION_PROVENANCE_FOUND');
    }
    const files = documentIds.length ? (await pg.query(
      'SELECT "documentId", "storageKey", "originalFilename", sha256 FROM "CorpusDocumentFile" WHERE "documentId" = ANY($1::text[]) ORDER BY "documentId", id',
      [documentIds],
    )).rows : [];
    const filesByDocument = new Map();
    const storageKeys = new Map();
    const documentRunIds = new Map();
    const rootReal = fs.realpathSync(storageRoot);
    for (const file of files) {
      const nameMatch = file.originalFilename.match(validFilename);
      assert(nameMatch && runIds.includes(nameMatch[2]), 'NON_SYNTHETIC_FILENAME_FOUND');
      documentRunIds.set(file.documentId, nameMatch[2]);
      const targetPath = path.resolve(storageRoot, ...file.storageKey.split('/'));
      assert(targetPath.startsWith(`${storageRoot}${path.sep}`), 'QA_STORAGE_ESCAPE');
      const stat = fs.lstatSync(targetPath);
      assert(stat.isFile() && !stat.isSymbolicLink(), 'QA_STORAGE_FILE_TYPE_REJECTED');
      const realPath = fs.realpathSync(targetPath);
      assert(realPath.startsWith(`${rootReal}${path.sep}`), 'QA_STORAGE_REALPATH_ESCAPE');
      const bytes = fs.readFileSync(realPath);
      const sha256 = crypto.createHash('sha256').update(bytes).digest('hex');
      assert(bytes.subarray(0, 5).equals(Buffer.from('%PDF-', 'ascii')), 'SYNTHETIC_PDF_SIGNATURE_INVALID');
      assert(sha256 === file.sha256, 'SYNTHETIC_PDF_HASH_MISMATCH');
      // The deliberate no-text OCR fixture predates the run-id comment in the
      // generated PDF header; its exact synthetic filename and stored SHA are
      // the ownership proof for that one fixture family.
      if (nameMatch[1] !== 'scan') {
        assert(bytes.toString('latin1').toLowerCase().includes(nameMatch[2]), `SYNTHETIC_PDF_RUN_ID_MISSING:${file.originalFilename}`);
      }
      if (!metadataOwnedDocs.has(file.documentId)) assert(documentIds.includes(file.documentId), 'UNOWNED_DOCUMENT_NOT_LINKED_TO_TEST');
      filesByDocument.set(file.documentId, [...(filesByDocument.get(file.documentId) ?? []), file]);
      storageKeys.set(file.storageKey, file.sha256);
    }
    assert(documentIds.every((id) => (filesByDocument.get(id)?.length ?? 0) > 0), 'SYNTHETIC_DOCUMENT_WITHOUT_PROVEN_FILE');

    const links = documentIds.length ? (await pg.query(
      'SELECT "documentId", "targetDomain", "targetType", "targetId" FROM "CorpusDocumentLink" WHERE "documentId" = ANY($1::text[]) ORDER BY "documentId"',
      [documentIds],
    )).rows : [];
    assert(links.every((row) => row.targetDomain === 'JURISPRUDENCIA' && row.targetType === 'SENTENCIA' && sentenceIdSet.has(row.targetId)), 'NON_SYNTHETIC_CORPUS_LINK_FOUND');

    const outboxKeys = [
      ...documentIds.map((id) => `CORPUS:${id}`),
      ...sentenceIds.map((id) => `JURISPRUDENCIA:SENTENCIA:${id}`),
    ];
    const searchIds = [
      ...documentIds,
      ...sentenceIds.map((id) => `JURISPRUDENCIA:SENTENCIA:${id}`),
    ];
    const sourceMarkerBySearchId = new Map([
      ...documentIds.map((id) => [id, documentRunIds.get(id)]),
      ...sentences.map((row) => [`JURISPRUDENCIA:SENTENCIA:${row.id}`, sentenceRunIds.get(row.id)]),
    ]);
    for (const id of searchIds) {
      let response;
      try {
        response = await search.get({ index: target, id });
      } catch (error) {
        if (error?.meta?.statusCode === 404) continue;
        throw error;
      }
      assert(response.body?._index === target && response.body?._id === id, 'QA_SEARCH_DELETE_SCOPE_REJECTED');
      const marker = sourceMarkerBySearchId.get(id);
      assert(typeof marker === 'string' && JSON.stringify(response.body._source ?? {}).toLowerCase().includes(marker), 'QA_SEARCH_SYNTHETIC_SOURCE_UNPROVEN');
    }

    await pg.query('BEGIN');
    transactionOpen = true;
    const deletedLinks = links.length ? await pg.query(
      'DELETE FROM "CorpusDocumentLink" WHERE "documentId" = ANY($1::text[]) OR ("targetDomain" = $2 AND "targetType" = $3 AND "targetId" = ANY($4::text[]))',
      [documentIds, 'JURISPRUDENCIA', 'SENTENCIA', sentenceIds.map(String)],
    ) : { rowCount: 0 };
    const deletedFilesForSentencias = sentenceIds.length ? await pg.query(
      'DELETE FROM "ArchivoPdf" WHERE "sentenciaId" = ANY($1::int[])', [sentenceIds],
    ) : { rowCount: 0 };
    const deletedIntakes = intakeIds.length ? await pg.query(
      'DELETE FROM "InstitutionalIngestion" WHERE id = ANY($1::text[])', [intakeIds],
    ) : { rowCount: 0 };
    const deletedSentencias = sentenceIds.length ? await pg.query(
      'DELETE FROM "Sentencia" WHERE id = ANY($1::int[])', [sentenceIds],
    ) : { rowCount: 0 };
    const deletedDocuments = documentIds.length ? await pg.query(
      'DELETE FROM "CorpusDocument" WHERE id = ANY($1::text[])', [documentIds],
    ) : { rowCount: 0 };
    const deletedOutbox = outboxKeys.length ? await pg.query(
      'DELETE FROM "SearchIndexOutbox" WHERE "documentKey" = ANY($1::text[])', [outboxKeys],
    ) : { rowCount: 0 };
    const deletedUsers = userIds.length ? await pg.query(
      'DELETE FROM "Usuario" WHERE id = ANY($1::int[])', [userIds],
    ) : { rowCount: 0 };
    const leftovers = await pg.query(
      'SELECT (SELECT count(*) FROM "InstitutionalIngestion" WHERE id = ANY($1::text[]))::int AS ingestions, (SELECT count(*) FROM "CorpusDocument" WHERE id = ANY($2::text[]))::int AS documents, (SELECT count(*) FROM "Sentencia" WHERE id = ANY($3::int[]))::int AS sentencias, (SELECT count(*) FROM "Usuario" WHERE id = ANY($4::int[]))::int AS users, (SELECT count(*) FROM "SearchIndexOutbox" WHERE "documentKey" = ANY($5::text[]))::int AS outbox',
      [intakeIds, documentIds, sentenceIds, userIds, outboxKeys],
    );
    assert(Object.values(leftovers.rows[0]).every((value) => value === 0), 'SYNTHETIC_DATABASE_CLEANUP_INCOMPLETE');
    await pg.query('COMMIT');
    transactionOpen = false;

    const deletedSearch = [];
    for (const id of searchIds) {
      try {
        await search.delete({ index: target, id, refresh: 'wait_for' });
        deletedSearch.push(id);
      } catch (error) {
        if (error?.meta?.statusCode !== 404) throw error;
      }
    }
    await search.indices.refresh({ index: target });
    const residual = await search.search({ index: target, body: { query: { ids: { values: searchIds } } }, size: Math.max(1, searchIds.length) });
    assert((residual.body?.hits?.hits ?? []).length === 0, 'SYNTHETIC_SEARCH_CLEANUP_INCOMPLETE');

    const deletedStorageFiles = [];
    const retainedSharedStorageFiles = [];
    for (const [storageKey, expectedHash] of storageKeys) {
      const refs = await pg.query('SELECT count(*)::int AS n FROM "CorpusDocumentFile" WHERE "storageKey" = $1', [storageKey]);
      if (refs.rows[0].n !== 0) {
        retainedSharedStorageFiles.push(storageKey);
        continue;
      }
      const targetPath = path.resolve(storageRoot, ...storageKey.split('/'));
      assert(targetPath.startsWith(`${storageRoot}${path.sep}`), 'QA_STORAGE_DELETE_ESCAPE');
      const stat = fs.lstatSync(targetPath);
      assert(stat.isFile() && !stat.isSymbolicLink(), 'QA_STORAGE_DELETE_TYPE_REJECTED');
      const bytes = fs.readFileSync(targetPath);
      assert(crypto.createHash('sha256').update(bytes).digest('hex') === expectedHash, 'QA_STORAGE_DELETE_HASH_MISMATCH');
      fs.unlinkSync(targetPath);
      deletedStorageFiles.push(storageKey);
    }

    report.decision = 'PASS';
    report.cleanup = {
      decision: 'PASS',
      syntheticUsers: users.length,
      syntheticRunIds: runIds.length,
      ingestions: intakes.length,
      documents: documentIds.length,
      files: files.length,
      sentencias: sentences.length,
      links: deletedLinks.rowCount,
      legacyPdfAssociations: deletedFilesForSentencias.rowCount,
      removedOutboxEvents: deletedOutbox.rowCount,
      removedUsers: deletedUsers.rowCount,
      removedIngestions: deletedIntakes.rowCount,
      removedDocuments: deletedDocuments.rowCount,
      removedSentencias: deletedSentencias.rowCount,
      deletedSearchIds: deletedSearch.length,
      deletedStorageFiles: deletedStorageFiles.length,
      retainedSharedStorageFiles,
      residualSearchIds: residual.body?.hits?.hits?.length ?? 0,
      verifiedDatabaseIdentity: true,
      verifiedSearchIdentity: true,
      filesHashVerifiedBeforeDeletion: files.length,
    };
    report.finishedAt = new Date().toISOString();
    fs.mkdirSync(evidenceRoot, { recursive: true });
    fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
    console.log(`SPRINT7_SYNTHETIC_QA_CLEANUP=PASS; users=${users.length}; ingestions=${intakes.length}; documents=${documentIds.length}; sentencias=${sentences.length}; searchIds=${deletedSearch.length}`);
  } catch (error) {
    if (transactionOpen) await pg.query('ROLLBACK').catch(() => undefined);
    report.decision = 'FAIL';
    report.error = error instanceof Error ? error.message : 'SYNTHETIC_QA_CLEANUP_FAILED';
    report.finishedAt = new Date().toISOString();
    fs.mkdirSync(evidenceRoot, { recursive: true });
    fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
    throw error;
  } finally {
    await pg.end().catch(() => undefined);
    await search.close().catch(() => undefined);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : 'SPRINT7_SYNTHETIC_QA_CLEANUP_FAILED');
  process.exitCode = 1;
});
