import { createHash } from 'node:crypto';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Client } from 'pg';
import { open } from 'sqlite';
import sqlite3 from 'sqlite3';
import { buildSumarioSearchData } from '../../src/busqueda/utils/search-normalizer';
import {
  mapLegacySentencia,
  mapLegacySumario,
  type LegacyRow,
} from '../../src/importacion/utils/mapeadores';

const repoRoot = path.resolve(__dirname, '../../..');
const auditRoot = path.join(repoRoot, '_recovery-work', 'office-beta-legacy-corpus');
const sourcePath = path.join(
  'D:\\',
  '_recovery-work',
  'jurisprudencia-archive-audit-20261028-111413',
  'extracted',
  'jurisprudencia',
  'jurisprudencia_db.sqlite',
);
const supplementalSummarySnapshotPath = path.join(
  'D:\\',
  '_recovery-work',
  'jurisprudencia-archive-audit-20261028-111413',
  'extracted',
  'jurisprudencia',
  'jurisp_6',
  'db',
  'jurisprudencia_db.sqlite',
);
const corroboratingSummarySnapshotPath = path.join(
  'D:\\',
  '_recovery-work',
  'jurisprudencia-archive-audit-20261028-111413',
  'extracted',
  'jurisprudencia',
  'jurisp_6',
  'db',
  'jurisprudencia_db11.sqlite',
);
const sourceCode = 'sqlite:jurisprudencia/jurisprudencia_db.sqlite';
const batchSize = 25;
const insertBatchSize = 250;

type Args = string[];
type PgSentence = {
  id: number;
  legacyId: string | null;
  numeroSentencia: string | null;
  tipoFallo: string | null;
  sala: string | null;
  fecha: Date | null;
  expediente: string | null;
  tribunalOrigen: string | null;
  actor: string | null;
  demandado: string | null;
  objeto: string | null;
  magistrados: string | null;
  juez: string | null;
  publicado: boolean;
  publishedAt: Date | null;
  activo: boolean;
  estadoCarga: string;
  caratula: string | null;
  anio: number | null;
  textoBusqueda: string | null;
  textoBusquedaNormalizado: string | null;
};
type PgSummary = {
  id: number;
  legacyId: string | null;
  numeroSumario: string | null;
  tema: string | null;
  texto: string;
  resumenBusqueda: string | null;
  publicado: boolean;
  activo: boolean;
  sentenciaId: number;
  parentLegacyId: string | null;
};
type PreparedSentence = {
  sourceId: number;
  values: Record<string, unknown>;
  pg?: PgSentence;
  active: boolean;
};
type PreparedSummary = {
  sourceId: number;
  parentSourceId: number;
  values: Record<string, unknown>;
  pg?: PgSummary;
  active: boolean;
  sourcePublished: boolean;
  parentActive: boolean;
};

function getArgs(): Args {
  const raw = process.env.BJC_OFFICE_BETA_LEGACY_ARGS;
  if (!raw) throw new Error('Run only through the DEV database guard.');
  const parsed = JSON.parse(raw) as unknown;
  if (!Array.isArray(parsed) || parsed.some((value) => typeof value !== 'string')) {
    throw new Error('Guard arguments are invalid.');
  }
  return parsed as string[];
}

function sourceNumericId(value: unknown, table: 'tb_sentencias' | 'tb_sumarios') {
  const match = String(value ?? '').match(new RegExp(`#${table}/(\\d+)$`, 'u'));
  return match?.[1] ?? null;
}

function sourceLegacyId(table: 'tb_sentencias' | 'tb_sumarios', id: number) {
  return `${sourceCode}#${table}/${id}`;
}

function textValue(value: unknown) {
  if (value === null || value === undefined) return null;
  const normalized = String(value).replace(/\s+/gu, ' ').trim();
  return normalized || null;
}

function dateKey(value: unknown) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString().slice(0, 10);
}

function equalValue(left: unknown, right: unknown) {
  if (left === null || left === undefined || right === null || right === undefined) {
    return (left === null || left === undefined) && (right === null || right === undefined);
  }
  if (left instanceof Date || right instanceof Date) {
    return dateKey(left) === dateKey(right);
  }
  if (typeof left === 'string' || typeof right === 'string') {
    return textValue(left) === textValue(right);
  }
  return left === right;
}

function addIndex<T>(map: Map<string, T[]>, key: string | null, value: T) {
  if (!key) return;
  const group = map.get(key) ?? [];
  group.push(value);
  map.set(key, group);
}

function indexOne<T>(rows: T[], keyFn: (row: T) => string | null) {
  const map = new Map<string, T[]>();
  for (const row of rows) addIndex(map, keyFn(row), row);
  return map;
}

function toPreparedSentence(row: LegacyRow): PreparedSentence {
  const mapped = mapLegacySentencia(row);
  const sourceId = Number(row.id_sentencia);
  const active = Number(row.activo) === 1;
  const values = {
    numeroSentencia: mapped.data.numeroSentencia ?? null,
    tipoFallo: mapped.data.tipoFallo ?? null,
    sala: mapped.data.sala ?? null,
    fecha: mapped.data.fecha ?? null,
    expediente: mapped.data.expediente ?? null,
    tribunalOrigen: mapped.data.tribunalOrigen ?? null,
    actor: mapped.data.actor ?? null,
    demandado: mapped.data.demandado ?? null,
    objeto: mapped.data.objeto ?? null,
    magistrados: mapped.data.magistrados ?? null,
    juez: mapped.juez ?? null,
    caratula: mapped.data.caratula ?? null,
    anio: mapped.data.anio ?? null,
    textoBusqueda: mapped.data.textoBusqueda ?? null,
    textoBusquedaNormalizado: mapped.data.textoBusquedaNormalizado ?? null,
    publicado: active,
    publishedAt: active ? null : null,
    activo: active,
    estadoCarga: active ? 'PUBLICADA' : 'BORRADOR',
  };
  return { sourceId, values, active };
}

