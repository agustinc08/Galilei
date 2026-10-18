import fs from 'node:fs';
import path from 'node:path';
import { Pool } from 'pg';
import { Client } from '@opensearch-project/opensearch';
import { readOpenSearchConfig } from '../../src/busqueda/opensearch/opensearch-config';

type QueryResult = { rows: Array<Record<string, unknown>> };
type SearchBody = {
  aggregations?: Record<
    string,
    { buckets?: Array<{ key: string; doc_count: number }> }
  >;
};

loadLocalEnvironment();
let reportDirectory = '';

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error('DEV_DATABASE_URL_REQUIRED');
  const target = new URL(databaseUrl);
  if (
    target.protocol !== 'postgresql:' ||
    target.hostname !== '127.0.0.1' ||
    target.port !== '55432' ||
    target.pathname !== '/buscador_juridico_civil_dev' ||
    target.username !== 'bjc_dev'
  ) {
    throw new Error('SEARCH_CENSUS_DATABASE_TARGET_REJECTED');
  }

  reportDirectory = path.resolve(
    process.cwd(),
    '..',
    '..',
    '_recovery-work',
    'search-engine-integration1',
  );
  fs.mkdirSync(reportDirectory, { recursive: true });
  const pool = new Pool({
    connectionString: databaseUrl,
    max: 2,
    statement_timeout: 30_000,
  });
  const client = new Client(readOpenSearchConfig().clientOptions);
  let transaction = false;
  try {
    const pg = await pool.connect();
    try {
      await pg.query('BEGIN READ ONLY');
      transaction = true;
      await pg.query("SET LOCAL statement_timeout = '30s'");
      const corpusRows = (await pg.query(corpusUniverseSql)) as QueryResult;
      const publicationRows = (await pg.query(publicationSql)) as QueryResult;
      const sentencePublicationRows = (await pg.query(
        sentencePublicationSql,
      )) as QueryResult;
      const sameShaRows = (await pg.query(sameShaSql)) as QueryResult;
      const outboxRows = (await pg.query(outboxSql)) as QueryResult;
      const corpusManifestRows = (await pg.query(
        corpusEligibilityManifestSql,
      )) as QueryResult;
      const sumarioManifestRows = (await pg.query(
        sumarioEligibilityManifestSql,
      )) as QueryResult;
      const sentenciaManifestRows = (await pg.query(
        sentenciaEligibilityManifestSql,
      )) as QueryResult;
      const excludedRows = (await pg.query(
        excludedEligibilityCountsSql,
      )) as QueryResult;
      await pg.query('COMMIT');
      transaction = false;

      const healthResponse = await client.cluster.health();
      const health =
        bodyOf<{ status?: string }>(healthResponse).status ?? 'unknown';
      const aliasResponse = await client.indices.getAlias({
        name: process.env.OPENSEARCH_INDEX_ALIAS ?? 'galilei-search-active',
      });
      const aliases =
        bodyOf<Record<string, { aliases?: Record<string, unknown> }>>(
          aliasResponse,
        );
      const activePhysical = Object.keys(aliases);
      if (activePhysical.length !== 1)
        throw new Error('SEARCH_CENSUS_ALIAS_TARGET_INVALID');
      const mappingResponse = await client.indices.getMapping({
        index: activePhysical[0],
      });
      const mapping =
        bodyOf<
          Record<
            string,
            { mappings?: { _meta?: { galileiSearchSchemaVersion?: number } } }
          >
        >(mappingResponse);
      const schemaVersion =
        mapping[activePhysical[0]]?.mappings?._meta
          ?.galileiSearchSchemaVersion ?? null;
      const aggregationResponse = await client.search({
        index: process.env.OPENSEARCH_INDEX_ALIAS ?? 'galilei-search-active',
        body: {
          size: 0,
          track_total_hits: true,
          aggs: Object.fromEntries(
            [
              'sourceSystem',
              'sourceType',
              'documentType',
              'documentScope',
              'visibility',
              'publicationStatus',
              'status',
            ].map((field) => [field, { terms: { field, size: 100 } }]),
          ),
        },
      });
      const aggregationBody = bodyOf<SearchBody>(aggregationResponse);
      const distributions = Object.fromEntries(
        Object.entries(aggregationBody.aggregations ?? {}).map(
          ([field, agg]) => [
            field,
            Object.fromEntries(
              (agg.buckets ?? []).map((bucket) => [
                bucket.key,
                bucket.doc_count,
              ]),
            ),
          ],
        ),
      );

      const corpus = corpusRows.rows.map((row) => ({
        category: String(row.category),
        documentType: String(row.documentType),
        visibility: String(row.visibility),
        status: String(row.status),
        count: Number(row.count),
      }));
      const corpusEligible = corpus.reduce((sum, row) => sum + row.count, 0);
      const juris = publicationRows.rows[0] ?? {};
      const sentencia = sentencePublicationRows.rows[0] ?? {};
      const sameSha = sameShaRows.rows[0] ?? {};
      const outbox = outboxRows.rows[0] ?? {};
      const indexTotal = Object.values(distributions.sourceSystem ?? {}).reduce(
        (sum, count) => sum + Number(count),
        0,
      );

      writeReport('search-universe-breakdown.json', {
        generatedAt: new Date().toISOString(),
        target: 'bjc_dev@127.0.0.1:55432/buscador_juridico_civil_dev',
        readOnlyTransaction: true,
        totalEligible: corpusEligible + Number(juris.activeSumarioRecords ?? 0),
        corpusEligible,
        jurisprudenciaActiveSumarioRecords: Number(
          juris.activeSumarioRecords ?? 0,
        ),
        jurisprudenciaPublishedActiveSumarioRecords: Number(
          juris.publishedActiveSumarioRecords ?? 0,
        ),
        jurisprudenciaUnpublishedOrReviewActiveSumarioRecords: Number(
          juris.unpublishedOrReviewActiveSumarioRecords ?? 0,
        ),
        jurisprudenciaSentenciasWithActiveSumarioDistinct: Number(
          juris.activeSentenciasDistinct ?? 0,
        ),
        jurisprudenciaSentenciasWithPublishedActiveSumarioAndPublishedSentenceDistinct:
          Number(juris.publishedActiveSentenciasDistinct ?? 0),
        jurisprudenciaSentenciasInUnpublishedOrReviewSumarioPairsDistinct:
          Number(juris.unpublishedOrReviewActiveSentenciasDistinct ?? 0),
        jurisprudenciaAllActiveSentenciasDistinct: Number(
          sentencia.activeSentenciasDistinct ?? 0,
        ),
        jurisprudenciaAllPublishedActiveSentenciasDistinct: Number(
          sentencia.publishedActiveSentenciasDistinct ?? 0,
        ),
        jurisprudenciaAllUnpublishedOrReviewActiveSentenciasDistinct: Number(
          sentencia.unpublishedOrReviewActiveSentenciasDistinct ?? 0,
        ),
        jurisprudenciaPublishedActiveSentenciasWithoutPublishedActiveSumario:
          Number(sentencia.publishedWithoutPublishedActiveSumarioDistinct ?? 0),
        jurisprudenciaPublishedActiveSentenciasWithoutAnyActiveSumario: Number(
          sentencia.publishedWithoutAnyActiveSumarioDistinct ?? 0,
        ),
        corpusCategoriesMutuallyExclusive: corpus,
        corpusCategorySumMatchesEligible:
          corpus.reduce((sum, row) => sum + row.count, 0) === corpusEligible,
        sameSha: {
          duplicateShaGroups: Number(sameSha.duplicateShaGroups ?? 0),
          documentsInDuplicateShaGroups: Number(
            sameSha.documentsInDuplicateShaGroups ?? 0,
          ),
          groupsWithMultipleVisibilityClasses: Number(
            sameSha.groupsWithMultipleVisibilityClasses ?? 0,
          ),
        },
        explanation:
          'The active-index universe combines eligible CorpusDocument records (GENERAL PUBLIC/INTERNAL and PRIVATE_WORKSPACE) with active Sumario records whose Sentencia is active. Corpus-only count is not the index total. Jurisprudencia index identity is one ID per active Sumario record, not one per distinct Sentencia. Directly published active Sentencias without a published active Sumario are counted separately because the legacy public endpoint can return them but the current index projection does not represent them. Private Corpus rows are isolated by documentScope and query-time ACL; general Corpus search filters documentScope=GENERAL.',
      });
      const eligibilityEntries = [
        ...corpusManifestRows.rows,
        ...sumarioManifestRows.rows,
        ...sentenciaManifestRows.rows,
      ].map((row) => ({
        logicalSearchId: String(row.logicalSearchId),
        documentKind: String(row.documentKind),
        sourceEntity: String(row.sourceEntity),
        sourceId: String(row.sourceId),
        searchEligible: true,
        publicationState: String(row.publicationState),
        visibilityMode: String(row.visibilityMode),
        dependencyId:
          typeof row.dependencyId === 'string' ? row.dependencyId : null,
        ownerId: typeof row.ownerId === 'number' ? row.ownerId : null,
        reasonIncluded: String(row.reasonIncluded),
        reasonExcluded: null,
      }));
      writeReport('search-eligibility-manifest.json', {
        generatedAt: new Date().toISOString(),
        target: 'bjc_dev@127.0.0.1:55432/buscador_juridico_civil_dev',
        readOnlyTransaction: true,
        manifestScope: 'All PostgreSQL-eligible logical Search documents.',
        expectedEligibleCount: eligibilityEntries.length,
        expectedCorpus: corpusManifestRows.rows.length,
        expectedSumario: sumarioManifestRows.rows.length,
        expectedSentencia: sentenciaManifestRows.rows.length,
        excludedCounts: Object.fromEntries(
          Object.entries(excludedRows.rows[0] ?? {}).map(([key, value]) => [
            key,
            Number(value),
          ]),
        ),
        records: eligibilityEntries,
      });
      writeReport('index-type-distribution.json', {
        generatedAt: new Date().toISOString(),
        alias: process.env.OPENSEARCH_INDEX_ALIAS ?? 'galilei-search-active',
        physicalIndex: activePhysical[0],
        schemaVersion,
        clusterHealth: health,
        indexTotalFromSourceBuckets: indexTotal,
        distributions,
      });
      writeReport('publication-real.json', {
        generatedAt: new Date().toISOString(),
        target: 'bjc_dev@127.0.0.1:55432/buscador_juridico_civil_dev',
        ...Object.fromEntries(
          Object.entries(juris).map(([key, value]) => [key, Number(value)]),
        ),
        directSentenceCounts: Object.fromEntries(
          Object.entries(sentencia).map(([key, value]) => [key, Number(value)]),
        ),
        warning:
          'The original joined counts describe active Sumario/Sentencia pairs published on both sides. Direct Sentencia counts are separate: public Search can return a published Sentencia without a published active Sumario. This is not the J9 identity-review queue classification.',
        apiPublicationLeakTest: 'NOT_RUN',
        publicationMutationSync: 'NOT_RUN',
      });
      writeReport('outbox-final.json', {
        generatedAt: new Date().toISOString(),
        ...Object.fromEntries(
          Object.entries(outbox).map(([key, value]) => [key, Number(value)]),
        ),
      });
      console.log(
        JSON.stringify(
          {
            corpusEligible,
            activeSumarioRecords: Number(juris.activeSumarioRecords ?? 0),
            totalEligible:
              corpusEligible + Number(juris.activeSumarioRecords ?? 0),
            indexTotal,
            physicalIndex: activePhysical[0],
            schemaVersion,
            clusterHealth: health,
            outbox,
          },
          null,
          2,
        ),
      );
    } finally {
      if (transaction) await pg.query('ROLLBACK').catch(() => undefined);
      pg.release();
    }
  } finally {
    await client.close();
    await pool.end();
  }
}

