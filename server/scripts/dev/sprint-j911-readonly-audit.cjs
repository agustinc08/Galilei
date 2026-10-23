const { Pool } = require('pg');
const fs = require('node:fs');
const path = require('node:path');
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('DATABASE_URL_MISSING_FROM_DEV_GUARD');
const target = new URL(databaseUrl);
if (target.protocol !== 'postgresql:' || target.hostname !== '127.0.0.1' || target.port !== '55432' || target.pathname !== '/buscador_juridico_civil_dev' || target.username !== 'bjc_dev') throw new Error('DEV_DATABASE_TARGET_REJECTED');
const root = path.resolve(__dirname, '../../../');
const work = path.join(root, '_recovery-work', 'jurisprudencia-j911');
const prior = path.join(root, '_recovery-work', 'jurisprudencia-j901', 'legacy-publication-dry-run.json');
const report = JSON.parse(fs.readFileSync(prior, 'utf8'));
const pending = report.candidates.filter((row) => row.category === 'MODEL_AMBIGUITY');
if (pending.length !== 56 || pending.some((row) => !row.documentId)) throw new Error('J901_REVIEW_COHORT_NOT_56:' + pending.length);
const pool = new Pool({ connectionString: databaseUrl, max: 1 });
async function main() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const identity = (await client.query('SELECT current_database() AS database,current_user AS role,inet_server_addr()::text AS host,inet_server_port() AS port,current_setting(\'server_version_num\') AS server_version_num')).rows[0];
    if (identity.database !== 'buscador_juridico_civil_dev' || identity.role !== 'bjc_dev' || !String(identity.host).startsWith('127.0.0.1') || Number(identity.port) !== 55432) throw new Error('DB_IDENTITY_MISMATCH');
    const published = await client.query(`
      WITH workflow AS (
        SELECT s.* FROM "Sentencia" s
        WHERE s."legacyId" LIKE 'CORPUS:%' AND s.publicado = TRUE AND s.activo = TRUE
      ), grouped AS (
        SELECT f.id, count(sm.id)::int AS all_count,
               count(sm.id) FILTER (WHERE sm.activo)::int AS active_count,
               count(sm.id) FILTER (WHERE sm.activo AND sm.publicado)::int AS visible_count,
               count(sm.id) FILTER (WHERE nullif(btrim(sm."numeroSumario"), '') IS NOT NULL)::int AS numbered_count,
               count(sm.id) FILTER (WHERE nullif(btrim(sm.texto), '') IS NOT NULL)::int AS text_count,
               count(sm.id) FILTER (WHERE nullif(btrim(sm.tema), '') IS NOT NULL)::int AS theme_count,
               count(sm.id) FILTER (WHERE sm.activo AND sm.publicado AND nullif(btrim(sm."numeroSumario"), '') IS NOT NULL)::int AS visible_numbered_count,
               count(sm.id) FILTER (WHERE sm.activo AND sm.publicado AND nullif(btrim(sm.texto), '') IS NOT NULL)::int AS visible_text_count,
               count(sm.id) FILTER (WHERE sm.activo AND sm.publicado AND nullif(btrim(sm.tema), '') IS NOT NULL)::int AS visible_theme_count
        FROM workflow f LEFT JOIN "Sumario" sm ON sm."sentenciaId" = f.id GROUP BY f.id
      )
      SELECT count(*)::int AS published_fallos,
        count(*) FILTER (WHERE all_count=0)::int AS fallos_zero_sumarios,
        count(*) FILTER (WHERE all_count=1)::int AS fallos_one_sumario,
        count(*) FILTER (WHERE all_count>1)::int AS fallos_multiple_sumarios,
        coalesce(sum(all_count),0)::int AS attached_sumarios,
        coalesce(sum(active_count),0)::int AS attached_active_sumarios,
        coalesce(sum(visible_count),0)::int AS reader_visible_sumarios,
        count(*) FILTER (WHERE numbered_count>0)::int AS fallos_with_sumario_number,
        count(*) FILTER (WHERE text_count>0)::int AS fallos_with_sumario_text,
        count(*) FILTER (WHERE theme_count>0)::int AS fallos_with_sumario_theme,
        count(*) FILTER (WHERE visible_count>0 AND active_count>visible_count)::int AS fallos_with_nonreader_sumarios,
        coalesce(sum(visible_numbered_count),0)::int AS visible_numbered_sumarios,
        coalesce(sum(visible_text_count),0)::int AS visible_text_sumarios,
        coalesce(sum(visible_theme_count),0)::int AS visible_themes
      FROM grouped`);
    const sources = await client.query(`
      SELECT count(*) FILTER (WHERE sm."legacyId" LIKE 'sqlite:jurisp_6/db/jurisprudencia_db.sqlite#tb_sumarios/%')::int AS legacy_sumarios,
             count(*) FILTER (WHERE parent."legacyId" LIKE 'CORPUS:%' AND parent.publicado AND parent.activo)::int AS on_published_corpus_workflow,
             count(*) FILTER (WHERE parent."legacyId" LIKE 'sqlite:jurisp_6/db/jurisprudencia_db.sqlite#tb_sentencias/%')::int AS attached_to_legacy_sentence,
             count(*) FILTER (WHERE parent."legacyId" LIKE 'CORPUS:%' AND NOT (parent.publicado AND parent.activo))::int AS attached_to_nonreader_corpus_workflow,
             count(*) FILTER (WHERE parent.id IS NULL)::int AS orphan_sumarios,
             count(*) FILTER (WHERE sm."legacyId" IS NOT NULL AND sm."legacyId" NOT LIKE 'sqlite:jurisp_6/db/jurisprudencia_db.sqlite#tb_sumarios/%')::int AS other_source_sumarios
      FROM "Sumario" sm LEFT JOIN "Sentencia" parent ON parent.id=sm."sentenciaId"`);
    const cohort = await client.query(`
      SELECT c.id AS document_id, f."mimeType" AS mime_type,s.id AS sentence_id,s.publicado,s.activo,
             l.metadata->>'publicationStatus' AS persisted_review_status
      FROM "CorpusDocument" c
      LEFT JOIN "CorpusDocumentFile" f ON f."documentId"=c.id
      LEFT JOIN "Sentencia" s ON s."legacyId"='CORPUS:'||c.id
      LEFT JOIN "CorpusDocumentLink" l ON l."documentId"=c.id AND l."targetDomain"='JURISPRUDENCIA' AND l."targetType"='SENTENCIA'
      WHERE c.id=ANY($1::text[]) ORDER BY c.id`, [pending.map((row) => row.documentId)]);
    if (cohort.rows.length !== 56) throw new Error('REVIEW_COHORT_DB_RECONCILIATION_FAILED:' + cohort.rows.length);
    const byReason = {};
    for (const row of pending) for (const issue of row.issues || []) byReason[issue] = (byReason[issue] || 0) + 1;
    const persistedStates = {};
    for (const row of cohort.rows) { const key = row.persisted_review_status || 'NO_PERSISTED_REVIEW_STATUS'; persistedStates[key] = (persistedStates[key] || 0) + 1; }
    const cohortWorkflow = {
      documents: cohort.rows.length,
      docsWithSentenceWorkflow: cohort.rows.filter((row) => row.sentence_id !== null).length,
      published: cohort.rows.filter((row) => row.publicado === true).length,
      activeUnpublished: cohort.rows.filter((row) => row.publicado === false && row.activo === true).length,
      inactiveUnpublished: cohort.rows.filter((row) => row.publicado === false && row.activo === false).length,
      byMime: cohort.rows.reduce((result, row) => { const key = row.mime_type || 'NO_FILE'; result[key] = (result[key] || 0) + 1; return result; }, {}),
      persistedReviewStatus: persistedStates,
      derivation: 'Exact J9.0.1 dry-run cohort category MODEL_AMBIGUITY; no IDs hardcoded.'
    };
    const history = await client.query(`
      SELECT count(*) FILTER (WHERE NOT publicado AND activo)::int AS active_unpublished_all,
             count(*) FILTER (WHERE NOT publicado AND activo AND "legacyId" LIKE 'CORPUS:%')::int AS active_unpublished_corpus_workflow,
             count(*) FILTER (WHERE NOT publicado AND activo AND ("legacyId" IS NULL OR "legacyId" NOT LIKE 'CORPUS:%'))::int AS active_unpublished_legacy_other,
             count(*) FILTER (WHERE NOT publicado AND activo AND "legacyId" LIKE 'CORPUS:%' AND "estadoCarga"='BORRADOR')::int AS corpus_workflow_draft
      FROM "Sentencia"`);
    const reviewDerivation = await client.query(`
      WITH model_ambiguity AS (
        SELECT DISTINCT c.id, 'PERSISTED_LEGAL_KEY_COLLISION'::text AS source
        FROM "CorpusDocument" c
        JOIN "CorpusDocumentLink" l ON l."documentId"=c.id
          AND l."targetDomain"='JURISPRUDENCIA' AND l."targetType"='SENTENCIA'
        WHERE l.metadata->>'publicationStatus'='REQUIRES_REVIEW_LEGAL_KEY_COLLISION'
      ), unsupported_representation AS (
        SELECT DISTINCT c.id, 'CIVIL_TEXT_PLAIN_SOURCE'::text AS source
        FROM "CorpusDocument" c
        JOIN "CorpusIngestionRecord" i ON i."documentId"=c.id
        JOIN "CorpusSourceSystem" ss ON ss.id=i."sourceSystemId"
        JOIN "CorpusDocumentFile" f ON f.id=i."fileId"
        WHERE ss.code='CIVIL_CUANTIFICACION_DANOS' AND f."mimeType"='text/plain'
      ), joined AS (
        SELECT coalesce(a.id,b.id) AS id, a.id IS NOT NULL AS identity_review,
          b.id IS NOT NULL AS representation_review
        FROM model_ambiguity a FULL OUTER JOIN unsupported_representation b ON b.id=a.id
      )
      SELECT count(*)::int AS total, count(*) FILTER (WHERE identity_review)::int AS identity_review,
        count(*) FILTER (WHERE representation_review)::int AS representation_review,
        count(*) FILTER (WHERE identity_review AND representation_review)::int AS overlapping,
        count(*) FILTER (WHERE NOT identity_review AND NOT representation_review)::int AS unclassified
      FROM joined`);
    if (Number(reviewDerivation.rows[0].total) !== 56 || Number(reviewDerivation.rows[0].overlapping) !== 0 || Number(reviewDerivation.rows[0].unclassified) !== 0) {
      throw new Error('REVIEW_QUEUE_DERIVATION_NOT_EXACTLY_56:' + JSON.stringify(reviewDerivation.rows[0]));
    }
    const realPdf = await client.query(`
      SELECT s.id, s."slugPublico" AS slug, s.caratula, a.id AS "fileId",
        a."nombreOriginal" AS filename, a."rutaArchivo" AS path, a."mimeType" AS "mimeType"
      FROM "Sentencia" s JOIN "ArchivoPdf" a ON a."sentenciaId"=s.id
      WHERE s.publicado AND s.activo AND s."legacyId" LIKE 'CORPUS:%'
        AND s."slugPublico" IS NOT NULL AND a."mimeType"='application/pdf'
      ORDER BY s.id LIMIT 1`);
    const result = {
      audit: 'SPRINT_J911_READ_ONLY',
      databaseIdentity: identity,
      transaction: 'REPEATABLE READ READ ONLY',
      publishedCorpusWorkflow: published.rows[0],
      legacySumarioSourceInventory: sources.rows[0],
      reviewRequiredCohort: { expected: 56, byReason, persistedAndDatabase: cohortWorkflow },
      activeUnpublishedPopulation: history.rows[0],
      reviewQueueDerivation: reviewDerivation.rows[0],
      realPublishedPdfCandidate: realPdf.rows[0] || null,
      classificationNotes: {
        orphanSumarios: 'Sumario.sentenciaId is required; zero orphans does not prove a legal match to the public workflow.',
        legacyUnmapped: 'Legacy-origin sumarios attached to legacy Sentencia rows are counted separately; no legal crosswalk to public Corpus workflow rows is inferred.',
        cohortSource: 'J9.0.1 publication dry-run on the J8 6,070-row manifest.'
      }
    };
    fs.mkdirSync(work, { recursive: true });
    fs.writeFileSync(path.join(work, 'sumario-audit.json'), JSON.stringify(result, null, 2) + '\n', 'utf8');
    fs.writeFileSync(path.join(work, 'review-56-definition.json'), JSON.stringify({
      rule: 'Union of persisted CorpusDocumentLink publicationStatus REQUIRES_REVIEW_LEGAL_KEY_COLLISION and civil quantification source documents whose linked file mimeType is text/plain.',
      cohort: result.reviewRequiredCohort,
      derivation: reviewDerivation.rows[0],
      published: 0,
      hardcodedIds: false,
      overlaps: Number(reviewDerivation.rows[0].overlapping),
      unrelatedActiveUnpublishedSentencias: Number(history.rows[0].active_unpublished_all) - Number(cohortWorkflow.docsWithSentenceWorkflow),
    }, null, 2) + '\n', 'utf8');
    await client.query('ROLLBACK');
    console.log(JSON.stringify({ ...result, writes: 0 }, null, 2));
  } finally { client.release(); }
}
main().catch((error) => { console.error('SPRINT_J911_READ_ONLY_AUDIT=FAIL; ' + error.message); process.exitCode = 1; }).finally(() => pool.end());
