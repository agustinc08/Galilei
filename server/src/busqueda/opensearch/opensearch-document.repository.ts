import { Pool, type PoolClient } from 'pg';
import {
  resolveSearchDatabasePoolConfig,
  type ApprovedRuntimePgConfig,
} from '../../config/runtime-database-config';
import type {
  CorpusSearchProjection,
  JurisprudenciaSearchProjection,
  SentenciaSearchProjection,
} from './opensearch-search-document';

const CORPUS_SELECT = `
SELECT d."id", d."documentType", d."title", d."subtitle", d."jurisdiction", d."court", d."chamber", d."instance",
       d."caseNumber", d."docket", d."decisionDate", d."visibility", d."documentScope"::text AS "documentScope",
       d."status", d."updatedAt", d."searchText", d."metadata",
       latest."mimeType" AS "mimeType", latest."originalFilename" AS "latestOriginalFilename",
       COALESCE(collections."ids", ARRAY[]::text[]) AS "digestoCollectionIds",
       COALESCE(topics."ids", ARRAY[]::text[]) AS "digestoTopicIds",
       COALESCE(tags."ids", ARRAY[]::text[]) AS "digestoTagIds",
       COALESCE(acl."ids", ARRAY[]::text[]) AS "aclPrincipalIds",
       wd."ownerUserId", wd."workspaceId", wd."folderId", wd."createdAt" AS "workspaceLinkedAt", folder."visibilityScope"::text AS "visibilityScope",
       COALESCE(source_data."sourceIds", ARRAY[]::text[]) AS "sourceIds",
       COALESCE(source_data."sourcePaths", ARRAY[]::text[]) AS "sourcePaths",
       COALESCE(source_data."sourceWorkspaceIds", ARRAY[]::text[]) AS "sourceWorkspaceIds",
       COALESCE(source_data."sourceFileScopes", '[]'::jsonb) AS "sourceFileScopes",
       COALESCE(links."ids", ARRAY[]::text[]) AS "linkedResultIds"
  FROM "CorpusDocument" d
  LEFT JOIN LATERAL (
    SELECT lower(btrim(split_part(file."mimeType", ';', 1))) AS "mimeType", file."originalFilename"
      FROM "CorpusDocumentFile" file WHERE file."documentId" = d."id"
     ORDER BY file."version" DESC LIMIT 1
  ) latest ON TRUE
  LEFT JOIN LATERAL (
    SELECT "workspaceId", "ownerUserId", "folderId", "createdAt"
      FROM "WorkspaceDocument" link WHERE link."documentId" = d."id"
     ORDER BY link."createdAt", link."id" LIMIT 1
  ) wd ON TRUE
  LEFT JOIN "WorkspaceFolder" folder ON folder."id" = wd."folderId"
  LEFT JOIN LATERAL (
    WITH RECURSIVE folder_chain AS (
      SELECT f."id", f."parentId", f."workspaceId", f."ownerUserId", f."visibilityScope", f."createdById"
        FROM "WorkspaceFolder" f WHERE f."id" = wd."folderId"
      UNION ALL
      SELECT parent."id", parent."parentId", parent."workspaceId", parent."ownerUserId", parent."visibilityScope", parent."createdById"
        FROM folder_chain child JOIN "WorkspaceFolder" parent ON parent."id" = child."parentId"
       WHERE parent."workspaceId" = child."workspaceId" OR (parent."workspaceId" IS NULL AND parent."ownerUserId" = child."ownerUserId")
    )
    SELECT array_agg(DISTINCT membership."userId"::text) AS ids
      FROM "WorkspaceMembership" membership
      JOIN "DocumentWorkspace" workspace ON workspace."id" = membership."workspaceId" AND workspace."active" = TRUE
     WHERE membership."workspaceId" = wd."workspaceId" AND membership."active" = TRUE
       AND NOT EXISTS (
         SELECT 1 FROM folder_chain chain
          WHERE NOT CASE chain."visibilityScope"::text
            WHEN 'PERSONAL' THEN chain."ownerUserId" = membership."userId"
            WHEN 'RESTRICTED' THEN membership."role"::text = 'ADMIN'
              OR chain."createdById" = membership."userId"
              OR EXISTS (
                SELECT 1 FROM "WorkspaceFolderGrant" grant_row
                 WHERE grant_row."folderId" = chain."id" AND grant_row."membershipId" = membership."id"
              )
            ELSE TRUE
          END
       )
  ) acl ON TRUE
  LEFT JOIN LATERAL (
    SELECT array_agg(DISTINCT membership."collectionId") AS ids
      FROM "DigestoCollectionMembership" membership
      JOIN "DigestoCollection" collection ON collection."id" = membership."collectionId" AND collection."status" = 'ACTIVE'
     WHERE membership."documentId" = d."id"
  ) collections ON TRUE
  LEFT JOIN LATERAL (
    SELECT array_agg(DISTINCT topic."id") AS ids
      FROM "CorpusDocumentTopic" link
      JOIN "DigestoTopic" topic ON topic."id" = link."topicId" AND topic."active" = TRUE
     WHERE link."documentId" = d."id"
  ) topics ON TRUE
  LEFT JOIN LATERAL (
    SELECT array_agg(DISTINCT tag."id") AS ids FROM "CorpusDocumentTag" link
      JOIN "DigestoTag" tag ON tag."id" = link."tagId"
     WHERE link."documentId" = d."id"
  ) tags ON TRUE
  LEFT JOIN LATERAL (
    SELECT array_agg(DISTINCT link."targetId") AS ids FROM "CorpusDocumentLink" link
     WHERE link."documentId" = d."id" AND link."targetDomain" = 'JURISPRUDENCIA'
  ) links ON TRUE
  LEFT JOIN LATERAL (
    SELECT array_agg(DISTINCT source."id") AS "sourceIds",
           array_agg(DISTINCT file."normalizedPath") FILTER (WHERE file."normalizedPath" IS NOT NULL) AS "sourcePaths",
           array_agg(DISTINCT source."workspaceId") FILTER (WHERE source."workspaceId" IS NOT NULL) AS "sourceWorkspaceIds",
           jsonb_agg(DISTINCT jsonb_build_object(
             'sourceId', source."id",
             'workspaceId', source."workspaceId",
             'normalizedPath', file."normalizedPath"
           )) FILTER (WHERE source."id" IS NOT NULL) AS "sourceFileScopes"
      FROM "SourceFile" file JOIN "DocumentSource" source ON source."id" = file."sourceId"
     WHERE file."documentId" = d."id"
  ) source_data ON TRUE`;