function toPreparedSummary(row: LegacyRow, parentActive: boolean): PreparedSummary {
  const mapped = mapLegacySumario(row);
  const sourceId = Number(row.id_sumario);
  const parentSourceId = Number(row.id_sentencia);
  const active = Number(row.activo) === 1;
  const sourcePublished = Number(row.publicado) === 1;
  const rawText = row.texto_sumario;
  const rawSummary = row.resumen;
  const rawTopic = row.tema;
  const preserveText = (value: unknown) =>
    typeof value === 'string' && value.trim().length ? value : null;
  const texto =
    preserveText(rawText) ?? preserveText(rawSummary) ?? preserveText(rawTopic) ?? '';
  const resumenBusqueda = preserveText(rawSummary);
  const search = buildSumarioSearchData({
    numeroSumario: mapped.data.numeroSumario,
    tema: mapped.data.tema,
    texto,
    resumenBusqueda: resumenBusqueda ?? undefined,
  });
  const published = active && parentActive;
  const values = {
    numeroSumario: mapped.data.numeroSumario ?? null,
    tema: mapped.data.tema ?? null,
    texto,
    resumenBusqueda: search.resumenBusqueda ?? null,
    textoBusqueda: search.textoBusqueda ?? null,
    textoBusquedaNormalizado: search.textoBusquedaNormalizado ?? null,
    publicado: published,
    activo: active,
  };
  return {
    sourceId,
    parentSourceId,
    values,
    active,
    sourcePublished,
    parentActive,
  };
}

function sentenceDiffs(expected: Record<string, unknown>, actual: PgSentence) {
  const fields = [
    'numeroSentencia', 'tipoFallo', 'sala', 'fecha', 'expediente',
    'tribunalOrigen', 'actor', 'demandado', 'objeto', 'magistrados', 'juez',
    'caratula', 'anio', 'textoBusqueda', 'textoBusquedaNormalizado',
    'publicado', 'activo', 'estadoCarga',
  ];
  return fields.filter((field) => !equalValue(expected[field], actual[field as keyof PgSentence]));
}

function summaryDiffs(expected: Record<string, unknown>, actual: PgSummary) {
  const fields = [
    'numeroSumario', 'tema', 'texto', 'resumenBusqueda', 'textoBusqueda',
    'textoBusquedaNormalizado', 'publicado', 'activo',
  ];
  return fields.filter((field) => !equalValue(expected[field], actual[field as keyof PgSummary]));
}

async function readSource() {
  const uri = `file:${sourcePath.replace(/\\/gu, '/')}?mode=ro&immutable=1`;
  const sqlite = await open({
    filename: uri,
    driver: sqlite3.Database,
    mode: sqlite3.OPEN_READONLY | sqlite3.OPEN_URI,
  });
  try {
    await sqlite.get('PRAGMA query_only = ON');
    const sentencias = await sqlite.all<LegacyRow[]>('SELECT * FROM tb_sentencias ORDER BY id_sentencia');
    const sumarios = await sqlite.all<LegacyRow[]>('SELECT * FROM tb_sumarios ORDER BY id_sumario');
    const orphan = await sqlite.get<{ count: number }>(
      'SELECT COUNT(*) AS count FROM tb_sumarios s LEFT JOIN tb_sentencias t ON t.id_sentencia=s.id_sentencia WHERE t.id_sentencia IS NULL',
    );
    const activeWithInactiveParent = await sqlite.get<{ count: number }>(
      'SELECT COUNT(*) AS count FROM tb_sumarios s JOIN tb_sentencias t ON t.id_sentencia=s.id_sentencia WHERE s.activo=1 AND t.activo<>1',
    );
    const rootSummaryIds = new Set(sumarios.map((row) => String(row.id_sumario)));
    const snapshot = await readSnapshotSummaries(supplementalSummarySnapshotPath);
    const corroborating = await readSnapshotSummaries(corroboratingSummarySnapshotPath);
    const corroboratingById = new Map(
      corroborating.rows.map((row) => [String(row.id_sumario), row]),
    );
    const supplemental = snapshot.rows.filter(
      (row) => !rootSummaryIds.has(String(row.id_sumario)),
    );
    const corroboration = supplemental.map((row) => {
      const other = corroboratingById.get(String(row.id_sumario));
      return {
        sourceId: Number(row.id_sumario),
        inCorroboratingSnapshot: Boolean(other),
        sameCoreFields: other
          ? [
              'id_sentencia', 'numero_sumario', 'tema', 'texto_sumario',
              'resumen', 'publicado', 'activo',
            ].every((field) => equalValue(row[field], other[field]))
          : null,
      };
    });
    return {
      sentencias,
      sumarios: [...sumarios, ...supplemental],
      snapshotSupplement: {
        path: supplementalSummarySnapshotPath,
        total: snapshot.rows.length,
        uniqueIds: new Set(snapshot.rows.map((row) => String(row.id_sumario))).size,
        appendedRows: supplemental.length,
        appendedIds: supplemental.map((row) => Number(row.id_sumario)),
        corroboratingPath: corroboratingSummarySnapshotPath,
        corroborating: {
          total: corroborating.rows.length,
          appendedIdsFound: corroboration.filter((row) => row.inCorroboratingSnapshot).length,
          appendedIdsCoreFieldsMatch: corroboration.filter((row) => row.sameCoreFields === true).length,
        },
      },
      orphanSumarios: Number(orphan?.count ?? 0),
      activeWithInactiveParent:
        Number(activeWithInactiveParent?.count ?? 0) +
        supplemental.filter((row) => Number(row.activo) === 1 && Number(row.parent_activo) !== 1).length,
    };
  } finally {
    await sqlite.close();
  }
}

async function readSnapshotSummaries(snapshotPath: string) {
  const uri = `file:${snapshotPath.replace(/\\/gu, '/')}?mode=ro&immutable=1`;
  const sqlite = await open({
    filename: uri,
    driver: sqlite3.Database,
    mode: sqlite3.OPEN_READONLY | sqlite3.OPEN_URI,
  });
  try {
    await sqlite.get('PRAGMA query_only = ON');
    const rows = await sqlite.all<LegacyRow[]>(`
      SELECT s.*, t.activo AS parent_activo
        FROM tb_sumarios s
        LEFT JOIN tb_sentencias t ON t.id_sentencia = s.id_sentencia
       ORDER BY s.id_sumario
    `);
    return { rows };
  } finally {
    await sqlite.close();
  }
}

async function assertDatabase(client: Client) {
  const result = await client.query(`
    SELECT current_database() AS database, current_user AS role,
           inet_server_addr()::text AS host, inet_server_port() AS port,
           current_setting('server_version_num')::integer AS version
  `);
  const identity = result.rows[0];
  if (
    identity.database !== 'buscador_juridico_civil_dev' ||
    identity.role !== 'bjc_dev' ||
    identity.host?.split('/')[0] !== '127.0.0.1' ||
    Number(identity.port) !== 55432 ||
    identity.version < 160000 || identity.version >= 170000
  ) {
    throw new Error('Connected database identity failed the DEV-only guard.');
  }
  return {
    database: identity.database,
    host: '127.0.0.1',
    port: 55432,
    role: identity.role,
    postgresMajor: Math.floor(identity.version / 10000),
  };
}

