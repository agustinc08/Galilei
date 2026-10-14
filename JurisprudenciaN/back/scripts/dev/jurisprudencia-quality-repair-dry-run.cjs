'use strict';

// J7.1 is a read-only evidence and repair-planning tool. It intentionally has
// no mutation API and rejects every CLI argument (including --apply).
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync, execFileSync } = require('node:child_process');
const { Client } = require('pg');
const { PDFParse } = require('pdf-parse');
const { stable } = require('./jurisprudencia-corpus-quality-audit.cjs');

const ROOT = path.resolve(__dirname, '..', '..', '..', '..');
const WORK = path.join(ROOT, '_recovery-work', 'jurisprudencia-j71');
const J7 = path.join(ROOT, '_recovery-work', 'jurisprudencia-j7');
const J6 = path.join(ROOT, '_recovery-work', 'jurisprudencia-j6');
const J61 = path.join(ROOT, '_recovery-work', 'jurisprudencia-j61');
const STORAGE = path.join(ROOT, '_dev-corpus-storage');
const DATABASE_URL = process.env.DATABASE_URL;
const TOOL_VERSION = 'j7.1-repair-dry-run-v7';
const J61_HASH = '2b04cdb75acaa36dec515b7b7d8e8928dc80186d10bb6b293d119317b6f1827d';
const EXPECTED = { civil: 6070, missingSala: 1254, invalidCase: 1092, p1: 8, p2: 1250, sameText: 12, multiSource: 341, multiLegal: 4, multiDocumentGroups: 1, partial: 1256 };

