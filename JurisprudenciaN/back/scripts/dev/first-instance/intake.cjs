'use strict';

// Authorized first-instance census intake. File-only, read-only, deterministic normalization.
// No network, database, source-file mutation, or Corpus writes are performed here.
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { TextDecoder } = require('node:util');
const { performance } = require('node:perf_hooks');

const VERSION = 'bjc-first-instance-intake-v1.0.0';
const ALIASES = {
  source: ['source', 'fuente', 'source_name'], sourceRecordId: ['sourceRecordId', 'source_record_id', 'recordId', 'record_id', 'id', 'sourceId', 'source_id'],
  portalId: ['portalId', 'portal_id'], fuero: ['fuero', 'matter', 'subject'], jurisdiction: ['jurisdiction', 'jurisdiccion', 'jurisdicción'],
  instance: ['instance', 'instancia'], court: ['court', 'tribunal', 'juzgado', 'organo', 'órgano'], courtNumber: ['courtNumber', 'court_number', 'numeroJuzgado', 'juzgado_numero', 'numero_juzgado'],
  secretary: ['secretary', 'secretaria', 'secretaría', 'secretaria_numero'], expediente: ['expediente', 'caseNumber', 'case_number', 'docket'],
  expedienteYear: ['expedienteYear', 'expediente_year', 'year_expediente', 'año_expediente', 'anio_expediente'], decisionYear: ['decisionYear', 'decision_year', 'año_decision', 'anio_decision'],
  decisionDate: ['decisionDate', 'decision_date', 'fecha_decision', 'fecha', 'date'], title: ['title', 'caratula', 'carátula'],
  resolutionType: ['resolutionType', 'resolution_type', 'tipo_resolucion', 'tipo de resolución'], metadataUrl: ['metadataUrl', 'metadata_url', 'urlMetadata', 'url_metadata'],
  documentUrl: ['documentUrl', 'document_url', 'urlDocumento', 'url_documento', 'document_url'], documentUrlType: ['documentUrlType', 'document_url_type', 'tipo_url_documento'],
  availability: ['availability', 'status', 'estado', 'estado_documento', 'estadoDisponibilidad'], publishedAt: ['publishedAt', 'published_at', 'fecha_publicacion'],
  retrievedAt: ['retrievedAt', 'retrieved_at', 'fecha_extraccion'], sourceUpdatedAt: ['sourceUpdatedAt', 'source_updated_at', 'fecha_modificacion'],
};

function sha256(value) { return createHash('sha256').update(value).digest('hex'); }
function fold(value) { return String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/gu, '').trim().toLowerCase().replace(/\s+/gu, ' '); }
function stableStringify(value) { return JSON.stringify(value); }

function countDelimiter(line) {
  let comma = 0, semicolon = 0, quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted && ch === '"' && line[i + 1] === '"') { i++; continue; }
    if (ch === '"') quoted = !quoted;
    else if (!quoted && ch === ',') comma++;
    else if (!quoted && ch === ';') semicolon++;
  }
  if (comma === semicolon) throw new Error('CSV_DELIMITER_AMBIGUOUS');
  return comma > semicolon ? ',' : ';';
}

function parseCsv(text, delimiter) {
  const input = String(text).replace(/^\uFEFF/u, '');
  const firstLine = input.split(/\r?\n/u, 1)[0];
  const sep = delimiter || countDelimiter(firstLine);
  if (![';', ','].includes(sep)) throw new Error('CSV_DELIMITER_UNSUPPORTED');
  const rows = [];
  let row = [], field = '', quoted = false, rowNumber = 1, malformed = null;
  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    if (quoted) {
      if (ch === '"' && input[i + 1] === '"') { field += '"'; i++; }
      else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"' && field === '') quoted = true;
    else if (ch === sep) { row.push(field); field = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && input[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.some(value => value !== '')) rows.push({ values: row, rowNumber, malformed });
      row = []; rowNumber++; malformed = null;
    } else if (ch === '"') malformed = 'CSV_UNEXPECTED_QUOTE';
    else field += ch;
  }
  if (quoted) throw new Error('CSV_UNCLOSED_QUOTE');
  row.push(field);
  if (row.some(value => value !== '')) rows.push({ values: row, rowNumber, malformed });
  if (!rows.length) return { rows: [], delimiter: sep };
  const headers = rows.shift().values.map(value => value.trim());
  if (headers.some(value => !value) || new Set(headers.map(fold)).size !== headers.length) throw new Error('CSV_HEADER_INVALID_OR_DUPLICATE');
  return { delimiter: sep, rows: rows.map(({ values, rowNumber: physicalRow, malformed: parseIssue }) => {
    const issues = [];
    if (values.length !== headers.length) issues.push({ code: 'MALFORMED_ROW', row: physicalRow, expectedFields: headers.length, actualFields: values.length });
    if (parseIssue) issues.push({ code: 'MALFORMED_ROW', row: physicalRow, detail: parseIssue });
    return { row: Object.fromEntries(headers.map((header, i) => [header, values[i] ?? ''])), rowNumber: physicalRow, parseIssues: issues };
  }) };
}

