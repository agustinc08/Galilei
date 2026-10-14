'use strict';

// Read-only, deterministic census adapter. It never opens a database or fetches URLs.
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');

const DEFAULT_COLUMNS = {
  source: ['source', 'fuente'], sourceRecordId: ['sourceRecordId', 'source_record_id', 'recordId', 'id'],
  portalId: ['portalId', 'portal_id'], expediente: ['expediente', 'caseNumber', 'case_number', 'docket'],
  expedienteYear: ['expedienteYear', 'expediente_year', 'year', 'año', 'anio'],
  decisionYear: ['decisionYear', 'decision_year'], decisionDate: ['decisionDate', 'decision_date', 'fecha', 'date'],
  court: ['court', 'tribunal', 'juzgado', 'organo'], chamber: ['chamber', 'sala'], courtNumber: ['courtNumber', 'court_number', 'numeroJuzgado'],
  title: ['title', 'caratula', 'carátula'], documentUrl: ['documentUrl', 'document_url', 'urlDocumento'],
  metadataUrl: ['metadataUrl', 'metadata_url', 'urlMetadata'], retrievedAt: ['retrievedAt', 'retrieved_at'],
  status: ['status', 'estadoDisponibilidad'],
};

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
    } else if (ch === '"' && field === '') quoted = true;
    else if (ch === ',') { row.push(field); field = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && input[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.some(value => value !== '')) rows.push(row);
      row = [];
    } else field += ch;
  }
  if (quoted) throw new Error('CSV_UNCLOSED_QUOTE');
  row.push(field);
  if (row.some(value => value !== '')) rows.push(row);
  if (!rows.length) return [];
  const headers = rows.shift().map(value => value.trim());
  return rows.map(values => Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ''])));
}

function readRows(file) {
  const raw = fs.readFileSync(file, 'utf8');
  if (/\.csv$/iu.test(file)) return parseCsv(raw);
  const parsed = JSON.parse(raw);
  const rows = Array.isArray(parsed) ? parsed : parsed.records || parsed.rows;
  if (!Array.isArray(rows)) throw new Error('JSON_RECORDS_ARRAY_REQUIRED');
  return rows;
}

function fold(value) {
  return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/gu, '')
    .toUpperCase().replace(/[^A-Z0-9]+/gu, ' ').trim().replace(/\s+/gu, ' ');
}
function pick(row, mapping, name) {
  const configured = mapping[name];
  const names = configured ? [configured] : DEFAULT_COLUMNS[name] || [name];
  for (const key of names) if (row[key] !== undefined && row[key] !== null && String(row[key]).trim() !== '') return row[key];
  return '';
}
function normalizeDocket(value) {
  const raw = String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/gu, '').toUpperCase();
  const match = raw.match(/(\d+)\s*[/-]\s*(\d{2,4})/u);
  if (!match) return raw.replace(/[^A-Z0-9]/gu, '') || '';
  const number = match[1].replace(/^0+(?=\d)/u, '');
  const year = match[2].length === 2 ? match[2] : match[2].replace(/^0+(?=\d)/u, '');
  return `${number}/${year}`;
}
function parseDate(value) {
  const text = String(value || '').trim();
  let y, m, d;
  let match = text.match(/^(\d{4})-(\d{2})-(\d{2})$/u);
  if (match) [, y, m, d] = match;
  else { match = text.match(/^(\d{2})\/(\d{2})\/(\d{4})$/u); if (match) [, d, m, y] = match; }
  if (!match) return null;
  const date = new Date(Date.UTC(Number(y), Number(m) - 1, Number(d)));
  return date.getUTCFullYear() === Number(y) && date.getUTCMonth() === Number(m) - 1 && date.getUTCDate() === Number(d)
    ? `${y}-${m}-${d}` : null;
}
function classifyCourt(value) {
  const original = String(value || '').trim();
  const key = fold(original);
  if (/^JUZGADO (NACIONAL DE )?(1RA INSTANCIA|PRIMERA INSTANCIA|CIVIL) DEL? (FUERO )?CIVIL\b/u.test(key) ||
      /^JUZGADO NACIONAL DE PRIMERA INSTANCIA EN LO CIVIL\b/u.test(key) || /^JUZGADO CIVIL \d+\b/u.test(key)) {
    const n = key.match(/(?:N(?:RO)?\.?|NUMERO|CIVIL)\s*(\d{1,3})\b/u);
    return { type: 'FIRST_INSTANCE_CIVIL', normalized: 'JUZGADO NACIONAL DE PRIMERA INSTANCIA EN LO CIVIL', number: n?.[1] || null };
  }
  if (/^CAMARA NACIONAL DE APELACIONES EN LO CIVIL\b/u.test(key) || /^CAMARA CIVIL\b/u.test(key)) {
    return { type: 'SECOND_INSTANCE_CIVIL', normalized: 'CAMARA NACIONAL DE APELACIONES EN LO CIVIL', number: null };
  }
  return { type: 'UNKNOWN', normalized: key || null, number: null };
}
function validUrl(value) {
  if (!value) return true;
  try { const u = new URL(String(value)); return ['http:', 'https:'].includes(u.protocol); } catch { return false; }
}
function hash(value) { return createHash('sha256').update(JSON.stringify(value)).digest('hex'); }

