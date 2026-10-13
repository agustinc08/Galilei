import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import { resolve } from 'node:path';
import { Client, Pool } from 'pg';
import { CorpusSearchSourceAdapter } from '../../src/corpus/corpus-search.adapter';
import { parseSearchQuery } from '../../src/busqueda/utils/search-parser';
import { normalizeSearchText } from '../../src/busqueda/utils/search-normalizer';

const raw = process.env.DATABASE_URL;
if (!raw) throw new Error('DEV_DATABASE_URL_MISSING');
const target = new URL(raw);
if (target.protocol !== 'postgresql:' || target.hostname !== '127.0.0.1' || target.port !== '55432' || target.pathname !== '/buscador_juridico_civil_dev' || target.username !== 'bjc_dev') throw new Error('DEV_DATABASE_TARGET_REJECTED');

const cases = [
  { id: 'frequent_two_word', phrase: 'responsabilidad civil' },
  { id: 'frequent_alt_two_word', phrase: 'daño moral' },
  { id: 'three_word', phrase: 'responsabilidad civil contractual' },
  { id: 'accented', phrase: 'daño emergente' },
  { id: 'rare_two_word', phrase: 'rondinella daño' },
  { id: 'zero_result', phrase: 'zzqvnoresult2026 phrase' },
];
let currentStep = 'connect';
const phase = process.argv[2] === 'after' ? 'after' : 'before';

