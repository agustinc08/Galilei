// Read-only INT-1S profiler. Invoke through with-dev-db-guard.cjs.
require('ts-node/register');

const fs = require('node:fs');
const path = require('node:path');
const pg = require('pg');
const { performance } = require('node:perf_hooks');
const { parseSearchQuery } = require('../../src/busqueda/utils/search-parser');
const { normalizeSearchText } = require('../../src/busqueda/utils/search-normalizer');
const { CorpusSearchSourceAdapter } = require('../../src/corpus/corpus-search.adapter');
const { PostgresJurisprudenciaSearchAdapter } = require('../../src/busqueda/adapters/postgres-jurisprudencia-search.adapter');

const raw = process.env.DATABASE_URL || '';
const target = new URL(raw);
if (target.protocol !== 'postgresql:' || target.hostname !== '127.0.0.1' || target.port !== '55432' ||
    target.pathname !== '/buscador_juridico_civil_dev' || target.username !== 'bjc_dev') {
  throw new Error('INT1S_DEV_TARGET_REJECTED');
}

const root = path.resolve(__dirname, '../../../_recovery-work/integration-int1s-search');
fs.mkdirSync(root, { recursive: true });
const originalQuery = pg.Pool.prototype.query;
const captured = { JURISPRUDENCIA: [], CORPUS: [] };
let activeSource = null;
pg.Pool.prototype.query = function (...args) {
  const sql = typeof args[0] === 'string' ? args[0] : args[0]?.text;
  const values = Array.isArray(args[1]) ? args[1] : args[0]?.values || [];
  const record = sql && activeSource ? { sql, values, startedAt: performance.now() } : null;
  const result = originalQuery.apply(this, args);
  if (record) {
    captured[activeSource].push(record);
    if (result && typeof result.then === 'function') {
      return result.then((value) => {
        record.elapsedMs = performance.now() - record.startedAt;
        record.rowCount = value?.rows?.length ?? null;
        record.resultBytes = value?.rows ? Buffer.byteLength(JSON.stringify(value.rows), 'utf8') : null;
        return value;
      }, (error) => {
        record.elapsedMs = performance.now() - record.startedAt;
        throw error;
      });
    }
  }
  return result;
};

function safeError(error) {
  return { code: error?.code || null, message: String(error?.message || error).split('\n')[0].slice(0, 240) };
}

async function explainCaptured(label, record) {
  const client = new pg.Client({ connectionString: raw, connectionTimeoutMillis: 5000, statement_timeout: 40000 });
  await client.connect();
  try {
    const identity = await client.query(`SELECT current_database() AS database, current_user AS role,
      inet_server_addr()::text AS address, inet_server_port() AS port, current_setting('server_version_num')::int AS version`);
    const row = identity.rows[0];
    const address = String(row.address || '').split('/')[0];
    const localAddress = address === '127.0.0.1' || address === '::ffff:127.0.0.1';
    if (row.database !== 'buscador_juridico_civil_dev' || row.role !== 'bjc_dev' || !localAddress || row.port !== 55432 || row.version < 160000 || row.version >= 170000) {
      throw new Error(`INT1S_EXPLAIN_TARGET_REJECTED:${row.database}:${row.role}:${row.address}:${row.port}:${row.version}`);
    }
    await client.query('BEGIN READ ONLY');
    await client.query("SET LOCAL statement_timeout = '40000'");
    const explain = await client.query(
      `EXPLAIN (ANALYZE, BUFFERS, VERBOSE, SETTINGS, WAL, FORMAT JSON) ${record.sql}`,
      record.values,
    );
    await client.query('COMMIT');
    return { status: 'PASS', target: { database: row.database, role: row.role, endpoint: '127.0.0.1:55432', version: row.version }, plan: explain.rows[0]['QUERY PLAN'][0] };
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch {}
    return { status: 'FAIL', error: safeError(error) };
  } finally {
    await client.end();
  }
}

