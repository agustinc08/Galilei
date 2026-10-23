'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const ROOT = path.resolve(__dirname, '..', '..', '..', '..');
const WORK = path.join(ROOT, '_recovery-work', 'sprint144', 'quantification');

function normalize(value) {
  return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toUpperCase().replace(/\b(?:EXPTE?|EXPEDIENTE|CIV|NRO|Nº|NO)\b/g, '')
    .replace(/[^A-Z0-9]/g, '');
}
function docketValues(record) {
  const parsed = record.metadata_json ? JSON.parse(record.metadata_json) : {};
  return [...new Set([record.case_number, ...(parsed.expedientes || [])].map(normalize).filter(Boolean))];
}
function titleSimilarity(left, right) {
  const words = value => new Set(String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toUpperCase().split(/[^A-Z0-9]+/).filter(word => word.length > 1 && !['C','S','OTRO','OTROS','OTRA','OTRAS','Y'].includes(word)));
  const a = words(left);
  const b = words(right);
  if (!a.size || !b.size) return 0;
  let common = 0;
  for (const character of a) if (b.has(character)) common++;
  return (2 * common) / (a.size + b.size);
}
function room(value) { return String(value || '').match(/\b(?:SALA\s*)?([A-M])\b/i)?.[1]?.toUpperCase() || null; }
function pairEvidence(record, candidate, source) {
  const dockets = docketValues(record);
  const candidateDocket = normalize(candidate.caseNumber || candidate.expediente);
  const exactDocket = Boolean(candidateDocket && dockets.includes(candidateDocket));
  const date = record.decision_date || null;
  const candidateDate = candidate.decisionDate || candidate.fecha_sentencia || null;
  const sameDate = Boolean(date && candidateDate && date === candidateDate);
  const recordRoom = room(record.chamber || JSON.parse(record.metadata_json || '{}').chamber);
  const candidateRoom = room(candidate.chamber || candidate.tribunal_original);
  const sameRoom = Boolean(recordRoom && candidateRoom && recordRoom === candidateRoom);
  const similarity = titleSimilarity(record.title, candidate.title || candidate.caratula);
  let status = 'UNRESOLVED';
  if (exactDocket && sameDate && sameRoom) status = 'EXACT';
  else if (exactDocket && sameDate) status = 'HIGH_CONFIDENCE';
  else if (exactDocket || (sameDate && sameRoom && similarity >= 0.72) || similarity >= 0.9) status = 'CANDIDATE';
  return { status, source, documentId: candidate.id || candidate.source_id || null,
    caseNumber: candidate.caseNumber || candidate.expediente || null, date: candidateDate,
    chamber: candidate.chamber || null, sourceCodes: candidate.sourceCodes || [],
    titleSimilarity: Number(similarity.toFixed(3)), evidence: { exactDocket, sameDate, sameRoom } };
}
const rank = { EXACT: 4, HIGH_CONFIDENCE: 3, CANDIDATE: 2, UNRESOLVED: 1 };
function titleKey(value) {
  return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase()
    .split(/[^A-Z0-9]+/).filter(word => word.length > 1 && !['C','S','OTRO','OTROS','OTRA','OTRAS','Y'].includes(word)).sort().join(' ');
}
function makeIndex(candidates) {
  const dockets = new Map(), dates = new Map(), dateRooms = new Map(), titles = new Map();
  const add = (map, key, candidate) => { if (!key) return; if (!map.has(key)) map.set(key, []); map.get(key).push(candidate); };
  for (const candidate of candidates) {
    const docket = normalize(candidate.caseNumber || candidate.expediente);
    add(dockets, docket, candidate);
    add(dates, candidate.decisionDate || candidate.fecha_sentencia, candidate);
    const date = candidate.decisionDate || candidate.fecha_sentencia;
    const candidateRoom = room(candidate.chamber || candidate.tribunal_original);
    if (date && candidateRoom) add(dateRooms, `${date}|${candidateRoom}`, candidate);
    add(titles, titleKey(candidate.title || candidate.caratula), candidate);
  }
  return { dockets, dates, dateRooms, titles };
}
function bestMatch(record, index, source) {
  const candidates = new Map();
  const add = rows => { for (const row of rows || []) candidates.set(row.id || row.source_id, row); };
  for (const docket of docketValues(record)) add(index.dockets.get(docket));
  if (record.decision_date) {
    add(index.dates.get(record.decision_date));
    const recordRoom = room(record.chamber || JSON.parse(record.metadata_json || '{}').chamber);
    if (recordRoom) add(index.dateRooms.get(`${record.decision_date}|${recordRoom}`));
  }
  const normalizedTitle = titleKey(record.title || JSON.parse(record.metadata_json || '{}').title);
  if (normalizedTitle) add(index.titles.get(normalizedTitle));
  const matches = [...candidates.values()].map(candidate => pairEvidence(record, candidate, source))
    .filter(item => item.status !== 'UNRESOLVED')
    .sort((a, b) => rank[b.status] - rank[a.status] || b.titleSimilarity - a.titleSimilarity);
  return { status: matches[0]?.status || 'UNRESOLVED', matches: matches.slice(0, 10) };
}
function buildMatches(records, corpus, historical) {
  const corpusIndex = makeIndex(corpus);
  const historicalIndex = makeIndex(historical);
  return records.map(record => {
    if (!record.case_number && !record.case_record_id && !record.title && !record.decision_date && !record.metadata_json) {
      return { sourceKey: record.source_key, category: record.category, caseRecordId: null, caseNumber: null,
        title: null, decisionDate: null, chamber: null,
        corpus: { status: 'UNRESOLVED', matches: [] }, historical: { status: 'UNRESOLVED', matches: [] },
        cij: { status: 'UNRESOLVED', matches: [] }, status: 'UNRESOLVED' };
    }
      const corpusMatch = bestMatch(record, corpusIndex, 'BJC_CORPUS');
      const historicalMatch = bestMatch(record, historicalIndex, 'HISTORICAL_TFN');
      const status = rank[corpusMatch.status] >= rank[historicalMatch.status] ? corpusMatch.status : historicalMatch.status;
    return { sourceKey: record.source_key, inspected: Boolean(record.case_record_id || record.metadata_json), category: record.category, caseRecordId: record.case_record_id,
      caseNumber: record.case_number, title: record.title, decisionDate: record.decision_date, chamber: record.chamber,
      corpus: corpusMatch, historical: historicalMatch, cij: { status: 'UNRESOLVED', matches: [] }, status };
  });
}
function run() {
  const checkpoint = path.join(WORK, 'checkpoint.sqlite');
  const historicalPath = path.join(ROOT, '_recovery-work', 'sprint142', 'historical.sqlite');
  const corpusPath = path.join(WORK, 'corpus-snapshot.json');
  if (!fs.existsSync(corpusPath)) throw new Error(`CORPUS_SNAPSHOT_MISSING:${corpusPath}`);
  const corpus = JSON.parse(fs.readFileSync(corpusPath, 'utf8'));
  const q = new DatabaseSync(checkpoint, { readOnly: true });
  const h = new DatabaseSync(historicalPath, { readOnly: true });
  try {
    const records = q.prepare('SELECT * FROM records ORDER BY source_key').all();
    const historical = h.prepare("SELECT source_id,expediente,caratula,fecha_sentencia,tribunal_original,download_status,sha256,bytes FROM results WHERE civil_status='CIVIL_EXACT'").all()
      .map(row => ({ ...row, decisionDate: row.fecha_sentencia?.split('/').reverse().join('-') || null }));
    const matches = buildMatches(records, corpus, historical);
    const summary = {
      generatedAt: new Date().toISOString(),
      sourceRows: records.length,
      corpusSnapshotDocuments: corpus.length,
      historicalCivilRows: historical.length,
      inspectedRows: matches.filter(row => row.inspected).length,
      uninspectedRows: matches.filter(row => !row.inspected).length,
      crossmatches: Object.fromEntries(['EXACT','HIGH_CONFIDENCE','CANDIDATE','UNRESOLVED'].map(status => [status, matches.filter(row => row.inspected && row.status === status).length])),
      corpusMatches: Object.fromEntries(['EXACT','HIGH_CONFIDENCE','CANDIDATE','UNRESOLVED'].map(status => [status, matches.filter(row => row.inspected && row.corpus.status === status).length])),
      historicalMatches: Object.fromEntries(['EXACT','HIGH_CONFIDENCE','CANDIDATE','UNRESOLVED'].map(status => [status, matches.filter(row => row.inspected && row.historical.status === status).length])),
      preExistingCorpusMatches: matches.filter(row => row.corpus.matches.some(match => ['EXACT','HIGH_CONFIDENCE'].includes(match.status) && !match.sourceCodes.includes('CIVIL_CUANTIFICACION_DANOS'))).length,
      alreadyQuantificationCorpusMatches: matches.filter(row => row.corpus.matches.some(match => ['EXACT','HIGH_CONFIDENCE'].includes(match.status) && match.sourceCodes.includes('CIVIL_CUANTIFICACION_DANOS'))).length,
      distinctPreExistingCorpusDocuments: new Set(matches.flatMap(row => row.corpus.matches.filter(match => ['EXACT','HIGH_CONFIDENCE'].includes(match.status) && !match.sourceCodes.includes('CIVIL_CUANTIFICACION_DANOS')).map(match => match.documentId))).size,
      distinctQuantificationDocuments: new Set(matches.flatMap(row => row.corpus.matches.filter(match => ['EXACT','HIGH_CONFIDENCE'].includes(match.status) && match.sourceCodes.includes('CIVIL_CUANTIFICACION_DANOS')).map(match => match.documentId))).size,
      historicalPdfCandidates: matches.filter(row => row.historical.matches.some(match => match.status !== 'UNRESOLVED' && historical.find(item => item.source_id === match.documentId)?.download_status === 'VERIFIED')).length,
      matches,
    };
    const output = path.join(WORK, 'crossmatches.json');
    const temp = `${output}.${process.pid}.tmp`;
    fs.writeFileSync(temp, `${JSON.stringify(summary)}\n`, { flag: 'w' });
    fs.renameSync(temp, output);
    console.log(JSON.stringify({ output, sourceRows: summary.sourceRows, inspectedRows: summary.inspectedRows, uninspectedRows: summary.uninspectedRows, corpusSnapshotDocuments: summary.corpusSnapshotDocuments,
      historicalCivilRows: summary.historicalCivilRows, crossmatches: summary.crossmatches,
      corpusMatches: summary.corpusMatches, historicalMatches: summary.historicalMatches,
      preExistingCorpusMatches: summary.preExistingCorpusMatches, alreadyQuantificationCorpusMatches: summary.alreadyQuantificationCorpusMatches,
      distinctPreExistingCorpusDocuments: summary.distinctPreExistingCorpusDocuments, distinctQuantificationDocuments: summary.distinctQuantificationDocuments,
      historicalPdfCandidates: summary.historicalPdfCandidates }));
  } finally { h.close(); q.close(); }
}

if (require.main === module) run();
module.exports = { normalize, docketValues, pairEvidence, bestMatch, buildMatches };