async function loadPg(client: Client) {
  const sentences = await client.query<PgSentence>(`
    SELECT id, "legacyId", "numeroSentencia", "tipoFallo", sala, fecha,
           expediente, "tribunalOrigen", actor, demandado, objeto, magistrados,
           juez, publicado, "publishedAt", activo, "estadoCarga", caratula,
           anio, "textoBusqueda", "textoBusquedaNormalizado"
      FROM "Sentencia"
  `);
  const summaries = await client.query<PgSummary>(`
    SELECT s.id, s."legacyId", s."numeroSumario", s.tema, s.texto,
           s."resumenBusqueda", s."textoBusqueda", s."textoBusquedaNormalizado",
           s.publicado, s.activo, s."sentenciaId", p."legacyId" AS "parentLegacyId"
      FROM "Sumario" s JOIN "Sentencia" p ON p.id = s."sentenciaId"
  `);
  return { sentences: sentences.rows, summaries: summaries.rows };
}

function prepareReport(source: Awaited<ReturnType<typeof readSource>>, pg: Awaited<ReturnType<typeof loadPg>>) {
  const sourceSentenceRows = source.sentencias as LegacyRow[];
  const sourceSummaryRows = source.sumarios as LegacyRow[];
  const pgSentenceIndex = indexOne(pg.sentences, (row) => sourceNumericId(row.legacyId, 'tb_sentencias'));
  const pgSummaryIndex = indexOne(pg.summaries, (row) => sourceNumericId(row.legacyId, 'tb_sumarios'));
  const sourceSentenceIndex = indexOne(sourceSentenceRows, (row) => String(row.id_sentencia));
  const sourceSummaryIndex = indexOne(sourceSummaryRows, (row) => String(row.id_sumario));
  const sourceSentenceActive = new Map(sourceSentenceRows.map((row) => [Number(row.id_sentencia), Number(row.activo) === 1]));

  const preparedSentences = sourceSentenceRows.map(toPreparedSentence);
  const preparedSummaries = sourceSummaryRows.map((row) =>
    toPreparedSummary(row, sourceSentenceActive.get(Number(row.id_sentencia)) === true),
  );

  let sentenceMatched = 0;
  let sentenceMissingActive = 0;
  let sentenceMissingInactive = 0;
  let sentenceMismatchRows = 0;
  let sentenceActiveMismatch = 0;
  let sentenceDuplicates = 0;
  const sentenceDiffCounts: Record<string, number> = {};
  const matchedSentences: Array<PreparedSentence & { pg: PgSentence; diffs: string[] }> = [];
  for (const row of preparedSentences) {
    const key = String(row.sourceId);
    const matches = pgSentenceIndex.get(key) ?? [];
    if (matches.length > 1) {
      sentenceDuplicates++;
      continue;
    }
    const actual = matches[0];
    if (!actual) {
      if (row.active) sentenceMissingActive++;
      else sentenceMissingInactive++;
      continue;
    }
    sentenceMatched++;
    if (row.active !== actual.activo) sentenceActiveMismatch++;
    const diffs = sentenceDiffs(row.values, actual);
    if (diffs.length) sentenceMismatchRows++;
    for (const field of diffs) sentenceDiffCounts[field] = (sentenceDiffCounts[field] ?? 0) + 1;
    matchedSentences.push({ ...row, pg: actual, diffs });
  }

  let summaryMatched = 0;
  let summaryMissingActive = 0;
  let summaryMissingInactive = 0;
  let summaryMismatchRows = 0;
  let summaryParentMismatch = 0;
  let summaryActiveUnpublished = 0;
  let summarySourceUnpublished = 0;
  let summaryDuplicates = 0;
  const summaryDiffCounts: Record<string, number> = {};
  const matchedSummaries: Array<PreparedSummary & { pg: PgSummary; diffs: string[]; parentMismatch: boolean }> = [];
  for (const row of preparedSummaries) {
    const key = String(row.sourceId);
    const matches = pgSummaryIndex.get(key) ?? [];
    if (matches.length > 1) {
      summaryDuplicates++;
      continue;
    }
    const actual = matches[0];
    if (!actual) {
      if (row.active) summaryMissingActive++;
      else summaryMissingInactive++;
      if (row.active && !row.sourcePublished) summarySourceUnpublished++;
      continue;
    }
    summaryMatched++;
    if (row.active && !actual.publicado) summaryActiveUnpublished++;
    if (row.active && !row.sourcePublished) summarySourceUnpublished++;
    const diffs = summaryDiffs(row.values, actual);
    const parentMismatch = sourceNumericId(actual.parentLegacyId, 'tb_sentencias') !== String(row.parentSourceId);
    if (diffs.length) summaryMismatchRows++;
    if (parentMismatch) summaryParentMismatch++;
    for (const field of diffs) summaryDiffCounts[field] = (summaryDiffCounts[field] ?? 0) + 1;
    matchedSummaries.push({ ...row, pg: actual, diffs, parentMismatch });
  }

  const sourceSentenceDuplicateIds = sourceSentenceRows.length - sourceSentenceIndex.size;
  const sourceSummaryDuplicateIds = sourceSummaryRows.length - sourceSummaryIndex.size;
  const sourceCounts = {
    sentencias: {
      total: sourceSentenceRows.length,
      activas: sourceSentenceRows.filter((row) => Number(row.activo) === 1).length,
      inactivas: sourceSentenceRows.filter((row) => Number(row.activo) !== 1).length,
      duplicateIds: sourceSentenceDuplicateIds,
    },
    sumarios: {
      total: sourceSummaryRows.length,
      activos: sourceSummaryRows.filter((row) => Number(row.activo) === 1).length,
      inactivos: sourceSummaryRows.filter((row) => Number(row.activo) !== 1).length,
      sourcePublished: sourceSummaryRows.filter((row) => Number(row.publicado) === 1).length,
      activosNoPublicadosEnFuente: sourceSummaryRows.filter((row) => Number(row.activo) === 1 && Number(row.publicado) !== 1).length,
      activosConPadreInactivo: source.activeWithInactiveParent,
      duplicateIds: sourceSummaryDuplicateIds,
      missingParent: source.orphanSumarios,
    },
  };
  const pgLegacySentences = pg.sentences.filter((row) => sourceNumericId(row.legacyId, 'tb_sentencias'));
  const pgLegacySummaries = pg.summaries.filter((row) => sourceNumericId(row.legacyId, 'tb_sumarios'));
  const pgLegacyOnlySentences = pgLegacySentences.filter((row) => !sourceSentenceIndex.has(sourceNumericId(row.legacyId, 'tb_sentencias')!)).length;
  const pgLegacyOnlySummaries = pgLegacySummaries.filter((row) => !sourceSummaryIndex.has(sourceNumericId(row.legacyId, 'tb_sumarios')!)).length;

  return {
    sourceCounts,
    reconciliation: {
      sentencias: {
        matched: sentenceMatched,
        missingActiveInPostgres: sentenceMissingActive,
        missingInactiveInPostgres: sentenceMissingInactive,
        metadataMismatchRows: sentenceMismatchRows,
        fieldDifferences: sentenceDiffCounts,
        activeFlagMismatch: sentenceActiveMismatch,
        duplicateMatchesInPostgres: sentenceDuplicates,
        postgresLegacyOnly: pgLegacyOnlySentences,
      },
      sumarios: {
        matched: summaryMatched,
        missingActiveInPostgres: summaryMissingActive,
        missingInactiveInPostgres: summaryMissingInactive,
        metadataMismatchRows: summaryMismatchRows,
        fieldDifferences: summaryDiffCounts,
        relationshipMismatch: summaryParentMismatch,
        activeUnpublishedInPostgres: summaryActiveUnpublished,
        activeUnpublishedInSource: summarySourceUnpublished,
        duplicateMatchesInPostgres: summaryDuplicates,
        postgresLegacyOnly: pgLegacyOnlySummaries,
      },
    },
    preparedSentences,
    preparedSummaries,
    matchedSentences,
    matchedSummaries,
    pgSentenceIndex,
    pgSummaryIndex,
    sourceSentenceActive,
    sourceSentenceIndex,
    sourceSummaryIndex,
  };
}

