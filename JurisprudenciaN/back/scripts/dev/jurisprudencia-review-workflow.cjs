'use strict';

const crypto = require('node:crypto');

function fold(value) {
  return String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/gu, '')
    .toUpperCase().replace(/[^A-Z0-9]+/gu, ' ').trim().replace(/\s+/gu, ' ');
}
function docket(value) {
  return String(value ?? '').normalize('NFC').toUpperCase().replace(/[‐‑‒–—]/gu, '-')
    .replace(/\s*([/-])\s*/gu, '$1').replace(/\s+/gu, ' ').trim();
}
function dateOnly(value) {
  const match = String(value ?? '').match(/^(\d{4}-\d{2}-\d{2})/u);
  return match ? match[1] : '';
}
function isRealIsoDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}
function legalIdentity(record = {}) {
  const instance = String(record.instance || '').toUpperCase();
  const firstInstance = instance === 'FIRST_INSTANCE' || /^JUZGADO\b/u.test(fold(record.court));
  const chamber = firstInstance ? '' : fold(record.chamber).replace(/^SALA /u, '');
  const normalizedCourt = fold(record.court).replace(/\s+N\s*\d{1,3}$/u, '').trim();
  const courtNumber = firstInstance
    ? String(record.courtNumber || record.court?.match(/\b(?:N(?:RO|[°º.]?)\s*)?(\d{1,3})\b/iu)?.[1] || '').trim()
    : '';
  const fields = {
    jurisdiction: fold(record.jurisdiction || 'NACIONAL'),
    court: normalizedCourt,
    chamber,
    courtNumber,
    caseNumber: docket(record.caseNumber || record.expediente),
    decisionDate: dateOnly(record.decisionDate),
  };
  const criticalMissing = !fields.jurisdiction || !fields.court || !fields.caseNumber || !fields.decisionDate ||
    (firstInstance ? !fields.courtNumber : !fields.chamber);
  const hasConflict = Boolean(record.identityConflict || record.conflicts?.length);
  const invalid = Boolean(record.identityInvalid || (fields.decisionDate && !isRealIsoDate(fields.decisionDate)));
  const confidence = invalid ? 'INVALID' : hasConflict ? 'AMBIGUOUS' : criticalMissing ? 'PARTIAL' : 'COMPLETE';
  const key = confidence === 'COMPLETE'
    ? [fields.jurisdiction, fields.court, firstInstance ? `J${fields.courtNumber}` : fields.chamber, fields.caseNumber, fields.decisionDate]
      .map(value => encodeURIComponent(value)).join('|')
    : null;
  return { confidence, key, fields, instance: firstInstance ? 'FIRST_INSTANCE' : 'SECOND_INSTANCE' };
}
function normalizeText(text) {
  return String(text ?? '').normalize('NFC').replace(/\u00ad/gu, '').replace(/\r\n?/gu, '\n')
    .replace(/[\t\f\v ]+/gu, ' ').replace(/\n+/gu, ' ').replace(/\s+/gu, ' ').trim();
}
function sha256(value) { return crypto.createHash('sha256').update(value).digest('hex'); }
function representationKey(file = {}) {
  return {
    sha256: String(file.sha256 || '').toLowerCase() || null,
    mime: file.mime || file.mimeType || null,
    size: Number.isFinite(Number(file.bytes ?? file.sizeBytes)) ? Number(file.bytes ?? file.sizeBytes) : null,
    pages: Number.isFinite(Number(file.pages ?? file.pageCount)) ? Number(file.pages ?? file.pageCount) : null,
    source: file.source || file.sourceSystem || null,
    sourceRecordId: file.sourceRecordId || file.externalId || null,
  };
}
function textEvidence(text) {
  const original = String(text || '');
  const normalized = normalizeText(original);
  const lineSource = original.normalize('NFC').replace(/\u00ad/gu, '').replace(/\r\n?/gu, '\n');
  const lines = lineSource.split('\n').map(line => line.replace(/\s+/gu, ' ').trim().slice(0, 1000)).filter(line => line.length >= 12);
  const upper = normalized.toLocaleUpperCase('es-AR');
  const markers = ['SE RESUELVE', 'RESUELVE:', 'POR ELLO', 'FALLA:', 'RESUELVO', 'Y VISTOS'].filter(marker => upper.includes(marker));
  let dispositive = '';
  const positions = markers.map(marker => upper.lastIndexOf(marker)).filter(position => position >= 0);
  if (positions.length) dispositive = normalized.slice(Math.min(...positions)).slice(0, 5000);
  const header = lines.slice(0, 18).filter(line => /EXPTE|EXPEDIENTE|CAMARA|CÁMARA|JUZGADO|SALA|A LOS .* DIAS|A LOS .* DÍAS/iu.test(line)).slice(0, 10);
  const signatureLines = lines.filter(line => /FIRMADO POR|FIRMADO DIGITALMENTE|FIRMA DIGITAL|JUEZ DE CAMARA|JUEZA DE CAMARA|JUEZ NACIONAL|SECRETARIO/u.test(fold(line))).slice(-12).map(line => line.toLocaleUpperCase('es-AR').slice(0, 500));
  const stamps = [...new Set(normalized.match(/#\d{5,}#\d{5,}#\d{8,}/gu) || [])].slice(0, 30);
  return {
    textAvailable: normalized.length > 0,
    chars: original.length,
    normalizedTextSha256: normalized ? sha256(normalized) : null,
    headerEvidence: header,
    decisionDateEvidence: header.filter(line => /A LOS .* DIAS|A LOS .* DÍAS|FECHA/iu.test(line)),
    chamberEvidence: header.filter(line => /SALA|CAMARA|CÁMARA/iu.test(line)),
    docketEvidence: header.filter(line => /EXPTE|EXPEDIENTE/iu.test(line)),
    resolutoryMarkers: markers,
    resolutorySha256: dispositive ? sha256(normalizeText(dispositive).toLocaleUpperCase('es-AR')) : null,
    resolutoryExcerpt: dispositive.slice(0, 1200),
    signatureEvidence: signatureLines,
    documentStamps: stamps,
    limitedExcerpt: lines.slice(0, 6).join('\n').slice(0, 900),
  };
}
function compareRepresentations(left, right) {
  const leftSha = String(left?.sha256 || '').toLowerCase();
  const rightSha = String(right?.sha256 || '').toLowerCase();
  const a = left?.legalIdentity;
  const b = right?.legalIdentity;
  const identityComplete = a?.confidence === 'COMPLETE' && b?.confidence === 'COMPLETE';
  const sameLegalKey = Boolean(identityComplete && a.key === b.key);
  const differentLegalKey = Boolean(identityComplete && a.key !== b.key);
  if (leftSha && leftSha === rightSha) return { relationship: 'EXACT_FILE', evidence: ['SHA256_EQUAL'], allowedAction: 'LINK_EXACT_FILE' };
  if (differentLegalKey) return { relationship: 'RELATED_DOCUMENT', evidence: ['COMPLETE_LEGAL_KEYS_DIFFER'], allowedAction: 'KEEP_SEPARATE_RELATED' };
  if (sameLegalKey && left?.textEvidence?.textAvailable && right?.textEvidence?.textAvailable) {
    if (left.textEvidence.normalizedTextSha256 === right.textEvidence.normalizedTextSha256)
      return { relationship: 'SAME_TEXT_RENDER', evidence: ['LEGAL_KEY_EQUAL', 'NORMALIZED_TEXT_HASH_EQUAL'], allowedAction: 'ATTACH_ALTERNATE_REPRESENTATION' };
    const sameStamp = left.textEvidence.documentStamps.length > 0 &&
      left.textEvidence.documentStamps.some(stamp => right.textEvidence.documentStamps.includes(stamp));
    const sameSignatures = left.textEvidence.signatureEvidence.length > 0 &&
      left.textEvidence.signatureEvidence.some(line => right.textEvidence.signatureEvidence.includes(line));
    const sameResolutory = Boolean(left.textEvidence.resolutorySha256 &&
      left.textEvidence.resolutorySha256 === right.textEvidence.resolutorySha256);
    const markerOverlap = left.textEvidence.resolutoryMarkers.some(marker => right.textEvidence.resolutoryMarkers.includes(marker));
    const tokens = value => new Set(normalizeText(value).toLocaleUpperCase('es-AR').split(/[^A-Z0-9]+/u).filter(token => token.length > 2));
    const leftTokens = tokens(left.textEvidence.resolutoryExcerpt);
    const rightTokens = tokens(right.textEvidence.resolutoryExcerpt);
    const union = new Set([...leftTokens, ...rightTokens]);
    const dispositionSimilarity = union.size ? [...leftTokens].filter(token => rightTokens.has(token)).length / union.size : 0;
    if (sameStamp && sameSignatures && sameResolutory)
      return { relationship: 'SAME_DECISION_DIFFERENT_VERSION', evidence: ['LEGAL_KEY_EQUAL', 'DOCUMENT_STAMP_EQUAL', 'SIGNATURE_LINES_EQUAL', 'RESOLUTORY_TEXT_HASH_EQUAL'], allowedAction: 'HUMAN_REVIEW' };
    if (sameSignatures && sameResolutory)
      return { relationship: 'SAME_DECISION_DIFFERENT_RENDER', evidence: ['LEGAL_KEY_EQUAL', 'SIGNATURE_LINES_EQUAL', 'RESOLUTORY_TEXT_HASH_EQUAL'], allowedAction: 'HUMAN_REVIEW' };
    const sameDisposition = dispositionSimilarity >= 0.85;
    if (sameStamp && markerOverlap && sameDisposition)
      return { relationship: 'SAME_DECISION_DIFFERENT_VERSION', evidence: ['LEGAL_KEY_EQUAL', 'DOCUMENT_STAMP_EQUAL',
        'RESOLUTORY_MARKER_OVERLAP', `RESOLUTORY_TOKEN_JACCARD_${dispositionSimilarity.toFixed(4)}`], allowedAction: 'HUMAN_REVIEW' };
    if (sameSignatures && markerOverlap && (sameDisposition || sameStamp))
      return { relationship: 'SAME_DECISION_DIFFERENT_VERSION', evidence: ['LEGAL_KEY_EQUAL', ...(sameStamp ? ['DOCUMENT_STAMP_EQUAL'] : []),
        'SIGNATURE_LINE_OVERLAP', 'RESOLUTORY_MARKER_OVERLAP', ...(sameDisposition ? [`RESOLUTORY_TOKEN_JACCARD_${dispositionSimilarity.toFixed(4)}`] : [])], allowedAction: 'HUMAN_REVIEW' };
  }
  if (left?.textEvidence?.textAvailable && right?.textEvidence?.textAvailable)
    return { relationship: 'INCONCLUSIVE', evidence: ['TEXT_AVAILABLE_BUT_INDEPENDENT_DECISION_PROOF_INSUFFICIENT'], allowedAction: 'HUMAN_REVIEW' };
  return { relationship: 'INCONCLUSIVE', evidence: ['TEXT_UNAVAILABLE_OR_LEGAL_KEY_INCOMPLETE'], allowedAction: 'HUMAN_REVIEW' };
}
const REVIEW_DECISIONS = new Set(['SAME_DECISION_SAME_FILE', 'SAME_DECISION_ALTERNATE_REPRESENTATION',
  'SAME_DECISION_DIFFERENT_VERSION', 'RELATED_DOCUMENT', 'DIFFERENT_DECISION', 'INCONCLUSIVE']);
function parseCsv(text) {
  const rows = [];
  let row = [], cell = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted && ch === '"' && text[i + 1] === '"') { cell += '"'; i++; }
    else if (ch === '"') quoted = !quoted;
    else if (!quoted && ch === ',') { row.push(cell); cell = ''; }
    else if (!quoted && (ch === '\n' || ch === '\r')) {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); cell = '';
      if (row.some(value => value !== '')) rows.push(row);
      row = [];
    } else cell += ch;
  }
  if (quoted) throw new Error('CSV_UNCLOSED_QUOTE');
  if (cell || row.length) { row.push(cell); rows.push(row); }
  if (!rows.length) return { headers: [], records: [] };
  const headers = rows.shift().map((header, index) => index === 0 ? header.replace(/^\uFEFF/u, '') : header);
  return { headers, records: rows.map(values => Object.fromEntries(headers.map((header, index) => [header, values[index] ?? '']))) };
}
function validateReviewDecisions(csvText, knownGroupIds) {
  const parsed = parseCsv(csvText);
  const errors = [];
  const required = ['groupId', 'decision', 'reviewer', 'reviewedAt', 'notes'];
  for (const name of required) if (!parsed.headers.includes(name)) errors.push({ code: 'MISSING_COLUMN', field: name });
  const seen = new Map();
  const valid = [];
  for (let index = 0; index < parsed.records.length; index++) {
    const record = parsed.records[index]; const line = index + 2;
    if (!knownGroupIds.has(record.groupId)) errors.push({ code: 'UNKNOWN_GROUP_ID', line, groupId: record.groupId });
    if (!REVIEW_DECISIONS.has(record.decision)) errors.push({ code: 'INVALID_DECISION', line, groupId: record.groupId, decision: record.decision });
    if (!seen.has(record.groupId)) seen.set(record.groupId, new Set());
    const decisions = seen.get(record.groupId);
    if (decisions.has(record.decision)) errors.push({ code: 'DUPLICATE_DECISION', line, groupId: record.groupId });
    else if (decisions.size) errors.push({ code: 'CONFLICTING_DECISIONS', line, groupId: record.groupId });
    decisions.add(record.decision);
    if (knownGroupIds.has(record.groupId) && REVIEW_DECISIONS.has(record.decision)) valid.push(record);
  }
  for (const groupId of knownGroupIds) if (!seen.has(groupId)) errors.push({ code: 'MISSING_DECISION', groupId });
  return { valid: errors.length === 0, rows: parsed.records.length, decisions: valid.length, errors };
}
module.exports = { fold, docket, legalIdentity, normalizeText, sha256, representationKey, textEvidence,
  compareRepresentations, REVIEW_DECISIONS, validateReviewDecisions };