const corpusUniverseSql = `
WITH RECURSIVE eligible AS (
  SELECT d."id", d."documentType", d."visibility", d."status", d."documentScope"::text AS scope,
         wd."workspaceId", wd."ownerUserId", wd."folderId"
    FROM "CorpusDocument" d
    LEFT JOIN LATERAL (
      SELECT link."workspaceId", link."ownerUserId", link."folderId"
        FROM "WorkspaceDocument" link WHERE link."documentId" = d."id"
       ORDER BY link."createdAt", link."id" LIMIT 1
    ) wd ON TRUE
   WHERE d."status" IN ('INDEXED', 'OCR_REQUIRED')
     AND ((d."documentScope" = 'GENERAL' AND d."visibility" IN ('PUBLIC', 'INTERNAL'))
       OR d."documentScope" = 'PRIVATE_WORKSPACE')
), folder_chain AS (
  SELECT e."id" AS "documentId", f."id", f."parentId", f."workspaceId", f."ownerUserId", f."visibilityScope"::text AS scope, 0 AS depth
    FROM eligible e JOIN "WorkspaceFolder" f ON f."id" = e."folderId"
  UNION ALL
  SELECT chain."documentId", parent."id", parent."parentId", parent."workspaceId", parent."ownerUserId", parent."visibilityScope"::text, chain.depth + 1
    FROM folder_chain chain JOIN "WorkspaceFolder" parent ON parent."id" = chain."parentId"
   WHERE parent."workspaceId" IS NOT DISTINCT FROM chain."workspaceId"
     AND parent."ownerUserId" IS NOT DISTINCT FROM chain."ownerUserId"
), effective_scope AS (
  SELECT DISTINCT ON ("documentId") "documentId", scope
    FROM folder_chain WHERE scope <> 'INHERIT' ORDER BY "documentId", depth
), categorized AS (
  SELECT e."documentType", e."visibility", e."status",
         CASE
           WHEN e.scope = 'GENERAL' THEN 'CORPUS_GENERAL'
           WHEN e."workspaceId" IS NULL AND e."ownerUserId" IS NOT NULL THEN 'PERSONAL'
           WHEN e."workspaceId" IS NOT NULL AND COALESCE(es.scope, 'DEPENDENCY_SHARED') = 'RESTRICTED' THEN 'RESTRICTED'
           WHEN e."workspaceId" IS NOT NULL AND COALESCE(es.scope, 'DEPENDENCY_SHARED') = 'DEPENDENCY_SHARED' THEN 'DEPENDENCY_SHARED'
           WHEN e."workspaceId" IS NOT NULL THEN 'WORKSPACE_OTHER_SCOPE'
           ELSE 'PRIVATE_UNCLASSIFIED'
         END AS category
    FROM eligible e LEFT JOIN effective_scope es ON es."documentId" = e."id"
)
SELECT category, "documentType", visibility, status, count(*)::text AS count
  FROM categorized GROUP BY category, "documentType", visibility, status
 ORDER BY category, "documentType", visibility, status`;