function decodeUtf8(buffer) {
  try { return new TextDecoder('utf-8', { fatal: true }).decode(buffer); }
  catch { throw new Error('INVALID_UTF8'); }
}
function readInput(file) {
  const ext = path.extname(file).toLowerCase();
  const buffer = fs.readFileSync(file); // deliberately read only
  const text = decodeUtf8(buffer);
  if (ext === '.csv') return { format: 'CSV', inputSha256: sha256(buffer), byteLength: buffer.length, ...parseCsv(text) };
  if (ext === '.json') {
    const parsed = JSON.parse(text.replace(/^\uFEFF/u, ''));
    const rows = Array.isArray(parsed) ? parsed : parsed?.records || parsed?.rows;
    if (!Array.isArray(rows)) throw new Error('JSON_RECORDS_ARRAY_REQUIRED');
    return { format: 'JSON', inputSha256: sha256(buffer), byteLength: buffer.length, rows: rows.map((row, i) => ({ row, rowNumber: i + 1, parseIssues: [] })) };
  }
  if (ext === '.ndjson' || ext === '.jsonl') {
    const lines = text.replace(/^\uFEFF/u, '').split(/\r?\n/u);
    const rows = [];
    for (let i = 0; i < lines.length; i++) {
      if (!lines[i].trim()) continue;
      try { rows.push({ row: JSON.parse(lines[i]), rowNumber: i + 1, parseIssues: [] }); }
      catch { rows.push({ row: {}, rowNumber: i + 1, parseIssues: [{ code: 'MALFORMED_ROW', row: i + 1, detail: 'NDJSON_INVALID_LINE' }] }); }
    }
    return { format: 'NDJSON', inputSha256: sha256(buffer), byteLength: buffer.length, rows };
  }
  throw new Error('UNSUPPORTED_FORMAT');
}

function pick(row, mapping, field) {
  const keys = mapping[field] ? [mapping[field]] : ALIASES[field] || [field];
  const normalized = new Map(Object.entries(row || {}).map(([key, value]) => [fold(key), value]));
  const candidates = keys.map(key => normalized.get(fold(key))).filter(value => value !== undefined && value !== null && String(value).trim() !== '');
  if (!mapping[field] && new Set(candidates.map(value=>String(value).trim())).size > 1) return '';
  for (const key of keys) {
    const value = normalized.get(fold(key));
    if (value !== undefined && value !== null && String(value).trim() !== '') return String(value).trim();
  }
  return '';
}
function normalizeCase(value) {
  const original = String(value ?? '').trim();
  const ascii = original.normalize('NFD').replace(/[\u0300-\u036f]/gu, '').toUpperCase();
  const match = ascii.match(/([A-Z]*\s*)?(\d+)\s*[/-]\s*(\d{2,4})/u);
  if (!match) return null;
  const prefix = (match[1] || '').trim().replace(/\s+/gu, ' ');
  const number = match[2].replace(/^0+(?=\d)/u, '');
  const year = match[3];
  return `${prefix ? `${prefix} ` : ''}${number}/${year}`;
}
function parseDate(value) {
  const text = String(value ?? '').trim();
  let y, m, d, match = text.match(/^(\d{4})-(\d{2})-(\d{2})(?:T.*)?$/u);
  if (match) [, y, m, d] = match;
  else if ((match = text.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})(?:[ T].*)?$/u))) [, d, m, y] = match;
  if (!match) return null;
  const date = new Date(Date.UTC(+y, +m - 1, +d));
  return date.getUTCFullYear() === +y && date.getUTCMonth() === +m - 1 && date.getUTCDate() === +d ? `${y}-${m}-${d}` : null;
}
function parseYear(value) { const text = String(value ?? '').trim(); return /^(18\d{2}|19\d{2}|20\d{2}|2100)$/u.test(text) ? text : null; }
function normalizeCourt(value, fuero = '', instance = '') {
  const original = String(value ?? '').trim();
  const key = fold(original).toUpperCase();
  const matter = fold(fuero).toUpperCase();
  const inst = fold(instance).toUpperCase();
  const n = key.match(/(?:JUZGADO(?: NACIONAL)?(?: DE PRIMERA INSTANCIA)?(?: EN LO CIVIL| CIVIL)?\s*(?:N(?:RO)?\.?|NUMERO|N°)?\s*)(\d{1,3})\b/u) || key.match(/^JUZGADO CIVIL\s+(\d{1,3})\b/u);
  if (/CIVIL/u.test(key) && /JUZGADO/u.test(key)) {
    return { type: 'FIRST_INSTANCE_CIVIL', normalized: 'JUZGADO NACIONAL DE PRIMERA INSTANCIA EN LO CIVIL', number: n?.[1] || null };
  }
  if (/CAMARA NACIONAL DE APELACIONES EN LO CIVIL|CAMARA CIVIL/u.test(key)) return { type: 'SECOND_INSTANCE_CIVIL', normalized: 'CAMARA NACIONAL DE APELACIONES EN LO CIVIL', number: null };
  if (/(COMERCIAL|CONTENCIOSO|LABORAL|CRIMINAL|FEDERAL|PENAL|FAMILIA)/u.test(`${key} ${matter}`)) return { type: 'OTHER', normalized: key || null, number: null };
  return { type: 'UNKNOWN', normalized: key || null, number: n?.[1] || null };
}
function validUrl(value) {
  if (!value) return true;
  if (!/^https?:\/\/[^\s/]+/iu.test(String(value))) return false;
  try { const url = new URL(value); return ['http:', 'https:'].includes(url.protocol) && Boolean(url.hostname); }
  catch { return false; }
}
function normalizedHash(records) { return sha256(stableStringify(records)); }

