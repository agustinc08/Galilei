'use strict';

// Bounded read-only sample of published judgments linked to the existing
// Corpus page-text projection. Invoke only via with-dev-db-guard.cjs.
const fs = require('node:fs/promises');
const path = require('node:path');
const { Client } = require('pg');

const EXPECTED = {
  host: '127.0.0.1',
  port: 55432,
  database: 'buscador_juridico_civil_dev',
  role: 'bjc_dev',
};
const OUT = process.env.BJC_SPRINT3_EVIDENCE_ROOT;

function parseArgs() {
  const args = JSON.parse(process.env.BJC_SPRINT3_SAMPLE_ARGS || '[]');
  const values = new Map();
  for (let index = 0; index < args.length; index += 1) {
    const [key, inline] = String(args[index]).split('=', 2);
    if (key === '--dry-run') {
      values.set(key, true);
      continue;
    }
    if (!key.startsWith('--')) throw new Error('UNSUPPORTED_ARGUMENT');
    const value = inline ?? args[++index];
    if (!value || String(value).startsWith('--')) throw new Error('MISSING_ARGUMENT_VALUE');
    values.set(key, String(value));
  }
  if (!values.get('--dry-run')) throw new Error('DRY_RUN_REQUIRED');
  const limit = Number(values.get('--limit') ?? 200);
  const offset = Number(values.get('--offset') ?? 0);
  if (!Number.isInteger(limit) || limit < 100 || limit > 500) throw new Error('LIMIT_OUT_OF_RANGE_100_500');
  if (!Number.isInteger(offset) || offset < 0 || offset > 5000) throw new Error('OFFSET_OUT_OF_RANGE_0_5000');
  return { limit, offset };
}

function requireIdentity(row) {
  const host = String(row.host || '').replace(/\/\d+$/u, '');
  if (host !== EXPECTED.host || Number(row.port) !== EXPECTED.port ||
      row.database !== EXPECTED.database || row.role !== EXPECTED.role ||
      Number(row.server_version_num) < 160000 || Number(row.server_version_num) >= 170000) {
    throw new Error('DATABASE_IDENTITY_REJECTED');
  }
  return { host, port: Number(row.port), database: row.database, role: row.role, serverMajor: 16 };
}