const JURISPRUDENCIA_SELECT = `
SELECT s."id", s."numeroSumario", s."tema", s."texto", s."resumenBusqueda", s."textoBusquedaNormalizado",
       s."publicado" AS "sumarioPublicado", t."publicado" AS "sentenciaPublicado",
       s."activo" AS "sumarioActivo", t."activo" AS "sentenciaActivo", s."sentenciaId", s."legacyId",
       t."numeroSentencia", t."tipoFallo", t."sala", t."fecha", t."expediente", t."tribunalOrigen",
       t."actor", t."actorPublico", t."demandado", t."demandadoPublico", t."anonimizado",
       t."objeto", t."magistrados", t."caratula",
       t."textoBusquedaNormalizado" AS "sentenciaSearchText",
       t."resumenIa", t."resumenPublicado", t."resena", t."resenaPublicada", t."destacada",
       COALESCE((SELECT json_agg(json_build_object('id', file."id", 'rutaArchivo', file."rutaArchivo") ORDER BY file."createdAt" DESC)
                   FROM "ArchivoPdf" file WHERE file."sentenciaId" = t."id"), '[]'::json) AS "archivosPdf",
       COALESCE((SELECT string_agg(reference."searchText", ' ')
                   FROM (
                     SELECT concat_ws(' ', r."tipoNorma", r."numeroNorma", r."articulo", r."inciso", r."textoReferencia") AS "searchText"
                       FROM "ReferenciaNormativa" r WHERE r."sentenciaId" = t."id"
                     UNION ALL
                     SELECT concat_ws(' ', r."referencia", r."textoOriginal") AS "searchText"
                       FROM "ReferenciaJurisprudencial" r WHERE r."sentenciaId" = t."id"
                     UNION ALL
                     SELECT concat_ws(' ', r."autor", r."titulo", r."fuente", r."textoReferencia") AS "searchText"
                       FROM "ReferenciaDoctrinaria" r WHERE r."sentenciaId" = t."id"
                   ) reference), '') AS "referenciasSearchText",
       GREATEST(s."updatedAt", t."updatedAt") AS "updatedAt"
  FROM "Sumario" s JOIN "Sentencia" t ON t."id" = s."sentenciaId"`;