function normalizeRows(inputRows, options = {}) {
  const mapping = options.mapping || {};
  const preliminary = inputRows.map(({ row, rowNumber, parseIssues = [] }, index) => {
    if (!row || typeof row !== 'object' || Array.isArray(row)) return { row: {}, rowNumber: rowNumber ?? index + 1, parseIssues: [{ code: 'MALFORMED_ROW' }] };
    return { row, rowNumber: rowNumber ?? index + 1, parseIssues };
  });
  const records = preliminary.map(({ row, rowNumber, parseIssues }) => {
    const sourceRecordId = pick(row, mapping, 'sourceRecordId');
    const portalId = pick(row, mapping, 'portalId');
    const caseOriginal = pick(row, mapping, 'expediente');
    const caseNormalized = normalizeCase(caseOriginal);
    const decisionDateRaw = pick(row, mapping, 'decisionDate');
    const decisionDate = decisionDateRaw ? parseDate(decisionDateRaw) : null;
    const courtOriginal = pick(row, mapping, 'court');
    const fuero = pick(row, mapping, 'fuero');
    const jurisdiction = pick(row, mapping, 'jurisdiction');
    const instance = pick(row, mapping, 'instance');
    const courtInfo = normalizeCourt(courtOriginal, fuero, instance);
    const expedienteYearRaw = pick(row, mapping, 'expedienteYear') || (caseNormalized?.match(/\/(\d{2,4})$/u)?.[1] || '');
    const expedienteYear = parseYear(expedienteYearRaw);
    const decisionYearRaw = pick(row, mapping, 'decisionYear') || decisionDate?.slice(0, 4) || '';
    const decisionYear = decisionYearRaw ? parseYear(decisionYearRaw) : null;
    const documentUrl = pick(row, mapping, 'documentUrl') || null;
    const metadataUrl = pick(row, mapping, 'metadataUrl') || null;
    const issues = parseIssues.map(issue => ({ field: '', errorCode: 'MALFORMED_ROW', message: issue.detail || 'La fila no coincide con la estructura del encabezado.' }));
    const add = (field, errorCode, message, severity = 'ERROR', value = undefined) => issues.push({ field, errorCode, message, severity, value });
    for (const [field, aliases] of Object.entries(ALIASES)) {
      if (mapping[field]) continue;
      const values = aliases.map(alias => row[Object.keys(row).find(key=>fold(key)===fold(alias))]).filter(value=>value!==undefined&&value!==null&&String(value).trim()!=='').map(value=>String(value).trim());
      if (new Set(values).size > 1) add(field, 'AMBIGUOUS_COLUMN_MAPPING', 'Hay más de una columna alias con valores distintos; configure el mapping explícito.', 'REVIEW', values.join(' | '));
    }
    if (!sourceRecordId) add('sourceRecordId', 'MISSING_REQUIRED', 'Falta un identificador estable del registro de origen.');
    if (!courtOriginal) add('court', 'MISSING_REQUIRED', 'Falta el órgano emisor.');
    if (!caseOriginal || !caseNormalized) add('expediente', 'INVALID_CASE', 'Falta un expediente reconocible; se conserva el valor original.');
    if (decisionDateRaw && !decisionDate) add('decisionDate', 'INVALID_DATE', 'La fecha no es válida o no usa un formato reconocido (YYYY-MM-DD o DD/MM/YYYY).');
    if (courtOriginal && courtInfo.type === 'UNKNOWN') add('court', 'UNKNOWN_COURT', 'No se pudo clasificar el órgano; requiere revisión.', 'REVIEW');
    if (documentUrl && !validUrl(documentUrl)) add('documentUrl', 'INVALID_URL', 'La URL del documento no es HTTP(S) absoluta.');
    if (metadataUrl && !validUrl(metadataUrl)) add('metadataUrl', 'INVALID_URL', 'La URL de metadata no es HTTP(S) absoluta.');
    const fatal = issues.some(x => x.severity !== 'REVIEW');
    let scope = courtInfo.type === 'FIRST_INSTANCE_CIVIL' ? 'IN_SCOPE' : courtInfo.type === 'UNKNOWN' ? 'UNKNOWN_SCOPE' : 'OUT_OF_REQUESTED_SCOPE';
    if ((fuero && !/civil/iu.test(fuero)) || (jurisdiction && /laboral|comercial|penal|familia|contencioso/iu.test(jurisdiction))) scope = 'OUT_OF_REQUESTED_SCOPE';
    return {
      source: pick(row, mapping, 'source') || options.source || 'UNSPECIFIED', sourceRecordId: sourceRecordId || null,
      portalId: portalId || null, fuero: fuero || null, jurisdiction: jurisdiction || null, instance: instance || courtInfo.type,
      court: courtOriginal || null, courtNormalized: courtInfo.normalized, courtType: courtInfo.type,
      courtNumber: pick(row, mapping, 'courtNumber') || courtInfo.number, secretary: pick(row, mapping, 'secretary') || null,
      expediente: caseOriginal || null, caseNormalized, expedienteYear, decisionDate, decisionYear,
      title: pick(row, mapping, 'title') || null, resolutionType: pick(row, mapping, 'resolutionType') || null,
      metadataUrl, documentUrl, documentUrlType: pick(row, mapping, 'documentUrlType') || null,
      availability: pick(row, mapping, 'availability') || null, publishedAt: pick(row, mapping, 'publishedAt') || null,
      sourceUpdatedAt: pick(row, mapping, 'sourceUpdatedAt') || null, retrievedAt: pick(row, mapping, 'retrievedAt') || null,
      scope, validationStatus: fatal ? 'INVALID' : issues.length ? 'REVIEW' : 'VALID', rowNumber,
      issues, metadataOriginal: row,
    };
  });

  const ids = new Map();
  for (const record of records) if (record.sourceRecordId) {
    const list = ids.get(record.sourceRecordId) || []; list.push(record); ids.set(record.sourceRecordId, list);
  }
  const duplicateSourceIds = [];
  for (const [id, group] of ids) if (group.length > 1) {
    const signatures = new Set(group.map(record => stableStringify({ ...record, rowNumber: undefined, issues: [], validationStatus: undefined, metadataOriginal: undefined })));
    const classification = signatures.size === 1 ? 'DUPLICATE_IDENTICAL' : 'DUPLICATE_CONFLICT';
    duplicateSourceIds.push({ sourceRecordId: id, classification, rows: group.map(x => x.rowNumber) });
    for (const record of group) {
      record.duplicateSourceId = classification;
      record.issues.push({ field: 'sourceRecordId', errorCode: classification === 'DUPLICATE_IDENTICAL' ? 'DUPLICATE_SOURCE_ID' : 'CONFLICTING_SOURCE_ID', message: classification === 'DUPLICATE_IDENTICAL' ? 'ID repetido con metadata idéntica; se conserva sin deduplicación destructiva.' : 'ID repetido con metadata diferente; requiere revisión.' , severity: 'REVIEW' });
      if (record.validationStatus === 'VALID') record.validationStatus = 'REVIEW';
    }
  }
  const legal = new Map();
  for (const record of records) if (record.caseNormalized && record.courtNormalized && record.decisionDate) {
    const key = [record.caseNormalized, record.courtNormalized, record.courtNumber || '', record.decisionDate].join('|');
    const group = legal.get(key) || []; group.push(record); legal.set(key, group);
  }
  const legalIdentityDuplicates = [];
  for (const [key, group] of legal) if (group.length > 1 && new Set(group.map(x => x.sourceRecordId)).size > 1) {
    const item = { legalIdentity: key, sourceRecordIds: group.map(x => x.sourceRecordId).sort(), rows: group.map(x => x.rowNumber).sort((a,b)=>a-b) };
    legalIdentityDuplicates.push(item);
    for (const record of group) record.possibleLegalIdentityDuplicate = item.sourceRecordIds;
  }
  records.sort((a, b) => (a.sourceRecordId || '').localeCompare(b.sourceRecordId || '') || a.rowNumber - b.rowNumber);
  const errors = [];
  for (const record of records) for (const issue of record.issues) errors.push({ row: record.rowNumber, field: issue.field, value: issue.value ?? (issue.field ? pick(record.metadataOriginal, mapping, issue.field) : ''), errorCode: issue.errorCode, message: issue.message });
  errors.sort((a,b)=>a.row-b.row || a.errorCode.localeCompare(b.errorCode));
  const censusCompleteness = ['UNKNOWN','PARTIAL','DECLARED_COMPLETE'].includes(options.completeness) ? options.completeness : 'UNKNOWN';
  const snapshot = {
    schemaVersion: VERSION, source: options.source || 'UNSPECIFIED', censusCompleteness,
    scope: options.scope || { jurisdiction: null, instance: 'FIRST_INSTANCE', matter: 'CIVIL', dateFrom: null, dateTo: null, courts: [], source: options.source || null },
    records,
  };
  const summary = {
    rows: records.length, validRows: records.filter(x => x.validationStatus === 'VALID' || x.validationStatus === 'REVIEW').length,
    invalidRows: records.filter(x => x.validationStatus === 'INVALID').length,
    inScope: records.filter(x => x.scope === 'IN_SCOPE' && x.validationStatus !== 'INVALID').length,
    outOfScope: records.filter(x => x.scope === 'OUT_OF_REQUESTED_SCOPE').length,
    unknownScope: records.filter(x => x.scope === 'UNKNOWN_SCOPE').length,
    duplicateRows: duplicateSourceIds.reduce((sum, x) => sum + x.rows.length - 1, 0),
    duplicateSourceIds, legalIdentityDuplicates, errorCounts: errors.reduce((acc, x) => { acc[x.errorCode] = (acc[x.errorCode] || 0) + 1; return acc; }, {}),
  };
  return { snapshot, summary, errors, inputSha256: options.inputSha256 || null, normalizedSha256: sha256(stableStringify(snapshot)) };
}