function matchRecord(record, corpus = []) {
  const candidates = corpus.filter(doc => {
    const sourceId = String(doc.sourceRecordId || doc.portalId || '').trim();
    return record.sourceRecordId && sourceId && sourceId === record.sourceRecordId;
  });
  if (candidates.length === 1) {
    const doc = candidates[0];
    const idConflict = [];
    const otherDocket = doc.expediente || doc.caseNumber || doc.docket;
    const otherCourt = doc.courtNormalized || doc.court;
    const otherDate = doc.decisionDate || doc.date;
    if (otherDocket && normalizeDocket(otherDocket) !== record.expedienteNormalized) idConflict.push('CASE_NUMBER_CONFLICT');
    if (otherCourt && classifyCourt(otherCourt).type !== 'UNKNOWN' && classifyCourt(otherCourt).normalized !== record.courtNormalized) idConflict.push('COURT_CONFLICT');
    if (otherDate && parseDate(otherDate) && parseDate(otherDate) !== record.decisionDate) idConflict.push('DECISION_DATE_CONFLICT');
    return idConflict.length
      ? { confidence: 'CONFLICT', matchedDocumentId: null, reasons: ['SOURCE_RECORD_ID_METADATA_CONFLICT', ...idConflict] }
      : { confidence: 'EXACT', matchedDocumentId: doc.id || null, reasons: ['SOURCE_RECORD_ID'] };
  }
  if (candidates.length > 1) return { confidence: 'CONFLICT', matchedDocumentId: null, reasons: ['SOURCE_RECORD_ID_NOT_UNIQUE'] };
  const sameBase = corpus.filter(doc => normalizeDocket(doc.expediente || doc.caseNumber || doc.docket) === record.expedienteNormalized &&
    String(doc.expedienteYear || doc.year || '').trim() === record.expedienteYear &&
    (classifyCourt(doc.courtNormalized || doc.court).normalized || fold(doc.courtNormalized || doc.court)) === record.courtNormalized);
  if (sameBase.some(doc => parseDate(doc.decisionDate || doc.date) && parseDate(doc.decisionDate || doc.date) !== record.decisionDate))
    return { confidence: 'CONFLICT', matchedDocumentId: null, reasons: ['SAME_CASE_COURT_DIFFERENT_DATE'] };
  const exact = sameBase.filter(doc => record.decisionDate && parseDate(doc.decisionDate || doc.date) === record.decisionDate);
  if (exact.length === 1) return { confidence: 'HIGH', matchedDocumentId: exact[0].id || null, reasons: ['DOCKET_YEAR_COURT_DATE'] };
  if (exact.length > 1) return { confidence: 'CONFLICT', matchedDocumentId: null, reasons: ['HIGH_KEY_NOT_UNIQUE'] };
  if (sameBase.length === 1) return { confidence: 'MEDIUM', matchedDocumentId: sameBase[0].id || null, reasons: ['DOCKET_YEAR_COURT'] };
  if (sameBase.length > 1) return { confidence: 'CONFLICT', matchedDocumentId: null, reasons: ['MEDIUM_KEY_NOT_UNIQUE'] };
  if (record.title && corpus.some(doc => fold(doc.title) === fold(record.title))) return { confidence: 'LOW', matchedDocumentId: null, reasons: ['TITLE_ONLY'] };
  return { confidence: 'UNRESOLVED', matchedDocumentId: null, reasons: ['NO_MATCH'] };
}