async function main() {
  const adapter = new CorpusSearchSourceAdapter(raw);
  const pool = (adapter as unknown as { pool: Pool }).pool;
  const originalQuery = pool.query.bind(pool);
  const plans: Record<string, unknown> = {};
  const directPhrasePlans: Record<string, unknown> = {};
  const profiles: Array<Record<string, unknown>> = [];
  const queryTemplates: Array<Record<string, unknown>> = [];
  let fewResultSample: { queryFingerprint: string; resultCount: number; total: number; totalExact: boolean; hasMore: boolean } | undefined;
  let capturedPage: { sql: string; values: unknown[]; label: string } | undefined;
  const queryEvents: Array<{ label: string; fingerprint: string; elapsedMs: number; rowCount: number | null }> = [];
  let activeCase = '';
  (pool as unknown as { query: (...args: unknown[]) => Promise<unknown> }).query = async (...args: unknown[]) => {
    const started = performance.now();
    const sql = String(args[0]);
    if (sql.includes('"pagedCandidates"') && (sql.includes('"candidateStats"') || sql.includes('"phraseWindowScan"'))) capturedPage = { sql, values: args[1] as unknown[], label: activeCase };
    let result: { rows?: unknown[]; rowCount?: number | null };
    try {
      result = await (originalQuery as (...args: unknown[]) => Promise<{ rows?: unknown[]; rowCount?: number | null }>)(...args);
    } catch (error) {
      queryEvents.push({ label: activeCase, fingerprint: createHash('sha256').update(sql.replace(/\s+/gu, ' ').trim()).digest('hex').slice(0, 16), elapsedMs: round(performance.now() - started), rowCount: null });
      if (capturedPage && phase === 'after') {
        try {
          const explain = await inspector.query(`EXPLAIN (ANALYZE, BUFFERS, VERBOSE, SETTINGS, FORMAT JSON) ${capturedPage.sql}`, capturedPage.values);
          let serialized = JSON.stringify(explain.rows[0]['QUERY PLAN']);
          const samplePhrase = cases.find((item) => item.id === activeCase)?.phrase ?? '';
          for (const value of [samplePhrase, samplePhrase.normalize('NFD').replace(/[\u0300-\u036f]/gu, ''), ...samplePhrase.split(/\s+/u)]) if (value) serialized = serialized.split(value).join('<query-value>');
          plans[`${activeCase}_after_timeout`] = JSON.parse(serialized);
          const partialRoot = resolve(__dirname, '../../../..', '_recovery-work/sprint149');
          await mkdir(resolve(partialRoot, `explain-${phase}`), { recursive: true });
          await writeFile(resolve(partialRoot, `explain-${phase}/phrase-page-plans.json`), `${JSON.stringify({ generatedAt: new Date().toISOString(), environment: { endpoint: '127.0.0.1:55432', database: 'buscador_juridico_civil_dev', role: 'bjc_dev' }, plans }, null, 2)}\n`, 'utf8');
          await writeFile(resolve(partialRoot, 'query-templates-after.json'), `${JSON.stringify({ generatedAt: new Date().toISOString(), persistedQueryText: false, samples: [{ case: activeCase, sqlFingerprint: createHash('sha256').update(capturedPage.sql.replace(/\s+/gu, ' ').trim()).digest('hex').slice(0, 16), sqlTemplate: capturedPage.sql.replace(/\s+/gu, ' ').trim(), parameterCount: capturedPage.values.length, parameterValuesPersisted: false }] }, null, 2)}\n`, 'utf8');
        } catch {
          // Retain the original search error when EXPLAIN also exceeds its diagnostic window.
        }
      }
      throw error;
    }
    queryEvents.push({ label: activeCase, fingerprint: createHash('sha256').update(sql.replace(/\s+/gu, ' ').trim()).digest('hex').slice(0, 16), elapsedMs: round(performance.now() - started), rowCount: result.rowCount ?? result.rows?.length ?? null });
    return result;
  };

  const inspector = new Client({ connectionString: raw });
  try {
    await inspector.connect();
    await inspector.query('SET statement_timeout = 30000');
    const identity = (await inspector.query(`SELECT current_database() AS database, current_user AS role, inet_server_addr()::text AS host, inet_server_port() AS port, version() AS version`)).rows[0];
    if (identity.database !== 'buscador_juridico_civil_dev' || identity.role !== 'bjc_dev' || String(identity.host).replace(/\/\d+$/u, '') !== '127.0.0.1' || Number(identity.port) !== 55432) throw new Error('DEV_DATABASE_IDENTITY_REJECTED');
    const corpus = (await inspector.query(`SELECT count(*)::int AS documents, (SELECT count(*)::bigint FROM "CorpusSearchToken")::text AS tokens FROM "CorpusDocument" WHERE "status"='INDEXED'`)).rows[0];
    const indexes = await inspector.query(`
      SELECT s.relname AS table_name, i.indexrelname AS index_name,
             pg_relation_size(i.indexrelid)::bigint AS bytes, i.idx_scan, i.idx_tup_read, i.idx_tup_fetch,
             pg_get_indexdef(i.indexrelid) AS definition
        FROM pg_stat_user_indexes i JOIN pg_class s ON s.oid=i.relid
       WHERE s.relname IN ('CorpusDocument','CorpusSearchToken','CorpusDocumentPage')
         AND (i.indexrelname ILIKE '%searchtext%' OR i.indexrelname ILIKE '%token%' OR i.indexrelname ILIKE '%visibility%' OR i.indexrelname ILIKE '%decisiondate%')
       ORDER BY s.relname, i.indexrelname`);
    const tableStats = await inspector.query(`
      SELECT relname, n_live_tup, n_dead_tup, last_analyze, last_autoanalyze
        FROM pg_stat_user_tables WHERE relname IN ('CorpusDocument','CorpusSearchToken','CorpusDocumentPage') ORDER BY relname`);
    const environment = {
      generatedAt: new Date().toISOString(), target: { endpoint: '127.0.0.1:55432', database: identity.database, role: identity.role },
      postgresVersion: identity.version, corpusDocumentsIndexed: corpus.documents, tokenRows: corpus.tokens,
      hardware: { platform: os.platform(), release: os.release(), cpu: os.cpus()[0]?.model ?? null, logicalProcessors: os.cpus().length, memoryBytes: os.totalmem() },
      queryTextPersisted: false,
      indexes: indexes.rows.map((row) => ({ ...row, definition: String(row.definition).replace(/\s+/gu, ' ') })), tableStats: tableStats.rows,
    };

    for (const sample of cases) {
      activeCase = sample.id;
      currentStep = `adapter:${sample.id}`;
      capturedPage = undefined;
      const started = performance.now();
      const result = await adapter.search(parseSearchQuery(`"${sample.phrase}"`), {
        visibility: 'ADMIN', dialect: 'modern', publicationPolicy: 'legacy-active-only', page: 1, pageSize: 10,
      });
      const adapterMs = round(performance.now() - started);
      const profile = adapter.getLastSearchProfile();
      profiles.push({ case: sample.id, queryFingerprint: createHash('sha256').update(sample.phrase).digest('hex').slice(0, 16), adapterMs, resultCount: result.results.length, total: result.total, totalExact: result.totalExact, hasMore: result.hasMore, ...(profile ?? {}) });
      const pageSample = capturedPage as { sql: string; values: unknown[]; label: string } | undefined;
      if (!pageSample) continue;
      queryTemplates.push({
        case: sample.id,
        queryFingerprint: createHash('sha256').update(sample.phrase).digest('hex').slice(0, 16),
        sqlFingerprint: createHash('sha256').update(pageSample.sql.replace(/\s+/gu, ' ').trim()).digest('hex').slice(0, 16),
        sqlTemplate: pageSample.sql.replace(/\s+/gu, ' ').trim(),
        parameterCount: pageSample.values.length,
        parameterShapes: pageSample.values.map((value) => ({
          type: Array.isArray(value) ? 'array' : value === null ? 'null' : typeof value,
          ...(typeof value === 'string' ? { characterCount: value.length } : {}),
          ...(Array.isArray(value) ? { elementCount: value.length } : {}),
        })),
        parameterValuesPersisted: false,
      });
      currentStep = `actual_plan:${sample.id}`;
      const beforePlan = await inspector.query(`EXPLAIN (ANALYZE, BUFFERS, VERBOSE, SETTINGS, FORMAT JSON) ${pageSample.sql}`, pageSample.values);
      const plan = beforePlan.rows[0]['QUERY PLAN'];
      let serialized = JSON.stringify(plan);
      for (const value of [sample.phrase, sample.phrase.normalize('NFD').replace(/[\u0300-\u036f]/gu, ''), ...sample.phrase.split(/\s+/u)]) {
        if (value) serialized = serialized.split(value).join('<query-value>');
      }
      const safePlan = JSON.parse(serialized);
      plans[sample.id] = safePlan;
      queryEvents.push({ label: sample.id, fingerprint: createHash('sha256').update(pageSample.sql.replace(/\s+/gu, ' ').trim()).digest('hex').slice(0, 16), elapsedMs: 0, rowCount: null });
      const partialRoot = resolve(__dirname, '../../../..', '_recovery-work/sprint149');
      await mkdir(resolve(partialRoot, `explain-${phase}`), { recursive: true });
      await writeFile(resolve(partialRoot, `explain-${phase}/phrase-page-plans.json`), `${JSON.stringify({ generatedAt: new Date().toISOString(), environment: { endpoint: '127.0.0.1:55432', database: identity.database, role: identity.role }, plans }, null, 2)}\n`, 'utf8');
      if (phase === 'after') await writeFile(resolve(partialRoot, 'query-templates-after.json'), `${JSON.stringify({ generatedAt: new Date().toISOString(), persistedQueryText: false, samples: queryTemplates }, null, 2)}\n`, 'utf8');
      if (phase === 'before') {
      const directSql = `WITH "phraseCandidates" AS MATERIALIZED (
        SELECT d."id", d."decisionDate", d."updatedAt" FROM "CorpusDocument" d
         WHERE d."visibility" = ANY($1::text[]) AND d."status"='INDEXED' AND d."searchText" ILIKE $2 ESCAPE E'\\\\'
      ), "candidateStats" AS MATERIALIZED (SELECT count(*)::integer AS "candidateCount" FROM "phraseCandidates"),
      "candidateWindow" AS MATERIALIZED (
        SELECT "id", "decisionDate", "updatedAt" FROM "phraseCandidates"
         ORDER BY "decisionDate" DESC NULLS LAST, "updatedAt" DESC, "id" LIMIT 11
      ) SELECT c."id" FROM "candidateWindow" c CROSS JOIN "candidateStats"`;
      const directValues = [['PUBLIC', 'INTERNAL', 'RESTRICTED'], `%${normalizeSearchText(sample.phrase)}%`];
      const directStarted = performance.now();
      currentStep = `direct_plan:${sample.id}`;
      const directExplain = await inspector.query(`EXPLAIN (ANALYZE, BUFFERS, VERBOSE, SETTINGS, FORMAT JSON) ${directSql}`, directValues);
      const directPlan = directExplain.rows[0]['QUERY PLAN'];
      const directTotalMs = round(performance.now() - directStarted);
      let directSerialized = JSON.stringify(directPlan);
      for (const value of [sample.phrase, sample.phrase.normalize('NFD').replace(/[\u0300-\u036f]/gu, ''), ...sample.phrase.split(/\s+/u)]) if (value) directSerialized = directSerialized.split(value).join('<query-value>');
      const directJson = JSON.parse(directSerialized);
      const directRoot = Array.isArray(directJson) ? directJson[0] : directJson;
      directPhrasePlans[sample.id] = { explainWallMs: directTotalMs, exactPhraseCandidatePlan: directJson, planningMs: directRoot?.['Planning Time'], executionMs: directRoot?.['Execution Time'] };
      }
    }

    if (phase === 'after') {
      const phraseCandidates = await inspector.query<{ phrase: string }>(`
        SELECT DISTINCT match[1] AS phrase
          FROM (
            SELECT left(d."searchText", 1800) AS sample_text
              FROM "CorpusDocument" d
             WHERE d."status" = 'INDEXED' AND d."searchText" IS NOT NULL
             ORDER BY md5(d."id")
             LIMIT 40
          ) sampled
          CROSS JOIN LATERAL regexp_matches(sampled.sample_text, '([[:alpha:]]{5,}[[:space:]]+[[:alpha:]]{5,})', 'g') AS match
         WHERE length(match[1]) BETWEEN 11 AND 80
         LIMIT 60
      `);
      for (let index = 0; index < phraseCandidates.rows.length; index += 1) {
        const phrase = phraseCandidates.rows[index].phrase.trim();
        if (!phrase) continue;
        activeCase = `few_result_probe_${index + 1}`;
        capturedPage = undefined;
        const result = await adapter.search(parseSearchQuery(`"${phrase}"`), {
          visibility: 'ADMIN', dialect: 'modern', publicationPolicy: 'legacy-active-only', page: 1, pageSize: 10,
        });
        if (result.results.length === 0 || result.results.length > 10 || Boolean(result.hasMore)) continue;
        const queryFingerprint = createHash('sha256').update(phrase).digest('hex').slice(0, 16);
        const profile = adapter.getLastSearchProfile();
        profiles.push({ case: 'few_results', queryFingerprint, resultCount: result.results.length, total: result.total, totalExact: Boolean(result.totalExact), hasMore: Boolean(result.hasMore), ...(profile ?? {}) });
        fewResultSample = { queryFingerprint, resultCount: result.results.length, total: result.total, totalExact: Boolean(result.totalExact), hasMore: Boolean(result.hasMore) };
        const pageSample = capturedPage as { sql: string; values: unknown[]; label: string } | undefined;
        if (pageSample) {
          const explain = await inspector.query(`EXPLAIN (ANALYZE, BUFFERS, VERBOSE, SETTINGS, FORMAT JSON) ${pageSample.sql}`, pageSample.values);
          plans.few_results = explain.rows[0]['QUERY PLAN'];
          queryTemplates.push({
            case: 'few_results', queryFingerprint,
            sqlFingerprint: createHash('sha256').update(pageSample.sql.replace(/\s+/gu, ' ').trim()).digest('hex').slice(0, 16),
            sqlTemplate: pageSample.sql.replace(/\s+/gu, ' ').trim(), parameterCount: pageSample.values.length,
            parameterShapes: pageSample.values.map((value) => ({
              type: Array.isArray(value) ? 'array' : value === null ? 'null' : typeof value,
              ...(typeof value === 'string' ? { characterCount: value.length } : {}),
              ...(Array.isArray(value) ? { elementCount: value.length } : {}),
            })),
            parameterValuesPersisted: false,
          });
        }
        break;
      }
    }

    const root = resolve(__dirname, '../../../..');
    const output = resolve(root, '_recovery-work/sprint149');
    await mkdir(resolve(output, `explain-${phase}`), { recursive: true });
    await writeFile(resolve(output, `environment-${phase}.json`), `${JSON.stringify(environment, null, 2)}\n`, 'utf8');
    await writeFile(resolve(output, `profiling-${phase}.json`), `${JSON.stringify({ generatedAt: new Date().toISOString(), adapterProfiles: profiles, queryEvents }, null, 2)}\n`, 'utf8');
    await writeFile(resolve(output, 'query-samples.json'), `${JSON.stringify({ generatedAt: new Date().toISOString(), persistedQueryText: false, samples: [...cases.map(({ id, phrase }) => ({ id, queryFingerprint: createHash('sha256').update(phrase).digest('hex').slice(0, 16), words: phrase.split(/\s+/u).length, normalizedCharacterCount: phrase.length })), ...(fewResultSample ? [{ id: 'few_results', ...fewResultSample }] : [])] }, null, 2)}\n`, 'utf8');
    await writeFile(resolve(output, `explain-${phase}/phrase-page-plans.json`), `${JSON.stringify({ generatedAt: new Date().toISOString(), environment: { endpoint: '127.0.0.1:55432', database: identity.database, role: identity.role }, plans }, null, 2)}\n`, 'utf8');
    if (phase === 'after') await writeFile(resolve(output, 'query-templates-after.json'), `${JSON.stringify({ generatedAt: new Date().toISOString(), persistedQueryText: false, samples: queryTemplates }, null, 2)}\n`, 'utf8');
    await writeFile(resolve(output, `explain-${phase}/direct-phrase-candidate-plans.json`), `${JSON.stringify({ generatedAt: new Date().toISOString(), plans: directPhrasePlans }, null, 2)}\n`, 'utf8');
    console.log(JSON.stringify({ status: `SPRINT149_PROFILE_${phase.toUpperCase()}_PASS`, corpus: { documents: corpus.documents, tokens: corpus.tokens }, adapterProfiles: profiles, output }, null, 2));
  } finally {
    await inspector.end();
    await adapter.close();
  }
}

function round(value: number) { return Math.round(value * 100) / 100; }
main().catch((error) => { const item = error as { message?: string; code?: string }; console.error(JSON.stringify({ status: 'SPRINT149_PROFILE_FAILED', step: currentStep, code: item.code ?? null, message: item.message ?? null })); process.exitCode = 1; });