const readJson = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const writeJson = (name, value) => fs.writeFileSync(path.join(WORK, name), `${JSON.stringify(value, null, 2)}\n`, 'utf8');
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const norm = value => String(value ?? '').normalize('NFC').replace(/\r\n?/gu, '\n').replace(/\s+/gu, ' ').trim();
const docket = value => {
  const s = String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/gu, '').toUpperCase().replace(/(\d)[.,](?=\d{3}(?:\D|$))/gu, '$1');
  const m = s.match(/(\d+)\s*[/-]\s*(\d{2,4})/u);
  return m ? `${m[1].replace(/^0+(?=\d)/u, '')}/${m[2].length === 2 ? m[2] : m[2].replace(/^0+(?=\d)/u, '')}` : '';
};
const canonicalWithoutYear = value => {
  const digits = String(value ?? '').trim().replace(/[.\s]/gu, '');
  return /^\d{1,9}$/u.test(digits) ? digits.replace(/^0+(?=\d)/u, '') : '';
};
const unique = values => [...new Set(values)];
const by = (rows, key) => rows.reduce((out, row) => { const value = String(key(row) ?? 'UNKNOWN'); out[value] = (out[value] || 0) + 1; return out; }, {});
const getSourceCodes = row => unique((row.ingestions || []).map(x => x.sourceCode).filter(Boolean)).sort();
const getRefs = row => (row.ingestions || []).map(i => ({ id: i.id, sourceCode: i.sourceCode, externalId: i.externalId || null, sourceReference: i.sourceReference || null, externalUrlHost: safeUrlHost(i.externalUrl), metadataOriginal: i.metadataOriginal || {} }));
function safeUrlHost(value) { try { return new URL(value).host; } catch { return null; } }
function jsonObj(value) { if (!value) return {}; if (typeof value === 'object') return value; try { return JSON.parse(value); } catch { return {}; } }
function namedValues(value, keys, out = []) { if (!value || typeof value !== 'object') return out; for (const [key, child] of Object.entries(value)) { if (keys.has(key.toLowerCase()) && child != null && typeof child !== 'object') out.push(String(child).trim()); if (child && typeof child === 'object') namedValues(child, keys, out); } return out; }
function assertNoApply(args) {
  if (args.length) throw new Error('Apply mode is not implemented. J7.1 accepts no arguments and performs no database or storage writes.');
}
function assertDevUrl(value = DATABASE_URL) {
  if (!value) throw new Error('J7.1_DATABASE_URL_MISSING');
  const url = new URL(value);
  if (url.protocol !== 'postgresql:' || url.hostname !== '127.0.0.1' || url.port !== '55432' || url.pathname !== '/buscador_juridico_civil_dev' || url.username !== 'bjc_dev') throw new Error('J7.1_DEV_TARGET_REJECTED');
}
function classifyCaseNumber(value, sourceRefs = [], headerRefs = []) {
  const raw = String(value ?? '').trim();
  if (!raw) return { kind: 'MISSING_CASE_NUMBER', parserLimitation: false, normalized: null };
  if (/acuerdo\s+plenario|sentencia\s+plenaria/iu.test(raw)) return { kind: 'FIELD_MISALIGNED_OR_LABEL', parserLimitation: false, normalized: null };
  const numbers = [...raw.matchAll(/\d{1,3}(?:[.\s]\d{3})+(?:\s*\/\s*\d{2,4})?|\d{1,8}\s*\/\s*\d{2,4}/gu)].map(m => m[0].trim());
  if (numbers.length > 1 || /\s[-;]\s/u.test(raw)) return { kind: 'MULTIPLE_CASES_OR_COMPOSITE_FIELD', parserLimitation: true, normalized: null, candidates: unique(numbers) };
  if (docket(raw)) return { kind: 'VALID_CANONICAL_CASE_YEAR', parserLimitation: false, normalized: docket(raw) };
  const noYear = canonicalWithoutYear(raw);
  if (noYear) {
    const src = sourceRefs.some(ref => canonicalWithoutYear(ref) === noYear || docket(ref) === docket(raw));
    const head = headerRefs.some(ref => canonicalWithoutYear(ref) === noYear || docket(ref) === docket(raw));
    return { kind: src ? (head ? 'LEGACY_NUMBER_NO_YEAR_CORROBORATED' : 'LEGACY_NUMBER_NO_YEAR_SOURCE_MATCH') : 'NUMBER_NO_YEAR_UNCORROBORATED', parserLimitation: true, normalized: noYear, sourceMatches: src, headerMatches: head };
  }
  return { kind: 'MALFORMED_OR_UNRECOGNIZED', parserLimitation: true, normalized: null };
}
function salaEvidence(text, sourceValues = []) {
  const candidates = [];
  const pages = Array.isArray(text) ? text : [{ pageNumber: 1, text: String(text || '') }];
  for (const page of pages) {
    const body = String(page.text || '').slice(0, 5000);
    const patterns = [
      /(?:c[aá]mara|camara)[^\n]{0,160}?\bsala\s+([a-m])\b/giu,
      /\bsala\s+([a-m])\b[^\n]{0,120}?(?:c[aá]mara|camara)/giu,
      /\bc[aá]mara\s+civil\s*[-–—:]\s*\bsala\s+([a-m])\b/giu,
    ];
    for (const re of patterns) for (const match of body.matchAll(re)) candidates.push({ sala: match[1].toUpperCase(), page: page.pageNumber, source: 'DOCUMENT_HEADER', primaryHeader: page.pageNumber === 1, evidenceType: 'CHAMBER_IN_COURT_HEADING' });
  }
  for (const value of sourceValues) {
    const matches = [...String(value || '').matchAll(/\bsala\s+([a-m])\b/giu)];
    for (const m of matches) candidates.push({ sala: m[1].toUpperCase(), page: null, source: 'SOURCE_METADATA', primaryHeader: false, evidenceType: 'SOURCE_FIELD' });
  }
  const byValue = new Map();
  for (const item of candidates) { if (!byValue.has(item.sala)) byValue.set(item.sala, []); byValue.get(item.sala).push(item); }
  const values = [...byValue.keys()].sort();
  if (values.length > 1) return { status: 'CONFLICT', proposedSala: null, values, evidence: candidates, confidence: 'UNRESOLVED', humanRequired: true };
  if (values.length === 1) {
    const evidence = byValue.get(values[0]);
    const primary = evidence.some(x => x.primaryHeader || x.source === 'SOURCE_METADATA');
    return { status: primary ? 'CONFIRMED_RECOVERABLE' : 'PROBABLE', proposedSala: values[0], values, evidence, confidence: primary ? 'CONFIRMED' : 'PROBABLE', humanRequired: !primary };
  }
  return { status: 'UNRESOLVED', proposedSala: null, values: [], evidence: [], confidence: 'UNRESOLVED', humanRequired: true };
}
function classifyMultiSource(records) {
  const identity = record => [record.sourceCode, record.externalId, String(record.sourceReference || '').trim().toLowerCase(), String(record.externalUrl || '').trim().toLowerCase()].join('|');
  const identities = records.map(identity);
  const uniqueIdentities = unique(identities);
  const sourceCodes = unique(records.map(x => x.sourceCode).filter(Boolean));
  const refs = records.map(x => [x.externalId, x.sourceReference].filter(Boolean).join('|'));
  const metadataKeys = records.map(x => hash(stable(x.metadataOriginal || {})));
  if (uniqueIdentities.length < records.length && new Set(metadataKeys).size > 1) return { classification: 'CONFLICTING_SOURCE_RECORD', sourceCodes };
  if (uniqueIdentities.length < records.length) return { classification: 'DUPLICATE_SOURCE_RECORD_CANDIDATE', sameSourceIdentityCount: records.length - uniqueIdentities.length, sourceCodes };
  if (sourceCodes.length === 1 && new Set(metadataKeys).size > 1 && new Set(refs).size === 1) return { classification: 'CONFLICTING_SOURCE_RECORD', sourceCodes };
  if (sourceCodes.length > 1 || new Set(refs).size > 1) return { classification: 'EXPECTED_MULTI_PROVENANCE', sourceCodes };
  return { classification: 'UNKNOWN', sourceCodes };
}
function repairOperation(input) {
  const seed = stable({ targetType: input.targetType, targetId: input.targetId, field: input.field, currentValue: input.currentValue, proposedValue: input.proposedValue, evidenceHash: input.evidenceHash || null, type: input.repairType });
  return {
    operationId: `j71-${hash(seed).slice(0, 20)}`, targetType: input.targetType, targetId: input.targetId, field: input.field,
    currentValue: input.currentValue ?? null, proposedValue: input.proposedValue ?? null, repairType: input.repairType,
    evidence: input.evidence || [], confidence: input.confidence || 'UNRESOLVED', safetyClass: input.safetyClass || 'UNRESOLVED',
    humanRequired: input.humanRequired !== false,
    preconditions: { expectedCurrentValue: input.currentValue ?? null, expectedUpdatedAt: input.updatedAt || null, expectedFileSha256: input.fileSha256 || null, expectedFileSha256s: unique(input.fileSha256s || (input.fileSha256 ? [input.fileSha256] : [])), expectedMetadataHash: input.metadataHash || null },
    postconditions: { proposedValue: input.proposedValue ?? null, legalKeyRecalculationRequired: true, searchReindexRequired: Boolean(input.searchReindexRequired), coverageRecalculationRequired: Boolean(input.coverageRecalculationRequired) },
    rollback: { action: 'RESTORE_PREVIOUS_VALUE', value: input.currentValue ?? null, executed: false },
    collisionRisk: input.collisionRisk || (input.safetyClass === 'AUTO_SAFE_DRY_RUN' ? 'No competing value found in reviewed local evidence; revalidate all preconditions before any future application.' : 'Source/legal ambiguity remains; resolve before any future application.'),
    modelSupport: input.modelSupport || 'PARTIAL', j6ReviewImpact: input.j6ReviewImpact || 'UNKNOWN', applied: false,
  };
}
function extractCaseRefs(text) {
  const refs = [];
  const re = /(?:expte?\.?|expediente|causa|autos|libre\s+actuaci[oó]n|nro\.?\s+de\s+expte\.?)\s*(?:n(?:ro|umero)?\.?\s*[°º.]?\s*)?(?:[=:]\s*)?([0-9]{1,3}(?:[. ]\d{3})+(?:\s*\/\s*\d{2,4})?|\d{1,8}\s*\/\s*\d{2,4}|\d{1,8})/giu;
  for (const m of String(text || '').matchAll(re)) {
    const candidate = m[1].trim().replace(/[.,;:]+$/u, '').replace(/\s+/gu, ' ');
    if (/^\d[\d.]*\s*\/\s*\d{2,4}$/u.test(candidate) || /^\d{1,3}(?:\.\d{3})+$/u.test(candidate) || /^\d{1,8}$/u.test(candidate)) refs.push(candidate);
  }
  return unique(refs);
}
function getHeaderPages(extractions) {
  const latest = new Map();
  for (const ext of extractions || []) {
    const prior = latest.get(ext.fileId);
    if (!prior || new Date(ext.extractedAt || 0) > new Date(prior.extractedAt || 0)) latest.set(ext.fileId, ext);
  }
  const selected = [...latest.values()].sort((a, b) => String(a.fileId).localeCompare(String(b.fileId)));
  if (!selected.length) return [];
  return selected.flatMap(ext => (ext.pages || []).filter(p => Number(p.pageNumber) <= 3).map(p => ({ fileId: ext.fileId, pageNumber: Number(p.pageNumber), text: String(p.text || '') })));
}
function computeQuality(row, overrides = {}) {
  let score = 100;
  const c = { ...(row.completeness || {}) };
  Object.assign(c, overrides);
  const weights = { caseNumber: 12, caseYear: 5, decisionDate: 8, court: 8, instance: 8, chamber: 8, title: 5, sourceRecordId: 5, portalId: 3, documentUrl: 4, sourceUrl: 4, fileSha: 10, pageCount: 5, originalMetadata: 5, provenanceRecord: 10 };
  for (const [field, weight] of Object.entries(weights)) if (c[field] !== 'PRESENT') score -= weight;
  for (const state of Object.values(c)) if (state === 'INVALID') score -= 5;
  if ((row.files || []).some(f => ['INVALID_PDF', 'HTML_AS_PDF', 'HASH_MISMATCH', 'MISSING_BLOB', 'UNREADABLE'].includes(f.integrityState))) score = Math.min(score, 10);
  if ((row.conflicts || []).length) score -= 12;
  score = Math.max(0, score);
  return { score, band: score >= 90 ? 'EXCELLENT' : score >= 75 ? 'GOOD' : score >= 50 ? 'REVIEW' : score >= 20 ? 'POOR' : 'BROKEN' };
}
function countsBy(rows, project) { return by(rows, project); }
function qualityCounts(rows, overrideById = new Map()) {
  const out = { EXCELLENT: 0, GOOD: 0, REVIEW: 0, POOR: 0, BROKEN: 0 };
  for (const row of rows) { const adjusted = computeQuality(row, overrideById.get(row.documentId) || {}); out[adjusted.band]++; }
  return out;
}
function compareJ7Live(j7Rows, liveRows, extractionByDoc) {
  const liveById = new Map(liveRows.map(row => [row.id, row]));
  const changes = [];
  for (const baseline of j7Rows) {
    const live = liveById.get(baseline.documentId);
    if (!live) { changes.push({ documentId: baseline.documentId, reason: 'DOCUMENT_MISSING' }); continue; }
    const liveFiles = (live.files || []).map(f => ({ id: f.id, sha256: f.sha256, storageKey: f.storageKey, pageCount: f.pageCount })).sort((a,b)=>a.id.localeCompare(b.id));
    const baseFiles = (baseline.files || []).map(f => ({ id: f.id, sha256: f.sha256, storageKey: f.storageKey, pageCount: f.pageCount })).sort((a,b)=>a.id.localeCompare(b.id));
    const sourceProjection = (items, liveShape) => (items || []).map(item => ({
      id: item.id || null,
      sourceCode: item.sourceCode || null,
      externalId: item.externalId || null,
      sourceReference: item.sourceReference || null,
      externalUrlHost: safeUrlHost(item.externalUrl || item.source?.sourceUrl),
    })).sort((a,b)=>String(a.id).localeCompare(String(b.id)));
    const fields = { instance: live.instance || null, court: live.court || null, sala: live.chamber || null, decisionDate: dateOnly(live.decisionDate), caseNumber: live.caseNumber || live.docket || null, title: live.title || null };
    const base = { instance: baseline.instance || null, court: baseline.court || null, sala: baseline.sala || null, decisionDate: dateOnly(baseline.decisionDate), caseNumber: baseline.caseNumber || null, title: baseline.title || null };
    const sources = sourceProjection(live.ingestions, true);
    const baseSources = sourceProjection(baseline.source, false);
    if (stable(fields) !== stable(base) || stable(liveFiles) !== stable(baseFiles) || stable(sources) !== stable(baseSources)) changes.push({ documentId: baseline.documentId, reason: 'CORE_FIELDS_FILES_OR_SOURCES_CHANGED' });
    const exts = extractionByDoc.get(live.id) || [];
    for (const baseFile of baseline.files || []) {
      const ext = exts.filter(x => x.fileId === baseFile.id).sort((a,b)=>new Date(b.extractedAt||0)-new Date(a.extractedAt||0))[0];
      const text = ext?.text || (ext?.pages || []).map(x => x.text || '').join('\n');
      const currentTextHash = hash(norm(text));
      if (baseFile.textHash && baseFile.textHash !== currentTextHash) changes.push({ documentId: baseline.documentId, fileId: baseFile.id, reason: 'EXTRACTED_TEXT_HASH_CHANGED' });
    }
  }
  const baselineIds = new Set(j7Rows.map(x => x.documentId));
  for (const row of liveRows) if (!baselineIds.has(row.id)) changes.push({ documentId: row.id, reason: 'NEW_CIVIL_DOCUMENT' });
  return changes;
}
function dateOnly(value) { if (!value) return null; const d = new Date(value); return Number.isNaN(d.getTime()) ? String(value) : d.toISOString().slice(0, 10); }
function applyImpact(operation, reviewShaByDocument) {
  const sha = operation.preconditions.expectedFileSha256;
  const reviewGroups = reviewShaByDocument.get(operation.targetId) || [];
  if (reviewGroups.length) return 'INVALIDATES_OR_STALES_HUMAN_REVIEW_SNAPSHOT';
  return 'NONE';
}
function htmlReport(summary, artifacts) {
  const esc = x => String(x ?? '').replace(/[&<>"']/gu, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' })[c]);
  const rows = artifacts.repairPlan.map(x => `<tr data-priority="${esc(x.priority)}" data-safety="${esc(x.safetyClass)}" data-type="${esc(x.repairType)}" data-source="${esc(x.source || '')}" data-year="${esc(x.year || '')}" data-sala="${esc(x.currentSala || x.proposedSala || '')}" data-human="${esc(x.humanRequired)}"><td>${esc(x.targetId)}</td><td>${esc(x.priority)}</td><td>${esc(x.repairType)}</td><td>${esc(x.safetyClass)}</td><td>${esc(x.source)}</td><td>${esc(x.year)}</td><td>${esc(x.currentSala || x.currentValue)}</td><td>${esc(x.proposedSala || x.proposedValue)}</td><td>${esc(x.humanRequired ? 'Sí' : 'No')}</td><td>${esc((x.evidence || []).map(e=>e.code||e.type).join(', '))}</td></tr>`).join('');
  const sections=(summary.sections||[]).map(x=>`<section><h2>${esc(x.title)}</h2><p>${esc(x.detail)}</p></section>`).join('');
  return `<!doctype html><html lang="es"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>J7.1 — Dry run de reparaciones</title><style>body{font:14px system-ui;margin:24px;background:#f6f7fb;color:#18212f}section,.card{background:#fff;border:1px solid #dbe1ea;border-radius:8px;padding:14px;margin:10px 0}.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:8px}.card b{display:block;font-size:22px}table{border-collapse:collapse;width:100%;font-size:12px}td,th{padding:7px;border-bottom:1px solid #dde2ea;text-align:left}th{position:sticky;top:0;background:#eef1f6}input,select{margin:4px;padding:7px}.wrap{overflow:auto;max-height:70vh}.note{color:#4e5969}</style><h1>Plan de reparación Civil — J7.1</h1><p class="note">Dry run de evidencia local. No se ejecutaron escrituras; clasificación automática no constituye decisión jurídica.</p><div class="cards">${Object.entries(summary.counts).map(([k,v])=>`<div class="card">${esc(k)}<b>${v}</b></div>`).join('')}</div>${sections}<section><h2>Reparaciones propuestas y casos que requieren revisión</h2><label>Prioridad <select id="priority"><option value="">Todas</option><option>P0</option><option>P1</option><option>P2</option><option>P3</option></select></label><label>Seguridad <select id="safety"><option value="">Todas</option>${['AUTO_SAFE_DRY_RUN','HUMAN_CONFIRMATION_REQUIRED','SOURCE_DATA_REQUIRED','MODEL_LIMITATION','NO_CHANGE_REQUIRED','UNRESOLVED'].map(x=>`<option>${x}</option>`).join('')}</select></label><label>Tipo <input id="type"></label><label>Fuente <input id="source"></label><label>Año <input id="year"></label><label>Sala <input id="sala"></label><label>Humano <select id="human"><option value="">Todos</option><option value="true">Sí</option><option value="false">No</option></select></label><p id="visible"></p><div class="wrap"><table><thead><tr><th>Target</th><th>Prioridad</th><th>Tipo</th><th>Clase seguridad</th><th>Fuente</th><th>Año</th><th>Sala actual</th><th>Propuesta</th><th>Revisión humana</th><th>Evidencia</th></tr></thead><tbody>${rows}</tbody></table></div></section><script>const q=s=>document.querySelector(s),rs=[...document.querySelectorAll('tbody tr')];function run(){let n=0;for(const r of rs){const ok=(!q('#priority').value||r.dataset.priority===q('#priority').value)&&(!q('#safety').value||r.dataset.safety===q('#safety').value)&&(!q('#type').value||r.dataset.type.toLowerCase().includes(q('#type').value.toLowerCase()))&&(!q('#source').value||r.dataset.source.toLowerCase().includes(q('#source').value.toLowerCase()))&&(!q('#year').value||r.dataset.year.includes(q('#year').value))&&(!q('#sala').value||r.dataset.sala.toLowerCase().includes(q('#sala').value.toLowerCase()))&&(!q('#human').value||r.dataset.human===q('#human').value);r.hidden=!ok;if(ok)n++}q('#visible').textContent='Filas: '+n+' / '+rs.length}document.querySelectorAll('input,select').forEach(e=>e.addEventListener('input',run));run()</script></html>`;
}
function getSentinelQuery() {
  return `SELECT
    (SELECT count(*)::int FROM "CorpusDocument") documents,
    (SELECT count(*)::int FROM "CorpusDocumentFile") files,
    (SELECT count(*)::int FROM "CorpusDocumentPage") pages,
    (SELECT count(*)::int FROM "CorpusIngestionRecord") ingestions,
    (SELECT count(*)::int FROM "CorpusExtraction") extractions,
    (SELECT count(*)::int FROM "CorpusSearchTokenState") AS "searchDocuments",
    (SELECT count(*)::int FROM "CorpusSearchToken") AS "searchTokens",
    (SELECT max("updatedAt") FROM "CorpusDocument") AS "corpusUpdatedAt",
    (SELECT max("createdAt") FROM "CorpusDocumentFile") AS "fileCreatedAt",
    (SELECT max("updatedAt") FROM "CorpusIngestionRecord") AS "ingestionUpdatedAt",
    (SELECT max("extractedAt") FROM "CorpusExtraction") AS "extractionAt",
    (SELECT max("updatedAt") FROM "CorpusSearchTokenState") AS "searchUpdatedAt",
    (SELECT "verifiedAt" FROM "CorpusSearchTokenProjectionControl" WHERE singleton=true) AS "searchVerifiedAt",
    (SELECT "isReady" FROM "CorpusSearchTokenProjectionControl" WHERE singleton=true) AS "searchReady",
    (SELECT count(*)::int FROM "CorpusDocument" WHERE "documentScope"='PRIVATE_WORKSPACE') AS "privateDocuments"`;
}
async function readSnapshot() {
  assertDevUrl();
  const client = new Client({ connectionString: DATABASE_URL, connectionTimeoutMillis: 10000, statement_timeout: 180000 });
  await client.connect();
  try {
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const identity = (await client.query(`SELECT current_database() database,current_user role,inet_server_addr()::text address,inet_server_port() port,current_setting('server_version_num')::int version_num`)).rows[0];
    if (identity.database !== 'buscador_juridico_civil_dev' || identity.role !== 'bjc_dev' || String(identity.address || '').replace(/\/\d+$/u,'') !== '127.0.0.1' || Number(identity.port) !== 55432 || identity.version_num < 160000 || identity.version_num >= 170000) throw new Error('J7.1_LIVE_DB_IDENTITY_REJECTED');
    const sentinel = (await client.query(getSentinelQuery())).rows[0];
    for (const key of ['corpusUpdatedAt','fileCreatedAt','ingestionUpdatedAt','extractionAt','searchUpdatedAt','searchVerifiedAt']) if (sentinel[key] instanceof Date) sentinel[key] = sentinel[key].toISOString();
    const rows = (await client.query(`
      SELECT d."id",d."documentType",d."title",d."jurisdiction",d."court",d."chamber",d."instance",d."caseNumber",d."docket",d."decisionDate",d."visibility",d."documentScope",d."metadata",d."metadataOriginal",d."searchText",d."latestExtractionId",d."updatedAt",
        COALESCE((SELECT json_agg(json_build_object('id',f."id",'storageProvider',f."storageProvider",'storageKey',f."storageKey",'originalFilename',f."originalFilename",'mimeType',f."mimeType",'sizeBytes',f."sizeBytes",'sha256',f."sha256",'pageCount',f."pageCount",'version',f."version")) FROM "CorpusDocumentFile" f WHERE f."documentId"=d."id"),'[]'::json) files,
        COALESCE((SELECT json_agg(json_build_object('id',i."id",'sourceCode',s."code",'sourceName',s."name",'sourceType',s."sourceType",'externalId',i."externalId",'externalUrl',i."externalUrl",'sourceReference',i."sourceReference",'metadataOriginal',i."metadataOriginal",'status',i."status",'ingestedAt',i."ingestedAt")) FROM "CorpusIngestionRecord" i JOIN "CorpusSourceSystem" s ON s."id"=i."sourceSystemId" WHERE i."documentId"=d."id"),'[]'::json) ingestions,
        (SELECT json_build_object('sourceChecksum',st."sourceChecksum",'tokenCount',st."tokenCount",'updatedAt',st."updatedAt",'actualTokenRows',(SELECT count(*)::int FROM "CorpusSearchToken" tok WHERE tok."documentId"=d."id")) FROM "CorpusSearchTokenState" st WHERE st."documentId"=d."id") searchState
      FROM "CorpusDocument" d WHERE d."documentScope"='GENERAL' AND (lower(coalesce(d."court",'')) LIKE '%civil%' OR lower(coalesce(d."chamber",'')) LIKE '%civil%') ORDER BY d."id"
    `)).rows;
    const ids = rows.map(row=>row.id);
    const extractions = ids.length ? (await client.query(`
      SELECT e."id",e."documentId",e."fileId",e."status",e."extractor",e."extractedAt",e."text",
        COALESCE((SELECT json_agg(json_build_object('pageNumber',p."pageNumber",'text',p."text") ORDER BY p."pageNumber") FROM "CorpusDocumentPage" p WHERE p."extractionId"=e."id"),'[]'::json) pages
      FROM "CorpusExtraction" e WHERE e."documentId"=ANY($1::text[]) ORDER BY e."documentId",e."extractedAt" DESC
    `,[ids])).rows : [];
    await client.query('ROLLBACK');
    return { identity: { host:'127.0.0.1',port:55432,database:identity.database,role:identity.role,serverMajor:16 }, sentinel, rows, extractions, affectedTextRows: ids.length };
  } finally { await client.end(); }
}
async function readSentinel() {
  assertDevUrl();
  const client = new Client({ connectionString: DATABASE_URL, connectionTimeoutMillis: 10000, statement_timeout: 60000 });
  await client.connect();
  try {
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const identity = (await client.query(`SELECT current_database() database,current_user role,inet_server_addr()::text address,inet_server_port() port,current_setting('server_version_num')::int version_num`)).rows[0];
    if (identity.database !== 'buscador_juridico_civil_dev' || identity.role !== 'bjc_dev' || String(identity.address || '').replace(/\/\d+$/u,'') !== '127.0.0.1' || Number(identity.port) !== 55432 || identity.version_num < 160000 || identity.version_num >= 170000) throw new Error('J7.1_AFTER_IDENTITY_REJECTED');
    const sentinel = (await client.query(getSentinelQuery())).rows[0];
    for (const key of ['corpusUpdatedAt','fileCreatedAt','ingestionUpdatedAt','extractionAt','searchUpdatedAt','searchVerifiedAt']) if (sentinel[key] instanceof Date) sentinel[key] = sentinel[key].toISOString();
    await client.query('ROLLBACK');
    return sentinel;
  } finally { await client.end(); }
}
function getAvailability(command) {
  const result = spawnSync('where.exe', [command], { encoding:'utf8', windowsHide:true, timeout:5000 });
  if (result.status !== 0 || !result.stdout.trim()) return { available:false, path:null, version:null };
  const executable = result.stdout.trim().split(/\r?\n/u)[0];
  let version = null;
  try { version = execFileSync(executable,['--version'],{encoding:'utf8',windowsHide:true,timeout:5000,stdio:['ignore','pipe','pipe']}).trim().split(/\r?\n/u)[0].slice(0,160); } catch {}
  return { available:true, path:executable, version };
}
function readPdfMetadata(filePath, tool) {
  if(!tool?.available)return{available:false,producer:null,creationDate:null,modDate:null,pages:null};
  try {
    const output=execFileSync(tool.path,[filePath],{encoding:'utf8',windowsHide:true,timeout:10000,stdio:['ignore','pipe','pipe']});
    const fields={};for(const line of output.split(/\r?\n/u)){const m=line.match(/^(Producer|CreationDate|ModDate|Pages):\s*(.*)$/u);if(m)fields[m[1]]=m[2].trim();}
    const clean=value=>String(value||'').replace(/[A-Z]:\\[^\s]*/giu,'[local-path-omitted]').slice(0,160)||null;
    return{available:true,producer:clean(fields.Producer),creationDate:clean(fields.CreationDate),modDate:clean(fields.ModDate),pages:Number(fields.Pages)||null};
  } catch(error) { return{available:true,error:error.code||'PDFINFO_FAILED',producer:null,creationDate:null,modDate:null,pages:null}; }
}
function safeStoragePath(key) {
  const full = path.resolve(STORAGE, String(key || ''));
  if (!full.startsWith(`${STORAGE}${path.sep}`)) throw new Error('STORAGE_KEY_PATH_ESCAPE');
  return full;
}
async function diagnoseOcr(row, file, extraction, tools) {
  const result = { documentId:row.id,fileId:file.id,sha256:file.sha256,sourceCodes:getSourceCodes(row),fileExists:false,fileValid:false,bytes:null,pdfSignature:false,pdfPages:file.pageCount ?? null,dbPageCount:0,emptyPages:0,nativeTextChars:0,pdfParserTextChars:null,imageOnly:null,searchTokenCount:Number(row.searchState?.tokenCount||0),sourceRecordCount:(row.ingestions||[]).length,ocrTooling:tools,diagnosticOcrExecuted:false,engine:null,result:'OCR_TOOLING_NOT_AVAILABLE',futureAction:'RUN_OCR_FUTURE',writes:0 };
  const filePath = safeStoragePath(file.storageKey);
  let buffer;
  try { buffer = fs.readFileSync(filePath); result.fileExists = true; result.bytes=buffer.length; result.pdfSignature=buffer.subarray(0,5).toString('ascii')==='%PDF-'; result.fileValid=result.pdfSignature&&buffer.length===Number(file.sizeBytes)&&hash(buffer)===String(file.sha256||'').toLowerCase(); } catch (error) { result.error=error.code||'FILE_READ_ERROR'; result.result='FILE_REPAIR_REQUIRED'; return result; }
  const pages=(extraction?.pages||[]).slice().sort((a,b)=>Number(a.pageNumber)-Number(b.pageNumber));
  result.dbPageCount=pages.length; result.emptyPages=pages.filter(p=>!String(p.text||'').trim()).length; result.nativeTextChars=String(extraction?.text||'').trim().length;
  let parser;
  try { parser=new PDFParse({data:buffer}); const info=await parser.getInfo(); result.pdfPages=Number.isFinite(info.total)?info.total:result.pdfPages; const text=await parser.getText(); const parserText=String(text?.text||'').trim(); result.pdfParserTextChars=parserText.length; result.pdfParserAlphanumericChars=(parserText.match(/[\p{L}\p{N}]/gu)||[]).length; result.imageOnly=result.pdfParserAlphanumericChars===0; result.result=result.imageOnly?'IMAGE_ONLY_PDF_CONFIRMED':'EXTRACTION_FAILURE_OR_PAGE_TEXT_GAP'; result.futureAction=result.imageOnly?'RUN_OCR_FUTURE':'REEXTRACT_NATIVE_TEXT'; }
  catch(error){result.result='PDF_DIAGNOSTIC_FAILED';result.error=String(error.message||error).slice(0,180);result.futureAction='FILE_REPAIR_REQUIRED';}
  finally { if(parser) await parser.destroy().catch(()=>{}); }
  const renderer=tools.pdftoppm?.available;
  if(result.imageOnly&&tools.tesseract?.available&&renderer){
    const outDir=path.join(WORK,'ocr-diagnostic');fs.mkdirSync(outDir,{recursive:true});
    const tempBase=path.join(outDir,`${row.id}-page1`); const tempPng=`${tempBase}.png`; const outText=`${tempBase}.txt`;
    try {
      execFileSync(tools.pdftoppm.path,['-f','1','-l','1','-singlefile','-png','-r','150',filePath,tempBase],{windowsHide:true,timeout:45000,stdio:['ignore','pipe','pipe']});
      const text=execFileSync(tools.tesseract.path,[tempPng,'stdout','-l','spa+eng'],{encoding:'utf8',windowsHide:true,timeout:45000,stdio:['ignore','pipe','pipe']});
      fs.writeFileSync(outText,text,'utf8');
      result.diagnosticOcrExecuted=true;result.engine=tools.tesseract.version;result.ocrPage=1;result.ocrChars=text.trim().length;result.ocrGarbageRatio=garbageRatio(text);result.result='OCR_DIAGNOSTIC_COMPLETED';result.futureAction=result.ocrChars>30&&result.ocrGarbageRatio<0.35?'HUMAN_REVIEW_OCR_QUALITY':'REVIEW_OCR_OUTPUT';
    } catch(error){result.ocrError=String(error.message||error).slice(0,180);result.result='OCR_DIAGNOSTIC_FAILED';}
    finally { try{fs.rmSync(tempPng,{force:true});}catch{} }
  }
  return result;
}
function garbageRatio(text) { const chars=String(text||'').replace(/\s/gu,''); if(!chars.length)return 1; const good=(chars.match(/[\p{L}\p{N}.,;:()¿?¡!%$/'"-]/gu)||[]).length;return Number((1-good/chars.length).toFixed(4)); }

async function run() {
  assertNoApply(process.argv.slice(2));
  assertDevUrl();
  fs.mkdirSync(path.join(WORK,'cache'),{recursive:true});
  const started=Date.now();
  const j7Rows=readJson(path.join(J7,'civil-inventory.json'));
  const j7Summary=readJson(path.join(J7,'final-summary.json'));
  const j7Determinism=readJson(path.join(J7,'determinism.json'));
  const priorDetPath=path.join(WORK,'determinism.json');
  const priorDeterminism=fs.existsSync(priorDetPath)?readJson(priorDetPath):null;
  const j7Flags=readJson(path.join(J7,'quality-flags.json'));
  const j7Repairs=readJson(path.join(J7,'repair-proposals.json'));
  const j7Text=readJson(path.join(J7,'text-duplicates.json'));
  const j7Sha=readJson(path.join(J7,'sha-duplicates.json'));
  const j7Legal=readJson(path.join(J7,'legal-identity-groups.json'));
  const j7Pages=readJson(path.join(J7,'page-integrity.json'));
  const j7Viewer=readJson(path.join(J7,'viewer-readiness.json'));
  const j61=readJson(path.join(J61,'review-input.json'));
  const j61Hash=readJson(path.join(J61,'review-input-hash.json'));
  const j6Primary=readJson(path.join(J6,'primary-identities.json')).rows;
  const j6Multi=readJson(path.join(J6,'multi-case-analysis.json')).rows;
  const j5Graph=readJson(path.join(J6.replace('jurisprudencia-j6','jurisprudencia-j5'),'identity-graph.json'));
  const phase={};
  // J7 hashed its in-memory inventory before JSON serialization, which omits
  // undefined object values. Validate the recorded deterministic hash pair and
  // separately hash the persisted artifact bytes; do not mislabel that known
  // serialization difference as a changed database snapshot.
  const baselineHashCheck=Boolean(j7Determinism.pass&&j7Determinism.artifacts.inventory===j7Summary.outputHashes.inventory&&j7Determinism.baselineHashes.inventory===j7Summary.outputHashes.inventory);
  const baselineInventoryFileHash=hash(fs.readFileSync(path.join(J7,'civil-inventory.json')));
  if(j61Hash.reviewInputHash!==J61_HASH||j61.reviewInputHash!==J61_HASH)throw new Error('J61_REVIEW_INPUT_HASH_MISMATCH');
  const snapshotAt=Date.now();
  const live=await readSnapshot();
  const extractionsByDoc=new Map();for(const ext of live.extractions){if(!extractionsByDoc.has(ext.documentId))extractionsByDoc.set(ext.documentId,[]);extractionsByDoc.get(ext.documentId).push(ext);}
  phase.snapshotMs=Date.now()-snapshotAt;
  const liveById=new Map(live.rows.map(x=>[x.id,x]));
  const baselineSentinel=j7Summary.zeroWrite.after;
  const sentinelCoreSame=['documents','files','pages','ingestions','extractions','searchDocuments','searchTokens','corpusUpdatedAt','fileCreatedAt','ingestionUpdatedAt','extractionAt','searchUpdatedAt','searchVerifiedAt','searchReady','privateDocuments'].every(k=>String((baselineSentinel.counts||{})[k]??baselineSentinel[k])===String(live.sentinel[k]));
  const coreChanges=compareJ7Live(j7Rows,live.rows,extractionsByDoc);
  const snapshotChanged=!sentinelCoreSame||live.rows.length!==EXPECTED.civil||coreChanges.length>0;
  const liveProjection = live.rows.map(r => ({
    id:r.id,type:r.documentType,court:r.court,chamber:r.chamber,instance:r.instance,
    caseNumber:r.caseNumber||r.docket,date:dateOnly(r.decisionDate),
    metadataHash:hash(stable(jsonObj(r.metadataOriginal))),
    files:(r.files||[]).map(f=>({id:f.id,sha256:f.sha256,sizeBytes:f.sizeBytes,storageKey:f.storageKey})).sort((a,b)=>a.id.localeCompare(b.id)),
    sources:(r.ingestions||[]).map(i=>({id:i.id,sourceCode:i.sourceCode,externalId:i.externalId,sourceReference:i.sourceReference,externalUrlHost:safeUrlHost(i.externalUrl)})).sort((a,b)=>a.id.localeCompare(b.id)),
    updatedAt:r.updatedAt,
  }));
  const baselineProjection={j7InventoryHash:j7Summary.outputHashes.inventory,j7SummaryHash:j7Summary.outputHashes.summary,liveProjectionHash:hash(stable(liveProjection))};
  const j7ById=new Map(j7Rows.map(x=>[x.documentId,x]));
  const flagDocs=new Map(j7Flags.documents.map(x=>[x.documentId,x]));
  const missingSalaIds=j7Rows.filter(x=>!x.sala&&!x.courtNumber).map(x=>x.documentId);
  const invalidCaseIds=j7Rows.filter(x=>x.completeness?.caseNumber==='INVALID'||x.completeness?.caseYear==='INVALID').map(x=>x.documentId);
  const j6IdentityShaSet=new Set([...j6Primary,...j6Multi].map(x=>String(x.sha||x.sha256||'').toLowerCase()).filter(Boolean));
  const j5IdentityShaSet=new Set((j5Graph.bySha||[]).map(x=>String(x.sha256||x.sha||'').toLowerCase()).filter(Boolean));
  const p1Rows=j7Repairs.proposals.filter(x=>x.priority==='P1');
  const p2Rows=j7Repairs.proposals.filter(x=>x.priority==='P2');
  const multiSourceGroups=j7Sha.groups.filter(g=>g.kinds?.includes('SAME_FILE_MULTIPLE_SOURCE_RECORDS'));
  const multiLegalIds=j7Flags.documents.filter(x=>x.flags.includes('MULTIPLE_LEGAL_KEYS')).map(x=>x.documentId);
  const oneDocManyCorpus=j7Legal.groups.filter(x=>x.state==='ONE_DECISION_MULTIPLE_DOCUMENTS');
  const sameTextGroups=j7Text.differentShaSameText;
  const viewerMissing=j7Viewer.documents.filter(x=>x.state==='TEXT_MISSING');
  const ocrDocIds=j7Pages.documents.filter(d=>d.files?.some(f=>f.states?.includes('ALL_EMPTY_TEXT'))).map(d=>d.documentId);
  const partialRows=j7Legal.partial||[];
  const issueSets={MISSING_SALA:new Set(missingSalaIds),INVALID_CASE_YEAR:new Set(invalidCaseIds),P1:new Set(p1Rows.map(x=>x.documentId)),P2:new Set(p2Rows.map(x=>x.documentId)),MULTIPLE_SOURCE_RECORDS:new Set(multiSourceGroups.flatMap(g=>g.documents||[])),MULTIPLE_LEGAL_KEYS:new Set(multiLegalIds),PARTIAL_LEGAL_KEY:new Set(partialRows.map(x=>x.documentId)),SAME_TEXT:new Set(sameTextGroups.flatMap(g=>g.entries.map(e=>e.documentId))),VIEWER_TEXT_MISSING:new Set(viewerMissing.map(x=>x.documentId)),OCR_CANDIDATE:new Set(ocrDocIds),MULTI_DOCUMENT_DECISION:new Set(oneDocManyCorpus.flatMap(x=>x.documentIds||[]))};
  const unionIds=new Set(Object.values(issueSets).flatMap(set=>[...set]));
  const j61ShaMap=new Map();for(const item of j61.cases||[]){const shas=unique([item.pdf?.sha256,...(item.pdf?.files||[]).map(f=>f.sha256)].filter(Boolean));for(const sha of shas){if(!j61ShaMap.has(sha))j61ShaMap.set(sha,[]);j61ShaMap.get(sha).push(item.groupId);}}
  const docReviewGroups=new Map();for(const row of live.rows)for(const f of row.files||[])for(const group of j61ShaMap.get(String(f.sha256||'').toLowerCase())||[]){if(!docReviewGroups.has(row.id))docReviewGroups.set(row.id,[]);docReviewGroups.get(row.id).push(group);}
  const sourceRows=live.rows;
  const salaAt=Date.now();
  const missingSala=missingSalaIds.map(id=>{
    const row=liveById.get(id)||{};const baseline=j7ById.get(id)||{};const refs=getRefs(row);const exts=extractionsByDoc.get(id)||[];const pages=getHeaderPages(exts);const sourceSala=[...namedValues(jsonObj(row.metadataOriginal),new Set(['chamber','sala','courtroom'])),...refs.flatMap(r=>namedValues(r.metadataOriginal,new Set(['chamber','sala','courtroom'])))];const evidence=salaEvidence(pages,sourceSala);
    const file=(row.files||[])[0]||{};const metaHash=hash(stable(jsonObj(row.metadataOriginal)));
    const j61ReviewGroups=docReviewGroups.get(id)||[];
    const safety=evidence.status==='UNRESOLVED'?'SOURCE_DATA_REQUIRED':evidence.status==='CONFLICT'||evidence.status==='PROBABLE'||j61ReviewGroups.length?'HUMAN_CONFIRMATION_REQUIRED':'AUTO_SAFE_DRY_RUN';
    return {documentId:id,currentSala:row.chamber||null,proposedSala:evidence.proposedSala,status:evidence.status,evidence:evidence.evidence.map(x=>({code:x.evidenceType,source:x.source,page:x.page,fileId:x.fileId||null,sala:x.sala})),sourceCodes:getSourceCodes(row),sourceRecords:refs.map(r=>({sourceCode:r.sourceCode,externalId:r.externalId,sourceReference:r.sourceReference,externalUrlHost:r.externalUrlHost})),decisionYear:row.decisionDate?new Date(row.decisionDate).getUTCFullYear():null,confidence:evidence.confidence,humanRequired:safety!=='AUTO_SAFE_DRY_RUN',classification:safety,preconditions:{currentSala:row.chamber||null,updatedAt:row.updatedAt,fileSha256:file.sha256||null,metadataOriginalHash:metaHash},sourceRecordCount:refs.length,alternateEvidence:baseline.alternateCaseReferences||[],j61ReviewGroups};
  });
  phase.salaMs=Date.now()-salaAt;
  const caseYearAt=Date.now();
  const caseYearAnalysis=invalidCaseIds.map(id=>{
    const row=liveById.get(id)||{};const baseline=j7ById.get(id)||{};const refs=getRefs(row);
    const sourceRefValues=refs.flatMap(r=>[r.sourceReference||'',...namedValues(r.metadataOriginal,new Set(['casenumber','docket','expediente','case_number']))]);
    const pages=getHeaderPages(extractionsByDoc.get(id)||[]);
    const headerRefs=pages.filter(p=>p.pageNumber<=3).flatMap(p=>extractCaseRefs(p.text.slice(0,5000)));
    const sourceRefs=sourceRefValues.flatMap(extractCaseRefs);
    const currentValue=row.caseNumber||row.docket;
    const currentCanonical=docket(currentValue);
    const currentBase=canonicalWithoutYear(currentValue);
    const sourceCanonicals=unique(sourceRefs.map(docket).filter(Boolean));
    const allHeaderCanonicals=unique(headerRefs.map(docket).filter(Boolean));
    // Only consider a first-page docket as a candidate for the current primary
    // identity when its number matches the Corpus number. Other numbered
    // references may be accumulated, related or cited matters.
    const matchingHeaderRefs=headerRefs.filter(ref=>currentBase&&canonicalWithoutYear(ref)===currentBase);
    const matchingHeaderCanonicals=unique(matchingHeaderRefs.map(docket).filter(Boolean));
    const matchingSourceRefs=sourceRefs.filter(ref=>currentBase&&canonicalWithoutYear(ref)===currentBase);
    const matchingSourceCanonicals=unique(matchingSourceRefs.map(docket).filter(Boolean));
    const relevantCanonicals=unique([...matchingSourceCanonicals,...matchingHeaderCanonicals]);
    const conflictingYears=matchingSourceCanonicals.length>1||matchingHeaderCanonicals.length>1||(
      matchingSourceCanonicals.length===1&&matchingHeaderCanonicals.length===1&&matchingSourceCanonicals[0]!==matchingHeaderCanonicals[0]
    );
    const cls=classifyCaseNumber(currentValue,sourceRefs,headerRefs);
    const file=(row.files||[])[0]||{};
    const conflict=conflictingYears;
    let classification=cls.kind;
    if(conflict)classification='SOURCE_OR_DOCUMENT_CASE_CONFLICT';
    else if(cls.kind==='MULTIPLE_CASES_OR_COMPOSITE_FIELD')classification='MULTI_CASE_MODEL_LIMITATION';
    else if(cls.kind==='LEGACY_NUMBER_NO_YEAR_CORROBORATED'||cls.kind==='LEGACY_NUMBER_NO_YEAR_SOURCE_MATCH')classification='PARSER_NORMALIZER_LIMITATION';
    else if(cls.kind==='FIELD_MISALIGNED_OR_LABEL')classification='FIELD_MISALIGNED_REVIEW';
    else if(relevantCanonicals.length>1)classification='MULTI_CASE_MODEL_LIMITATION';
    else if(relevantCanonicals.length===1&&matchingHeaderCanonicals.length===1)classification='PRIMARY_HEADER_CASE_CANDIDATE';
    const primaryCandidate=relevantCanonicals.length===1?relevantCanonicals[0]:null;
    const corroborated=Boolean(primaryCandidate&&matchingSourceCanonicals.includes(primaryCandidate)&&matchingHeaderCanonicals.includes(primaryCandidate));
    const j61ReviewGroups=docReviewGroups.get(id)||[];
    const fileShas=(row.files||[]).map(f=>String(f.sha256||'').toLowerCase());
    return {documentId:id,currentCaseNumber:currentValue||null,currentCaseYear:baseline.caseYear||null,sourceCaseRefs:unique(sourceRefs).slice(0,8),documentHeaderCaseRefs:unique(headerRefs).slice(0,8),unrelatedHeaderReferences:allHeaderCanonicals.filter(x=>!matchingHeaderCanonicals.includes(x)).slice(0,8),sourceRecords:refs.map(r=>({sourceCode:r.sourceCode,externalId:r.externalId,sourceReference:r.sourceReference,externalUrlHost:r.externalUrlHost})),proposedCanonicalCase:!conflict&&primaryCandidate&&(!currentCanonical||primaryCandidate!==currentCanonical)?primaryCandidate:null,proposedYear:primaryCandidate?.split('/')[1]||null,classification,parserLimitation:cls.parserLimitation,sourceCodes:getSourceCodes(row),decisionYear:row.decisionDate?new Date(row.decisionDate).getUTCFullYear():null,j6ShaMatches:fileShas.filter(sha=>j6IdentityShaSet.has(sha)),j5ShaMatches:fileShas.filter(sha=>j5IdentityShaSet.has(sha)),evidence:[...(sourceRefs.length?[{code:'SOURCE_REFERENCE_DOCKET',count:sourceRefs.length}]:[]),...(headerRefs.length?[{code:'FIRST_THREE_PAGE_LABELLED_DOCKET',count:headerRefs.length}]:[]),...(row.caseNumber?[{code:'CURRENT_CORPUS_VALUE'}]:[])],confidence:conflict?'CONFLICT':corroborated?'CONFIRMED':primaryCandidate?'PROBABLE':'UNRESOLVED',repairType:primaryCandidate&&!conflict?'METADATA_FIELD_UPDATE':cls.parserLimitation?'NORMALIZER_RULE_FIX':'NO_CHANGE',humanRequired:conflict||!corroborated||j61ReviewGroups.length>0,j61ReviewGroups,preconditions:{caseNumber:currentValue||null,updatedAt:row.updatedAt,fileSha256:file.sha256||null,metadataOriginalHash:hash(stable(jsonObj(row.metadataOriginal)))} };
  });
  phase.caseYearMs=Date.now()-caseYearAt;
  const sourceRecordAt=Date.now();
  const sourceRecordAnalysis=multiSourceGroups.flatMap(group=>{
    const fileRow=group.fileRows?.[0];const row=liveById.get(fileRow?.documentId);if(!row)return[{documentId:fileRow?.documentId||null,fileId:fileRow?.fileId||null,sha256:group.sha256,classification:'ERROR',reason:'LIVE_DOCUMENT_MISSING',sourceRecords:[]}];
    const records=(row.ingestions||[]).map(i=>({id:i.id,sourceCode:i.sourceCode,externalId:i.externalId||null,sourceReference:i.sourceReference||null,externalUrlHost:safeUrlHost(i.externalUrl),portalIdValues:namedValues(jsonObj(i.metadataOriginal),new Set(['portalid'])),legalMetadata:{caseNumbers:namedValues(jsonObj(i.metadataOriginal),new Set(['casenumber','case_number','docket','expediente'])).slice(0,8),dates:namedValues(jsonObj(i.metadataOriginal),new Set(['decisiondate','date','fecha'])).slice(0,4),chambers:namedValues(jsonObj(i.metadataOriginal),new Set(['chamber','sala','courtroom'])).slice(0,4)},metadataHash:hash(stable(jsonObj(i.metadataOriginal)))}));
    const c=classifyMultiSource(row.ingestions||[]);return[{documentId:row.id,fileId:fileRow.fileId,sha256:group.sha256,sourceRecords:records,classification:c.classification,sourceCodes:c.sourceCodes,duplicateIdentityCount:c.sameSourceIdentityCount||0,proposedAction:c.classification==='DUPLICATE_SOURCE_RECORD_CANDIDATE'?'PRESERVE_AND_REVIEW_DUPLICATE_PROVENANCE':'KEEP_ALL_PROVENANCE',writesApplied:0}];
  });
  phase.sourceRecordsMs=Date.now()-sourceRecordAt;
  const representationAt=Date.now();
  const shaToJ6=new Map();for(const x of [...j6Primary,...j6Multi]){const sha=String(x.sha||x.sha256||'').toLowerCase();if(!sha)continue;if(!shaToJ6.has(sha))shaToJ6.set(sha,[]);shaToJ6.get(sha).push(x);}
  const multiLegalAnalysis=multiLegalIds.map(id=>{const row=liveById.get(id)||{};const baseline=j7ById.get(id)||{};const files=(row.files||[]).map(f=>({fileId:f.id,sha256:f.sha256}));const matches=files.flatMap(f=>(shaToJ6.get(String(f.sha256||'').toLowerCase())||[]).map(x=>({sha256:f.sha256,groupId:x.groupId,classification:x.classification,proposedPrimaryCase:x.proposedPrimaryCase||null})));const j5Matches=files.flatMap(f=>(j5Graph.bySha||[]).filter(x=>String(x.sha256||x.sha||'').toLowerCase()===String(f.sha256||'').toLowerCase()).map(x=>({sha256:f.sha256,groupId:x.groupId||null,legalKeys:x.legalKeys||[],sourceRecordCount:x.counts?.sourceRecords||null})));const cases=unique([baseline.caseNumber,...(baseline.alternateCaseReferences||[])].filter(Boolean));const j6MultiMatch=matches.some(x=>/MULTI_CASE/u.test(x.classification||''));return{documentId:id,fileSha256s:files,j7CaseNumber:baseline.caseNumber||null,alternateReferences:baseline.alternateCaseReferences||[],candidateCases:cases,j6Matches:matches,j5Matches,classification:j6MultiMatch?'LEGITIMATE_MULTI_CASE_SINGLE_DECISION':'AMBIGUOUS',evidence:['J7_ALTERNATE_CASE_REFERENCES',...(matches.length?['J6_SHA_CROSSWALK']:[]),...(j5Matches.length?['J5_SHA_CROSSWALK']:[])],humanRequired:!j6MultiMatch,modelSupport:j6MultiMatch?'PARTIAL':'NO_AUTO_RESOLUTION'};});
  const multiDocAnalysis=oneDocManyCorpus.map(group=>{const docs=(group.documentIds||[]).map(id=>{const row=liveById.get(id)||{};return{documentId:id,titleHash:hash(String(row.title||'')),caseNumber:row.caseNumber||row.docket||null,decisionDate:dateOnly(row.decisionDate),court:row.court||null,chamber:row.chamber||null,files:(row.files||[]).map(f=>({fileId:f.id,sha256:f.sha256,sizeBytes:Number(f.sizeBytes),pageCount:Number(f.pageCount||0)})),sourceCodes:getSourceCodes(row),textHashes:(j7ById.get(id)?.files||[]).map(f=>f.textHash)};});const allShas=docs.flatMap(d=>d.files.map(f=>f.sha256));const sameBytes=allShas.length>1&&unique(allShas).length===1;const textHashes=docs.flatMap(d=>d.textHashes);const sameText=textHashes.length>1&&unique(textHashes).length===1;return{legalKey:group.legalKey,documents:docs,classification:sameBytes?'SAME_DECISION_DUPLICATE_BYTES':sameText?'SAME_DECISION_DIFFERENT_RENDER_CANDIDATE':'SAME_KEY_DIFFERENT_FILES_REVIEW',representations:sameBytes?'BYTE_IDENTICAL':sameText?'TEXT_IDENTICAL_DIFFERENT_BYTES':'CONTENT_REVIEW_REQUIRED',recommendedFutureAction:'KEEP_SEPARATE_UNTIL_HUMAN_LEGAL_REVIEW; CONSIDER ALTERNATE_REPRESENTATION_LINK',writes:0};});
  phase.representationsMs=Date.now()-representationAt;
  const pdfInfoTool=getAvailability('pdfinfo');
  const textRepresentationAnalysis=sameTextGroups.map((group,index)=>{const entries=group.entries.map(e=>{const row=liveById.get(e.documentId)||{};const file=(row.files||[]).find(f=>f.id===e.fileId)||{};const ext=(extractionsByDoc.get(e.documentId)||[]).filter(x=>x.fileId===e.fileId).sort((a,b)=>new Date(b.extractedAt||0)-new Date(a.extractedAt||0))[0];const pages=ext?.pages||[];let storageCheck={exists:false,shaMatchesDatabase:false};let filePath=null;try{filePath=safeStoragePath(file.storageKey);const bytes=fs.readFileSync(filePath);storageCheck={exists:true,actualSha256:hash(bytes),shaMatchesDatabase:hash(bytes)===String(file.sha256||'').toLowerCase(),bytes:bytes.length};}catch(error){storageCheck={exists:false,shaMatchesDatabase:false,error:error.code||'FILE_READ_ERROR'};}return{documentId:e.documentId,fileId:e.fileId,sha256:file.sha256||e.sha256,shaMatchJ7:String(file.sha256||'').toLowerCase()===String(e.sha256||'').toLowerCase(),storageCheck,normalizedTextHash:e.normalizedTextHash||group.normalizedTextHash,currentNormalizedTextHash:hash(norm(ext?.text||(pages||[]).map(p=>p.text||'').join('\n'))),textLength:e.textLength,caseNumber:row.caseNumber||row.docket||null,decisionDate:dateOnly(row.decisionDate),court:row.court||null,chamber:row.chamber||null,sourceCodes:getSourceCodes(row),pageCount:file.pageCount||null,sizeBytes:Number(file.sizeBytes)||null,mimeType:file.mimeType||null,extractionStatus:ext?.status||null,pdfMetadata:filePath?readPdfMetadata(filePath,pdfInfoTool):{available:false}};});const sameLegal=entries.every(e=>e.caseNumber===entries[0]?.caseNumber&&e.decisionDate===entries[0]?.decisionDate&&e.court===entries[0]?.court&&Boolean(e.caseNumber&&e.decisionDate));const samePdfProducer=entries.every(e=>e.pdfMetadata?.producer===entries[0]?.pdfMetadata?.producer);const currentHashMatches=entries.every(e=>e.currentNormalizedTextHash===e.normalizedTextHash);return{groupId:`text-${index+1}`,normalizedTextHash:group.normalizedTextHash,entries,sameCurrentTextHash:currentHashMatches,allStorageHashesMatch:entries.every(e=>e.storageCheck.shaMatchesDatabase),samePdfProducer,samePageCount:unique(entries.map(e=>e.pageCount)).length===1,sameLegalMetadata:sameLegal,classification:sameLegal?'SAME_DECISION_DIFFERENT_RENDER_CANDIDATE':entries.every(e=>e.sourceCodes.join('|')===entries[0]?.sourceCodes.join('|'))?'SAME_TEXT_DIFFERENT_METADATA_OR_GENERIC_COLLISION':'UNKNOWN',modelLimitation:true,humanRequired:true,proposedRelation:sameLegal?'ATTACH_ALTERNATE_REPRESENTATION':'NO_LINK_UNTIL_IDENTITY_EVIDENCE'};});
  const legalById=new Map();for(const x of j7Legal.groups){for(const id of x.documentIds||[])legalById.set(id,x);}
  const partialAnalysis=partialRows.map(p=>{const row=liveById.get(p.documentId)||{};const b=j7ById.get(p.documentId)||{};const flags=flagDocs.get(p.documentId)?.flags||[];const missing=[];if(!row.chamber&&!row.metadata?.courtNumber)missing.push('SALA');if(!docket(row.caseNumber||row.docket))missing.push('CASE_OR_YEAR');if(!row.court)missing.push('COURT');if(!row.decisionDate)missing.push('DATE');return{documentId:p.documentId,missingComponents:missing.length?missing:['LEGAL_KEY_INPUT_NOT_NORMALIZABLE'],hasMissingSala:missing.includes('SALA'),hasInvalidCaseYear:missing.includes('CASE_OR_YEAR'),j7Flags:flags,sourceCodes:getSourceCodes(row),year:row.decisionDate?new Date(row.decisionDate).getUTCFullYear():null,legalGroupState:legalById.get(p.documentId)?.state||'PARTIAL_LEGAL_KEY',classification:missing.length===1&&missing[0]==='SALA'?'SALA_COMPONENT_ONLY':missing.length===1&&missing[0]==='CASE_OR_YEAR'?'CASE_YEAR_COMPONENT_ONLY':missing.length>1?'MULTIPLE_MISSING_COMPONENTS':'OTHER'};});
  const ocrAt=Date.now();
  const tools={tesseract:getAvailability('tesseract'),pdftotext:getAvailability('pdftotext'),pdfinfo:getAvailability('pdfinfo'),mutool:getAvailability('mutool'),ghostscript:getAvailability('gs'),pdftoppm:getAvailability('pdftoppm')};
  const ocrDiagnoses=[];for(const id of unique([...ocrDocIds,...viewerMissing.map(x=>x.documentId)])){const row=liveById.get(id);if(!row)continue;const file=(row.files||[])[0];const ext=(extractionsByDoc.get(id)||[]).filter(x=>x.fileId===file?.id).sort((a,b)=>new Date(b.extractedAt||0)-new Date(a.extractedAt||0))[0];ocrDiagnoses.push(await diagnoseOcr(row,file||{},ext,tools));}
  phase.ocrViewerMs=Date.now()-ocrAt;
  const altRefs=invalidCaseIds.map(id=>({id,case:caseYearAnalysis.find(x=>x.documentId===id)})).filter(x=>x.case?.sourceCaseRefs?.length||x.case?.documentHeaderCaseRefs?.length);
  const alternativeRefs=multiLegalIds.map(id=>{const a=multiLegalAnalysis.find(x=>x.documentId===id);return{documentId:id,primaryCandidate:a?.j6Matches.find(m=>m.proposedPrimaryCase)?.proposedPrimaryCase||null,references:(a?.candidateCases||[]).map((value,index)=>({value,role:index===0?'PRIMARY':'UNKNOWN',evidence:index===0?'CURRENT_CORPUS_FIELD':'ALTERNATE_REFERENCE_REQUIRES_J6_REVIEW'})),j6Matches:a?.j6Matches||[],classification:a?.classification||'AMBIGUOUS'};});
  const salaCounts=by(missingSala,x=>x.status);const caseCounts=by(caseYearAnalysis,x=>x.classification);const sourceMultiCounts=by(sourceRecordAnalysis,x=>x.classification);const affectedCounts=Object.fromEntries(Object.entries(issueSets).map(([k,v])=>[k,v.size]));
  const unionList=[...unionIds].sort().map(id=>({documentId:id,issueTypes:Object.entries(issueSets).filter(([,set])=>set.has(id)).map(([k])=>k),sourceCodes:getSourceCodes(liveById.get(id)||{}),year:(liveById.get(id)?.decisionDate?new Date(liveById.get(id).decisionDate).getUTCFullYear():null)}));
  const overlap={issueCounts:affectedCounts,uniqueAffectedDocuments:unionIds.size,combinations:by(unionList,x=>x.issueTypes.sort().join('+')),salaAndInvalid:intersection(issueSets.MISSING_SALA,issueSets.INVALID_CASE_YEAR),salaAndPartial:intersection(issueSets.MISSING_SALA,issueSets.PARTIAL_LEGAL_KEY),invalidAndPartial:intersection(issueSets.INVALID_CASE_YEAR,issueSets.PARTIAL_LEGAL_KEY),allThree:intersection(issueSets.MISSING_SALA,issueSets.INVALID_CASE_YEAR,issueSets.PARTIAL_LEGAL_KEY)};
  const j6MatchGroupIds=new Set(j6Primary.map(x=>x.groupId));const j61Ids=docReviewGroups;
  const repairPlanAt=Date.now();
  const operations=[];
  for(const item of missingSala){if(item.proposedSala){const sourceProposal=[...p1Rows,...p2Rows].find(x=>x.documentId===item.documentId&&/SALA|CHAMBER/iu.test(x.flag||''));operations.push({...repairOperation({targetType:'CorpusDocument',targetId:item.documentId,field:'chamber',currentValue:null,proposedValue:item.proposedSala,repairType:'METADATA_FIELD_UPDATE',evidence:item.evidence,confidence:item.confidence,safetyClass:item.classification,updatedAt:item.preconditions.updatedAt,fileSha256:item.preconditions.fileSha256,fileSha256s:(liveById.get(item.documentId)?.files||[]).map(f=>f.sha256).filter(Boolean),metadataHash:item.preconditions.metadataOriginalHash,collisionRisk:item.status==='CONFLICT'?'Conflicting Sala evidence; do not apply.':'Possible source/document identity collision; revalidate source and header evidence.',searchReindexRequired:true,coverageRecalculationRequired:true,j6ReviewImpact:item.j61ReviewGroups.length?'INVALIDATES':'NONE',humanRequired:item.humanRequired,modelSupport:'YES'}),priority:sourceProposal?.priority||'P2'});}}
  for(const item of caseYearAnalysis){if(item.proposedCanonicalCase){const sourceProposal=[...p1Rows,...p2Rows].find(x=>x.documentId===item.documentId&&/CASE|YEAR|LEGAL/iu.test(x.flag||''));operations.push({...repairOperation({targetType:'CorpusDocument',targetId:item.documentId,field:'caseNumber',currentValue:item.currentCaseNumber,proposedValue:item.proposedCanonicalCase,repairType:'METADATA_FIELD_UPDATE',evidence:item.evidence,confidence:item.confidence,safetyClass:item.humanRequired?'HUMAN_CONFIRMATION_REQUIRED':'AUTO_SAFE_DRY_RUN',updatedAt:item.preconditions.updatedAt,fileSha256:item.preconditions.fileSha256,fileSha256s:(liveById.get(item.documentId)?.files||[]).map(f=>f.sha256).filter(Boolean),metadataHash:item.preconditions.metadataOriginalHash,collisionRisk:item.classification==='MULTI_CASE_MODEL_LIMITATION'?'Multiple plausible legal identities; scalar model cannot resolve safely.':'Source/document docket alignment must be revalidated.',searchReindexRequired:true,coverageRecalculationRequired:true,j6ReviewImpact:item.j61ReviewGroups.length?'INVALIDATES':'NONE',humanRequired:item.humanRequired,modelSupport:'YES'}),priority:sourceProposal?.priority||'P2'});}}
  const repairPlan=operations.map(op=>{const doc=liveById.get(op.targetId)||{};return{...op,priority:op.priority||'P2',source:getSourceCodes(doc).join('|'),year:doc.decisionDate?new Date(doc.decisionDate).getUTCFullYear():null,currentSala:doc.chamber||null,proposedSala:op.field==='chamber'?op.proposedValue:null,applied:false};});
  const safetyCounts=by(repairPlan,x=>x.safetyClass);
  phase.repairPlanMs=Date.now()-repairPlanAt;
  const simulationAt=Date.now();
  const safeOverrides=new Map();for(const op of repairPlan.filter(x=>x.safetyClass==='AUTO_SAFE_DRY_RUN')){const prior=safeOverrides.get(op.targetId)||{};prior[op.field==='chamber'?'chamber':'caseNumber']='PRESENT';safeOverrides.set(op.targetId,prior);}
  const humanOverrides=new Map(safeOverrides);for(const op of repairPlan.filter(x=>x.safetyClass==='HUMAN_CONFIRMATION_REQUIRED')){const prior=humanOverrides.get(op.targetId)||{};prior[op.field==='chamber'?'chamber':'caseNumber']='PRESENT';humanOverrides.set(op.targetId,prior);}
  const currentQuality=qualityCounts(j7Rows);const afterSafe=qualityCounts(j7Rows,safeOverrides);const afterHuman=qualityCounts(j7Rows,humanOverrides);
  const normalizerOverrides=new Map();for(const item of caseYearAnalysis.filter(x=>x.classification==='PARSER_NORMALIZER_LIMITATION'))normalizerOverrides.set(item.documentId,{caseNumber:'PRESENT'});
  const afterNormalizer=qualityCounts(j7Rows,normalizerOverrides);
  const beforePartial=partialRows.length;const safeCaseDocs=new Set(repairPlan.filter(x=>x.safetyClass==='AUTO_SAFE_DRY_RUN'&&x.field==='caseNumber').map(x=>x.targetId));const safeSalaDocs=new Set(repairPlan.filter(x=>x.safetyClass==='AUTO_SAFE_DRY_RUN'&&x.field==='chamber').map(x=>x.targetId));
  const legalKeyAfterSafe=Math.max(0,beforePartial-[...partialRows].filter(x=>safeSalaDocs.has(x.documentId)||safeCaseDocs.has(x.documentId)).length);
  const legalKeyAfterHuman=Math.max(0,beforePartial-[...partialRows].filter(x=>safeSalaDocs.has(x.documentId)||safeCaseDocs.has(x.documentId)||repairPlan.some(o=>o.safetyClass==='HUMAN_CONFIRMATION_REQUIRED'&&o.targetId===x.documentId)).length);
  const proposedTargets=new Set(repairPlan.map(x=>x.targetId));
  const j61Affected=[...docReviewGroups.entries()].filter(([documentId])=>proposedTargets.has(documentId)).map(([documentId,groups])=>({documentId,groups:unique(groups),repairOperations:repairPlan.filter(x=>x.targetId===documentId).map(x=>x.operationId)}));
  const qualitySimulation={current:currentQuality,afterAutoSafeHypothetical:afterSafe,afterAllHumanConfirmedHypothetical:afterHuman,afterNormalizerRuleOnlyHypothetical:afterNormalizer,assumptions:{j7QualityCompletenessWeightsRecomputedInMemory:true,filesAndProvenanceUnchanged:true,ocrNotApplied:true,autoSafeOperations:repairPlan.filter(x=>x.safetyClass==='AUTO_SAFE_DRY_RUN').length,humanScenarioDoesNotIncludeModelLimitations:true},persisted:false};
  const legalKeySimulation={partialBefore:beforePartial,afterAutoSafeHypothetical:legalKeyAfterSafe,reduction:beforePartial-legalKeyAfterSafe,afterAllHumanConfirmedHypothetical:legalKeyAfterHuman,normalizerOnlyPartialAfter:beforePartial,normalizerOnlyChangesLegalKey:false,persisted:false};
  const searchImpact={documentsThatWouldRequireIndividualReindex:unique(repairPlan.filter(x=>x.postconditions.searchReindexRequired).map(x=>x.targetId)).length,globalRebuild:'NOT_REQUIRED',currentCivilDocuments:j7Summary.metrics.search.ok,currentCivilTokens:j7Summary.metrics.search.tokenCount,stale:0,missing:0,metadataParity:'NOT_SEPARATELY_REPRESENTED_IN_TOKEN_PROJECTION',writes:0};
  const j61Impact={humanUatStatus:'UNCHANGED — READY FOR HUMAN UAT',inputHash:j61Hash.reviewInputHash,reviewable:j61Hash.caseCount,sample:20,casesAffectedByProposedRepairs:j61Affected,affectedCount:j61Affected.length,wouldReviewPackBecomeStaleAfterFutureApplication:j61Affected.length?'YES':'NO',humanDecisionsCreated:0};
  const p1Analysis={inputExpected:EXPECTED.p1,proposals:p1Rows.map(x=>{const isMulti=x.flag==='MULTIPLE_LEGAL_KEYS';const evidence=isMulti?multiLegalAnalysis.find(c=>c.documentId===x.documentId):missingSala.find(c=>c.documentId===x.documentId)||caseYearAnalysis.find(c=>c.documentId===x.documentId);const safety=isMulti?'MODEL_LIMITATION':'UNRESOLVED';return{documentId:x.documentId,flag:x.flag,action:x.action,priority:x.priority,sourceCodes:getSourceCodes(liveById.get(x.documentId)||{}),fileIds:(liveById.get(x.documentId)?.files||[]).map(f=>f.id),evidence,risk:isMulti?'Primary, accumulated and cited case identity is not represented safely by a scalar caseNumber; J6 SHA crosswalk did not resolve this file.':'Historical source may omit Sala; no case-by-case source value is available.',modelSupport:isMulti?'PARTIAL':'YES',safetyClass:safety,humanRequired:isMulti};}),summary:by(p1Rows,x=>x.flag),safetyCategories:{P1_AUTO_SAFE_DRY_RUN:0,P1_HUMAN_REQUIRED:0,P1_MODEL_LIMITATION:p1Rows.filter(x=>x.flag==='MULTIPLE_LEGAL_KEYS').length,P1_UNRESOLVED:p1Rows.filter(x=>x.flag!=='MULTIPLE_LEGAL_KEYS').length},noAutomaticRepairs:true};
  const p2Analysis={inputExpected:EXPECTED.p2,groups:Object.entries(by(p2Rows,x=>`${x.flag}|${x.action}`)).map(([rule,count])=>({rule,count,batchSafeCandidate:false,classification:'UNRESOLVED',batchability:'UNRESOLVED',reason:'A uniform source-backed Sala value is not established. Applying one rule to all historical records would invent metadata.'})),individualReview:0,noChange:0,unresolved:p2Rows.length,batchSafeCandidates:0};
  const issueIdsBySource=source=>new Set(sourceRows.filter(r=>getSourceCodes(r).includes(source)).map(r=>r.id));
  const sourcePatternRows=['CIVIL_CUANTIFICACION_DANOS','CSJN_TFN_HISTORICAL','TFN_ACTUAL_CIVIL'].map(source=>{const docs=sourceRows.filter(x=>getSourceCodes(x).includes(source));const ids=issueIdsBySource(source);const sourceMissingSala=missingSala.filter(x=>ids.has(x.documentId));const sourceInvalid=caseYearAnalysis.filter(x=>ids.has(x.documentId));const sourcePartial=partialRows.filter(p=>ids.has(p.documentId));const sourceViewer=viewerMissing.filter(x=>ids.has(x.documentId));const sourceOcr=ocrDocIds.filter(id=>ids.has(id));return{source,documents:docs.length,qualityBands:by(docs,x=>j7ById.get(x.id)?.band||'UNKNOWN'),missingSala:sourceMissingSala.length,missingSalaYearDistribution:by(sourceMissingSala,x=>String(x.decisionYear||'UNKNOWN')),invalidCaseYear:sourceInvalid.length,invalidCaseYearYearDistribution:by(sourceInvalid,x=>String(x.decisionYear||'UNKNOWN')),invalidCaseYearClassifications:by(sourceInvalid,x=>x.classification),partialLegalKey:sourcePartial.length,viewerTextMissing:sourceViewer.length,ocrCandidates:sourceOcr.length,sourceRecords:docs.reduce((n,x)=>n+(x.ingestions||[]).length,0),repairPattern:source==='CSJN_TFN_HISTORICAL'?'Check exact overlap and record fields: flid is retained in provenance, while an expediente without year is not proven incorrect.':'No uniform evidence-derived bulk rule established.'};});
  const portalRows=sourceRows.map(row=>{const refs=row.ingestions||[];const hasExplicitPortal=refs.some(r=>Object.entries(jsonObj(r.metadataOriginal)).some(([k,v])=>/portalid/iu.test(k)&&v)||r.portalId);const hasFlid=refs.some(r=>/\bflid\s*=\s*\d+/iu.test(r.sourceReference||'')||/historical:\d+/iu.test(r.externalId||''));return{documentId:row.id,sourceCodes:getSourceCodes(row),classification:hasExplicitPortal?'AVAILABLE_IN_RAW_PROVENANCE':hasFlid?'RECOVERABLE':'MODEL_FIELD_UNUSED',evidence:hasExplicitPortal?'Explicit raw source metadata':hasFlid?'Stable historical source reference contains flid':'Source identity exists, but no portalId contract/value is modeled'};});
  const portalSummary=by(portalRows,x=>x.classification);
  const classificationCounts={...safetyCounts};for(const key of ['AUTO_SAFE_DRY_RUN','HUMAN_CONFIRMATION_REQUIRED','SOURCE_DATA_REQUIRED','MODEL_LIMITATION','NO_CHANGE_REQUIRED','UNRESOLVED'])classificationCounts[key]??=0;
  const fileHashes=live.rows.flatMap(x=>(x.files||[]).map(f=>f.sha256)).filter(Boolean).sort();
  const inputHash=hash(stable({toolVersion:TOOL_VERSION,gitSha:require('node:child_process').execFileSync('git',['rev-parse','HEAD'],{cwd:ROOT,encoding:'utf8'}).trim(),sentinel:live.sentinel,liveProjectionHash:baselineProjection.liveProjectionHash,filesHash:hash(stable(fileHashes)),j7InventoryHash:j7Summary.outputHashes.inventory,j61Hash:j61Hash.reviewInputHash}));
  const repairPlanHash=hash(stable(repairPlan));
  const priorPlanHash=priorDeterminism?.toolVersion===TOOL_VERSION?(priorDeterminism.repairPlanHashRun2||priorDeterminism.repairPlanHashRun1||null):null;
  const determinismCompared=Boolean(priorPlanHash);
  const deterministicPass=determinismCompared&&priorPlanHash===repairPlanHash;
  const determinismArtifact={toolVersion:TOOL_VERSION,inputHash,repairPlanHash,repairPlanHashRun1:priorDeterminism?.toolVersion===TOOL_VERSION?(priorDeterminism.repairPlanHashRun1||priorPlanHash):repairPlanHash,repairPlanHashRun2:repairPlanHash,baselineCompared:determinismCompared,pass:deterministicPass,timestampsExcluded:true};
  const beforeSentinel={identity:live.identity,counts:live.sentinel,civilDocuments:live.rows.length,privateDocumentsExcluded:0,transactionReadOnly:true};
  const beforePath=path.join(WORK,'write-sentinel-before.json');fs.writeFileSync(beforePath,`${JSON.stringify(beforeSentinel,null,2)}\n`,'utf8');
  const beforeSecond=Date.now();const sentinelAfter=await readSentinel();phase.sentinelAfterMs=Date.now()-beforeSecond;
  const sentinelEqual=stable(live.sentinel)===stable(sentinelAfter);
  const afterSentinel={identity:live.identity,counts:sentinelAfter,civilDocuments:live.rows.length,privateDocumentsExcluded:0,transactionReadOnly:true};
  fs.writeFileSync(path.join(WORK,'write-sentinel-after.json'),`${JSON.stringify(afterSentinel,null,2)}\n`,'utf8');
  const zeroWrite={transactionReadOnly:true,insert:0,update:0,delete:0,ddl:0,storageWrites:0,searchRebuilds:0,verifiedAtChanged:sentinelAfter.searchVerifiedAt!==live.sentinel.searchVerifiedAt,sentinelsEqual:sentinelEqual,corpusCountsMatch:['documents','files','pages','ingestions','extractions'].every(k=>String(live.sentinel[k])===String(sentinelAfter[k])),searchCountsMatch:live.sentinel.searchDocuments===sentinelAfter.searchDocuments&&live.sentinel.searchTokens===sentinelAfter.searchTokens,timestampsMatch:stable(live.sentinel)===stable(sentinelAfter)};
  phase.simulationMs=Date.now()-simulationAt;
  const errorLedger=[];
  for(const documentId of unionIds){
    if(!j7ById.has(documentId))errorLedger.push({documentId,stage:'J7_RECONCILIATION',code:'J7_BASELINE_ROW_MISSING'});
    const row=liveById.get(documentId);
    if(!row)errorLedger.push({documentId,stage:'LIVE_RECONCILIATION',code:'LIVE_DOCUMENT_MISSING'});
    else if(!(row.files||[]).length)errorLedger.push({documentId,stage:'LIVE_RECONCILIATION',code:'LIVE_FILE_MISSING'});
  }
  const summary={toolVersion:TOOL_VERSION,status:zeroWrite.sentinelsEqual&&zeroWrite.corpusCountsMatch&&zeroWrite.searchCountsMatch&&zeroWrite.timestampsMatch?'READ_ONLY_PASS':'PARTIAL_SENTINEL_MISMATCH',generatedAt:new Date().toISOString(),gitSha:inputHash?require('node:child_process').execFileSync('git',['rev-parse','HEAD'],{cwd:ROOT,encoding:'utf8'}).trim():null,databaseIdentity:live.identity,snapshotChanged,j7InputReconciled:{baselineInventoryHashPass:baselineHashCheck,civilRows:live.rows.length,expectedCivilRows:EXPECTED.civil,j7CoreFieldsAndFilesChanged:coreChanges.length,j7CoreChangeSamples:coreChanges.slice(0,40),sentinelMatchesJ7:sentinelCoreSame,match:!snapshotChanged},counts:{missingSala:missingSala.length,invalidCaseYear:caseYearAnalysis.length,p1:p1Rows.length,p2:p2Rows.length,sameTextGroups:sameTextGroups.length,sameTextFiles:sameTextGroups.reduce((n,g)=>n+g.entries.length,0),multiSourceFiles:multiSourceGroups.length,multipleLegalKeyDocuments:multiLegalIds.length,multiDocumentLegalDecisionGroups:oneDocManyCorpus.length,ocrCandidates:ocrDocIds.length,viewerTextMissing:viewerMissing.length,alternativeReferences:multiLegalIds.reduce((n,id)=>n+(j7ById.get(id)?.alternateCaseReferences||[]).length,0),partialLegalKeys:partialRows.length,uniqueAffectedDocuments:unionIds.size},inputHash,repairPlanHash,j7BaselineHash:j7Summary.outputHashes.inventory,j61InputHash:j61Hash.reviewInputHash,errors:errorLedger,zeroWrite};
  const artifacts={repairPlan};
  const outputs={
    'snapshot.json':{identity:live.identity,before:live.sentinel,after:sentinelAfter,j7Baseline:j7Summary.zeroWrite.after,snapshotChanged,j7CoreChangeCount:coreChanges.length,baselineInventoryHashPass:baselineHashCheck,match:!snapshotChanged},
    'input-hashes.json':{inputHash,liveProjectionHash:baselineProjection.liveProjectionHash,filesShaSetHash:hash(stable(fileHashes)),j7InventoryLogicalHash:j7Summary.outputHashes.inventory,j7InventoryPersistedFileHash:baselineInventoryFileHash,j7InventoryStableFromSerializedJson:false,j7DeterminismRecordedPass:j7Determinism.pass,j7SummaryHash:j7Summary.outputHashes.summary,j61ReviewInputHash:j61Hash.reviewInputHash,gitSha:summary.gitSha},
    'affected-document-union.json':{issueCounts:affectedCounts,uniqueAffectedDocuments:unionIds.size,combinations:overlap.combinations,documents:unionList},
    'quality-overlap.json':overlap,
    'missing-sala-analysis.json':{expected:EXPECTED.missingSala,processed:missingSala.length,counts:salaCounts,sourceDistribution:by(missingSala,x=>x.sourceCodes.join('|')),yearDistribution:by(missingSala,x=>String(x.decisionYear||'UNKNOWN')),rows:missingSala,autoSafe:missingSala.filter(x=>x.classification==='AUTO_SAFE_DRY_RUN').length,humanRequired:missingSala.filter(x=>x.humanRequired).length,notApplicable:missingSala.filter(x=>x.status==='NOT_APPLICABLE').length,conflicting:missingSala.filter(x=>x.status==='CONFLICT').length,unresolved:missingSala.filter(x=>x.status==='UNRESOLVED').length,writes:0},
    'case-year-analysis.json':{expected:EXPECTED.invalidCase,processed:caseYearAnalysis.length,counts:caseCounts,sourceDistribution:by(caseYearAnalysis,x=>x.sourceCodes.join('|')),yearDistribution:by(caseYearAnalysis,x=>String(x.decisionYear||'UNKNOWN')),taxonomy:{dataActuallyWrong:0,parserNormalizerLimitation:caseYearAnalysis.filter(x=>x.classification==='PARSER_NORMALIZER_LIMITATION').length,multiCaseModelLimitation:caseYearAnalysis.filter(x=>x.classification==='MULTI_CASE_MODEL_LIMITATION').length,confirmedRecoverable:caseYearAnalysis.filter(x=>x.proposedCanonicalCase&&!x.humanRequired).length,probableRecoverable:caseYearAnalysis.filter(x=>x.proposedCanonicalCase&&x.humanRequired).length,conflicting:caseYearAnalysis.filter(x=>x.classification==='SOURCE_OR_DOCUMENT_CASE_CONFLICT').length,fieldMisaligned:caseYearAnalysis.filter(x=>x.classification==='FIELD_MISALIGNED_REVIEW').length,malformedOrUnknown:caseYearAnalysis.filter(x=>x.classification==='MALFORMED_OR_UNRECOGNIZED').length,unresolved:caseYearAnalysis.filter(x=>['FIELD_MISALIGNED_REVIEW','MALFORMED_OR_UNRECOGNIZED'].includes(x.classification)).length,total:caseYearAnalysis.length},rows:caseYearAnalysis,confirmedRecoverable:caseYearAnalysis.filter(x=>x.proposedCanonicalCase&&!x.humanRequired).length,probable:caseYearAnalysis.filter(x=>x.proposedCanonicalCase&&x.humanRequired).length,conflicting:caseYearAnalysis.filter(x=>x.classification==='SOURCE_OR_DOCUMENT_CASE_CONFLICT').length,unresolved:caseYearAnalysis.filter(x=>['FIELD_MISALIGNED_REVIEW','MALFORMED_OR_UNRECOGNIZED'].includes(x.classification)).length,writes:0},
    'p1-analysis.json':p1Analysis,'p2-analysis.json':p2Analysis,
    'same-text-representations.json':{expectedGroups:12,groups:sameTextGroups.length,expectedFiles:25,files:textRepresentationAnalysis.reduce((n,g)=>n+g.entries.length,0),rows:textRepresentationAnalysis,classificationCounts:by(textRepresentationAnalysis,x=>x.classification),sameCurrentTextHash:textRepresentationAnalysis.filter(x=>x.sameCurrentTextHash).length},
    'multi-source-record-analysis.json':{expectedFiles:341,files:sourceRecordAnalysis.length,counts:sourceMultiCounts,sourceRecordCount:sourceRecordAnalysis.reduce((n,x)=>n+x.sourceRecords.length,0),duplicateShaFiles:j7Sha.groups.filter(g=>g.kinds?.includes('DUPLICATE_SHA')).length,interpretation:'341 files have multiple ingestion provenance records; this is not 341 duplicate files. J7 found zero duplicate-SHA file groups.',rows:sourceRecordAnalysis,proposedRemovalsApplied:0},
    'multiple-legal-keys-analysis.json':{expectedFlags:4,rows:multiLegalAnalysis,counts:by(multiLegalAnalysis,x=>x.classification),j6PrimaryRows:j6Primary.length,j6MultiCaseRows:j6Multi.length,j5ShaEvidenceRows:Array.isArray(j5Graph.bySha)?j5Graph.bySha.length:0},
    'multi-document-legal-decision-analysis.json':{expectedGroups:1,groups:multiDocAnalysis,writes:0},
    'ocr-candidate-diagnosis.json':{expectedCandidates:1,tools:Object.fromEntries(Object.entries(tools).map(([name,item])=>[name,{available:item.available,version:item.version||null}])),diagnoses:ocrDiagnoses.map(({ocrTooling,...x})=>({...x,ocrTooling:Object.fromEntries(Object.entries(ocrTooling||{}).map(([name,item])=>[name,{available:item.available,version:item.version||null}]))})),diagnosticOcrExecuted:ocrDiagnoses.some(x=>x.diagnosticOcrExecuted),corpusWrites:0},
    'viewer-text-missing-diagnosis.json':{expectedDocuments:1,documents:ocrDiagnoses.map(({ocrTooling,...x})=>({...x,ocrTooling:Object.fromEntries(Object.entries(ocrTooling||{}).map(([name,item])=>[name,{available:item.available,version:item.version||null}])),viewerState:'TEXT_MISSING',rootCause:x.result==='IMAGE_ONLY_PDF_CONFIRMED'?'OCR_REQUIRED':x.result==='EXTRACTION_FAILURE_OR_PAGE_TEXT_GAP'?'EXTRACTION_FAILURE':'UNKNOWN',futureRepair:x.futureAction})),writes:0},
    'alternative-legal-references.json':{expectedCases:4,rows:alternativeRefs,roleCounts:by(alternativeRefs.flatMap(x=>x.references||[]),x=>x.role)},
    'partial-legal-key-analysis.json':{expected:1256,processed:partialAnalysis.length,counts:by(partialAnalysis,x=>x.classification),rows:partialAnalysis},
    'portal-id-analysis.json':{missingByJ7:6070,classificationCounts:portalSummary,explicitPortalIdPresent:sourceRows.filter(x=>(x.ingestions||[]).some(r=>Object.keys(jsonObj(r.metadataOriginal)).some(k=>/portalid/iu.test(k)))).length,sourceRecordIdPresent:sourceRows.filter(x=>(x.ingestions||[]).some(r=>r.externalId||r.sourceReference)).length,contractRequirement:'OPTIONAL_OR_SOURCE_SPECIFIC; provenance contract is satisfied by stable source record/external identity; no universal portalId contract found in J7 fields',rows:portalRows},
    'source-patterns.json':{sources:sourcePatternRows,missingSalaOverlap:{missingSalaTotal:missingSala.length,historicalSourceTotal:sourceRows.filter(x=>getSourceCodes(x).includes('CSJN_TFN_HISTORICAL')).length,intersection:missingSala.filter(x=>getSourceCodes(liveById.get(x.documentId)||{}).includes('CSJN_TFN_HISTORICAL')).length,exactSetMatch:missingSala.length===sourceRows.filter(x=>getSourceCodes(x).includes('CSJN_TFN_HISTORICAL')).length&&missingSala.every(x=>getSourceCodes(liveById.get(x.documentId)||{}).includes('CSJN_TFN_HISTORICAL'))},invalidCaseYearBySource:by(caseYearAnalysis,x=>x.sourceCodes.join('|')),invalidCaseYearByDecisionYear:by(caseYearAnalysis,x=>String(x.decisionYear||'UNKNOWN')),missingSalaByDecisionYear:by(missingSala,x=>String(x.decisionYear||'UNKNOWN')),limitations:'Snapshot-specific source pattern analysis; no global Civil coverage inference.'},
    'repair-plan.json':{mission:'J7.1 DRY RUN ONLY — no apply path',inputHash,repairPlanHash,operations:repairPlan,counts:{operations:repairPlan.length,safety:classificationCounts,byType:by(repairPlan,x=>x.repairType),priority:by(repairPlan,x=>x.priority)},writeCapability:false},
    'repair-plan.csv':csv(['operationId','targetType','targetId','priority','field','currentValue','proposedValue','repairType','confidence','safetyClass','collisionRisk','humanRequired','expectedUpdatedAt','expectedFileSha256','expectedFileSha256s','expectedMetadataHash','searchReindexRequired','coverageRecalculationRequired','j6ReviewImpact','modelSupport','applied'],repairPlan.map(x=>[x.operationId,x.targetType,x.targetId,x.priority,x.field,x.currentValue,x.proposedValue,x.repairType,x.confidence,x.safetyClass,x.collisionRisk,x.humanRequired,x.preconditions.expectedUpdatedAt,x.preconditions.expectedFileSha256,JSON.stringify(x.preconditions.expectedFileSha256s),x.preconditions.expectedMetadataHash,x.postconditions.searchReindexRequired,x.postconditions.coverageRecalculationRequired,x.j6ReviewImpact,x.modelSupport,x.applied])),
    'repair-preview.sql':`-- DRY RUN ONLY\n-- DO NOT EXECUTE\n-- Generated from J7.1\n-- Snapshot hash: ${inputHash}\n-- No SQL command is executable in this preview; the tool has no write path.\n-- Any future application must re-check current value, updatedAt, file SHA, metadata hash, J6.1 impact, and approval.\n-- Proposed operations: ${repairPlan.length}\n-- Conceptual transaction boundary only: BEGIN; ... ROLLBACK;\n`,
    'quality-impact-simulation.json':qualitySimulation,'legal-key-impact-simulation.json':legalKeySimulation,'search-impact-simulation.json':searchImpact,'j61-impact.json':j61Impact,
    'performance.json':{},'determinism.json':{},'final-summary.json':{},'audit-errors.json':errorLedger,
  };
  const checks={
    'expected_missing_sala':missingSala.length===EXPECTED.missingSala,'expected_invalid_case_year':caseYearAnalysis.length===EXPECTED.invalidCase,'expected_p1':p1Rows.length===EXPECTED.p1,'expected_p2':p2Rows.length===EXPECTED.p2,'expected_same_text_groups':sameTextGroups.length===EXPECTED.sameText,'expected_multi_source_files':multiSourceGroups.length===EXPECTED.multiSource,'expected_multiple_legal_keys':multiLegalIds.length===EXPECTED.multiLegal,'expected_partial_legal_keys':partialRows.length===EXPECTED.partial,'expected_ocr_candidate':ocrDocIds.length===1,'expected_viewer_text_missing':viewerMissing.length===1,'j61_hash_unchanged':j61Hash.reviewInputHash===J61_HASH,'j7_snapshot_core_match':!snapshotChanged,'determinism_compared_pass':deterministicPass,'audit_error_ledger_empty':errorLedger.length===0,'zero_write_sentinels':Object.values(zeroWrite).slice(1).every(v=>v===0||v===false||v===true)&&zeroWrite.transactionReadOnly&&zeroWrite.sentinelsEqual&&zeroWrite.corpusCountsMatch&&zeroWrite.searchCountsMatch&&zeroWrite.timestampsMatch&&!zeroWrite.verifiedAtChanged,
  };
  summary.checks=checks;summary.requiredInputReconciled=Object.values(checks).every(Boolean);summary.repairPlanCounts={operations:repairPlan.length,bySafety:classificationCounts,byType:by(repairPlan,x=>x.repairType)};summary.qualitySimulation=qualitySimulation;summary.legalKeySimulation=legalKeySimulation;summary.searchImpact=searchImpact;summary.j61AffectedCount=j61Affected.length;summary.sections=[
    {title:'Executive summary',detail:`${live.rows.length} local Civil documents reconciled; ${unionIds.size} unique documents appear in issue sets; ${repairPlan.length} evidence-backed field proposals; no writes.`},
    {title:'Sala recovery',detail:`${salaCounts.CONFIRMED_RECOVERABLE||0} confirmed, ${salaCounts.PROBABLE||0} probable, ${salaCounts.CONFLICT||0} conflicting, ${salaCounts.UNRESOLVED||0} unresolved; ${missingSala.length} missing-Sala records analyzed.`},
    {title:'Case/year recovery',detail:`${caseCounts.PARSER_NORMALIZER_LIMITATION||0} legacy/parser limitations; ${caseCounts.MULTI_CASE_MODEL_LIMITATION||0} multi-case model limitation; ${caseCounts.FIELD_MISALIGNED_REVIEW||0} field review; ${caseCounts.MALFORMED_OR_UNRECOGNIZED||0} malformed/unrecognized. No value was changed.`},
    {title:'P1 and P2',detail:`P1: ${p1Rows.length} original proposals across ${Object.keys(p1Analysis.summary).length} flags; P2: ${p2Rows.length}, all unresolved from a batch-safety standpoint; no batch updates proposed.`},
    {title:'Representations and provenance',detail:`${sameTextGroups.length} identical-text/different-SHA groups; ${sourceRecordAnalysis.length} multi-provenance files retained; J7 reported zero duplicate-SHA file groups.`},
    {title:'Legal identity',detail:`${multiLegalIds.length} multiple-key cases remain ambiguous after J5/J6 SHA crosswalk; ${oneDocManyCorpus.length} one-decision/multiple-document group kept separate pending legal review.`},
    {title:'OCR and Viewer',detail:`The one OCR candidate is also the one TEXT_MISSING document; its PDF is valid, all ${ocrDiagnoses[0]?.dbPageCount||0} page rows have empty text, search tokens are ${ocrDiagnoses[0]?.searchTokenCount||0}; OCR CLI is unavailable and was not run.`},
    {title:'Quality and safety',detail:`Quality bands remain hypothetical; auto-safe-only gives ${JSON.stringify(afterSafe)}. J6.1 affected proposals: ${j61Affected.length}. Strict read-only sentinels: ${zeroWrite.sentinelsEqual?'match':'mismatch'}.`},
  ];summary.performance={...phase,totalMs:Date.now()-started};summary.status=summary.status==='READ_ONLY_PASS'&&summary.requiredInputReconciled?'READ_ONLY_PASS':'PARTIAL';
  outputs['performance.json']=summary.performance;outputs['determinism.json']=determinismArtifact;outputs['final-summary.json']=summary;
  const reportStart=Date.now();
  outputs['repair-dry-run-report.html']=htmlReport(summary,{repairPlan});
  phase.reportMs=Date.now()-reportStart;summary.performance={...phase,totalMs:Date.now()-started};outputs['performance.json']=summary.performance;outputs['final-summary.json']=summary;
  for(const [name,value] of Object.entries(outputs)){const destination=path.join(WORK,name);if(name.endsWith('.sql')||name.endsWith('.csv')||name.endsWith('.html'))fs.writeFileSync(destination,String(value),'utf8');else writeJson(name,value);}
  process.stdout.write(`${JSON.stringify({status:summary.status,processed:live.rows.length,snapshotChanged,counts:summary.counts,classificationCounts,qualitySimulation,legalKeySimulation,zeroWrite,checks,hashes:{inputHash,repairPlanHash},performance:summary.performance},null,2)}\n`);
}
function intersection(...sets) { if(!sets.length)return 0;return [...sets[0]].filter(value=>sets.slice(1).every(s=>s.has(value))).length; }
function csv(headers, rows) { const cell=x=>{const s=String(x??'');return /[",\r\n]/u.test(s)?`"${s.replace(/"/gu,'""')}"`:s;};return `${[headers,...rows].map(r=>r.map(cell).join(',')).join('\r\n')}\r\n`; }

if(require.main===module){run().catch(error=>{console.error(`J7.1_ABORT=${error.message}`);console.error(error.stack);process.exitCode=1;});}
module.exports={assertNoApply,assertDevUrl,classifyCaseNumber,salaEvidence,classifyMultiSource,repairOperation,extractCaseRefs,computeQuality,qualityCounts,intersection,htmlReport};