const SENTENCIA_SELECT = `
SELECT t."id", t."numeroSentencia", t."tipoFallo", t."sala", t."fecha", t."expediente",
       t."tribunalOrigen", t."actor", t."actorPublico", t."demandado", t."demandadoPublico",
       t."anonimizado", t."objeto", t."magistrados", t."caratula",
       t."textoBusquedaNormalizado", t."publicado", t."activo", t."estadoCarga", t."updatedAt",
       t."resumenIa", t."resumenPublicado", t."resena", t."resenaPublicada", t."destacada",
       COALESCE((SELECT json_agg(json_build_object('id', file."id", 'rutaArchivo', file."rutaArchivo") ORDER BY file."createdAt" DESC)
                   FROM "ArchivoPdf" file WHERE file."sentenciaId" = t."id"), '[]'::json) AS "archivosPdf",
       COALESCE((SELECT string_agg(reference."searchText", ' ')
                   FROM (
                     SELECT concat_ws(' ', r."tipoNorma", r."numeroNorma", r."articulo", r."inciso", r."textoReferencia") AS "searchText"
                       FROM "ReferenciaNormativa" r WHERE r."sentenciaId" = t."id"
                     UNION ALL
                     SELECT concat_ws(' ', r."referencia", r."textoOriginal") AS "searchText"
                       FROM "ReferenciaJurisprudencial" r WHERE r."sentenciaId" = t."id"
                     UNION ALL
                     SELECT concat_ws(' ', r."autor", r."titulo", r."fuente", r."textoReferencia") AS "searchText"
                       FROM "ReferenciaDoctrinaria" r WHERE r."sentenciaId" = t."id"
                   ) reference), '') AS "referenciasSearchText",
       COALESCE(summary."searchText", '') AS "sumariosSearchText",
       COALESCE(summary."numeroSumarios", ARRAY[]::text[]) AS "numeroSumarios"
  FROM "Sentencia" t
  LEFT JOIN LATERAL (
    SELECT string_agg(
             concat_ws(' ', s."tema", s."numeroSumario", s."resumenBusqueda", s."textoBusquedaNormalizado"),
             ' '
           ) AS "searchText",
           array_agg(DISTINCT s."numeroSumario") FILTER (WHERE s."numeroSumario" IS NOT NULL) AS "numeroSumarios"
      FROM "Sumario" s
     WHERE s."sentenciaId" = t."id" AND s."activo" = TRUE
       AND (t."publicado" = FALSE OR s."publicado" = TRUE)
  ) summary ON TRUE`;

const SEARCH_INDEX_LOCK = [1195467849, 1397047634] as const;
const MUTATION_TABLES = [
  'CorpusDocument',
  'CorpusDocumentFile',
  'CorpusExtraction',
  'CorpusDocumentPage',
  'CorpusDocumentLink',
  'CorpusDocumentTopic',
  'CorpusDocumentTag',
  'DigestoCollectionMembership',
  'WorkspaceDocument',
  'SourceFile',
  'Sentencia',
  'Sumario',
  'ArchivoPdf',
  'ReferenciaNormativa',
  'ReferenciaJurisprudencial',
  'ReferenciaDoctrinaria',
  'WorkspaceMembership',
  'DocumentWorkspace',
  'WorkspaceFolder',
  'WorkspaceFolderGrant',
  'DocumentSource',
  'DigestoCollection',
  'DigestoTopic',
  'DigestoTag',
  // Lock the outbox itself as well as every trigger source. A cutover watermark
  // must not race a direct outbox writer while the source tables are quiesced.
  'SearchIndexOutbox',
];

export type SearchOutboxEvent = {
  id: string;
  documentKey: string;
  operation: 'UPSERT' | 'DELETE';
  attempts: number;
};

export class OpenSearchDocumentRepository {
  private readonly pool: Pool;

  constructor(databaseConfig?: string | ApprovedRuntimePgConfig) {
    this.pool = new Pool({
      ...resolveSearchDatabasePoolConfig(databaseConfig),
      max: 4,
      connectionTimeoutMillis: 5000,
      statement_timeout: 180000,
    });
  }