const publicationSql = `
SELECT count(*) FILTER (WHERE s."activo" AND t."activo")::text AS "activeSumarioRecords",
       count(*) FILTER (WHERE s."activo" AND t."activo" AND s."publicado" AND t."publicado")::text AS "publishedActiveSumarioRecords",
       count(*) FILTER (WHERE s."activo" AND t."activo" AND NOT (s."publicado" AND t."publicado"))::text AS "unpublishedOrReviewActiveSumarioRecords",
       count(DISTINCT t."id") FILTER (WHERE s."activo" AND t."activo")::text AS "activeSentenciasDistinct",
       count(DISTINCT t."id") FILTER (WHERE s."activo" AND t."activo" AND s."publicado" AND t."publicado")::text AS "publishedActiveSentenciasDistinct",
       count(DISTINCT t."id") FILTER (WHERE s."activo" AND t."activo" AND NOT (s."publicado" AND t."publicado"))::text AS "unpublishedOrReviewActiveSentenciasDistinct"
  FROM "Sumario" s JOIN "Sentencia" t ON t."id" = s."sentenciaId"`;

const sentencePublicationSql = `
SELECT count(*) FILTER (WHERE t."activo")::text AS "activeSentenciasDistinct",
       count(*) FILTER (WHERE t."activo" AND t."publicado")::text AS "publishedActiveSentenciasDistinct",
       count(*) FILTER (WHERE t."activo" AND t."publicado" AND t."estadoCarga" = 'PUBLICADA')::text AS "publishedActiveWorkflowPublishedSentenciasDistinct",
       count(*) FILTER (WHERE t."activo" AND NOT t."publicado")::text AS "unpublishedOrReviewActiveSentenciasDistinct",
       count(*) FILTER (WHERE t."activo" AND t."publicado" AND NOT EXISTS (
         SELECT 1 FROM "Sumario" s
          WHERE s."sentenciaId" = t."id" AND s."activo" AND s."publicado"
       ))::text AS "publishedWithoutPublishedActiveSumarioDistinct",
       count(*) FILTER (WHERE t."activo" AND t."publicado" AND NOT EXISTS (
         SELECT 1 FROM "Sumario" s
          WHERE s."sentenciaId" = t."id" AND s."activo"
       ))::text AS "publishedWithoutAnyActiveSumarioDistinct"
  FROM "Sentencia" t`;