function detailedReconciliation(report: ReturnType<typeof prepareReport>) {
  const missingActiveSummaries = report.preparedSummaries.filter((row) =>
    row.active && !(report.pgSummaryIndex.get(String(row.sourceId))?.length),
  );
  return {
    sentencias: {
      missingActive: report.preparedSentences
        .filter((row) => row.active && !(report.pgSentenceIndex.get(String(row.sourceId))?.length))
        .map((row) => ({ sourceId: row.sourceId })),
      missingInactive: report.preparedSentences
        .filter((row) => !row.active && !(report.pgSentenceIndex.get(String(row.sourceId))?.length))
        .map((row) => ({ sourceId: row.sourceId })),
      metadataMismatch: report.matchedSentences
        .filter((row) => row.diffs.length)
        .map((row) => ({ sourceId: row.sourceId, postgresId: row.pg.id, fields: row.diffs })),
      duplicateMatches: [...report.pgSentenceIndex.entries()]
        .filter(([, rows]) => rows.length > 1)
        .map(([sourceId, rows]) => ({ sourceId, postgresIds: rows.map((row) => row.id) })),
      postgresLegacyOnly: [...report.pgSentenceIndex.entries()]
        .filter(([sourceId]) => !report.sourceSentenceIndex.has(sourceId))
        .flatMap(([sourceId, rows]) => rows.map((row) => ({ sourceId, postgresId: row.id }))),
    },
    sumarios: {
      missingActive: missingActiveSummaries.map((row) => ({
        sourceId: row.sourceId,
        parentSourceId: row.parentSourceId,
        parentActiveInSource: row.parentActive,
        parentMatchCountInPostgres: report.pgSentenceIndex.get(String(row.parentSourceId))?.length ?? 0,
        parentPostgresIds: (report.pgSentenceIndex.get(String(row.parentSourceId)) ?? []).map((parent) => parent.id),
      })),
      missingInactive: report.preparedSummaries
        .filter((row) => !row.active && !(report.pgSummaryIndex.get(String(row.sourceId))?.length))
        .map((row) => ({ sourceId: row.sourceId, parentSourceId: row.parentSourceId })),
      metadataMismatch: report.matchedSummaries
        .filter((row) => row.diffs.length)
        .map((row) => ({ sourceId: row.sourceId, postgresId: row.pg.id, fields: row.diffs })),
      relationshipMismatch: report.matchedSummaries
        .filter((row) => row.parentMismatch)
        .map((row) => ({
          sourceId: row.sourceId,
          postgresId: row.pg.id,
          expectedParentSourceId: row.parentSourceId,
          actualParentSourceId: sourceNumericId(row.pg.parentLegacyId, 'tb_sentencias'),
          actualParentPostgresId: row.pg.sentenciaId,
        })),
      duplicateMatches: [...report.pgSummaryIndex.entries()]
        .filter(([, rows]) => rows.length > 1)
        .map(([sourceId, rows]) => ({ sourceId, postgresIds: rows.map((row) => row.id) })),
      postgresLegacyOnly: [...report.pgSummaryIndex.entries()]
        .filter(([sourceId]) => !report.sourceSummaryIndex.has(sourceId))
        .flatMap(([sourceId, rows]) => rows.map((row) => ({ sourceId, postgresId: row.id }))),
    },
  };
}

function sentenceUpdateRows(report: ReturnType<typeof prepareReport>) {
  const updates: Array<Record<string, unknown>> = [];
  for (const { pg, values, active } of report.matchedSentences) {
    const row = { id: pg.id, ...values, publishedAt: active ? pg.publishedAt ?? new Date() : null };
    const diffs = sentenceDiffs(row, pg);
    if (diffs.length > 0 || !equalValue(row.publishedAt, pg.publishedAt)) updates.push(row);
  }
  return updates;
}

function summaryUpdateRows(report: ReturnType<typeof prepareReport>, sentenceIdBySourceId: Map<number, number>) {
  const updates: Array<Record<string, unknown>> = [];
  for (const { pg, values, parentSourceId } of report.matchedSummaries) {
    const row = {
      id: pg.id,
      sentenciaId: sentenceIdBySourceId.get(parentSourceId) ?? pg.sentenciaId,
      ...values,
    };
    const diffs = summaryDiffs(row, pg);
    if (diffs.length > 0 || row.sentenciaId !== pg.sentenciaId) updates.push(row);
  }
  return updates;
}