function dateOf(value) { return parseDate(value); }
function corpusId(doc) { return doc.id || doc.corpusDocumentId || null; }
function corpusCase(doc) { return normalizeCase(doc.expediente || doc.caseNumber || doc.docket || ''); }
function corpusCourt(doc) { return normalizeCourt(doc.court || doc.courtNormalized || '', 'civil', doc.instance || '').normalized; }
function addIndex(map, key, doc) {
  if (!key) return;
  const list = map.get(key) || [];
  list.push(doc);
  map.set(key, list);
}
function buildCorpusIndex(corpus) {
  const sourceIds = new Map(), legalIdentity = new Map();
  for (const doc of corpus) {
    for (const id of new Set([doc.sourceRecordId, doc.externalId, doc.portalId, doc.sourceReference].filter(Boolean).map(String))) addIndex(sourceIds, id, doc);
    const docket = corpusCase(doc), court = corpusCourt(doc);
    if (docket && court) addIndex(legalIdentity, `${docket}|${court}`, doc);
  }
  return { sourceIds, legalIdentity, corpusSize: corpus.length };
}
function matchRecordIndexed(record, index) {
  const nativeId = record.sourceRecordId;
  const idMatches = index.sourceIds.get(String(nativeId || '')) || [];
  if (nativeId && idMatches.length === 1) {
    const doc = idMatches[0];
    const mismatches = [];
    if (record.caseNormalized && corpusCase(doc) && record.caseNormalized !== corpusCase(doc)) mismatches.push('CASE_CONFLICT');
    const targetCourt = corpusCourt(doc);
    if (record.courtNormalized && targetCourt && record.courtNormalized !== targetCourt) mismatches.push('COURT_CONFLICT');
    const targetDate = dateOf(doc.decisionDate);
    if (record.decisionDate && targetDate && record.decisionDate !== targetDate) mismatches.push('DECISION_DATE_CONFLICT');
    if (record.courtNumber && doc.courtNumber && String(record.courtNumber) !== String(doc.courtNumber)) mismatches.push('COURT_NUMBER_CONFLICT');
    if (mismatches.length) return { matchLevel: 'CONFLICT', corpusDocumentId: null, reason: ['SOURCE_ID_METADATA_CONTRADICTION', ...mismatches], documentAvailability: doc.documentAvailability || (doc.sha256 || doc.fileId ? 'AVAILABLE' : 'UNKNOWN') };
    return { matchLevel: 'EXACT', corpusDocumentId: corpusId(doc), reason: ['SOURCE_NATIVE_ID'], documentAvailability: doc.documentAvailability || (doc.sha256 || doc.fileId ? 'AVAILABLE' : 'UNKNOWN') };
  }
  if (idMatches.length > 1) return { matchLevel: 'CONFLICT', corpusDocumentId: null, reason: ['SOURCE_ID_NOT_UNIQUE'], documentAvailability: 'UNKNOWN' };
  const base = (index.legalIdentity.get(`${record.caseNormalized}|${record.courtNormalized}`) || []).filter(doc => {
    const docNumber = doc.courtNumber || normalizeCourt(doc.court || '', '', doc.instance || '').number;
    return !record.courtNumber || !docNumber || String(record.courtNumber) === String(docNumber);
  });
  const withDates = base.filter(doc => dateOf(doc.decisionDate));
  if (record.decisionDate && withDates.some(doc => dateOf(doc.decisionDate) !== record.decisionDate)) return { matchLevel: 'CONFLICT', corpusDocumentId: null, reason: ['SAME_CASE_COURT_DIFFERENT_DATE'], documentAvailability: 'UNKNOWN' };
  const high = record.decisionDate ? base.filter(doc => dateOf(doc.decisionDate) === record.decisionDate) : [];
  if (high.length === 1) return { matchLevel: 'HIGH', corpusDocumentId: corpusId(high[0]), reason: ['CASE_COURT_DATE'], documentAvailability: high[0].documentAvailability || (high[0].sha256 || high[0].fileId ? 'AVAILABLE' : 'UNKNOWN') };
  if (high.length > 1) return { matchLevel: 'CONFLICT', corpusDocumentId: null, reason: ['HIGH_IDENTITY_NOT_UNIQUE'], documentAvailability: 'UNKNOWN' };
  const medium = base.filter(doc => {
    const docYear = String(doc.expedienteYear || corpusCase(doc)?.match(/\/(\d{2,4})$/u)?.[1] || '');
    return record.expedienteYear && (docYear === record.expedienteYear || (docYear.length === 2 && `20${docYear}` === record.expedienteYear));
  });
  if (medium.length === 1) return { matchLevel: 'MEDIUM', corpusDocumentId: corpusId(medium[0]), reason: ['CASE_COURT_EXPEDIENTE_YEAR'], documentAvailability: medium[0].documentAvailability || (medium[0].sha256 || medium[0].fileId ? 'AVAILABLE' : 'UNKNOWN') };
  if (medium.length > 1 || base.length > 1) return { matchLevel: 'CONFLICT', corpusDocumentId: null, reason: ['MEDIUM_IDENTITY_NOT_UNIQUE'], documentAvailability: 'UNKNOWN' };
  return { matchLevel: 'UNMATCHED', corpusDocumentId: null, reason: ['NO_LEGAL_IDENTITY_MATCH'], documentAvailability: record.availability || (record.documentUrl ? 'URL_DECLARED_UNVERIFIED' : 'NO_DOCUMENT_URL') };
}
function matchRecord(record, corpus = []) { return matchRecordIndexed(record, buildCorpusIndex(corpus)); }