  async withReadSnapshot<T>(
    run: (client: PoolClient) => Promise<T>,
  ): Promise<T> {
    const client = await this.pool.connect();
    let transaction = false;
    try {
      await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
      transaction = true;
      await client.query("SET LOCAL statement_timeout = '180s'");
      const value = await run(client);
      await client.query('COMMIT');
      transaction = false;
      return value;
    } finally {
      if (transaction) await client.query('ROLLBACK').catch(() => undefined);
      client.release();
    }
  }

  async corpusPage(
    client: PoolClient,
    afterId: string,
    limit: number,
  ): Promise<CorpusSearchProjection[]> {
    const result = await client.query<CorpusSearchProjection>(
      `${CORPUS_SELECT}
       WHERE d."id" > $1
         AND d."status" IN ('INDEXED', 'OCR_REQUIRED')
         AND ((d."documentScope" = 'GENERAL' AND d."visibility" IN ('PUBLIC', 'INTERNAL'))
           OR d."documentScope" = 'PRIVATE_WORKSPACE')
       ORDER BY d."id" LIMIT $2`,
      [afterId, limit],
    );
    return result.rows;
  }

  async jurisprudenciaPage(
    client: PoolClient,
    afterId: number,
    limit: number,
  ): Promise<JurisprudenciaSearchProjection[]> {
    const result = await client.query<JurisprudenciaSearchProjection>(
      `${JURISPRUDENCIA_SELECT}
       WHERE s."id" > $1 AND s."activo" = TRUE AND t."activo" = TRUE
       ORDER BY s."id" LIMIT $2`,
      [afterId, limit],
    );
    return result.rows;
  }

  async sentenciaPage(
    client: PoolClient,
    afterId: number,
    limit: number,
  ): Promise<SentenciaSearchProjection[]> {
    const result = await client.query<SentenciaSearchProjection>(
      `${SENTENCIA_SELECT}
       WHERE t."id" > $1 AND t."activo" = TRUE
       ORDER BY t."id" LIMIT $2`,
      [afterId, limit],
    );
    return result.rows;
  }

  async corpusEligibleIdPage(
    client: PoolClient,
    afterId: string,
    limit: number,
  ): Promise<string[]> {
    const result = await client.query<{ id: string }>(
      `SELECT d."id"
         FROM "CorpusDocument" d
        WHERE d."id" > $1
          AND d."status" IN ('INDEXED', 'OCR_REQUIRED')
          AND ((d."documentScope" = 'GENERAL' AND d."visibility" IN ('PUBLIC', 'INTERNAL'))
            OR d."documentScope" = 'PRIVATE_WORKSPACE')
        ORDER BY d."id" LIMIT $2`,
      [afterId, limit],
    );
    return result.rows.map((row) => row.id);
  }

  async jurisprudenciaEligibleIdPage(
    client: PoolClient,
    afterId: number,
    limit: number,
  ): Promise<number[]> {
    const result = await client.query<{ id: number }>(
      `SELECT s."id"
         FROM "Sumario" s
         JOIN "Sentencia" t ON t."id" = s."sentenciaId"
        WHERE s."id" > $1 AND s."activo" = TRUE AND t."activo" = TRUE
        ORDER BY s."id" LIMIT $2`,
      [afterId, limit],
    );
    return result.rows.map((row) => row.id);
  }

  async sentenciaEligibleIdPage(
    client: PoolClient,
    afterId: number,
    limit: number,
  ): Promise<Array<{ id: number; publicado: boolean; estadoCarga: string }>> {
    const result = await client.query<{
      id: number;
      publicado: boolean;
      estadoCarga: string;
    }>(
      `SELECT t."id", t."publicado", t."estadoCarga"
         FROM "Sentencia" t
        WHERE t."id" > $1 AND t."activo" = TRUE
        ORDER BY t."id" LIMIT $2`,
      [afterId, limit],
    );
    return result.rows;
  }

  async publishedSentenciaPage(
    client: PoolClient,
    afterId: number,
    limit: number,
  ): Promise<SentenciaSearchProjection[]> {
    const result = await client.query<SentenciaSearchProjection>(
      `${SENTENCIA_SELECT}
       WHERE t."id" > $1
         AND t."activo" = TRUE
         AND t."publicado" = TRUE
         AND t."estadoCarga" = 'PUBLICADA'
       ORDER BY t."id" LIMIT $2`,
      [afterId, limit],
    );
    return result.rows;
  }

