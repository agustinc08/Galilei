'use strict';

// Applies only the deterministic instance classifications captured by the J1 read-only audit.
// Invoke through with-dev-db-guard.cjs sprint-j1-apply; defaults to dry-run outside that action.
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { Client } = require('pg');

const ROOT = path.resolve(__dirname, '..', '..', '..');
const WORK = path.join(ROOT, '_recovery-work', 'jurisprudencia-j1');
const expected = { host: '127.0.0.1', port: 55432, database: 'buscador_juridico_civil_dev', role: 'bjc_dev' };

async function main() {
  const mode = process.env.BJC_SPRINT_J1_MODE || 'dry-run';
  if (!['dry-run', 'apply'].includes(mode)) throw new Error('J1_MODE_INVALID');
  const raw = process.env.DATABASE_URL;
  if (!raw) throw new Error('J1_DATABASE_URL_MISSING');
  const url = new URL(raw);
  if (url.protocol !== 'postgresql:' || url.hostname !== expected.host || Number(url.port) !== expected.port ||
      url.pathname !== `/${expected.database}` || url.username !== expected.role) throw new Error('J1_DEV_TARGET_REJECTED');
  const audit = JSON.parse(fs.readFileSync(path.join(WORK, 'instance-classification.json'), 'utf8'));
  const plan = JSON.parse(fs.readFileSync(path.join(WORK, 'db-write-plan.json'), 'utf8'));
  const backupPath = path.join(WORK, 'backup.json');
  const backup = fs.existsSync(backupPath) ? JSON.parse(fs.readFileSync(backupPath, 'utf8')) : null;
  if (plan.status !== 'DRY_RUN_ONLY' || plan.target?.database !== expected.database ||
      plan.target?.address?.replace(/\/\d+$/u, '') !== expected.host || Number(plan.target?.port) !== expected.port ||
      plan.target?.role !== expected.role || !Array.isArray(plan.proposed?.instanceUpdates)) throw new Error('J1_WRITE_PLAN_REJECTED');
  if (mode === 'apply' && (!backup || backup.status !== 'DEV_BACKUP_COMPLETE' ||
      backup.target?.host !== expected.host || Number(backup.target?.port) !== expected.port ||
      backup.target?.database !== expected.database || backup.target?.user !== expected.role ||
      !backup.path || !fs.existsSync(backup.path) || fs.statSync(backup.path).size !== Number(backup.bytes))) {
    throw new Error('J1_BACKUP_NOT_VERIFIED');
  }
  const entries = audit.records.filter(row => row.inferredInstance !== 'UNKNOWN');
  if (entries.length !== 4596 || entries.some(row => row.inferredInstance !== 'SECOND_INSTANCE' ||
      row.rule !== 'EXACT_CORPUS_COURT_NAME_AND_EXPLICIT_CIVIL_CHAMBER' || row.sourceCode !== 'CIVIL_CUANTIFICACION_DANOS' ||
      row.court !== 'Cámara Nacional de Apelaciones en lo Civil' || !/^[A-M]$/u.test(row.chamber) ||
      !row.originalCourtEvidence.some(e => /(?:sourceRecord|groupSourceRecords\.\d+)\.court$/u.test(e.key) && e.value === row.court) ||
      !row.originalCourtEvidence.some(e => /(?:sourceRecord|groupSourceRecords\.\d+)\.chamber$/u.test(e.key) && e.value === row.chamber))) {
    throw new Error('J1_INSTANCE_SET_INVALID');
  }

  const client = new Client({ connectionString: raw, connectionTimeoutMillis: 10000 });
  try {
    await client.connect();
    await client.query(mode === 'apply' ? 'BEGIN' : 'BEGIN READ ONLY');
    const live = (await client.query(`SELECT current_database() database,current_user role,
      inet_server_addr()::text address,inet_server_port() port,
      current_setting('server_version_num')::int version_num`)).rows[0];
    if (live.database !== expected.database || live.role !== expected.role ||
        String(live.address || '').replace(/\/\d+$/u, '') !== expected.host || Number(live.port) !== expected.port ||
        live.version_num < 160000 || live.version_num >= 170000) throw new Error('J1_LIVE_IDENTITY_REJECTED');
    const ids = entries.map(row => row.documentId);
    const rows = (await client.query(`SELECT d.id,d.instance,d.court,d.chamber,d."metadata"->'instanceClassification'->>'rule' prior_rule,
      s.code source_code
      FROM "CorpusDocument" d LEFT JOIN LATERAL (SELECT i."sourceSystemId" FROM "CorpusIngestionRecord" i
        WHERE i."documentId"=d.id ORDER BY i."createdAt" LIMIT 1) i ON true
      LEFT JOIN "CorpusSourceSystem" s ON s.id=i."sourceSystemId" WHERE d.id=ANY($1::text[])`, [ids])).rows;
    if (rows.length !== entries.length) throw new Error(`J1_ROW_COUNT_MISMATCH:${rows.length}/${entries.length}`);
    const unexpected = rows.filter(row => row.court !== 'Cámara Nacional de Apelaciones en lo Civil' ||
      !/^[A-M]$/u.test(row.chamber || '') || row.source_code !== 'CIVIL_CUANTIFICACION_DANOS' ||
      !((row.instance == null) || (row.instance === 'SECOND_INSTANCE' && row.prior_rule === 'EXACT_CORPUS_COURT_NAME_AND_EXPLICIT_CIVIL_CHAMBER')));
    if (unexpected.length) throw new Error(`J1_ROWS_CHANGED_OR_CONFLICTED:${unexpected.length}`);
    const skipped = rows.filter(row => row.instance === 'SECOND_INSTANCE').length;
    let updated = 0;
    if (mode === 'apply') {
      const toUpdate = entries.filter(entry => rows.find(row => row.id === entry.documentId)?.instance == null);
      for (let offset = 0; offset < toUpdate.length; offset += 250) {
        const batch = toUpdate.slice(offset, offset + 250);
        const result = await client.query(`UPDATE "CorpusDocument" d SET instance='SECOND_INSTANCE',
          metadata=jsonb_set(coalesce(d.metadata,'{}'::jsonb),'{instanceClassification}',jsonb_build_object(
            'value','SECOND_INSTANCE','rule','EXACT_CORPUS_COURT_NAME_AND_EXPLICIT_CIVIL_CHAMBER',
            'sourceCode','CIVIL_CUANTIFICACION_DANOS','evidence',jsonb_build_object('court',d.court,'chamber',d.chamber),
            'sprint','J1'),true), "updatedAt"=now()
          WHERE d.id=ANY($1::text[]) AND d.instance IS NULL AND d.court='Cámara Nacional de Apelaciones en lo Civil'
            AND d.chamber=ANY($2::text[])`, [batch.map(row => row.documentId), [...new Set(batch.map(row => row.chamber))]]);
        updated += result.rowCount;
        if (result.rowCount !== batch.length) throw new Error(`J1_BATCH_ROW_COUNT_MISMATCH:${result.rowCount}/${batch.length}`);
      }
    }
    const after = (await client.query(`SELECT
      (SELECT count(*)::int FROM "CorpusDocument" WHERE lower(coalesce(court,'')) LIKE '%civil%' OR lower(coalesce(chamber,'')) LIKE '%civil%') civil,
      (SELECT count(*)::int FROM "CorpusDocument" WHERE lower(coalesce(court,'')) LIKE '%civil%' AND instance='SECOND_INSTANCE') second_instance,
      (SELECT count(*)::int FROM "CorpusDocument" WHERE lower(coalesce(court,'')) LIKE '%civil%' AND instance='FIRST_INSTANCE') first_instance,
      (SELECT count(*)::int FROM "CorpusDocument" WHERE (lower(coalesce(court,'')) LIKE '%civil%' OR lower(coalesce(chamber,'')) LIKE '%civil%') AND instance IS NULL) missing_instance`)).rows[0];
    if (mode === 'apply' && (Number(after.missing_instance) !== 0 || Number(after.civil) !== 6070 ||
        Number(after.second_instance) !== 6069 || Number(after.first_instance) !== 1)) throw new Error('J1_POST_WRITE_COUNTS_REJECTED');
    if (mode === 'apply') await client.query('COMMIT');
    else await client.query('ROLLBACK');
    const idempotency = mode === 'apply' && updated === 0 && skipped === entries.length ? 'PASS' : 'REQUIRES_RECHECK';
    const result = { status: mode === 'apply' ? 'J1_INSTANCE_APPLY_PASS' : 'J1_INSTANCE_DRY_RUN_PASS',
      target: { ...expected, version_num: live.version_num }, planned: entries.length, updated, skipped,
      conflicted: 0, beforeMissing: audit.beforeMissing, after, idempotency };
    fs.writeFileSync(path.join(WORK, mode === 'apply' ? 'db-write-result.json' : 'db-write-preflight.json'), `${JSON.stringify(result, null, 2)}\n`);
    if (mode === 'apply') {
      const grouped = (await client.query(`SELECT extract(year from "decisionDate")::int AS "year",
        coalesce(nullif(chamber,''),'UNKNOWN') chamber,coalesce(nullif(court,''),'UNKNOWN') court,
        coalesce(nullif(instance,''),'UNKNOWN') instance,count(*)::int documents
        FROM "CorpusDocument" WHERE lower(coalesce(court,'')) LIKE '%civil%'
          OR lower(coalesce(chamber,'')) LIKE '%civil%' GROUP BY 1,2,3,4 ORDER BY 1,2,3,4`)).rows;
      const instanceGroups = {};
      const byCourt = {};
      const byYearCorpus = {};
      const byChamberCorpus = {};
      const byInstanceYears = {};
      const byInstanceSources = {};
      for (const row of grouped) {
        const inst = row.instance || 'UNKNOWN';
        instanceGroups[inst] = (instanceGroups[inst] || 0) + Number(row.documents);
        byCourt[`${row.court}|${row.chamber}`] = (byCourt[`${row.court}|${row.chamber}`] || 0) + Number(row.documents);
        if (!byInstanceYears[inst]) byInstanceYears[inst] = new Set();
        if (row.year != null) byInstanceYears[inst].add(String(row.year));
        if (!byInstanceSources[inst]) byInstanceSources[inst] = new Set();
        byInstanceSources[inst].add(row.court);
        if (row.year != null) byYearCorpus[String(row.year)] = (byYearCorpus[String(row.year)] || 0) + Number(row.documents);
        if (/^[A-M]$/u.test(row.chamber)) byChamberCorpus[row.chamber] = (byChamberCorpus[row.chamber] || 0) + Number(row.documents);
      }
      const discovery = JSON.parse(fs.readFileSync(path.join(ROOT, '_recovery-work', 'jurisprudencia-discovery', 'coverage.json'), 'utf8'));
      const held = JSON.parse(fs.readFileSync(path.join(ROOT, '_recovery-work', 'sprint148', 'live-dry-run.json'), 'utf8'))
        .legalDocumentClassifications.filter(row => row.status !== 'EXACT_FILE_MATCH');
      const reviewByYear = {};
      const reviewBySala = {};
      const unlinkedExactByYear = {};
      const unlinkedExactBySala = {};
      for (const row of held) {
        if (row.status === 'EXACT_DOCUMENT_MATCH') {
          const year = String(row.decisionDate || '').slice(0,4) || 'UNKNOWN';
          unlinkedExactByYear[year] = (unlinkedExactByYear[year] || 0) + 1;
          unlinkedExactBySala[row.chamber] = (unlinkedExactBySala[row.chamber] || 0) + 1;
        }
        if (!['CONFLICT','CANDIDATE','SAME_DOCUMENT_DIFFERENT_FILE','EXACT_DOCUMENT_MATCH'].includes(row.status)) continue;
        const year = String(row.decisionDate || '').slice(0,4) || 'UNKNOWN';
        reviewByYear[year] = (reviewByYear[year] || 0) + 1;
        reviewBySala[row.chamber] = (reviewBySala[row.chamber] || 0) + 1;
      }
      const yearRows = (discovery.byYear || []).map(row => { const year = String(row.year);
        const matched = Math.max(0, Number(row.safeAcquisitionLegalKeys || 0) - (unlinkedExactByYear[year] || 0));
        return { year, known: row.knownDocketYearPairs, acquiredWithSafeKey: row.safeAcquisitionLegalKeys,
        matched, documents: byYearCorpus[year] || 0, review: 0, metadataOnly: null,
        unavailable: row.documentUnavailable, challenge: row.humanChallengeRequired, open: row.notAttempted,
        coverageWithinKnownSetPct: row.knownDocketYearPairs
          ? Number((100 * matched / row.knownDocketYearPairs).toFixed(2)) : null }; });
      for (const row of yearRows) row.review = reviewByYear[row.year] || 0;
      const roomRows = (discovery.byChamber || []).map(row => { const matched = Math.max(0, Number(row.safeAcquisitionLegalKeys || 0) - (unlinkedExactBySala[row.chamber] || 0));
        return { chamber: row.chamber, known: row.docketDatePairs, acquiredWithSafeKey: row.safeAcquisitionLegalKeys,
        matched, documents: byChamberCorpus[row.chamber] || 0, review: reviewBySala[row.chamber] || 0, open: row.notAttempted, metadataOnly: null,
        unavailable: row.documentUnavailable, challenge: row.humanChallengeRequired,
        gap: Math.max(0, Number(row.docketDatePairs) - matched),
        coverageWithinKnownSetPct: row.docketDatePairs ? Number((100 * matched / row.docketDatePairs).toFixed(2)) : null }; });
      const byInstance = Object.entries(instanceGroups).map(([instance, documents]) => ({ instance, documents,
        years: [...(byInstanceYears[instance] || [])].sort(), sources: [...(byInstanceSources[instance] || [])].sort() }));
      const byCourtRows = Object.entries(byCourt).map(([key, documents]) => ({ court: key.split('|')[0], chamber: key.split('|')[1], documents }));
      const final = { generatedAt: new Date().toISOString(), gitSha: execFileSync('git', ['-C', ROOT, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
        target: result.target, counts: result.after, instanceGroups, byInstance, byYear: yearRows, bySala: roomRows, byCourt: byCourtRows,
        scope: discovery.scopeNote || discovery.scope, note: 'Coverage within the known thematic set; it is not total Civil coverage.' };
      fs.writeFileSync(path.join(WORK, 'coverage-after.json'), `${JSON.stringify(final, null, 2)}\n`);
      fs.writeFileSync(path.join(WORK, 'post-write-verification.json'), `${JSON.stringify({ ...result,
        searchProjectionMustBeVerified: true, corpusCountsPreserved: Number(after.civil) === 6070 }, null, 2)}\n`);
      const finalSummary = JSON.parse(fs.readFileSync(path.join(WORK, 'final-summary.json'), 'utf8'));
      finalSummary.status = 'J1_POST_WRITE_INSTANCE_CLASSIFICATION_PASS';
      finalSummary.corpusAfter = result.after;
      finalSummary.instanceAfter = instanceGroups;
      finalSummary.coverageAfter = { years: yearRows.length, salas: roomRows.length, scope: final.note };
      finalSummary.dbWrite = result;
      fs.writeFileSync(path.join(WORK, 'final-summary.json'), `${JSON.stringify(finalSummary, null, 2)}\n`);
    }
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally { await client.end().catch(() => {}); }
}

main().catch(error => { console.error(`J1_APPLY_FAILED: ${error.message}`); process.exitCode = 1; });