function reconcile(snapshot, corpus = []) {
  const records = snapshot.records || [];
  const corpusIndex = buildCorpusIndex(corpus);
  const rows = records.map(record => {
    const match = record.validationStatus === 'INVALID' ? { matchLevel: 'INVALID', corpusDocumentId: null, reason: ['INVALID_CENSUS_ROW'], documentAvailability: record.availability || (record.documentUrl ? 'URL_DECLARED_UNVERIFIED' : 'NO_DOCUMENT_URL') }
      : record.scope !== 'IN_SCOPE' ? { matchLevel: 'OUT_OF_SCOPE', corpusDocumentId: null, reason: ['OUTSIDE_FIRST_INSTANCE_CIVIL_SCOPE'], documentAvailability: record.availability || (record.documentUrl ? 'URL_DECLARED_UNVERIFIED' : 'NO_DOCUMENT_URL') }
        : record.duplicateSourceId ? { matchLevel: 'CONFLICT', corpusDocumentId: null, reason: [record.duplicateSourceId], documentAvailability: record.availability || (record.documentUrl ? 'URL_DECLARED_UNVERIFIED' : 'NO_DOCUMENT_URL') }
          : matchRecordIndexed(record, corpusIndex);
    const coverageState = match.matchLevel === 'INVALID' ? 'INVALID' : match.matchLevel === 'OUT_OF_SCOPE' ? 'OUT_OF_SCOPE'
        : match.matchLevel === 'CONFLICT' || match.matchLevel === 'MEDIUM' || record.scope === 'UNKNOWN_SCOPE' || record.possibleLegalIdentityDuplicate ? 'KNOWN_REVIEW'
        : match.matchLevel === 'UNMATCHED' ? (record.documentUrl ? 'KNOWN_UNMATCHED' : 'KNOWN_NO_DOCUMENT')
          : (match.documentAvailability === 'AVAILABLE' ? 'KNOWN_DOCUMENT_AVAILABLE' : 'KNOWN_MATCHED');
    return { sourceRecordId: record.sourceRecordId, legalIdentity: [record.caseNormalized, record.courtNormalized, record.courtNumber || '', record.decisionDate || ''].join('|'), matchLevel: match.matchLevel, corpusDocumentId: match.corpusDocumentId, reason: match.reason, documentAvailability: match.documentAvailability, coverageState, scope: record.scope, documentUrl: record.documentUrl, rowNumber: record.rowNumber, possibleLegalIdentityDuplicate: record.possibleLegalIdentityDuplicate || null };
  }).sort((a,b)=>(a.sourceRecordId||'').localeCompare(b.sourceRecordId||'') || a.rowNumber-b.rowNumber);
  const counts = Object.fromEntries(['EXACT','HIGH','MEDIUM','CONFLICT','UNMATCHED','INVALID','OUT_OF_SCOPE'].map(level => [level, rows.filter(row=>row.matchLevel===level).length]));
  const funnel = {
    censusTotal: rows.length, validFirstInstanceCivil: rows.filter(x=>x.scope==='IN_SCOPE'&&x.matchLevel!=='INVALID').length,
    documentUrlAvailable: rows.filter(x=>x.scope==='IN_SCOPE'&&x.matchLevel!=='INVALID'&&x.documentUrl).length,
    matchedInGalilei: rows.filter(x=>['EXACT','HIGH'].includes(x.matchLevel)).length,
    unmatched: rows.filter(x=>x.matchLevel==='UNMATCHED').length,
    review: rows.filter(x=>x.matchLevel==='CONFLICT'||x.matchLevel==='MEDIUM'||x.scope==='UNKNOWN_SCOPE'||x.possibleLegalIdentityDuplicate).length,
  };
  return { schemaVersion: VERSION, generatedAt: null, sourceCompleteness: snapshot.censusCompleteness || 'UNKNOWN', coverageClaim: 'coverage within supplied authorized census', corpusRows: corpus.length, counts, funnel, rows };
}