  async getCorpusDocument(id: string): Promise<CorpusSearchProjection | null> {
    const result = await this.pool.query<CorpusSearchProjection>(
      `${CORPUS_SELECT}
       WHERE d."id" = $1 AND d."status" IN ('INDEXED', 'OCR_REQUIRED')
         AND ((d."documentScope" = 'GENERAL' AND d."visibility" IN ('PUBLIC', 'INTERNAL'))
           OR d."documentScope" = 'PRIVATE_WORKSPACE')`,
      [id],
    );
    return result.rows[0] ?? null;
  }

  async getJurisprudenciaDocument(
    id: number,
  ): Promise<JurisprudenciaSearchProjection | null> {
    const result = await this.pool.query<JurisprudenciaSearchProjection>(
      `${JURISPRUDENCIA_SELECT}
       WHERE s."id" = $1 AND s."activo" = TRUE AND t."activo" = TRUE`,
      [id],
    );
    return result.rows[0] ?? null;
  }

  async getSentenciaDocument(
    id: number,
  ): Promise<SentenciaSearchProjection | null> {
    const result = await this.pool.query<SentenciaSearchProjection>(
      `${SENTENCIA_SELECT}
       WHERE t."id" = $1 AND t."activo" = TRUE`,
      [id],
    );
    return result.rows[0] ?? null;
  }

  async withAdvisoryLock<T>(
    wait: boolean,
    run: (client: PoolClient) => Promise<T>,
  ): Promise<{ acquired: boolean; value?: T }> {
    const client = await this.pool.connect();
    let acquired = false;
    try {
      const result = await client.query<{ acquired: boolean }>(
        wait
          ? 'SELECT pg_advisory_lock($1, $2), TRUE AS acquired'
          : 'SELECT pg_try_advisory_lock($1, $2) AS acquired',
        [...SEARCH_INDEX_LOCK],
      );
      acquired = result.rows[0]?.acquired === true;
      if (!acquired) return { acquired: false };
      return { acquired: true, value: await run(client) };
    } finally {
      if (acquired)
        await client
          .query('SELECT pg_advisory_unlock($1, $2)', [...SEARCH_INDEX_LOCK])
          .catch(() => undefined);
      client.release();
    }
  }

  async withMutationBarrier<T>(
    run: (client: PoolClient, watermark: string) => Promise<T>,
  ): Promise<T> {
    return this.withAdvisoryLock(true, async (client) => {
      let transaction = false;
      try {
        await client.query('BEGIN');
        transaction = true;
        await client.query(
          `LOCK TABLE ${MUTATION_TABLES.map((table) => `"${table}"`).join(', ')} IN SHARE MODE`,
        );
        const result = await client.query<{ watermark: string }>(
          'SELECT COALESCE(MAX("id"), 0)::text AS watermark FROM "SearchIndexOutbox"',
        );
        const value = await run(client, result.rows[0]?.watermark ?? '0');
        await client.query('COMMIT');
        transaction = false;
        return value;
      } finally {
        if (transaction) await client.query('ROLLBACK').catch(() => undefined);
      }
    }).then((result) => {
      if (!result.acquired)
        throw new Error('SEARCH_INDEX_LOCK_UNEXPECTEDLY_NOT_ACQUIRED');
      return result.value as T;
    });
  }

  async claimOutbox(limit: number): Promise<SearchOutboxEvent[]> {
    const safeLimit = Math.max(1, Math.min(200, Math.trunc(limit)));
    const result = await this.pool.query<SearchOutboxEvent>(
      `WITH pending AS (
         SELECT "id" FROM "SearchIndexOutbox"
          WHERE "processedAt" IS NULL AND "failedAt" IS NULL AND "nextAttemptAt" <= now()
            AND ("leaseUntil" IS NULL OR "leaseUntil" < now())
          ORDER BY "id" FOR UPDATE SKIP LOCKED LIMIT $1
       )
       UPDATE "SearchIndexOutbox" event
          SET "attempts" = event."attempts" + 1,
              "leaseUntil" = now() + interval '2 minutes'
         FROM pending WHERE event."id" = pending."id"
       RETURNING event."id"::text AS id, event."documentKey", event."operation", event."attempts"`,
      [safeLimit],
    );
    return result.rows;
  }