function canonicalize(rows, options = {}) {
  const sourceDefault = options.source || 'UNSPECIFIED';
  const mapping = options.mapping || {};
  const corp = options.corpus || [];
  const idCounts = new Map();
  const portalCounts = new Map();
  const docCounts = new Map();
  const parsed = rows.map((row, index) => {
    const sourceRecordId = String(pick(row, mapping, 'sourceRecordId')).trim();
    const portalId = String(pick(row, mapping, 'portalId')).trim();
    const documentUrl = String(pick(row, mapping, 'documentUrl')).trim() || null;
    if (sourceRecordId) idCounts.set(sourceRecordId, (idCounts.get(sourceRecordId) || 0) + 1);
    if (portalId) portalCounts.set(portalId, (portalCounts.get(portalId) || 0) + 1);
    if (documentUrl) docCounts.set(documentUrl, (docCounts.get(documentUrl) || 0) + 1);
    return { row, index, sourceRecordId, portalId, documentUrl };
  });
  const records = parsed.map(({ row, index, sourceRecordId, portalId, documentUrl }) => {
    const docketOriginal = String(pick(row, mapping, 'expediente')).trim();
    const docket = normalizeDocket(docketOriginal);
    const dateOriginal = String(pick(row, mapping, 'decisionDate')).trim();
    const decisionDate = dateOriginal ? parseDate(dateOriginal) : null;
    const courtOriginal = String(pick(row, mapping, 'court')).trim();
    const court = classifyCourt(courtOriginal);
    const expYearRaw = String(pick(row, mapping, 'expedienteYear')).trim() || (docket.match(/\/(\d{4})\b/u)?.[1] || '');
    const decYearRaw = String(pick(row, mapping, 'decisionYear')).trim() || decisionDate?.slice(0, 4) || '';
    const issues = [];
    if (!sourceRecordId) issues.push('SOURCE_RECORD_ID_MISSING');
    if (!docket) issues.push('EXPEDIENTE_MISSING');
    if (!/^\d{4}$/u.test(expYearRaw) || Number(expYearRaw) < 1800 || Number(expYearRaw) > 2100) issues.push('EXPEDIENTE_YEAR_INVALID');
    if (dateOriginal && !decisionDate) issues.push('DECISION_DATE_INVALID');
    if (decYearRaw && (!/^\d{4}$/u.test(decYearRaw) || Number(decYearRaw) < 1800 || Number(decYearRaw) > 2100)) issues.push('DECISION_YEAR_INVALID');
    if (court.type === 'UNKNOWN') issues.push('COURT_UNKNOWN');
    if (!validUrl(documentUrl)) issues.push('DOCUMENT_URL_INVALID');
    const metadataUrl = String(pick(row, mapping, 'metadataUrl')).trim() || null;
    if (!validUrl(metadataUrl)) issues.push('METADATA_URL_INVALID');
    if (sourceRecordId && idCounts.get(sourceRecordId) > 1) issues.push('SOURCE_RECORD_ID_DUPLICATE');
    if (portalId && portalCounts.get(portalId) > 1) issues.push('PORTAL_ID_DUPLICATE');
    if (documentUrl && docCounts.get(documentUrl) > 1) issues.push('DOCUMENT_URL_DUPLICATE');
    const record = {
      source: String(pick(row, mapping, 'source')).trim() || sourceDefault,
      sourceRecordId: sourceRecordId || null,
      portalId: portalId || null,
      expediente: docketOriginal || null,
      expedienteNormalized: docket || null,
      expedienteYear: /^\d{4}$/u.test(expYearRaw) ? expYearRaw : null,
      decisionYear: /^\d{4}$/u.test(decYearRaw) ? decYearRaw : null,
      decisionDate,
      court: courtOriginal || null,
      courtNormalized: court.normalized,
      courtType: court.type,
      chamber: String(pick(row, mapping, 'chamber')).trim() || null,
      courtNumber: String(pick(row, mapping, 'courtNumber')).trim() || court.number,
      title: String(pick(row, mapping, 'title')).trim() || null,
      documentUrl,
      metadataUrl,
      retrievedAt: String(pick(row, mapping, 'retrievedAt')).trim() || options.retrievedAt || null,
      availability: String(pick(row, mapping, 'status')).trim() || null,
      metadataOriginal: row,
      rowNumber: index + 2,
      issues,
    };
    const match = sourceRecordId && idCounts.get(sourceRecordId) > 1
      ? { confidence: 'CONFLICT', matchedDocumentId: null, reasons: ['DUPLICATE_SOURCE_RECORD_ID'] }
      : documentUrl && docCounts.get(documentUrl) > 1
        ? { confidence: 'CONFLICT', matchedDocumentId: null, reasons: ['DUPLICATE_DOCUMENT_URL'] }
        : matchRecord(record, corp);
    record.match = match;
    return record;
  }).sort((a, b) => (a.sourceRecordId || '').localeCompare(b.sourceRecordId || '') || a.rowNumber - b.rowNumber);
  const summary = { inputRows: rows.length, validRows: records.filter(x => !x.issues.length).length,
    invalidRows: records.filter(x => x.issues.length).length,
    exact: records.filter(x => x.match.confidence === 'EXACT').length,
    high: records.filter(x => x.match.confidence === 'HIGH').length,
    medium: records.filter(x => x.match.confidence === 'MEDIUM').length,
    low: records.filter(x => x.match.confidence === 'LOW').length,
    conflicts: records.filter(x => x.match.confidence === 'CONFLICT').length,
    unresolved: records.filter(x => x.match.confidence === 'UNRESOLVED').length,
    issues: records.reduce((a, x) => { for (const issue of x.issues) a[issue] = (a[issue] || 0) + 1; return a; }, {}) };
  const normalizedSnapshot = records.map(({ rowNumber, ...item }) => item);
  return { schemaVersion: 'bjc-census-v1', source: sourceDefault, records, summary,
    snapshotSha256: hash(normalizedSnapshot.map(({ metadataOriginal, ...item }) => item)), coverage: buildCoverage(records) };
}