function makeAcquisitionManifest(reconciliation, snapshot) {
  const byId = new Map((snapshot.records || []).map(x => [`${x.rowNumber}`, x]));
  const candidates = (reconciliation.rows || []).filter(row => row.matchLevel === 'UNMATCHED' && row.scope === 'IN_SCOPE' && !row.possibleLegalIdentityDuplicate).map(row => {
    const record = byId.get(String(row.rowNumber)) || {};
    let priority, reason;
    if (record.sourceRecordId && record.documentUrl && /PDF|DIRECT/u.test(String(record.documentUrlType || '').toUpperCase())) { priority = 'P0'; reason = 'Stable source ID and provider declares a direct document URL; content remains unverified.'; }
    else if (record.documentUrl && /VIEW|VISOR/u.test(String(record.documentUrlType || '').toUpperCase())) { priority = 'P1'; reason = 'Document viewer URL supplied; no request has been made.'; }
    else if (record.documentUrl) { priority = 'P1'; reason = 'Document URL supplied but URL type/content have not been verified.'; }
    else if (record.metadataUrl) { priority = 'P2'; reason = 'Metadata URL only; no document URL supplied.'; }
    else { priority = 'P3'; reason = 'No document URL; requires review.'; }
    return { sourceRecordId: row.sourceRecordId, documentUrl: row.documentUrl, metadataUrl: record.metadataUrl || null, court: record.court, date: record.decisionDate, case: record.expediente, priority, reason, acquisitionStatus: 'PENDING' };
  }).sort((a,b)=>a.priority.localeCompare(b.priority)||String(a.sourceRecordId).localeCompare(String(b.sourceRecordId)));
  return { schemaVersion: VERSION, networkRequests: 0, downloads: 0, eligibleCount: candidates.length, candidates };
}