  async claimOutboxByDocumentKey(limit: number): Promise<SearchOutboxEvent[]> {
    const safeLimit = Math.max(1, Math.min(200, Math.trunc(limit)));
    const result = await this.pool.query<SearchOutboxEvent>(
      `WITH candidate_keys AS (
         SELECT "documentKey", MIN("id") AS first_id
           FROM "SearchIndexOutbox"
          WHERE "processedAt" IS NULL AND "failedAt" IS NULL AND "nextAttemptAt" <= now()
            AND ("leaseUntil" IS NULL OR "leaseUntil" < now())
          GROUP BY "documentKey"
          ORDER BY first_id
          LIMIT $1
       ), pending AS (
         SELECT event."id"
           FROM "SearchIndexOutbox" event
           JOIN candidate_keys candidate USING ("documentKey")
          WHERE event."processedAt" IS NULL AND event."failedAt" IS NULL
            AND event."nextAttemptAt" <= now()
            AND (event."leaseUntil" IS NULL OR event."leaseUntil" < now())
          FOR UPDATE OF event SKIP LOCKED
       )
       UPDATE "SearchIndexOutbox" event
          SET "attempts" = event."attempts" + 1,
              "leaseUntil" = now() + interval '2 minutes'
         FROM pending WHERE event."id" = pending."id"
       RETURNING event."id"::text AS id, event."documentKey", event."operation", event."attempts"`,
      [safeLimit],
    );
    return result.rows;
  }

  async markOutboxProcessed(id: string) {
    await this.pool.query(
      `UPDATE "SearchIndexOutbox" SET "processedAt" = now(), "leaseUntil" = NULL, "lastError" = NULL
        WHERE "id" = $1::bigint`,
      [id],
    );
  }

  async markOutboxProcessedMany(ids: string[]) {
    if (!ids.length) return;
    await this.pool.query(
      `UPDATE "SearchIndexOutbox"
          SET "processedAt" = now(), "leaseUntil" = NULL, "lastError" = NULL
        WHERE "id" = ANY($1::bigint[]) AND "processedAt" IS NULL AND "failedAt" IS NULL`,
      [ids],
    );
  }

  async markOutboxFailed(event: SearchOutboxEvent) {
    const permanentlyFailed = event.attempts >= 12;
    const delayMs = Math.min(
      60_000 * 2 ** Math.max(0, event.attempts - 1),
      3_600_000,
    );
    await this.pool.query(
      `UPDATE "SearchIndexOutbox"
          SET "lastError" = 'OPENSEARCH_SYNC_FAILED',
              "leaseUntil" = NULL,
              "nextAttemptAt" = now() + ($2::text || ' milliseconds')::interval,
              "failedAt" = CASE WHEN $3::boolean THEN now() ELSE NULL END
        WHERE "id" = $1::bigint AND "processedAt" IS NULL AND "failedAt" IS NULL`,
      [event.id, String(delayMs), permanentlyFailed],
    );
  }

  async outboxChangesAfter(client: PoolClient, watermark: string) {
    const result = await client.query<{ documentKey: string }>(
      `SELECT DISTINCT ON ("documentKey") "documentKey"
         FROM "SearchIndexOutbox" WHERE "id" > $1::bigint
        ORDER BY "documentKey", "id" DESC`,
      [watermark],
    );
    return result.rows.map((row) => row.documentKey);
  }

  async outboxChangesPage(
    client: PoolClient,
    afterWatermark: string,
    throughWatermark: string,
    afterDocumentKey: string,
    limit = 250,
  ) {
    const safeLimit = Math.max(1, Math.min(1000, Math.trunc(limit)));
    const result = await client.query<{ documentKey: string }>(
      `SELECT latest."documentKey"
         FROM (
           SELECT DISTINCT ON ("documentKey") "documentKey", "id"
             FROM "SearchIndexOutbox"
            WHERE "id" > $1::bigint AND "id" <= $2::bigint
            ORDER BY "documentKey", "id" DESC
         ) latest
        WHERE latest."documentKey" > $3
        ORDER BY latest."documentKey"
        LIMIT $4`,
      [afterWatermark, throughWatermark, afterDocumentKey, safeLimit],
    );
    return result.rows.map((row) => row.documentKey);
  }