function buildCoverage(records) {
  const dims = ['decisionYear', 'courtNormalized', 'source'];
  const result = {};
  for (const dim of dims) {
    const buckets = new Map();
    for (const r of records) {
      const k = r[dim] || 'UNKNOWN';
      if (!buckets.has(k)) buckets.set(k, []);
      buckets.get(k).push(r);
    }
    result[dim] = [...buckets.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([key, rows]) => ({
      key, known: rows.length,
      matched: rows.filter(r => ['EXACT', 'HIGH'].includes(r.match.confidence)).length,
      unmatched: rows.filter(r => r.match.confidence === 'UNRESOLVED').length,
      review: rows.filter(r => ['MEDIUM', 'LOW', 'CONFLICT'].includes(r.match.confidence) || r.issues.length).length,
      noDocument: rows.filter(r => !r.documentUrl).length,
      unavailable: rows.filter(r => /UNAVAILABLE|MISSING|NOT_FOUND/iu.test(r.availability || '')).length,
    }));
  }
  return { byYear: result.decisionYear, byCourt: result.courtNormalized, bySource: result.source,
    scope: 'Coverage only within supplied census; completeness requires documented official census scope.' };
}

function main(argv) {
  const args = Object.fromEntries(argv.reduce((a, value, i) => {
    const m = value.match(/^--([^=]+)=(.*)$/u); if (m) a.push([m[1], m[2]]);
    else if (value.startsWith('--') && argv[i + 1] && !argv[i + 1].startsWith('--')) a.push([value.slice(2), argv[i + 1]]);
    return a;
  }, []));
  if (!args.input) throw new Error('INPUT_REQUIRED');
  const mapping = args.mapping ? JSON.parse(fs.readFileSync(args.mapping, 'utf8')) : {};
  const corpus = args.corpus ? JSON.parse(fs.readFileSync(args.corpus, 'utf8')) : [];
  const output = canonicalize(readRows(path.resolve(args.input)), { source: args.source, mapping, corpus: corpus.corpus || corpus.documents || corpus.records || corpus });
  const target = path.resolve(args.output || 'census.snapshot.json');
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, `${JSON.stringify(output, null, 2)}\n`);
  console.log(JSON.stringify({ output: target, snapshotSha256: output.snapshotSha256, summary: output.summary }));
}

if (require.main === module) {
  try { main(process.argv.slice(2)); } catch (error) { console.error(`CENSUS_IMPORT_FAILED: ${error.message}`); process.exitCode = 1; }
}

module.exports = { parseCsv, readRows, normalizeDocket, parseDate, classifyCourt, matchRecord, canonicalize, buildCoverage };