function errorCsv(errors) {
  const quote = x => `"${String(x ?? '').replace(/"/gu, '""')}"`;
  return ['row,field,value,errorCode,message', ...errors.map(x => [x.row,x.field,x.value,x.errorCode,x.message].map(quote).join(','))].join('\r\n') + '\r\n';
}
function writeRun(input, intake, reconciliation, acquisition, runDir, corpusCount) {
  fs.mkdirSync(runDir, { recursive: true });
  const normalizedPath = path.join(runDir, 'normalized-census.json');
  fs.writeFileSync(normalizedPath, `${JSON.stringify(intake.snapshot, null, 2)}\n`);
  const writtenHash = sha256(fs.readFileSync(normalizedPath));
  fs.writeFileSync(path.join(runDir, 'errors.json'), `${JSON.stringify(intake.errors, null, 2)}\n`);
  fs.writeFileSync(path.join(runDir, 'errors.csv'), errorCsv(intake.errors));
  fs.writeFileSync(path.join(runDir, 'reconciliation.json'), `${JSON.stringify(reconciliation, null, 2)}\n`);
  fs.writeFileSync(path.join(runDir, 'reconciliation.csv'), `sourceRecordId,legalIdentity,matchLevel,CorpusDocumentId,reason,documentAvailability\r\n${reconciliation.rows.map(row=>[row.sourceRecordId,row.legalIdentity,row.matchLevel,row.corpusDocumentId,(row.reason||[]).join('|'),row.documentAvailability].map(x=>`"${String(x??'').replace(/"/gu,'""')}"`).join(',')).join('\r\n')}\r\n`);
  fs.writeFileSync(path.join(runDir, 'coverage-funnel.json'), `${JSON.stringify({dataset: 'SUPPLIED_EXPORT', completeness: intake.snapshot.censusCompleteness, claim: reconciliation.coverageClaim, counts: reconciliation.counts, funnel: reconciliation.funnel}, null, 2)}\n`);
  fs.writeFileSync(path.join(runDir, 'acquisition-manifest.json'), `${JSON.stringify(acquisition, null, 2)}\n`);
  const sourceFile = path.basename(input.path);
  const manifest = { schemaVersion: VERSION, sourceFile, sourceHash: intake.inputSha256, sourceBytes: input.byteLength, format: input.format, delimiter: input.delimiter || null,
    receivedAt: new Date().toISOString(), rows: intake.summary.rows, validRows: intake.summary.validRows, invalidRows: intake.summary.invalidRows,
    duplicateRows: intake.summary.duplicateRows, outOfScopeRows: intake.summary.outOfScope, unknownScopeRows: intake.summary.unknownScope,
    normalizedHash: intake.normalizedSha256, normalizedFileHash: writtenHash, corpusRows: corpusCount, censusCompleteness: intake.snapshot.censusCompleteness,
    scope: intake.snapshot.scope, toolVersion: VERSION, gitSha: input.gitSha || 'UNKNOWN', networkRequests: 0, databaseWrites: 0, sourceFileModified: false };
  fs.writeFileSync(path.join(runDir, 'intake-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  const summary = { status: 'PROCESSED_WITH_ROW_ERRORS_ALLOWED', dataset: 'SUPPLIED_EXPORT', rows: intake.summary.rows, valid: intake.summary.validRows, invalid: intake.summary.invalidRows,
    inScope: intake.summary.inScope, matched: reconciliation.counts.EXACT + reconciliation.counts.HIGH, exact: reconciliation.counts.EXACT, high: reconciliation.counts.HIGH,
    medium: reconciliation.counts.MEDIUM, review: reconciliation.funnel.review, unmatched: reconciliation.counts.UNMATCHED,
    pdfUrls: intake.snapshot.records.filter(x=>x.documentUrl).length, acquisitionCandidates: acquisition.eligibleCount,
    inputSha256: intake.inputSha256, normalizedSha256: intake.normalizedSha256, networkRequests: 0, databaseWrites: 0,
    completeness: intake.snapshot.censusCompleteness, coverageClaim: reconciliation.coverageClaim, runDirectory: runDir };
  fs.writeFileSync(path.join(runDir, 'final-summary.json'), `${JSON.stringify(summary, null, 2)}\n`);
  return { manifest, summary };
}