async function main() {
  const { limit, offset } = parseArgs();
  if (!process.env.DATABASE_URL || !OUT) throw new Error('GUARDED_ENVIRONMENT_REQUIRED');
  const expectedOut = path.resolve(__dirname, '../../../_recovery-work/galilei-structured-citations-suite3');
  if (path.resolve(OUT) !== expectedOut) throw new Error('EVIDENCE_PATH_REJECTED');

  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const identity = requireIdentity((await client.query(`
      SELECT current_database() AS database, current_user AS role,
        inet_server_addr()::text AS host, inet_server_port() AS port,
        current_setting('server_version_num') AS server_version_num
    `)).rows[0]);

    const population = await client.query(`
      SELECT count(DISTINCT s.id)::int AS eligible_judgments,
        count(DISTINCT s.id) FILTER (WHERE p.id IS NOT NULL)::int AS with_page_text,
        count(DISTINCT s.id) FILTER (WHERE e.status = 'TEXT_EXTRACTED')::int AS text_extracted,
        count(DISTINCT s.id) FILTER (WHERE e.status = 'EXTRACTED_TRUNCATED')::int AS truncated,
        count(DISTINCT s.id) FILTER (WHERE e.status = 'OCR_REQUIRED')::int AS ocr_required,
        count(DISTINCT s.id) FILTER (WHERE e.id IS NULL)::int AS no_latest_extraction
      FROM "Sentencia" s
      LEFT JOIN "CorpusDocumentLink" l ON l."targetDomain"='JURISPRUDENCIA'
        AND l."targetType"='SENTENCIA' AND l."targetId"=s.id::text
      LEFT JOIN "CorpusDocument" d ON d.id=l."documentId" AND d."documentScope"='GENERAL'
      LEFT JOIN "CorpusExtraction" e ON e.id=d."latestExtractionId"
      LEFT JOIN "CorpusDocumentPage" p ON p."extractionId"=e.id
      WHERE s.publicado=true AND s.activo=true
    `);

    const selected = await client.query(`
      WITH eligible AS (
        SELECT DISTINCT ON (s.id)
          s.id AS "sentenceId", s.sala, s.fecha, s.expediente, s."numeroSentencia",
          s."slugPublico", d.id AS "documentId", e.id AS "extractionId",
          e.status AS "extractionStatus", e.extractor, e."extractorVersion",
          e."provenance", file.sha256 AS "sourceChecksum", file."pageCount",
          file."mimeType", file."originalFilename"
        FROM "Sentencia" s
        JOIN "CorpusDocumentLink" l ON l."targetDomain"='JURISPRUDENCIA'
          AND l."targetType"='SENTENCIA' AND l."targetId"=s.id::text
        JOIN "CorpusDocument" d ON d.id=l."documentId" AND d."documentScope"='GENERAL'
        JOIN "CorpusExtraction" e ON e.id=d."latestExtractionId"
        JOIN "CorpusDocumentFile" file ON file.id=e."fileId"
        JOIN "CorpusDocumentPage" p ON p."extractionId"=e.id
        WHERE s.publicado=true AND s.activo=true
        ORDER BY s.id, e."extractedAt" DESC, d.id
      ), bucketed AS (
        SELECT eligible.*,
          NTILE($1::int) OVER (ORDER BY COALESCE(EXTRACT(YEAR FROM fecha)::int, 0), COALESCE(sala, ''), "sentenceId") AS bucket
        FROM eligible
      ), chosen AS (
        SELECT bucketed.*,
          ROW_NUMBER() OVER (PARTITION BY bucket ORDER BY md5("sentenceId"::text || ':suite3')) AS sample_rank
        FROM bucketed
      )
      SELECT * FROM chosen WHERE sample_rank=1
      ORDER BY bucket LIMIT $2 OFFSET $3
    `, [limit, limit, offset]);

    const ids = selected.rows.map((row) => row.extractionId);
    const pageResult = ids.length ? await client.query(`
      SELECT p."extractionId", p."pageNumber", p.text, p."textKind", p."processingStatus"
      FROM "CorpusDocumentPage" p
      WHERE p."extractionId" = ANY($1::text[])
      ORDER BY p."extractionId", p."pageNumber"
    `, [ids]) : { rows: [] };
    const resolutionTargets = await client.query(`
      SELECT id, expediente, "numeroSentencia", sala, fecha, publicado, activo
      FROM "Sentencia"
      WHERE publicado = true AND activo = true
      ORDER BY id
    `);
    const pagesByExtraction = new Map();
    for (const page of pageResult.rows) {
      const pages = pagesByExtraction.get(page.extractionId) || [];
      pages.push({ pageNumber: page.pageNumber, text: page.text, textKind: page.textKind, processingStatus: page.processingStatus });
      pagesByExtraction.set(page.extractionId, pages);
    }
    const documents = selected.rows.map((row) => ({
      sentenceId: row.sentenceId,
      year: row.fecha ? new Date(row.fecha).getUTCFullYear() : null,
      sala: row.sala,
      sourceExpediente: row.expediente,
      sourceNumeroSentencia: row.numeroSentencia,
      documentId: row.documentId,
      extractionId: row.extractionId,
      extractionStatus: row.extractionStatus,
      extractor: row.extractor,
      extractorVersion: row.extractorVersion,
      sourceChecksum: row.sourceChecksum,
      pageCount: row.pageCount,
      pages: pagesByExtraction.get(row.extractionId) || [],
    }));
    const summary = {
      generatedAt: new Date().toISOString(),
      target: identity,
      transaction: 'REPEATABLE READ READ ONLY; rolled back',
      sampling: { method: 'deterministic Sala/year-stratified sample from public active Sentencia rows linked to the latest GENERAL Corpus extraction', limit, offset },
      population: population.rows[0],
      sampleSize: documents.length,
      sampleYears: frequency(documents.map((item) => item.year)),
      sampleSalas: frequency(documents.map((item) => item.sala)),
      extractionStatuses: frequency(documents.map((item) => item.extractionStatus)),
      formats: frequency(selected.rows.map((item) => item.mimeType)),
      pageCount: documents.reduce((sum, item) => sum + item.pages.length, 0),
      documents: documents.map(({ pages, sourceExpediente: _sourceExpediente, sourceNumeroSentencia: _sourceNumeroSentencia, ...item }) => ({ ...item, pageTextPages: pages.length, totalTextCharacters: pages.reduce((sum, page) => sum + page.text.length, 0) })),
    };

    await fs.mkdir(OUT, { recursive: true });
    await fs.writeFile(path.join(OUT, 'real-corpus-sample.json'), `${JSON.stringify(summary, null, 2)}\n`, 'utf8');
    await fs.writeFile(path.join(OUT, 'real-corpus-pages-sample.json'), `${JSON.stringify({ generatedAt: summary.generatedAt, documents }, null, 2)}\n`, 'utf8');
    await fs.writeFile(path.join(OUT, 'citation-resolution-targets.json'), `${JSON.stringify({
      generatedAt: summary.generatedAt,
      selection: 'public=true AND activo=true; read-only identity fields only',
      count: resolutionTargets.rowCount,
      targets: resolutionTargets.rows,
    }, null, 2)}\n`, 'utf8');
    await client.query('ROLLBACK');
    console.log(JSON.stringify({ status: 'READ_ONLY_SAMPLE_READY', identity, population: summary.population, sampleSize: summary.sampleSize, sampleYears: summary.sampleYears, sampleSalas: summary.sampleSalas, extractionStatuses: summary.extractionStatuses, formats: summary.formats, pages: summary.pageCount, resolutionTargets: resolutionTargets.rowCount, evidence: OUT }, null, 2));
  } finally {
    await client.end();
  }
}

function frequency(values) {
  const counts = new Map();
  for (const value of values) {
    const key = value === null || value === undefined || value === '' ? 'UNKNOWN' : String(value);
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return Object.fromEntries([...counts.entries()].sort(([a], [b]) => a.localeCompare(b)));
}

main().catch((error) => {
  console.error(`SPRINT3_READ_ONLY_SAMPLE=FAIL; ${error.code || error.message || 'UNKNOWN_ERROR'}`);
  process.exitCode = 1;
});