const corpusEligibilityManifestSql = `
SELECT 'CORPUS:' || d."id" AS "logicalSearchId",
       'CORPUS_DOCUMENT' AS "documentKind",
       'CorpusDocument' AS "sourceEntity",
       d."id" AS "sourceId",
       'NOT_APPLICABLE' AS "publicationState",
       CASE
         WHEN d."documentScope"::text = 'GENERAL' THEN 'GENERAL_' || d."visibility"::text
         WHEN wd."ownerUserId" IS NOT NULL THEN 'PERSONAL'
         WHEN wd."workspaceId" IS NOT NULL THEN 'DEPENDENCY_SHARED'
         ELSE 'PRIVATE_UNCLASSIFIED'
       END AS "visibilityMode",
       wd."workspaceId" AS "dependencyId",
       wd."ownerUserId" AS "ownerId",
       'INDEXED_OR_OCR_REQUIRED_AND_VISIBLE_SCOPE' AS "reasonIncluded"
  FROM "CorpusDocument" d
  LEFT JOIN LATERAL (
    SELECT "workspaceId", "ownerUserId"
      FROM "WorkspaceDocument" link
     WHERE link."documentId" = d."id"
     ORDER BY link."createdAt", link."id"
     LIMIT 1
  ) wd ON TRUE
 WHERE d."status" IN ('INDEXED', 'OCR_REQUIRED')
   AND ((d."documentScope"::text = 'GENERAL' AND d."visibility"::text IN ('PUBLIC', 'INTERNAL'))
     OR d."documentScope"::text = 'PRIVATE_WORKSPACE')
 ORDER BY d."id"`;