async function main() {
  const results = [];
  const phraseText = process.env.BJC_INT1S_QUERY || '"responsabilidad civil"';
  const phrase = parseSearchQuery(phraseText);
  const jurisprudencia = new PostgresJurisprudenciaSearchAdapter(raw);
  activeSource = 'JURISPRUDENCIA';
  const jStart = performance.now();
  try {
    const result = await jurisprudencia.search(phrase, {
      visibility: 'INTERNAL', dialect: 'modern', publicationPolicy: 'published-active-only', page: 1, pageSize: 25,
    });
    results.push({ source: activeSource, status: 'PASS', total: result.total, rows: result.results.length, elapsedMs: performance.now() - jStart, profile: jurisprudencia.getLastSearchProfile() });
  } catch (error) {
    results.push({ source: activeSource, status: 'FAIL', elapsedMs: performance.now() - jStart, error: safeError(error), profile: jurisprudencia.getLastSearchProfile() });
  } finally {
    await jurisprudencia.close();
  }

  const corpus = new CorpusSearchSourceAdapter(raw);
  activeSource = 'CORPUS';
  const cStart = performance.now();
  try {
    const result = await corpus.search(phrase, {
      visibility: 'INTERNAL', dialect: 'modern', publicationPolicy: 'published-active-only', page: 1, pageSize: 25, sourceSystems: ['CORPUS'],
    });
    results.push({ source: activeSource, status: 'PASS', total: result.total, rows: result.results.length, elapsedMs: performance.now() - cStart, profile: corpus.getLastSearchProfile() });
  } catch (error) {
    results.push({ source: activeSource, status: 'FAIL', elapsedMs: performance.now() - cStart, error: safeError(error), profile: corpus.getLastSearchProfile() });
  } finally {
    await corpus.close();
  }
  activeSource = null;
  pg.Pool.prototype.query = originalQuery;

  const sqlSections = [];
  const plans = {};
  for (const [source, records] of Object.entries(captured)) {
    for (const record of records) {
      const index = sqlSections.length + 1;
      sqlSections.push(`-- ${source} query ${index}; parameterCount=${record.values.length}; elapsedMs=${Number(record.elapsedMs || 0).toFixed(2)}\n${record.sql.trim()}\n`);
    }
    const explainRecord = source === 'JURISPRUDENCIA'
      ? records.find((record) => /SELECT COUNT\(\*\)::text AS total/u.test(record.sql))
      : records.find((record) => /phraseCandidateStats/u.test(record.sql));
    if (explainRecord) plans[source] = await explainCaptured(source, explainRecord);
  }

  if (phrase.root?.type === 'phrase') {
    const exactPattern = `%${normalizeSearchText(phrase.root.value).replace(/[\\%_]/gu, '\\$&')}%`;
    for (const status of ['INDEXED', 'OCR_REQUIRED']) {
      const key = `CORPUS_EXACT_COUNT_${status}`;
      plans[key] = await explainCaptured(key, {
        sql: `SELECT COUNT(*)::text AS total FROM "CorpusDocument" d
              WHERE d."visibility" = ANY($1::text[])
                AND d."status" = $2
                AND d."documentScope" = 'GENERAL'
                AND d."searchText" ILIKE $3 ESCAPE E'\\\\'`,
        values: [['PUBLIC', 'INTERNAL'], status, exactPattern],
      });
    }
    const corpusPageRecord = captured.CORPUS.find((record) => record.sql.includes('"phraseCandidateStats" AS MATERIALIZED'));
    if (corpusPageRecord) {
      const marker = corpusPageRecord.sql.indexOf('"phraseCandidateStats" AS MATERIALIZED');
      const candidateCtes = corpusPageRecord.sql.slice(0, marker).replace(/,\s*$/u, '');
      const phraseParameter = corpusPageRecord.values.findIndex((value) => value === exactPattern);
      if (candidateCtes && phraseParameter >= 0) {
        const countSql = `${candidateCtes}
          SELECT COUNT(*)::text AS total
            FROM "corpusSearchCandidates" c
            JOIN "CorpusDocument" d ON d."id" = c."id"
           WHERE d."searchText" ILIKE $${phraseParameter + 1} ESCAPE E'\\\\'`;
        plans.CORPUS_EXACT_COUNT_CANDIDATES = await explainCaptured('CORPUS_EXACT_COUNT_CANDIDATES', {
          sql: countSql,
          values: corpusPageRecord.values.slice(0, phraseParameter + 1),
        });
      }
    }
  }

  fs.writeFileSync(path.join(root, 'sql-captured.sql'), `${sqlSections.join('\n')}\n`, 'utf8');
  fs.writeFileSync(path.join(root, 'int1s-live-diagnostics.json'), `${JSON.stringify({ generatedAt: new Date().toISOString(), target: 'bjc_dev@127.0.0.1:55432/buscador_juridico_civil_dev', queryFamily: 'PHRASE', queryTextStored: false, results, plans, capturedQueries: Object.fromEntries(Object.entries(captured).map(([key, records]) => [key, records.map(({ sql, values, elapsedMs, rowCount, resultBytes }) => ({ sql, parameterCount: values.length, parameterTypes: values.map((value) => value instanceof Date ? 'date' : Array.isArray(value) ? 'text[]' : typeof value), elapsedMs: Number((elapsedMs || 0).toFixed(2)), rowCount, resultBytes }))])) }, null, 2)}\n`, 'utf8');
  const status = Object.values(plans).every((plan) => plan.status === 'PASS') ? 'PASS' : 'PARTIAL';
  console.log(`INT1S_DIAGNOSTICS=${status}; sourceRuns=${results.map((result) => `${result.source}:${result.status}`).join(',')}; plans=${Object.entries(plans).map(([source, plan]) => `${source}:${plan.status}`).join(',')}; artifacts=${root}`);
}

main().catch((error) => {
  pg.Pool.prototype.query = originalQuery;
  console.error(`INT1S_DIAGNOSTICS=FAIL; ${safeError(error).message}`);
  process.exitCode = 1;
});