  async markOutboxThrough(client: PoolClient, watermark: string) {
    await client.query(
      `UPDATE "SearchIndexOutbox" SET "processedAt" = COALESCE("processedAt", now()), "leaseUntil" = NULL,
              "lastError" = NULL, "failedAt" = NULL
        WHERE "id" <= $1::bigint`,
      [watermark],
    );
  }

  async retryFailedOutbox() {
    const result = await this.pool.query<{ updated: string }>(
      `WITH retried AS (
         UPDATE "SearchIndexOutbox" SET "failedAt" = NULL, "attempts" = 0, "nextAttemptAt" = now(),
                "leaseUntil" = NULL, "lastError" = NULL
          WHERE "failedAt" IS NOT NULL AND "processedAt" IS NULL
          RETURNING 1
       ) SELECT count(*)::text AS updated FROM retried`,
    );
    return Number(result.rows[0]?.updated ?? 0);
  }

  async outboxStatus() {
    const result = await this.pool.query<{
      total: string;
      processed: string;
      pending: string;
      failed: string;
      highWatermark: string;
    }>(
      `SELECT count(*)::text AS total,
              count(*) FILTER (WHERE "processedAt" IS NOT NULL)::text AS processed,
              count(*) FILTER (WHERE "processedAt" IS NULL AND "failedAt" IS NULL)::text AS pending,
              count(*) FILTER (WHERE "processedAt" IS NULL AND "failedAt" IS NOT NULL)::text AS failed,
              COALESCE(max("id"), 0)::text AS "highWatermark"
         FROM "SearchIndexOutbox"`,
    );
    return {
      total: Number(result.rows[0]?.total ?? 0),
      processed: Number(result.rows[0]?.processed ?? 0),
      pending: Number(result.rows[0]?.pending ?? 0),
      failed: Number(result.rows[0]?.failed ?? 0),
      highWatermark: result.rows[0]?.highWatermark ?? '0',
    };
  }

  async outboxSnapshot(client: PoolClient) {
    const result = await client.query<{
      total: string;
      processed: string;
      pending: string;
      failed: string;
      highWatermark: string;
    }>(
      `SELECT count(*)::text AS total,
              count(*) FILTER (WHERE "processedAt" IS NOT NULL)::text AS processed,
              count(*) FILTER (WHERE "processedAt" IS NULL AND "failedAt" IS NULL)::text AS pending,
              count(*) FILTER (WHERE "processedAt" IS NULL AND "failedAt" IS NOT NULL)::text AS failed,
              COALESCE(max("id"), 0)::text AS "highWatermark"
         FROM "SearchIndexOutbox"`,
    );
    const row = result.rows[0];
    return {
      total: Number(row?.total ?? 0),
      processed: Number(row?.processed ?? 0),
      pending: Number(row?.pending ?? 0),
      failed: Number(row?.failed ?? 0),
      highWatermark: row?.highWatermark ?? '0',
    };
  }

  async outboxSnapshotThrough(client: PoolClient, watermark: string) {
    const result = await client.query<{
      pending: string;
      failed: string;
    }>(
      `SELECT count(*) FILTER (
                WHERE "processedAt" IS NULL AND "failedAt" IS NULL
              )::text AS pending,
              count(*) FILTER (
                WHERE "processedAt" IS NULL AND "failedAt" IS NOT NULL
              )::text AS failed
         FROM "SearchIndexOutbox"
        WHERE "id" <= $1::bigint`,
      [watermark],
    );
    return {
      pending: Number(result.rows[0]?.pending ?? 0),
      failed: Number(result.rows[0]?.failed ?? 0),
    };
  }

  async cleanupProcessedOutbox(olderThan: Date) {
    const result = await this.pool.query<{ deleted: string }>(
      `WITH removed AS (
         DELETE FROM "SearchIndexOutbox"
          WHERE "processedAt" < $1 AND "failedAt" IS NULL
          RETURNING 1
       ) SELECT count(*)::text AS deleted FROM removed`,
      [olderThan],
    );
    return Number(result.rows[0]?.deleted ?? 0);
  }

  async close() {
    await this.pool.end();
  }
}