const sentenceUpdateTypes: Record<string, string> = {
  id: 'integer', numeroSentencia: 'text', tipoFallo: 'text', sala: 'text', fecha: 'timestamptz',
  expediente: 'text', tribunalOrigen: 'text', actor: 'text', demandado: 'text', objeto: 'text',
  magistrados: 'text', juez: 'text', caratula: 'text', anio: 'integer', textoBusqueda: 'text',
  textoBusquedaNormalizado: 'text', publicado: 'boolean', publishedAt: 'timestamptz', activo: 'boolean',
  estadoCarga: 'text',
};
const summaryUpdateTypes: Record<string, string> = {
  id: 'integer', numeroSumario: 'text', tema: 'text', texto: 'text', resumenBusqueda: 'text',
  textoBusqueda: 'text', textoBusquedaNormalizado: 'text', publicado: 'boolean', activo: 'boolean',
  sentenciaId: 'integer',
};

async function updateRows(client: Client, table: 'Sentencia' | 'Sumario', rows: Array<Record<string, unknown>>, types: Record<string, string>) {
  if (!rows.length) return 0;
  const columns = Object.keys(types).filter((column) => column in rows[0]);
  const updatedAt = '"updatedAt" = CURRENT_TIMESTAMP';
  let changed = 0;
  for (let offset = 0; offset < rows.length; offset += batchSize) {
    const batch = rows.slice(offset, offset + batchSize);
    const values: unknown[] = [];
    const tuples = batch.map((row, rowIndex) => {
      const start = values.length;
      for (const column of columns) values.push(row[column] ?? null);
      return `(${columns.map((column, index) => `$${start + index + 1}::${types[column]}`).join(', ')})`;
    });
    const sourceColumns = columns.map((column) => `"${column}"`).join(', ');
    const assignments = columns.filter((column) => column !== 'id')
      .map((column) => `"${column}" = source."${column}"`).concat(updatedAt).join(', ');
    await client.query('BEGIN');
    try {
      await client.query("SET LOCAL lock_timeout = '5s'");
      await client.query("SET LOCAL statement_timeout = '5min'");
      const result = await client.query(
        `UPDATE "${table}" AS target SET ${assignments} FROM (VALUES ${tuples.join(', ')}) AS source(${sourceColumns}) WHERE target.id = source.id`,
        values,
      );
      if ((result.rowCount ?? 0) !== batch.length) {
        throw new Error(`${table} update row count changed in batch ${offset / batchSize + 1}.`);
      }
      await client.query('COMMIT');
      changed += result.rowCount ?? 0;
      console.log(`OFFICE_BETA_LEGACY_PROGRESS=${table}_UPDATED ${Math.min(offset + batch.length, rows.length)}/${rows.length}`);
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    }
  }
  return changed;
}

async function insertRows(client: Client, table: 'Sentencia' | 'Sumario', columns: string[], rows: unknown[][], casts: string[]) {
  let inserted = 0;
  for (let offset = 0; offset < rows.length; offset += insertBatchSize) {
    const batch = rows.slice(offset, offset + insertBatchSize);
    const values = batch.flat();
    const tuples = batch.map((_, rowIndex) => {
      const start = rowIndex * columns.length;
      return `(${columns.map((_, colIndex) => `$${start + colIndex + 1}::${casts[colIndex]}`).join(', ')})`;
    });
    await client.query('BEGIN');
    try {
      await client.query("SET LOCAL lock_timeout = '5s'");
      await client.query("SET LOCAL statement_timeout = '5min'");
      const result = await client.query(
        `INSERT INTO "${table}" (${columns.map((column) => `"${column}"`).join(', ')}) VALUES ${tuples.join(', ')} ON CONFLICT ("legacyId") DO NOTHING`,
        values,
      );
      if ((result.rowCount ?? 0) !== batch.length) {
        throw new Error(`${table} insert collision: expected ${batch.length}; inserted ${result.rowCount ?? 0}.`);
      }
      await client.query('COMMIT');
      inserted += result.rowCount ?? 0;
      console.log(`OFFICE_BETA_LEGACY_PROGRESS=${table}_INSERTED ${Math.min(offset + batch.length, rows.length)}/${rows.length}`);
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    }
  }
  return inserted;
}

async function auditFileHash(filePath: string) {
  const bytes = await readFile(filePath);
  return createHash('sha256').update(bytes).digest('hex').toUpperCase();
}