function loadCorpus(file) {
  if (!file) return [];
  const value = JSON.parse(decodeUtf8(fs.readFileSync(file)));
  const docs = Array.isArray(value) ? value : value.documents || value.firstInstanceDocuments || value.records || (value.id || value.sourceRecordId ? [value] : []);
  if (!Array.isArray(docs)) throw new Error('CORPUS_SNAPSHOT_ARRAY_REQUIRED');
  return docs;
}
function argsOf(argv) {
  const out = {};
  for (let i=0;i<argv.length;i++) if (argv[i].startsWith('--')) { const [key, inline] = argv[i].slice(2).split(/=(.*)/su); out[key] = inline === undefined ? (argv[i+1] && !argv[i+1].startsWith('--') ? argv[++i] : true) : inline; }
  return out;
}
function runCli(argv) {
  const args = argsOf(argv);
  if (!args.input) throw new Error('INPUT_REQUIRED');
  const inputPath = path.resolve(String(args.input));
  if (!fs.statSync(inputPath).isFile()) throw new Error('INPUT_NOT_FILE');
  const input = readInput(inputPath);
  const mapping = args.mapping ? JSON.parse(decodeUtf8(fs.readFileSync(path.resolve(String(args.mapping))))) : {};
  const metadataPath = args['export-metadata'] ? path.resolve(String(args['export-metadata'])) : path.join(path.dirname(inputPath), 'export-metadata.json');
  const metadata = fs.existsSync(metadataPath) ? JSON.parse(decodeUtf8(fs.readFileSync(metadataPath))) : {};
  const completeness = args.completeness || (metadata.declaredComplete === true ? 'DECLARED_COMPLETE' : metadata.declaredComplete === false ? 'PARTIAL' : 'UNKNOWN');
  const scope = { jurisdiction: metadata.jurisdiction || null, instance: metadata.instance || 'FIRST_INSTANCE', matter: metadata.matter || metadata.fuero || 'CIVIL', dateFrom: metadata.dateFrom || null, dateTo: metadata.dateTo || null, courts: metadata.courts || [], source: metadata.source || args.source || null, declaredComplete: metadata.declaredComplete === true };
  const intake = normalizeRows(input.rows, { source: args.source || metadata.source, mapping, completeness, scope, inputSha256: input.inputSha256 });
  const corpus = loadCorpus(args.corpus ? path.resolve(String(args.corpus)) : null);
  const reconciliation = reconcile(intake.snapshot, corpus);
  const acquisition = makeAcquisitionManifest(reconciliation, intake.snapshot);
  const root = path.resolve(String(args['output-root'] || path.join(path.dirname(inputPath), 'runs')));
  const runDir = path.join(root, new Date().toISOString().replace(/[:.]/gu, '-'));
  const gitSha = args['git-sha'] || 'UNKNOWN';
  const result = writeRun({ path: inputPath, ...input, gitSha }, intake, reconciliation, acquisition, runDir, corpus.length);
  console.log(JSON.stringify(result.summary, null, 2));
  return result;
}
function statsOnly(rows, options = {}) {
  const started = performance.now();
  const input = rows.map((row,i)=>({row,rowNumber:i+2,parseIssues:[]}));
  const result = normalizeRows(input, options);
  const reconciled = reconcile(result.snapshot, options.corpus || []);
  const acquisition = makeAcquisitionManifest(reconciled, result.snapshot);
  return { rows: rows.length, corpusRows: options.corpus?.length || 0, elapsedMs: Number((performance.now()-started).toFixed(3)), normalizedSha256: result.normalizedSha256, matched: reconciled.counts.EXACT+reconciled.counts.HIGH, acquisitionCandidates: acquisition.eligibleCount };
}

if (require.main === module) {
  try { runCli(process.argv.slice(2)); }
  catch (error) { console.error(`FIRST_INSTANCE_INTAKE_FAILED: ${error.message}`); process.exitCode = 2; }
}
module.exports = { VERSION, parseCsv, readInput, normalizeCase, parseDate, normalizeCourt, normalizeRows, matchRecord, reconcile, makeAcquisitionManifest, errorCsv, statsOnly, sha256 };
