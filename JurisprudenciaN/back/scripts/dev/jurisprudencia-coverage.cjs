'use strict';

// Reusable coverage/gap engine. Accepts an official CSV/JSON census, or current
// discovery aggregate JSON; a current Corpus snapshot/coverage-after JSON is optional.
const fs = require('node:fs');
const path = require('node:path');

function parseCsv(text) {
  const input = String(text).replace(/^\uFEFF/u, '');
  const rows = [];
  let row = [], field = '', quoted = false;
  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    if (quoted) {
      if (ch === '"' && input[i + 1] === '"') { field += '"'; i++; }
      else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') { row.push(field); field = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && input[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.some(value => value !== '')) rows.push(row);
      row = [];
    } else field += ch;
  }
  row.push(field);
  if (row.some(value => value !== '')) rows.push(row);
  if (!rows.length) return [];
  const headers = rows.shift().map(value => value.trim());
  return rows.map(values => Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ''])));
}

function parseInput(file) {
  const content = fs.readFileSync(file, 'utf8');
  if (/\.csv$/iu.test(file)) return parseCsv(content);
  const value = JSON.parse(content);
  return Array.isArray(value) ? value : value.records || value.rows || value.documents || value;
}
function first(row, names) {
  for (const name of names) if (row[name] !== undefined && row[name] !== null && String(row[name]).trim() !== '') return row[name];
  return '';
}
function normalizeRow(row) {
  const docket = String(first(row, ['expediente','caseNumber','case_number','docket'])).trim();
  const date = String(first(row, ['fecha','decisionDate','decision_date','date'])).slice(0,10);
  const yearRaw = String(first(row, ['decisionYear','decision_year','año','anio','year']) || date.slice(0,4));
  const year = /^\d{4}$/u.test(yearRaw) ? yearRaw : 'UNKNOWN';
  const chamber = String(first(row, ['Sala','sala','chamber','room'])).trim().replace(/^sala\s*/iu, '').toUpperCase() || 'UNKNOWN';
  const court = String(first(row, ['courtNormalized','court_normalized','Juzgado','juzgado','court','tribunal'])).trim() || 'UNKNOWN';
  const sourceRecordId = String(first(row, ['sourceRecordId','source_record_id'])).trim();
  const portalId = String(first(row, ['portalId','portal_id','id','externalId'])).trim();
  const instanceRaw = String(first(row, ['instance','instancia'])).trim().toUpperCase();
  const instance = row.courtType === 'FIRST_INSTANCE_CIVIL' || /FIRST|PRIMERA|JUZGADO/u.test(instanceRaw) || court !== 'UNKNOWN' && /juzgado/i.test(court)
    ? 'FIRST_INSTANCE' : /SECOND|SEGUNDA|CAMARA|CÁMARA/u.test(instanceRaw) || chamber !== 'UNKNOWN'
      ? 'SECOND_INSTANCE' : 'UNKNOWN';
  const status = String(first(row, ['status','viewerStatus','sourceViewerStatus','estado','availability']) || row.match?.confidence || '').trim().toUpperCase();
  const confidence = String(first(row, ['confidence','matchConfidence','match_confidence']) || row.match?.confidence || '').trim().toUpperCase();
  const matched = row.matched === true || /^(true|1|yes)$/iu.test(String(row.matched || '')) ||
    ['EXACT','HIGH','HIGH_CONFIDENCE'].includes(confidence);
  const key = sourceRecordId || (row.expedienteNormalized
    ? `${docket}|${String(first(row,['expedienteYear','expediente_year']) || year)}|${court}|${chamber}`
    : docket ? `${docket}|${year}|${instance === 'FIRST_INSTANCE' ? court : chamber}` : portalId || `row:${JSON.stringify(row)}`);
  return { key, portalId, docket, year, chamber, court, instance, date, status, matched,
    acquired: /PDF_ACCESSIBLE|ACQUIRED|INGESTED/u.test(status) || row.acquired === true,
    unknown: !status || /UNKNOWN/u.test(status),
    metadataOnly: /METADATA_ONLY|METADATA-ONLY/u.test(status) || row.metadataOnly === true,
    review: /REVIEW|CANDIDATE|CONFLICT/u.test(status) || ['MEDIUM','LOW','CONFLICT'].includes(confidence),
    unavailable: /UNAVAILABLE/u.test(status), challenge: /CHALLENGE|CAPTCHA|SESSION_REQUIRED/u.test(status),
    open: /OPEN|NOT_ATTEMPTED|UNATTEMPTED/u.test(status) };
}
function group(rows, dimension) {
  const keyOf = row => row[dimension] || 'UNKNOWN';
  const buckets = new Map();
  for (const row of rows) {
    const key = keyOf(row);
    if (!buckets.has(key)) buckets.set(key, new Map());
    const existing = buckets.get(key).get(row.key);
    if (!existing) buckets.get(key).set(row.key, { ...row });
    else {
      existing.matched ||= row.matched;
      existing.metadataOnly ||= row.metadataOnly;
      existing.review ||= row.review;
      existing.unavailable ||= row.unavailable;
      existing.challenge ||= row.challenge;
      existing.open ||= row.open;
    }
  }
  return [...buckets.entries()].map(([key, values]) => {
    const items = [...values.values()];
    const known = items.length;
    const matched = items.filter(row => row.matched).length;
    return { [dimension]: key, known, matched, acquiredWithSafeKey: items.filter(row => row.acquired).length,
      gap: Math.max(0, known - matched),
      review: items.filter(row => row.review).length, metadataOnly: items.filter(row => row.metadataOnly).length,
      unavailable: items.filter(row => row.unavailable).length, challenge: items.filter(row => row.challenge).length,
      open: items.filter(row => row.open).length, unknown: items.filter(row => row.unknown).length,
      coverageWithinKnownSetPct: known ? Number((100 * matched / known).toFixed(2)) : null };
  }).sort((a,b) => String(a[dimension]).localeCompare(String(b[dimension]), 'en'));
}
function aggregateSource(source, corpus = {}) {
  if (source && Array.isArray(source.byYear) && Array.isArray(source.byChamber)) {
    const years = source.byYear.map(row => ({ year: String(row.year), known: Number(row.knownDocketYearPairs || 0),
      acquiredWithSafeKey: Number(row.safeAcquisitionLegalKeys || 0),
      matched: Number(corpus.byYear?.find(x => String(x.year) === String(row.year))?.matched ?? row.matched ?? row.safeAcquisitionLegalKeys ?? 0),
      documents: Number(corpus.byYear?.find(x => String(x.year) === String(row.year))?.documents ?? row.currentCorpusCivilDocuments ?? 0),
      review: Number(corpus.byYear?.find(x => String(x.year) === String(row.year))?.review ?? row.review ?? 0),
      metadataOnly: corpus.byYear?.find(x => String(x.year) === String(row.year))?.metadataOnly ?? row.metadataOnly ?? null,
      unavailable: Number(row.documentUnavailable || 0),
      challenge: Number(row.humanChallengeRequired || 0), open: Number(row.notAttempted || 0),
      coverageWithinKnownSetPct: row.knownDocketYearPairs ? Number((100 * Number(corpus.byYear?.find(x => String(x.year) === String(row.year))?.matched ?? row.matched ?? row.safeAcquisitionLegalKeys) / row.knownDocketYearPairs).toFixed(2)) : null }));
    const salas = source.byChamber.map(row => ({ chamber: row.chamber, known: Number(row.docketDatePairs || 0),
      acquiredWithSafeKey: Number(row.safeAcquisitionLegalKeys || 0),
      matched: Number(corpus.bySala?.find(x => x.chamber === row.chamber)?.matched ?? row.matched ?? row.safeAcquisitionLegalKeys ?? 0),
      documents: Number(corpus.bySala?.find(x => x.chamber === row.chamber)?.documents ?? row.currentCorpusDocuments ?? 0),
      gap: Math.max(0, Number(row.docketDatePairs || 0) - Number(corpus.bySala?.find(x => x.chamber === row.chamber)?.matched ?? row.safeAcquisitionLegalKeys ?? 0)),
      review: Number(corpus.bySala?.find(x => x.chamber === row.chamber)?.review ?? row.review ?? 0),
      open: Number(row.notAttempted || 0), unavailable: Number(row.documentUnavailable || 0),
      challenge: Number(row.humanChallengeRequired || 0),
      coverageWithinKnownSetPct: row.docketDatePairs
        ? Number((100 * Number(corpus.bySala?.find(x => x.chamber === row.chamber)?.matched ?? row.safeAcquisitionLegalKeys ?? 0) / row.docketDatePairs).toFixed(2)) : null }));
    return { byYear: years, bySala: salas, scope: source.scopeNote || source.scope || 'Coverage within a known thematic set; not total Civil coverage.' };
  }
  const rows = (Array.isArray(source) ? source : []).map(normalizeRow);
  const corpusRows = (Array.isArray(corpus) ? corpus : corpus.records || corpus.documents || []).map(row => ({ ...normalizeRow(row), matched: true }));
  const corpusCount = dimension => {
    const counts = {};
    for (const row of corpusRows) counts[row[dimension]] = (counts[row[dimension]] || 0) + 1;
    return counts;
  };
  const years = group(rows, 'year').map(row => ({ ...row, documents: corpusCount('year')[row.year] || 0 }));
  const salas = group(rows.filter(row => row.chamber !== 'UNKNOWN'), 'chamber')
    .map(row => ({ ...row, documents: corpusCount('chamber')[row.chamber] || 0 }));
  return { byYear: years, bySala: salas, byInstance: group(rows, 'instance'), byCourt: group(rows, 'court'),
    scope: 'Coverage within the supplied census only; do not interpret as total Civil coverage unless the source is a complete official census.' };
}
function main(args) {
  const base = path.resolve(process.cwd(), '..', '..');
  const opts = Object.fromEntries(args.reduce((all, arg, index) => {
    const match = arg.match(/^--([^=]+)=(.*)$/u);
    if (match) all.push([match[1], match[2]]);
    else if (arg.startsWith('--') && args[index + 1] && !args[index + 1].startsWith('--')) all.push([arg.slice(2), args[index + 1]]);
    return all;
  }, []));
  const sourceFile = path.resolve(opts.source || path.join(base, '_recovery-work', 'jurisprudencia-discovery', 'coverage.json'));
  const corpusFile = opts.corpus ? path.resolve(opts.corpus) : path.join(base, '_recovery-work', 'jurisprudencia-j1', 'coverage-after.json');
  const outputDir = path.resolve(opts.out || path.join(base, '_recovery-work', 'jurisprudencia-j1'));
  fs.mkdirSync(outputDir, { recursive: true });
  const source = parseInput(sourceFile);
  const corpus = fs.existsSync(corpusFile) ? JSON.parse(fs.readFileSync(corpusFile, 'utf8')) : {};
  const output = aggregateSource(source, corpus);
  for (const [name, rows] of [['coverage-by-year.json', output.byYear],['coverage-by-sala.json', output.bySala],
    ['coverage-by-instance.json', output.byInstance || corpus.instanceGroups || {}],['coverage-by-court.json', output.byCourt || corpus.byCourt || {}]]) {
    fs.writeFileSync(path.join(outputDir, name), `${JSON.stringify({ scope: output.scope, rows }, null, 2)}\n`);
  }
  const summary = { generatedAt: new Date().toISOString(), source: sourceFile, corpus: corpusFile,
    scope: output.scope, years: output.byYear.length, salas: output.bySala.length,
    knownSetKeys: output.byYear.reduce((sum,row)=>sum+Number(row.known||0),0),
    safeMatches: output.byYear.reduce((sum,row)=>sum+Number(row.matched||0),0) };
  fs.writeFileSync(path.join(outputDir, 'coverage-engine-summary.json'), `${JSON.stringify(summary, null, 2)}\n`);
  console.log(JSON.stringify(summary, null, 2));
}
if (require.main === module) {
  try { main(process.argv.slice(2)); }
  catch (error) { console.error(`COVERAGE_ENGINE_FAILED: ${error.message}`); process.exitCode = 1; }
}
module.exports = { parseCsv, normalizeRow, aggregateSource };