async function writeReport(fileName: string, value: unknown) {
  await mkdir(auditRoot, { recursive: true });
  const outputPath = path.join(auditRoot, fileName);
  await writeFile(outputPath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  return outputPath;
}


async function main() {
  const args = getArgs();
  const [mode, backupPath, expectedBackupSha] = args;
  if (!['audit', 'apply', 'activity', 'pgactivity', 'explain', 'explain-hydration'].includes(mode)) throw new Error('Mode must be audit, apply, activity, pgactivity, explain, or explain-hydration.');
  if (!process.env.DATABASE_URL) throw new Error('Missing guarded DATABASE_URL.');
  if (mode === 'activity' || mode === 'pgactivity' || mode === 'explain' || mode === 'explain-hydration') {
    const client = new Client({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 5000 });
    try {
      await client.connect();
      const database = await assertDatabase(client);
      if (mode === 'pgactivity') {
        const activity = await client.query(`
          SELECT pid, application_name AS "applicationName", client_addr::text AS "clientAddress",
                 state, wait_event_type AS "waitEventType", wait_event AS "waitEvent",
                 EXTRACT(EPOCH FROM (clock_timestamp() - xact_start))::int AS "transactionSeconds",
                 EXTRACT(EPOCH FROM (clock_timestamp() - query_start))::int AS "statementSeconds",
                 left(regexp_replace(query, '\\s+', ' ', 'g'), 600) AS "queryShape"
            FROM pg_stat_activity
           WHERE datname = current_database() AND pid <> pg_backend_pid()
           ORDER BY xact_start NULLS LAST, query_start NULLS LAST
           LIMIT 20
        `);
        console.log(JSON.stringify({ task: 'OFFICE_BETA_PG_ACTIVITY', database, activity: activity.rows }, null, 2));
        return;
      }
      if (mode === 'explain') {
        const sourceColumns = [
          'id', 'numeroSumario', 'tema', 'texto', 'resumenBusqueda',
          'textoBusqueda', 'textoBusquedaNormalizado', 'publicado', 'activo', 'sentenciaId',
        ];
        const casts = ['integer', 'text', 'text', 'text', 'text', 'text', 'text', 'boolean', 'boolean', 'integer'];
        const tuples = Array.from({ length: batchSize }, (_, index) => {
          const base = index * sourceColumns.length;
          return `(${sourceColumns.map((_, columnIndex) => `$${base + columnIndex + 1}::${casts[columnIndex]}`).join(', ')})`;
        });
        const values = Array.from({ length: batchSize }, (_, index) => [
          100000000 + index, 'x', 'x', 'x', 'x', 'x', 'x', true, true, 1,
        ]).flat();
        const plan = await client.query(
          `EXPLAIN (COSTS TRUE, FORMAT TEXT) UPDATE "Sumario" AS target SET "numeroSumario"=source."numeroSumario", "tema"=source."tema", "texto"=source."texto", "resumenBusqueda"=source."resumenBusqueda", "textoBusqueda"=source."textoBusqueda", "textoBusquedaNormalizado"=source."textoBusquedaNormalizado", "publicado"=source."publicado", "activo"=source."activo", "sentenciaId"=source."sentenciaId", "updatedAt"=CURRENT_TIMESTAMP FROM (VALUES ${tuples.join(',')}) AS source(${sourceColumns.map((column) => `"${column}"`).join(',')}) WHERE target.id=source.id`,
          values,
        );
        console.log(JSON.stringify({ task: 'OFFICE_BETA_LEGACY_CORPUS_UPDATE_PLAN', database, plan: plan.rows.map((row) => row['QUERY PLAN']) }, null, 2));
        return;
      }
      if (mode === 'explain-hydration') {
        const ids = (backupPath ?? '').split(',').map(Number);
        if (!ids.length || ids.some((id) => !Number.isSafeInteger(id) || id <= 0)) {
          throw new Error('explain-hydration requires comma-separated positive candidate IDs.');
        }
        await client.query("SET statement_timeout = '15s'");
        const plan = await client.query(`
          EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)
          SELECT t."id", t."slugPublico", t."numeroSentencia", t."tipoFallo", t."sala", t."fecha", t."expediente",
                 t."tribunalOrigen", t."actor", t."actorPublico", t."demandado", t."demandadoPublico",
                 t."anonimizado", t."objeto", t."magistrados", t."caratula", t."textoBusqueda",
                 t."textoBusquedaNormalizado", t."publicado", t."activo", t."estadoCarga",
                 COALESCE(summary."searchText", '') AS "sumariosSearchText",
                 COALESCE(summary."sumarioCount", 0)::text AS "sumarioCount",
                 COALESCE((SELECT json_agg(json_build_object('id', file."id", 'rutaArchivo', file."rutaArchivo") ORDER BY file."createdAt" DESC)
                           FROM "ArchivoPdf" file WHERE file."sentenciaId" = t."id"), '[]'::json) AS "archivosPdf"
            FROM "Sentencia" t
            LEFT JOIN LATERAL (
              SELECT string_agg(concat_ws(' ', s."tema", s."numeroSumario", s."resumenBusqueda", s."textoBusquedaNormalizado"), ' ') AS "searchText",
                     count(*) AS "sumarioCount"
                FROM "Sumario" s
               WHERE s."sentenciaId" = t."id" AND s."activo" = TRUE
                 AND (t."publicado" = FALSE OR s."publicado" = TRUE)
            ) summary ON TRUE
           WHERE t."id" = ANY($1::int[]) AND t."activo" = TRUE
             AND (t."publicado" = TRUE AND t."estadoCarga" = 'PUBLICADA')
           ORDER BY array_position($1::int[], t."id")
        `, [ids]);
        const textSize = await client.query(`
          SELECT count(*)::int AS sentences,
                 COALESCE(sum(octet_length(t."textoBusqueda")), 0)::bigint AS "sentenciaTextBytes",
                 COALESCE(max(octet_length(t."textoBusqueda")), 0)::int AS "maxSentenciaTextBytes",
                 COALESCE(sum(octet_length(t."textoBusquedaNormalizado")), 0)::bigint AS "sentenciaNormalizedBytes",
                 COALESCE(sum(summary."summaryBytes"), 0)::bigint AS "summaryTextBytes",
                 COALESCE(max(summary."summaryBytes"), 0)::int AS "maxSummaryTextBytes"
            FROM "Sentencia" t
            LEFT JOIN LATERAL (
              SELECT COALESCE(sum(octet_length(concat_ws(' ', s."tema", s."numeroSumario", s."resumenBusqueda", s."textoBusquedaNormalizado"))), 0)::int AS "summaryBytes"
                FROM "Sumario" s
               WHERE s."sentenciaId" = t."id" AND s."activo" = TRUE
                 AND (t."publicado" = FALSE OR s."publicado" = TRUE)
            ) summary ON TRUE
           WHERE t."id" = ANY($1::int[])
        `, [ids]);
        console.log(JSON.stringify({ task: 'OFFICE_BETA_LEGACY_HYDRATION_EXPLAIN', database, ids: ids.length, plan: plan.rows[0]?.['QUERY PLAN'], textSize: textSize.rows[0] }, null, 2));
        return;
      }
      const activity = await client.query(`
        SELECT pid, state, wait_event_type AS "waitEventType", wait_event AS "waitEvent",
               EXTRACT(EPOCH FROM (clock_timestamp() - xact_start))::int AS "transactionSeconds",
               EXTRACT(EPOCH FROM (clock_timestamp() - query_start))::int AS "statementSeconds",
               left(regexp_replace(query, '\\s+', ' ', 'g'), 3000) AS "queryShape"
          FROM pg_stat_activity
         WHERE datname = current_database() AND pid <> pg_backend_pid()
         ORDER BY xact_start NULLS LAST, query_start NULLS LAST
         LIMIT 12
      `);
      const outbox = await client.query(`
        SELECT count(*)::int AS total,
               count(*) FILTER (WHERE "processedAt" IS NOT NULL)::int AS processed,
               count(*) FILTER (WHERE "processedAt" IS NULL AND "failedAt" IS NULL)::int AS pending,
               count(*) FILTER (WHERE "processedAt" IS NULL AND "failedAt" IS NOT NULL)::int AS failed,
               min("id") FILTER (WHERE "processedAt" IS NULL AND "failedAt" IS NULL)::text AS "oldestPendingId",
               min("createdAt") FILTER (WHERE "processedAt" IS NULL AND "failedAt" IS NULL) AS "oldestPendingAt",
               max("processedAt") AS "lastProcessedAt",
               max("id")::text AS "highWatermark"
          FROM "SearchIndexOutbox"
      `);
      const pendingByOperation = await client.query(`
        SELECT "operation", count(*)::int AS events,
               count(DISTINCT "documentKey")::int AS "distinctDocumentKeys",
               count(*) FILTER (WHERE "leaseUntil" > now())::int AS "leasedNow",
               count(*) FILTER (WHERE "nextAttemptAt" > now())::int AS "notDueNow"
          FROM "SearchIndexOutbox"
         WHERE "processedAt" IS NULL AND "failedAt" IS NULL
         GROUP BY "operation" ORDER BY events DESC, "operation"
      `);
      const pendingByAttempts = await client.query(`
        SELECT "attempts", count(*)::int AS events
          FROM "SearchIndexOutbox"
         WHERE "processedAt" IS NULL AND "failedAt" IS NULL
         GROUP BY "attempts" ORDER BY "attempts"
      `);
      const pendingKeySummary = await client.query(`
        SELECT count(*)::int AS events,
               count(DISTINCT "documentKey")::int AS "distinctDocumentKeys",
               (count(*) - count(DISTINCT "documentKey"))::int AS "redundantNotificationsIfCurrentStateIsReindexed",
               count(*) FILTER (WHERE "leaseUntil" > now())::int AS "leasedNow"
          FROM "SearchIndexOutbox"
         WHERE "processedAt" IS NULL AND "failedAt" IS NULL
      `);
      console.log(JSON.stringify({ task: 'OFFICE_BETA_LEGACY_CORPUS_ACTIVITY', database, activity: activity.rows, outbox: outbox.rows[0], pendingByOperation: pendingByOperation.rows, pendingByAttempts: pendingByAttempts.rows, pendingKeySummary: pendingKeySummary.rows[0] }, null, 2));
    } finally {
      await client.end().catch(() => undefined);
    }
    return;
  }
  const sourceBytes = await stat(sourcePath);
  const sourceSha = await auditFileHash(sourcePath);
  const source = await readSource();
  const client = new Client({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 5000 });
  try {
    await client.connect();
    const database = await assertDatabase(client);
    if (mode === 'apply') {
      if (!backupPath || !expectedBackupSha) throw new Error('Apply requires a verified backup path and SHA-256.');
      const backupInfo = await stat(backupPath);
      const actualBackupSha = await auditFileHash(backupPath);
      if (backupInfo.size < 1_000_000 || actualBackupSha !== expectedBackupSha.toUpperCase()) {
        throw new Error('Verified backup path, size, or checksum did not match.');
      }
    }

    const pg = await loadPg(client);
    const report = prepareReport(source, pg);
    if (
      mode === 'apply' &&
      (report.reconciliation.sentencias.matched < 20_000 ||
        report.reconciliation.sumarios.matched < 20_000)
    ) {
      throw new Error('Legacy identifier crosswalk did not meet the verified preflight shape.');
    }
    const result = {
      task: 'OFFICE_BETA_LEGACY_CORPUS',
      mode,
      source: {
        path: sourcePath,
        bytes: sourceBytes.size,
        sha256: sourceSha,
        readOnly: true,
        queryOnly: true,
        snapshotSupplement: source.snapshotSupplement,
      },
      database,
      sourceCounts: report.sourceCounts,
      reconciliation: report.reconciliation,
      actions: mode === 'audit' ? undefined : {
        betaTemporaryPublication: true,
        productionPublicationApproved: false,
      },
    };

    if (mode === 'audit') {
      const details = detailedReconciliation(report);
      const reportPath = await writeReport(
        `legacy-reconciliation-audit-${new Date().toISOString().replace(/[:.]/gu, '-')}.json`,
        { ...result, details },
      );
      console.log(JSON.stringify({ ...result, details, reportPath }, null, 2));
      return;
    }

    const duplicates = report.reconciliation.sentencias.duplicateMatchesInPostgres +
      report.reconciliation.sumarios.duplicateMatchesInPostgres;
    if (duplicates || source.orphanSumarios) throw new Error('Duplicate legacy identities or orphan source relations block mutation.');

    const sentenceUpdates = sentenceUpdateRows(report);
    const sentenceUpdated = await updateRows(client, 'Sentencia', sentenceUpdates, sentenceUpdateTypes);
    if (sentenceUpdated !== sentenceUpdates.length) throw new Error('Sentence update row count changed during apply.');
    const activeSentenceAdds = report.preparedSentences.filter((row) =>
      row.active && !(report.pgSentenceIndex.get(String(row.sourceId))?.length),
    );
    const activeMissingSummaryParentIds = new Set(
      report.preparedSummaries
        .filter((row) =>
          row.active &&
          !row.parentActive &&
          !(report.pgSummaryIndex.get(String(row.sourceId))?.length),
        )
        .map((row) => row.parentSourceId),
    );
    const inactiveParentsForActiveSummaries = report.preparedSentences.filter((row) =>
      !row.active &&
      activeMissingSummaryParentIds.has(row.sourceId) &&
      !(report.pgSentenceIndex.get(String(row.sourceId))?.length),
    );
    const missingSnapshotOnlyIds = source.snapshotSupplement.appendedIds.filter(
      (id) => !(report.pgSummaryIndex.get(String(id))?.length),
    );
    if (missingSnapshotOnlyIds.length) {
      throw new Error(
        `Snapshot-only active summaries lack PostgreSQL identity and need provenance-specific import: ${missingSnapshotOnlyIds.join(',')}`,
      );
    }
    const sentenceColumns = [
      'legacyId', 'numeroSentencia', 'tipoFallo', 'sala', 'fecha', 'expediente', 'tribunalOrigen',
      'actor', 'demandado', 'objeto', 'magistrados', 'juez', 'estadoCarga', 'publicado',
      'publishedAt', 'activo', 'caratula', 'anio', 'textoBusqueda', 'textoBusquedaNormalizado', 'updatedAt',
    ];
    const sentenceCasts = [
      'text', 'text', 'text', 'text', 'timestamptz', 'text', 'text', 'text', 'text', 'text', 'text',
      'text', 'text', 'boolean', 'timestamptz', 'boolean', 'text', 'integer', 'text', 'text', 'timestamptz',
    ];
    const publishedAt = new Date();
    const sentenceRowsToInsert = [
      ...activeSentenceAdds,
      ...inactiveParentsForActiveSummaries,
    ];
    const sentenceInserted = await insertRows(
      client,
      'Sentencia',
      sentenceColumns,
      sentenceRowsToInsert.map((row) => [
        sourceLegacyId('tb_sentencias', row.sourceId), row.values.numeroSentencia,
        row.values.tipoFallo, row.values.sala, row.values.fecha, row.values.expediente,
        row.values.tribunalOrigen, row.values.actor, row.values.demandado, row.values.objeto,
        row.values.magistrados, row.values.juez, row.values.estadoCarga, row.values.publicado,
        row.active ? publishedAt : null, row.values.activo, row.values.caratula, row.values.anio,
        row.values.textoBusqueda, row.values.textoBusquedaNormalizado, publishedAt,
      ]),
      sentenceCasts,
    );

    const pgSentencesAfterInsert = await client.query<{ id: number; legacyId: string | null }>(
      'SELECT id, "legacyId" FROM "Sentencia"',
    );
    const sentenceIdBySourceId = new Map<number, number>();
    const sentenceIdsByLegacySuffix = new Map<string, number[]>();
    for (const row of pgSentencesAfterInsert.rows) {
      const key = sourceNumericId(row.legacyId, 'tb_sentencias');
      if (key) addIndex(sentenceIdsByLegacySuffix, key, row.id);
    }
    for (const [key, values] of sentenceIdsByLegacySuffix) {
      if (values.length === 1) sentenceIdBySourceId.set(Number(key), values[0]);
    }
    if (sentenceIdBySourceId.size < report.sourceCounts.sentencias.activas) {
      throw new Error('Sentence crosswalk incomplete after active legacy insertion.');
    }

    const summaryUpdates = summaryUpdateRows(report, sentenceIdBySourceId);
    const summaryUpdated = await updateRows(client, 'Sumario', summaryUpdates, summaryUpdateTypes);
    if (summaryUpdated !== summaryUpdates.length) throw new Error('Summary update row count changed during apply.');
    const activeSummaryAddCandidates = report.preparedSummaries.filter((row) =>
      row.active && !(report.pgSummaryIndex.get(String(row.sourceId))?.length),
    );
    const activeSummaryAdds = activeSummaryAddCandidates.filter((row) =>
      sentenceIdBySourceId.has(row.parentSourceId),
    );
    const activeSummaryAddsMissingParentInPostgres =
      activeSummaryAddCandidates.length - activeSummaryAdds.length;
    const summaryColumns = [
      'legacyId', 'numeroSumario', 'tema', 'texto', 'resumenBusqueda', 'textoBusqueda',
      'textoBusquedaNormalizado', 'publicado', 'activo', 'sentenciaId', 'updatedAt',
    ];
    const summaryCasts = ['text', 'text', 'text', 'text', 'text', 'text', 'text', 'boolean', 'boolean', 'integer', 'timestamptz'];
    const summaryInserted = await insertRows(
      client,
      'Sumario',
      summaryColumns,
      activeSummaryAdds.map((row) => [
        sourceLegacyId('tb_sumarios', row.sourceId), row.values.numeroSumario, row.values.tema,
        row.values.texto, row.values.resumenBusqueda, row.values.textoBusqueda,
        row.values.textoBusquedaNormalizado, row.values.publicado, row.values.activo,
        sentenceIdBySourceId.get(row.parentSourceId), publishedAt,
      ]),
      summaryCasts,
    );
    await client.query('BEGIN');
    await client.query("SET LOCAL statement_timeout = '5min'");
    await client.query(`SELECT setval(pg_get_serial_sequence('"Sentencia"','id'), GREATEST(COALESCE(MAX(id),1),1), COUNT(*) > 0) FROM "Sentencia"`);
    await client.query(`SELECT setval(pg_get_serial_sequence('"Sumario"','id'), GREATEST(COALESCE(MAX(id),1),1), COUNT(*) > 0) FROM "Sumario"`);
    await client.query('COMMIT');

    const post = await client.query(`
      SELECT
        (SELECT count(*)::int FROM "Sentencia" WHERE "legacyId" LIKE '%#tb_sentencias/%' AND activo AND publicado) AS "visibleSentencias",
        (SELECT count(*)::int FROM "Sumario" s JOIN "Sentencia" f ON f.id=s."sentenciaId" WHERE s."legacyId" LIKE '%#tb_sumarios/%' AND s.activo AND s.publicado AND f.activo AND f.publicado) AS "visibleSumarios",
        (SELECT count(*)::int FROM "SearchIndexOutbox" WHERE "processedAt" IS NULL AND "failedAt" IS NULL) AS "searchPending",
        (SELECT count(*)::int FROM "SearchIndexOutbox" WHERE "failedAt" IS NOT NULL) AS "searchFailed"
    `);
    const after = {
      importedSentencias: sentenceInserted,
      importedInactiveSentenciasOnlyAsParentsOfActiveSummaries:
        inactiveParentsForActiveSummaries.length,
      updatedSentencias: sentenceUpdated,
      importedSumarios: summaryInserted,
      updatedSumarios: summaryUpdated,
      rootActiveSentencias: report.sourceCounts.sentencias.activas,
      rootActiveSumarios: report.sourceCounts.sumarios.activos,
      activeSourceUnpublishedSumariosTemporarilyPublished: report.sourceCounts.sumarios.activosNoPublicadosEnFuente,
      activeSumariosWithInactiveParent: report.sourceCounts.sumarios.activosConPadreInactivo,
      activeSumariosNotImportedBecauseParentMissingInPostgres: activeSummaryAddsMissingParentInPostgres,
      snapshotOnlyLegacySummaryRowsIncluded: source.snapshotSupplement.appendedIds.length,
      snapshotOnlyLegacySummaryRowsMissingInPostgres: missingSnapshotOnlyIds.length,
      post: post.rows[0],
    };
    const outputPath = await writeReport('legacy-reconciliation-postapply.json', { ...result, after });
    console.log(JSON.stringify({ ...result, after, reportPath: outputPath }, null, 2));
  } finally {
    await client.end().catch(() => undefined);
  }
}

main().catch((error) => {
  console.error(`OFFICE_BETA_LEGACY_CORPUS=FAIL; ${error?.message ?? error}`);
  process.exitCode = 1;
});