const sumarioEligibilityManifestSql = `
SELECT 'JURISPRUDENCIA:SUMARIO:' || s."id"::text AS "logicalSearchId",
       'SUMARIO' AS "documentKind",
       'Sumario' AS "sourceEntity",
       s."id" AS "sourceId",
       CASE WHEN s."publicado" AND t."publicado" THEN 'PUBLISHED' ELSE 'UNPUBLISHED_OR_REVIEW' END AS "publicationState",
       CASE WHEN s."publicado" AND t."publicado" THEN 'PUBLIC' ELSE 'INTERNAL' END AS "visibilityMode",
       t."id"::text AS "dependencyId",
       NULL::integer AS "ownerId",
       'ACTIVE_SUMARIO_WITH_ACTIVE_FK_LINKED_SENTENCIA' AS "reasonIncluded"
  FROM "Sumario" s
  JOIN "Sentencia" t ON t."id" = s."sentenciaId"
 WHERE s."activo" AND t."activo"
 ORDER BY s."id"`;

const sentenciaEligibilityManifestSql = `
SELECT 'JURISPRUDENCIA:SENTENCIA:' || t."id"::text AS "logicalSearchId",
       'JURISPRUDENCIA_SENTENCIA' AS "documentKind",
       'Sentencia' AS "sourceEntity",
       t."id" AS "sourceId",
       CASE WHEN t."publicado" AND t."estadoCarga" = 'PUBLICADA' THEN 'PUBLISHED' ELSE 'UNPUBLISHED_OR_REVIEW' END AS "publicationState",
       CASE WHEN t."publicado" AND t."estadoCarga" = 'PUBLICADA' THEN 'PUBLIC' ELSE 'INTERNAL' END AS "visibilityMode",
       NULL::text AS "dependencyId",
       NULL::integer AS "ownerId",
       'ACTIVE_SENTENCIA_STANDS_ALONE;_SUMARIO_TEXT_ONLY_VIA_REAL_FK' AS "reasonIncluded"
  FROM "Sentencia" t
 WHERE t."activo"
 ORDER BY t."id"`;

const excludedEligibilityCountsSql = `
SELECT (SELECT count(*) FROM "CorpusDocument" d
         WHERE NOT (d."status" IN ('INDEXED', 'OCR_REQUIRED')
           AND ((d."documentScope"::text = 'GENERAL' AND d."visibility"::text IN ('PUBLIC', 'INTERNAL'))
             OR d."documentScope"::text = 'PRIVATE_WORKSPACE')))::text AS "corpusExcluded",
       (SELECT count(*) FROM "Sentencia" t WHERE NOT t."activo")::text AS "inactiveSentenciaExcluded",
       (SELECT count(*) FROM "Sumario" s JOIN "Sentencia" t ON t."id" = s."sentenciaId"
         WHERE NOT (s."activo" AND t."activo"))::text AS "sumarioWithInactiveSideExcluded"`;

const sameShaSql = `
WITH eligible_docs AS (
  SELECT d."id", CASE WHEN d."documentScope" = 'GENERAL' THEN 'GENERAL:' || d."visibility"::text
                       WHEN wd."workspaceId" IS NULL THEN 'PERSONAL:' || COALESCE(wd."ownerUserId"::text, 'none')
                       ELSE 'WORKSPACE:' || wd."workspaceId" END AS visibility_class
    FROM "CorpusDocument" d
    LEFT JOIN LATERAL (SELECT "workspaceId", "ownerUserId" FROM "WorkspaceDocument" WHERE "documentId" = d."id" ORDER BY "createdAt", "id" LIMIT 1) wd ON TRUE
   WHERE d."status" IN ('INDEXED', 'OCR_REQUIRED')
     AND ((d."documentScope" = 'GENERAL' AND d."visibility" IN ('PUBLIC', 'INTERNAL')) OR d."documentScope" = 'PRIVATE_WORKSPACE')
), sha_docs AS (
  SELECT file."sha256", d."id", d.visibility_class
    FROM eligible_docs d JOIN "CorpusDocumentFile" file ON file."documentId" = d."id"
), duplicate_groups AS (
  SELECT "sha256", count(DISTINCT "id") AS docs, count(DISTINCT visibility_class) AS classes
    FROM sha_docs GROUP BY "sha256" HAVING count(DISTINCT "id") > 1
)
SELECT count(*)::text AS "duplicateShaGroups",
       COALESCE(sum(docs), 0)::text AS "documentsInDuplicateShaGroups",
       count(*) FILTER (WHERE classes > 1)::text AS "groupsWithMultipleVisibilityClasses"
  FROM duplicate_groups`;

const outboxSql = `
SELECT count(*) FILTER (WHERE "processedAt" IS NULL AND "failedAt" IS NULL)::text AS pending,
       count(*) FILTER (WHERE "failedAt" IS NOT NULL)::text AS failed,
       count(*) FILTER (WHERE "processedAt" IS NULL AND "failedAt" IS NULL AND "leaseUntil" < now())::text AS staleLeases,
       count(*) FILTER (WHERE "processedAt" IS NULL AND "failedAt" IS NULL AND "leaseUntil" >= now())::text AS activeLeases
  FROM "SearchIndexOutbox"`;

function loadLocalEnvironment() {
  const file = path.resolve(process.cwd(), '.env.development.local');
  const contents = fs.readFileSync(file, 'utf8');
  for (const line of contents.split(/\r?\n/u)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/u);
    if (!match || match[1] in process.env) continue;
    const raw = match[2];
    const quoted =
      (raw.startsWith('"') && raw.endsWith('"')) ||
      (raw.startsWith("'") && raw.endsWith("'"));
    process.env[match[1]] = quoted ? raw.slice(1, -1) : raw;
  }
}

function bodyOf<T>(response: unknown): T {
  const value = response as { body?: T };
  return value.body ?? (response as T);
}

function writeReport(name: string, value: unknown) {
  fs.writeFileSync(
    path.join(reportDirectory, name),
    `${JSON.stringify(value, null, 2)}\n`,
    'utf8',
  );
}

void main().catch((error: unknown) => {
  const value = error as { name?: unknown; code?: unknown; message?: unknown };
  const message = typeof value?.message === 'string' ? value.message : '';
  const safeMessage = message.replace(
    /postgres(?:ql)?:\/\/[^\s]+/giu,
    '[database-url-redacted]',
  );
  const code = typeof value?.code === 'string' ? value.code : undefined;
  const knownCode = /^(?:SEARCH_|DEV_|OPENSEARCH_)/u.test(message)
    ? message
    : undefined;
  console.error(
    knownCode ??
      JSON.stringify({
        error: 'SEARCH_CENSUS_FAILED',
        name: value?.name,
        code,
        message: safeMessage,
      }),
  );
  process.exitCode = 1;
});
