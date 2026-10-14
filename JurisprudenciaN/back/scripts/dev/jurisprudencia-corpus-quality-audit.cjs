'use strict';

// J7 read-only audit. Run only through with-dev-db-guard.cjs j7-corpus-quality-audit.
// No mutation of Corpus, Search, metadata, files, or storage is performed.
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { Client } = require('pg');
const { PDFParse } = require('pdf-parse');

const ROOT = path.resolve(__dirname, '..', '..', '..', '..');
const WORK = path.join(ROOT, '_recovery-work', 'jurisprudencia-j7');
const CACHE_DIR = path.join(WORK, 'cache');
const CACHE_FILE = path.join(CACHE_DIR, 'file-fingerprints-v1.json');
const STORAGE = path.join(ROOT, '_dev-corpus-storage');
const TOOL_VERSION = 'j7-quality-v4';
const FILE_CACHE_VERSION = 'j7-file-fingerprint-v2';
const DATABASE_URL = process.env.DATABASE_URL;
const PDF_PARSE_MAX_BYTES = 40 * 1024 * 1024;

function sha256(value) { return crypto.createHash('sha256').update(value).digest('hex'); }
function stable(value) {
  if (value instanceof Date) return JSON.stringify(value.toISOString());
  if (value === undefined) return 'null';
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stable(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}
function writeJson(file, value) { fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, 'utf8'); }
function count(map, key, amount = 1) { map[key] = (map[key] || 0) + amount; }
function norm(value) { return String(value ?? '').normalize('NFC').replace(/\r\n?/gu, '\n').replace(/\s+/gu, ' ').trim(); }
function normKey(value) { return String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/gu, '').toLocaleLowerCase('es-AR').replace(/[^\p{L}\p{N}]+/gu, ' ').trim().replace(/\s+/gu, ' '); }
function docket(value) {
  const raw = String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/gu, '').toUpperCase().replace(/(\d)[.,](?=\d{3}(?:\D|$))/gu, '$1');
  const found = raw.match(/(\d+)\s*[/-]\s*(\d{2,4})/u);
  return found ? `${found[1].replace(/^0+(?=\d)/u, '')}/${found[2].length === 2 ? found[2] : found[2].replace(/^0+(?=\d)/u, '')}` : '';
}
function normalizeChamber(value) { return normKey(value).replace(/^sala\s*/u, '').trim(); }
function dateOnly(value) { return value ? new Date(value).toISOString().slice(0, 10) : ''; }
function legalKey(row) {
  const caseNumber = docket(row.caseNumber || row.docket);
  const court = normKey(row.court);
  const room = normKey(row.chamber || row.courtNumber);
  const date = dateOnly(row.decisionDate);
  return caseNumber && court && room && date ? `${court}|${room}|${caseNumber}|${date}` : '';
}
function nestedValues(value, wanted, prefix = '', out = []) {
  if (value == null || typeof value !== 'object') return out;
  for (const [key, child] of Object.entries(value)) {
    const at = prefix ? `${prefix}.${key}` : key;
    if (wanted.has(key.toLowerCase()) && child != null && typeof child !== 'object' && String(child).trim()) out.push({ path: at, value: String(child).trim() });
    if (child && typeof child === 'object') nestedValues(child, wanted, at, out);
  }
  return out;
}
function unique(values) { return [...new Set(values.map(value => String(value).trim()).filter(Boolean))]; }
function conflict(values, normalize = value => String(value).trim()) {
  return unique(values.map(normalize)).length > 1;
}
function classifyProvenance(records) {
  if (!records.length) return 'MISSING_INGESTION_RECORD';
  const keys = records.map(row => [row.sourceCode, row.externalId, row.sourceReference, row.externalUrl].map(value => String(value || '').trim()).join('|'));
  if (unique(keys).length > 1 && unique(records.map(row => row.sourceCode)).length > 1) return 'MULTIPLE_CONFLICTING_PROVENANCE';
  if (records.some(row => row.sourceCode && (row.externalId || row.sourceReference) && (row.externalUrl || row.sourceUrl))) return 'COMPLETE';
  if (!records.some(row => row.externalId || row.sourceReference)) return 'MISSING_SOURCE_RECORD';
  if (!records.some(row => row.externalUrl || row.sourceUrl)) return 'MISSING_SOURCE_URL';
  return 'PARTIAL';
}
function quality(row) {
  const missing = row.completeness;
  let score = 100;
  const weights = { caseNumber: 12, caseYear: 5, decisionDate: 8, court: 8, instance: 8, chamber: 8, title: 5, sourceRecordId: 5, portalId: 3, documentUrl: 4, sourceUrl: 4, fileSha: 10, pageCount: 5, originalMetadata: 5, provenanceRecord: 10 };
  for (const [key, weight] of Object.entries(weights)) if (missing[key] !== 'PRESENT') score -= weight;
  for (const state of Object.values(missing)) if (state === 'INVALID') score -= 5;
  if (row.flags.includes('FILE_INVALID') || row.flags.includes('MISSING_FILE')) score = Math.min(score, 10);
  if (row.flags.includes('METADATA_CONFLICT')) score -= 12;
  score = Math.max(0, score);
  const band = score >= 90 ? 'EXCELLENT' : score >= 75 ? 'GOOD' : score >= 50 ? 'REVIEW' : score >= 20 ? 'POOR' : 'BROKEN';
  return { score, band };
}
function pageAudit(file, extraction) {
  const pages = extraction?.pages || [];
  const nums = pages.map(page => Number(page.pageNumber)).filter(Number.isFinite);
  const sorted = [...nums].sort((a, b) => a - b);
  const duplicates = nums.length - new Set(nums).size;
  const gaps = [];
  if (sorted.length && sorted[0] > 1) gaps.push([1, sorted[0] - 1]);
  for (let i = 1; i < sorted.length; i++) if (sorted[i] > sorted[i - 1] + 1) gaps.push([sorted[i - 1] + 1, sorted[i] - 1]);
  const outOfOrder = nums.some((value, index) => value < 1 || (index > 0 && value < nums[index - 1]));
  const empty = pages.filter(page => page.empty === true || (Object.hasOwn(page, 'text') && !String(page.text || '').trim())).length;
  const countMismatch = file.pageCount != null && pages.length !== Number(file.pageCount);
  const states = [];
  if (duplicates) states.push('DUPLICATE_PAGE_NUMBER');
  if (gaps.length) states.push('MISSING_PAGE');
  if (outOfOrder) states.push('OUT_OF_ORDER');
  if (countMismatch) states.push('PAGE_COUNT_MISMATCH');
  if (pages.length && empty === pages.length) states.push('ALL_EMPTY_TEXT');
  else if (empty) states.push('EMPTY_TEXT_PAGE');
  if (!pages.length) states.push('PAGE_METADATA_MISSING');
  return { dbPageCount: file.pageCount == null ? null : Number(file.pageCount), pageRows: pages.length, pageNumbers: nums, gaps, duplicates, outOfOrder, emptyPages: empty, states };
}
function textHash(text) { const normalized = norm(text); return normalized ? { hash: sha256(normalized), length: normalized.length } : { hash: null, length: 0 }; }
function shingles(text, width = 5) {
  const words = normKey(text).split(' ').filter(Boolean);
  const result = new Set();
  for (let i = 0; i + width <= words.length; i++) result.add(words.slice(i, i + width).join(' '));
  return result;
}
function jaccard(left, right) {
  if (!left.size || !right.size) return 0;
  let common = 0;
  for (const item of left) if (right.has(item)) common++;
  return common / (left.size + right.size - common);
}
function priority(flags) {
  if (flags.some(flag => ['MISSING_FILE', 'FILE_INVALID', 'MISSING_BLOB', 'UNREADABLE', 'HASH_MISMATCH', 'SIZE_MISMATCH', 'SEARCH_MISSING'].includes(flag))) return 'P0';
  if (flags.some(flag => ['MISSING_PROVENANCE', 'METADATA_CONFLICT', 'MULTIPLE_LEGAL_KEYS', 'MULTIPLE_FILES', 'SEARCH_STALE'].includes(flag))) return 'P1';
  if (flags.some(flag => ['MISSING_CASE', 'MISSING_DATE', 'MISSING_SALA', 'MISSING_TITLE', 'OCR_REQUIRED', 'PAGE_COUNT_MISMATCH'].includes(flag))) return 'P2';
  return flags.length ? 'P3' : null;
}
function assertDevUrl() {
  if (!DATABASE_URL) throw new Error('J7_DATABASE_URL_MISSING');
  const url = new URL(DATABASE_URL);
  if (url.protocol !== 'postgresql:' || url.hostname !== '127.0.0.1' || url.port !== '55432' || url.pathname !== '/buscador_juridico_civil_dev' || url.username !== 'bjc_dev') throw new Error('J7_DEV_TARGET_REJECTED');
}
function isCivil(row) { return /civil/iu.test(`${row.court || ''} ${row.chamber || ''}`); }
function sourceFields(record) {
  const metadata = record.metadataOriginal || {};
  const sourceRecords = nestedValues(metadata, new Set(['sourcerecordid', 'recordid', 'sourceid', 'portalid', 'externalid', 'url', 'sourceurl', 'documenturl']));
  const find = key => sourceRecords.find(item => item.path.toLowerCase().endsWith(`.${key}`))?.value || null;
  return {
    id: record.externalId || find('externalid') || find('sourcerecordid') || null,
    portalId: find('portalid'),
    sourceUrl: record.externalUrl || find('sourceurl') || find('documenturl') || find('url'),
    sourceReference: record.sourceReference || null,
  };
}
function makeFlags(row) {
  const flags = [];
  if (!row.files.length) flags.push('MISSING_FILE');
  if (!row.caseNumber) flags.push('MISSING_CASE');
  if (!row.decisionDate) flags.push('MISSING_DATE');
  if (!row.chamber && !row.courtNumber) flags.push('MISSING_SALA');
  if (!row.title) flags.push('MISSING_TITLE');
  if (!row.provenanceRecords.length || row.provenanceStatus !== 'COMPLETE') flags.push('MISSING_PROVENANCE');
  if (row.conflicts.length) flags.push('METADATA_CONFLICT');
  if (row.files.length > 1) flags.push('MULTIPLE_FILES');
  if (row.legalKeys.length > 1 || row.alternateCaseReferences?.length) flags.push('MULTIPLE_LEGAL_KEYS');
  if (row.files.some(file => file.integrityState === 'INVALID_PDF' || file.integrityState === 'HTML_AS_PDF' || file.integrityState === 'HASH_MISMATCH')) flags.push('FILE_INVALID');
  if (row.files.some(file => file.integrityState === 'MISSING_BLOB')) flags.push('MISSING_BLOB');
  if (row.files.some(file => file.integrityState === 'UNREADABLE')) flags.push('UNREADABLE');
  if (row.files.some(file => file.integrityState === 'HASH_MISMATCH')) flags.push('HASH_MISMATCH');
  if (row.files.some(file => file.integrityState === 'SIZE_MISMATCH')) flags.push('SIZE_MISMATCH');
  if (row.search.state === 'MISSING_SEARCH_DOC') flags.push('SEARCH_MISSING');
  if (row.search.state === 'STALE_SEARCH_DOC') flags.push('SEARCH_STALE');
  if (row.files.some(file => file.pageAudit?.states.includes('ALL_EMPTY_TEXT')) && !row.search.tokenCount) flags.push('OCR_REQUIRED');
  if (row.files.some(file => file.pageAudit?.states.includes('PAGE_COUNT_MISMATCH'))) flags.push('PAGE_COUNT_MISMATCH');
  return unique(flags).sort();
}
function normalizeFileKind(file, prefix) {
  const ext = path.extname(file.originalFilename || file.storageKey || '').toLowerCase();
  const mime = String(file.mimeType || '').toLowerCase();
  if (prefix.startsWith('<!doctype html') || prefix.startsWith('<html') || prefix.startsWith('<head') || prefix.startsWith('<body')) return 'HTML_AS_PDF';
  if (mime.includes('pdf') || ext === '.pdf') return prefix.toUpperCase().startsWith('%PDF-') ? 'PDF' : 'INVALID_PDF';
  if (mime.startsWith('text/') || ext === '.txt') return 'TEXT';
  if (!prefix) return 'EMPTY';
  return 'OTHER';
}
async function hashStream(filePath, capturePdf) {
  const hash = crypto.createHash('sha256');
  let size = 0;
  const chunks = [];
  const prefixChunks = [];
  let prefixBytes = 0;
  const stream = fs.createReadStream(filePath);
  for await (const chunk of stream) {
    hash.update(chunk); size += chunk.length;
    if (capturePdf) chunks.push(chunk);
    if (prefixBytes < 1024) { const part = chunk.subarray(0, 1024 - prefixBytes); prefixChunks.push(part); prefixBytes += part.length; }
  }
  return { sha256: hash.digest('hex'), size, prefix: Buffer.concat(prefixChunks).toString('latin1'), buffer: capturePdf ? Buffer.concat(chunks, size) : null };
}
async function fingerprintFile(file, cache) {
  const target = path.resolve(STORAGE, file.storageKey || '');
  if (!target.startsWith(`${STORAGE}${path.sep}`)) return { integrityState: 'UNREADABLE', error: 'INVALID_STORAGE_KEY', measuredSize: null, actualSha256: null, kind: 'UNKNOWN', pdfPageCount: null };
  let stat;
  try { stat = await fsp.stat(target); } catch (error) {
    return { integrityState: error.code === 'ENOENT' ? 'MISSING_BLOB' : 'UNREADABLE', error: error.code || 'STAT_FAILED', measuredSize: null, actualSha256: null, kind: 'UNKNOWN', pdfPageCount: null };
  }
  const signature = `${FILE_CACHE_VERSION}|${file.storageKey}|${file.sha256}|${Number(file.sizeBytes)}|${stat.size}|${stat.mtimeMs}`;
  const cached = cache[signature];
  if (cached) return { ...cached };
  let read;
  try { read = await hashStream(target, /\.pdf$/iu.test(file.originalFilename || file.storageKey || '') || String(file.mimeType || '').toLowerCase().includes('pdf')); } catch (error) {
    return { integrityState: 'UNREADABLE', error: error.code || 'READ_FAILED', measuredSize: stat.size, actualSha256: null, kind: 'UNKNOWN', pdfPageCount: null };
  }
  const prefix = read.prefix.trimStart().toLowerCase();
  const kind = normalizeFileKind(file, prefix);
  let integrityState = 'VALID';
  if (read.size === 0) integrityState = 'EMPTY';
  else if (read.size !== Number(file.sizeBytes)) integrityState = 'SIZE_MISMATCH';
  else if (read.sha256.toLowerCase() !== String(file.sha256 || '').toLowerCase()) integrityState = 'HASH_MISMATCH';
  else if (kind === 'HTML_AS_PDF') integrityState = 'HTML_AS_PDF';
  else if (kind === 'INVALID_PDF') integrityState = 'INVALID_PDF';
  let pdfPageCount = null;
  let pdfValidation = 'NOT_APPLICABLE';
  if (kind === 'PDF') {
    if (read.size > PDF_PARSE_MAX_BYTES) pdfValidation = 'SKIPPED_SIZE_LIMIT';
    else {
      let parser;
      try {
        parser = new PDFParse({ data: read.buffer });
        const info = await parser.getInfo({ parsePageInfo: false });
        pdfPageCount = Number.isFinite(info.total) ? info.total : null;
        pdfValidation = pdfPageCount == null ? 'PARSE_NO_PAGE_COUNT' : 'PARSED';
      } catch (error) { pdfValidation = 'INVALID_PDF'; if (integrityState === 'VALID') integrityState = 'INVALID_PDF'; }
      finally { if (parser) await parser.destroy().catch(() => {}); }
    }
  }
  const result = { integrityState, error: null, measuredSize: read.size, actualSha256: read.sha256, kind, pdfPageCount, pdfValidation };
  cache[signature] = result;
  return result;
}
async function getSnapshot(client) {
  const rows = (await client.query(`
    SELECT d."id", d."documentType", d."title", d."subtitle", d."jurisdiction", d."court", d."chamber", d."instance",
           d."caseNumber", d."docket", d."decisionDate", d."visibility", d."documentScope", d."status", d."editorialStatus",
           d."anonymizationStatus", d."metadata", d."metadataOriginal", d."searchText", d."latestExtractionId", d."createdAt", d."updatedAt",
           COALESCE((SELECT json_agg(json_build_object('id', f."id", 'storageProvider', f."storageProvider", 'storageKey', f."storageKey",
             'originalFilename', f."originalFilename", 'mimeType', f."mimeType", 'sizeBytes', f."sizeBytes", 'sha256', f."sha256", 'pageCount', f."pageCount", 'version', f."version"))
             FROM "CorpusDocumentFile" f WHERE f."documentId"=d."id"), '[]'::json) AS files,
           COALESCE((SELECT json_agg(json_build_object('id', i."id", 'sourceCode', s."code", 'sourceName', s."name", 'sourceType', s."sourceType",
             'externalId', i."externalId", 'externalUrl', i."externalUrl", 'sourceReference', i."sourceReference", 'status', i."status",
             'metadataOriginal', i."metadataOriginal", 'ingestedAt', i."ingestedAt", 'obtainedAt', i."obtainedAt"))
             FROM "CorpusIngestionRecord" i JOIN "CorpusSourceSystem" s ON s."id"=i."sourceSystemId" WHERE i."documentId"=d."id"), '[]'::json) AS ingestions,
           COALESCE((SELECT json_agg(json_build_object('id', e."id", 'fileId', e."fileId", 'status', e."status", 'extractor', e."extractor",
             'extractedAt', e."extractedAt", 'text', e."text", 'pages', COALESCE((SELECT json_agg(json_build_object('pageNumber', p."pageNumber", 'empty', (btrim(p."text")='')) ORDER BY p."pageNumber") FROM "CorpusDocumentPage" p WHERE p."extractionId"=e."id"), '[]'::json)))
             FROM "CorpusExtraction" e WHERE e."documentId"=d."id"), '[]'::json) AS extractions,
           (SELECT json_build_object('sourceChecksum', st."sourceChecksum", 'tokenCount', st."tokenCount", 'updatedAt', st."updatedAt",
             'actualTokenRows', (SELECT count(*)::int FROM "CorpusSearchToken" tok WHERE tok."documentId"=d."id"))
             FROM "CorpusSearchTokenState" st WHERE st."documentId"=d."id") AS "searchState"
      FROM "CorpusDocument" d
     WHERE d."documentScope"='GENERAL' AND (lower(coalesce(d."court",'')) LIKE '%civil%' OR lower(coalesce(d."chamber",'')) LIKE '%civil%')
     ORDER BY d."id"
  `)).rows;
  const sentinel = (await client.query(`SELECT
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
    (SELECT count(*)::int FROM "CorpusDocument" WHERE "documentScope"='PRIVATE_WORKSPACE') AS "privateDocuments"`)).rows[0];
  for (const key of ['corpusUpdatedAt', 'fileCreatedAt', 'ingestionUpdatedAt', 'extractionAt', 'searchUpdatedAt', 'searchVerifiedAt']) {
    if (sentinel[key] instanceof Date) sentinel[key] = sentinel[key].toISOString();
  }
  return { rows, sentinel };
}
function transformRows(rawRows) {
  return rawRows.map(raw => {
    const files = (raw.files || []).map(file => ({ ...file, sizeBytes: Number(file.sizeBytes), pageCount: file.pageCount == null ? null : Number(file.pageCount) }));
    const ingestions = raw.ingestions || [];
    const sources = ingestions.map(sourceFields);
    const metadata = raw.metadata || {};
    const original = raw.metadataOriginal || {};
    const metadataVals = {
      caseNumber: nestedValues([metadata, original, ...ingestions.map(i => i.metadataOriginal)], new Set(['casenumber', 'docket', 'expediente'])).map(x => x.value),
      court: nestedValues([metadata, original, ...ingestions.map(i => i.metadataOriginal)], new Set(['court', 'tribunal', 'tribunalorigen', 'organism'])).map(x => x.value),
      chamber: nestedValues([metadata, original, ...ingestions.map(i => i.metadataOriginal)], new Set(['chamber', 'sala', 'courtroom'])).map(x => x.value),
      decisionDate: nestedValues([metadata, original, ...ingestions.map(i => i.metadataOriginal)], new Set(['decisiondate', 'fecha', 'date'])).map(x => x.value),
    };
    const discrepancies = [];
    const directCaseValues = [metadata.caseNumber, metadata.docket, metadata.expediente, original.caseNumber, original.docket, original.expediente].filter(Boolean);
    const directCourtValues = [metadata.court, metadata.tribunal, original.court, original.tribunal].filter(Boolean);
    const directChamberValues = [metadata.chamber, metadata.sala, original.chamber, original.sala].filter(Boolean);
    const directDateValues = [metadata.decisionDate, metadata.fecha, original.decisionDate, original.fecha].filter(Boolean);
    if (directCaseValues.length && conflict([raw.caseNumber || raw.docket, ...directCaseValues], docket)) discrepancies.push('caseNumber');
    if (directCourtValues.length && conflict([raw.court, ...directCourtValues], normKey)) discrepancies.push('court');
    if (directChamberValues.length && conflict([raw.chamber, ...directChamberValues], normalizeChamber)) discrepancies.push('chamber');
    if (directDateValues.length && conflict([dateOnly(raw.decisionDate), ...directDateValues.map(value => /^\d{4}-\d\d-\d\d/u.test(String(value)) ? String(value).slice(0, 10) : String(value))], value => String(value))) discrepancies.push('decisionDate');
    const alternateCaseReferences = unique(metadataVals.caseNumber.map(docket).filter(value => value && value !== docket(raw.caseNumber || raw.docket)));
    const extractionRows = raw.extractions || [];
    const filesWithData = files.map(file => {
      const fileExtractions = extractionRows.filter(extraction => extraction.fileId === file.id).sort((a, b) => new Date(b.extractedAt) - new Date(a.extractedAt));
      const extraction = fileExtractions[0] || null;
      const pages = extraction?.pages || [];
      const page = pageAudit(file, extraction);
      const text = extraction?.text || pages.map(item => item.text || '').join('\n');
      const fingerprint = textHash(text);
      return { ...file, extractionStatus: extraction?.status || null, extractionId: extraction?.id || null, pageAudit: page, textHash: fingerprint.hash, textLength: fingerprint.length, _normalizedText: norm(text) };
    });
    const sourceIDs = sources.flatMap(source => [source.id, source.portalId, source.sourceReference]).filter(Boolean);
    const completeness = {
      caseNumber: raw.caseNumber || raw.docket ? (docket(raw.caseNumber || raw.docket) ? 'PRESENT' : 'INVALID') : 'MISSING',
      caseYear: raw.caseNumber || raw.docket ? (docket(raw.caseNumber || raw.docket).split('/')[1] ? 'PRESENT' : 'INVALID') : 'MISSING',
      decisionDate: raw.decisionDate ? (Number.isNaN(new Date(raw.decisionDate).getTime()) ? 'INVALID' : 'PRESENT') : 'MISSING',
      court: raw.court ? 'PRESENT' : 'MISSING',
      instance: raw.instance ? (['FIRST_INSTANCE', 'SECOND_INSTANCE'].includes(raw.instance) ? 'PRESENT' : 'INVALID') : 'MISSING',
      chamber: raw.chamber ? 'PRESENT' : 'MISSING',
      courtNumber: raw.metadata?.courtNumber || raw.metadataOriginal?.courtNumber ? 'PRESENT' : 'MISSING',
      title: raw.title ? (/^(untitled|sin título|documento sin título|n\/a|-+)$/iu.test(String(raw.title).trim()) ? 'INVALID' : 'PRESENT') : 'MISSING', sourceRecordId: sourceIDs.length ? 'PRESENT' : 'MISSING',
      portalId: sources.some(source => source.portalId) ? 'PRESENT' : 'MISSING',
      documentUrl: sources.some(source => source.sourceUrl) ? 'PRESENT' : 'MISSING',
      sourceUrl: sources.some(source => source.sourceUrl) ? 'PRESENT' : 'MISSING',
      fileSha: files.some(file => file.sha256) ? (files.every(file => /^[a-f0-9]{64}$/iu.test(file.sha256 || '')) ? 'PRESENT' : 'INVALID') : 'MISSING',
      pageCount: files.some(file => file.pageCount != null) ? (files.some(file => Number(file.pageCount) <= 0) ? 'INVALID' : 'PRESENT') : 'MISSING',
      originalMetadata: original && Object.keys(original).length ? 'PRESENT' : 'MISSING',
      provenanceRecord: ingestions.length ? 'PRESENT' : 'MISSING',
    };
    const search = raw.searchState ? {
      state: raw.searchState.sourceChecksum !== crypto.createHash('md5').update(raw.searchText || '').digest('hex') || Number(raw.searchState.tokenCount) !== Number(raw.searchState.actualTokenRows) ? 'STALE_SEARCH_DOC' : 'OK',
      tokenCount: Number(raw.searchState.tokenCount), actualTokenRows: Number(raw.searchState.actualTokenRows), updatedAt: raw.searchState.updatedAt,
    } : { state: 'MISSING_SEARCH_DOC', tokenCount: 0, actualTokenRows: 0, updatedAt: null };
    const row = {
      documentId: raw.id, documentType: raw.documentType, title: raw.title, subtitle: raw.subtitle,
      jurisdiction: raw.jurisdiction, court: raw.court, chamber: raw.chamber, instance: raw.instance,
      courtNumber: raw.metadata?.courtNumber || raw.metadataOriginal?.courtNumber || null,
      caseNumber: raw.caseNumber || raw.docket || null, caseYear: docket(raw.caseNumber || raw.docket).split('/')[1] || null,
      decisionDate: raw.decisionDate, decisionYear: raw.decisionDate ? new Date(raw.decisionDate).getUTCFullYear() : null,
      visibility: raw.visibility, status: raw.status, editorialStatus: raw.editorialStatus,
      anonymizationStatus: raw.anonymizationStatus, metadata: raw.metadata, originalMetadataPresent: completeness.originalMetadata === 'PRESENT',
      files: filesWithData, provenanceRecords: ingestions.map((record, index) => ({ id: record.id, sourceCode: record.sourceCode, sourceName: record.sourceName, sourceType: record.sourceType,
        externalId: record.externalId, sourceReference: record.sourceReference, externalUrl: record.externalUrl, status: record.status, obtainedAt: record.obtainedAt,
        source: sources[index], metadataPresent: Boolean(record.metadataOriginal && Object.keys(record.metadataOriginal).length) })),
      provenanceStatus: classifyProvenance(ingestions.map((record, index) => ({ ...record, sourceUrl: sources[index]?.sourceUrl }))),
      completeness, conflicts: discrepancies,
      conflictDetails: discrepancies.map(field => ({ field, corpus: field === 'caseNumber' ? raw.caseNumber || raw.docket : field === 'court' ? raw.court : field === 'chamber' ? raw.chamber : dateOnly(raw.decisionDate), sourceValues: field === 'caseNumber' ? directCaseValues : field === 'court' ? directCourtValues : field === 'chamber' ? directChamberValues : directDateValues })),
      alternateCaseReferences,
      search,
      legalKeys: unique([legalKey(raw)]), createdAt: raw.createdAt, updatedAt: raw.updatedAt,
    };
    row.flags = makeFlags(row);
    row.priority = priority(row.flags);
    Object.assign(row, quality(row));
    for (const file of row.files) file.blobRef = file.storageKey;
    return row;
  });
}
function buildIndexes(rows) {
  const bySha = new Map(), byLegal = new Map(), byText = new Map(), bySource = new Map(), byDocId = new Map(rows.map(row => [row.documentId, row]));
  for (const row of rows) {
    for (const file of row.files) {
      const sha = String(file.sha256 || '').toLowerCase();
      if (sha) { if (!bySha.has(sha)) bySha.set(sha, []); bySha.get(sha).push({ row, file }); }
      if (file.textHash) { if (!byText.has(file.textHash)) byText.set(file.textHash, []); byText.get(file.textHash).push({ row, file }); }
    }
    const key = row.legalKeys[0] || '';
    if (key) { if (!byLegal.has(key)) byLegal.set(key, []); byLegal.get(key).push(row); }
    for (const source of row.provenanceRecords) { const sourceKey = source.sourceCode || '(MISSING_SOURCE)'; if (!bySource.has(sourceKey)) bySource.set(sourceKey, []); bySource.get(sourceKey).push(row); }
  }
  return { bySha, byLegal, byText, bySource, byDocId };
}
function sourceAliasCandidates(sources) {
  const names = sources.map(source => ({ source: source.source, normalized: normKey(source.source).replace(/\s+/gu, '_') }));
  const variants = [];
  for (let i = 0; i < names.length; i++) for (let j = i + 1; j < names.length; j++) {
    if (names[i].normalized === names[j].normalized || names[i].normalized.replace(/_/gu, '') === names[j].normalized.replace(/_/gu, '')) variants.push({ labels: [names[i].source, names[j].source], status: 'POTENTIAL_ALIAS', merged: false });
  }
  return variants;
}
function buildDuplicates(indexes, j6Rows = []) {
  const shaGroups = [...indexes.bySha.entries()].map(([sha256, values]) => {
    const docs = unique(values.map(value => value.row.documentId));
    const sourceIds = unique(values.flatMap(value => value.row.provenanceRecords.map(record => record.id)));
    const legalKeys = unique(values.flatMap(value => value.row.legalKeys));
    const relatedJ6 = j6Rows.filter(item => String(item.sha || item.sha256 || '').toLowerCase() === sha256).map(item => ({ groupId: item.groupId, proposedPrimaryCase: item.proposedPrimaryCase || null, classification: item.classification, legalCases: unique([item.proposedPrimaryCase, ...(item.evidence || []).map(evidence => evidence.caseNumber)].filter(Boolean)) }));
    const j6MultiLegal = relatedJ6.some(item => item.legalCases.length > 1);
    if (values.length < 2 && sourceIds.length < 2 && !j6MultiLegal) return null;
    return { sha256, fileRows: values.map(value => ({ documentId: value.row.documentId, fileId: value.file.id, sourceRecordIds: value.row.provenanceRecords.map(record => record.id) })),
      documents: docs, documentCount: docs.length, fileCount: values.length, sourceRecordIds: sourceIds, sourceRecordCount: sourceIds.length, legalKeys,
      kinds: unique([...(values.length > 1 && docs.length === 1 ? ['SAME_FILE_SAME_DOCUMENT'] : []), ...(docs.length > 1 ? ['SAME_FILE_MULTIPLE_DOCUMENTS'] : []), ...(sourceIds.length > 1 ? ['SAME_FILE_MULTIPLE_SOURCE_RECORDS'] : []), ...(legalKeys.length > 1 || j6MultiLegal ? ['SAME_FILE_MULTIPLE_LEGAL_IDENTITIES'] : [])]),
      j6RelatedGroups: relatedJ6,
    };
  }).filter(Boolean);
  const textGroups = [...indexes.byText.entries()].map(([normalizedTextHash, values]) => ({ normalizedTextHash, entries: values.map(({ row, file }) => ({ documentId: row.documentId, fileId: file.id, sha256: file.sha256, legalKey: row.legalKeys[0] || null, textLength: file.textLength })) }));
  const exactText = textGroups.filter(group => group.entries.length > 1);
  const near = [];
  for (const [key, docs] of indexes.byLegal) {
    const entries = docs.flatMap(row => row.files.map(file => ({ row, file })));
    if (entries.length < 2) continue;
    for (let i = 0; i < entries.length; i++) for (let j = i + 1; j < entries.length; j++) {
      const left = entries[i], right = entries[j];
      if (left.file.id === right.file.id || !left.file.textHash || !right.file.textHash || left.file.sha256 === right.file.sha256 || left.file.textHash === right.file.textHash || Math.min(left.file.textLength, right.file.textLength) < 300) continue;
      const similarity = jaccard(shingles(left.file._normalizedText), shingles(right.file._normalizedText));
      if (similarity >= 0.82) near.push({ legalKey: key, documentIds: [left.row.documentId, right.row.documentId], fileIds: [left.file.id, right.file.id], sha256: [left.file.sha256, right.file.sha256], status: 'DIFFERENT_SHA_NEAR_TEXT_CANDIDATE', similarity });
    }
  }
  const legalGroups = [...indexes.byLegal.entries()].map(([key, docs]) => ({ legalKey: key, documentIds: docs.map(row => row.documentId), files: unique(docs.flatMap(row => row.files.map(file => file.id))), state: docs.length > 1 ? (unique(docs.flatMap(row => row.files.map(file => file.id))).length > docs.length ? 'ONE_DECISION_MULTIPLE_FILES' : 'ONE_DECISION_MULTIPLE_DOCUMENTS') : (docs[0].files.length > 1 ? 'ONE_DECISION_MULTIPLE_FILES' : 'ONE_DOC_ONE_FILE') }));
  const partial = [];
  for (const row of indexes.byDocId.values()) if (!row.legalKeys.length) partial.push({ documentId: row.documentId, caseNumber: row.caseNumber, court: row.court, chamber: row.chamber, decisionDate: row.decisionDate });
  return { shaGroups, textGroups, exactText, nearCandidates: near, legalGroups, partialLegalKeys: partial };
}
function summarize(rows, duplicates) {
  const fieldNames = ['caseNumber', 'caseYear', 'decisionDate', 'court', 'instance', 'chamber', 'courtNumber', 'title', 'sourceRecordId', 'portalId', 'documentUrl', 'sourceUrl', 'fileSha', 'pageCount', 'originalMetadata', 'provenanceRecord'];
  const completeness = Object.fromEntries(fieldNames.map(field => [field, { present: 0, missing: 0, invalid: 0, conflicting: 0 }]));
  const bands = { EXCELLENT: 0, GOOD: 0, REVIEW: 0, POOR: 0, BROKEN: 0 };
  const provenance = { COMPLETE: 0, PARTIAL: 0, MISSING_SOURCE_RECORD: 0, MISSING_SOURCE_URL: 0, MISSING_INGESTION_RECORD: 0, MULTIPLE_CONFLICTING_PROVENANCE: 0, UNKNOWN: 0 };
  const flags = {}, priorities = { P0: 0, P1: 0, P2: 0, P3: 0 }, sources = new Map(), years = {}, salas = {}, courts = {}, instances = {}, acquisition = {};
  const file = { audited: 0, valid: 0, missing: 0, hashMismatch: 0, sizeMismatch: 0, invalidPdf: 0, htmlAsPdf: 0, empty: 0, unreadable: 0, unknown: 0, kinds: {} };
  const pages = { documentsChecked: 0, pageRows: 0, dbPageCount: 0, parsedPdfPageCount: 0, ok: 0, countMismatch: 0, missingPages: 0, duplicatePageNumbers: 0, allEmpty: 0, emptyPages: 0, ocrCandidates: 0 };
  const search = { ok: 0, missing: 0, stale: 0, tokenCount: 0, tokenDocuments: 0 };
  const title = { missing: 0, placeholder: 0, repeated: 0, veryLong: 0, veryShort: 0 };
  const titleCounts = new Map();
  for (const row of rows) {
    bands[row.band]++; if (row.priority) priorities[row.priority]++; provenance[row.provenanceStatus] = (provenance[row.provenanceStatus] || 0) + 1;
    for (const flag of row.flags) count(flags, flag);
    for (const field of fieldNames) {
      const target = completeness[field];
      if (row.completeness[field] === 'PRESENT') target.present++;
      else if (row.completeness[field] === 'INVALID') target.invalid++;
      else target.missing++;
      if (row.conflicts.includes(field)) target.conflicting++;
    }
    if (!row.title) title.missing++;
    if (/^(untitled|sin título|documento sin título|n\/a|-+)$/iu.test(String(row.title || '').trim())) title.placeholder++;
    if (String(row.title || '').length > 500) title.veryLong++;
    if (row.title && String(row.title).trim().length < 12) title.veryShort++;
    if (row.title) titleCounts.set(normKey(row.title), (titleCounts.get(normKey(row.title)) || 0) + 1);
    const year = row.decisionYear || 'UNKNOWN'; count(years, year);
    count(salas, row.chamber || 'UNKNOWN');
    count(courts, row.court || 'UNKNOWN');
    count(instances, row.instance || 'UNKNOWN');
    const src = row.provenanceRecords[0]?.sourceCode || 'UNKNOWN';
    if (!sources.has(src)) sources.set(src, { source: src, documents: new Set(), files: new Set(), years: {}, instances: {}, salas: {}, provenance: {} });
    const source = sources.get(src); source.documents.add(row.documentId); row.files.forEach(item => source.files.add(item.id)); count(source.years, year); count(source.instances, row.instance || 'UNKNOWN'); count(source.salas, row.chamber || 'UNKNOWN'); count(source.provenance, row.provenanceStatus);
    count(acquisition, row.provenanceRecords[0]?.sourceType || 'UNKNOWN');
    for (const item of row.files) {
      file.audited++;
      const field = ({ VALID: 'valid', MISSING_BLOB: 'missing', HASH_MISMATCH: 'hashMismatch', SIZE_MISMATCH: 'sizeMismatch', INVALID_PDF: 'invalidPdf', HTML_AS_PDF: 'htmlAsPdf', EMPTY: 'empty', UNREADABLE: 'unreadable' })[item.integrityState] || 'unknown';
      file[field]++;
      count(file.kinds, `${item.kind || 'UNKNOWN'}|${item.pdfValidation || 'NOT_CHECKED'}`);
      pages.documentsChecked++;
      pages.pageRows += item.pageAudit?.pageRows || 0;
      pages.dbPageCount += item.pageAudit?.dbPageCount || 0;
      pages.parsedPdfPageCount += item.pdfPageCount || 0;
      const states = item.pageAudit?.states || [];
      if (!states.length) pages.ok++;
      if (states.includes('PAGE_COUNT_MISMATCH')) pages.countMismatch++;
      if (states.includes('MISSING_PAGE')) pages.missingPages++;
      if (states.includes('DUPLICATE_PAGE_NUMBER')) pages.duplicatePageNumbers++;
      if (states.includes('ALL_EMPTY_TEXT')) pages.allEmpty++;
      pages.emptyPages += item.pageAudit?.emptyPages || 0;
      if (states.includes('ALL_EMPTY_TEXT')) pages.ocrCandidates++;
    }
    search[row.search.state === 'OK' ? 'ok' : row.search.state === 'STALE_SEARCH_DOC' ? 'stale' : 'missing']++;
    if (row.search.tokenCount) search.tokenDocuments++;
    search.tokenCount += row.search.tokenCount || 0;
  }
  title.repeated = [...titleCounts.values()].filter(n => n > 1).reduce((sum, n) => sum + n, 0);
  for (const item of sources.values()) { item.documents = item.documents.size; item.files = item.files.size; }
  const duplicateCounts = {
    uniqueShas: new Set(rows.flatMap(row => row.files.map(file => String(file.sha256 || '').toLowerCase())).filter(Boolean)).size,
    duplicateShas: duplicates.shaGroups.filter(group => group.fileCount > 1).length,
    documentsAffected: unique(duplicates.shaGroups.filter(group => group.fileCount > 1).flatMap(group => group.documents)).length,
    sameFileMultipleDocuments: duplicates.shaGroups.filter(group => group.kinds.includes('SAME_FILE_MULTIPLE_DOCUMENTS')).length,
    sameFileMultipleLegalIdentities: duplicates.shaGroups.filter(group => group.kinds.includes('SAME_FILE_MULTIPLE_LEGAL_IDENTITIES')).length,
    multipleSourceRecords: duplicates.shaGroups.filter(group => group.kinds.includes('SAME_FILE_MULTIPLE_SOURCE_RECORDS')).length,
    sameSha: duplicates.shaGroups.filter(group => group.fileCount > 1).length,
    differentShaSameText: duplicates.exactText.filter(group => unique(group.entries.map(entry => entry.sha256)).length > 1).length,
    nearTextCandidates: duplicates.nearCandidates.length,
    representationsAffected: unique(duplicates.exactText.flatMap(group => group.entries.map(entry => entry.documentId))).length,
  };
  const legalCounts = { ONE_DOC_ONE_FILE: 0, ONE_DECISION_MULTIPLE_FILES: 0, ONE_DECISION_MULTIPLE_DOCUMENTS: 0, AMBIGUOUS_LEGAL_KEY: 0, PARTIAL_LEGAL_KEY: duplicates.partialLegalKeys.length };
  for (const group of duplicates.legalGroups) legalCounts[group.state] = (legalCounts[group.state] || 0) + 1;
  const meta = { court: 0, chamber: 0, instance: 0, date: 0, case: 0, title: 0, source: 0, other: 0 };
  for (const row of rows) {
    for (const field of row.conflicts) meta[({ court: 'court', chamber: 'chamber', instance: 'instance', decisionDate: 'date', caseNumber: 'case' })[field] || 'other']++;
    if (row.provenanceStatus.startsWith('MISSING') || row.provenanceStatus === 'UNKNOWN') meta.source++;
  }
  return { totalDocuments: rows.length, completeness, qualityBands: bands, provenance, sources: [...sources.values()].sort((a, b) => a.source.localeCompare(b.source)), files: file, pages, search, title, exactDuplicates: duplicateCounts, legalIdentity: legalCounts, flags: Object.fromEntries(Object.entries(flags).sort((a, b) => b[1] - a[1])), priorities, metadataAnomalies: meta, distribution: { byDecisionYear: years, byChamber: salas, byCourt: courts, byInstance: instances, bySource: Object.fromEntries([...sources].map(([key, value]) => [key, value.documents])), byAcquisitionPath: acquisition, note: 'Describes only this local Corpus snapshot; it is not global Civil coverage.' } };
}
function proposals(rows) {
  const actionFor = flag => ({ MISSING_FILE: 'INVESTIGATE_MISSING_FILE', FILE_INVALID: 'INVESTIGATE_MISSING_FILE', HASH_MISMATCH: 'INVESTIGATE_MISSING_FILE', SIZE_MISMATCH: 'INVESTIGATE_MISSING_FILE', MISSING_PROVENANCE: 'RESTORE_MISSING_PROVENANCE', METADATA_CONFLICT: 'NORMALIZE_METADATA', MULTIPLE_LEGAL_KEYS: 'REVIEW_LEGAL_IDENTITY', MULTIPLE_FILES: 'ATTACH_ALTERNATE_REPRESENTATION', OCR_REQUIRED: 'MARK_OCR_REQUIRED', SEARCH_MISSING: 'REPAIR_SEARCH_PROJECTION', SEARCH_STALE: 'REPAIR_SEARCH_PROJECTION', SOURCE_ALIAS_SUSPECTED: 'REVIEW_SOURCE_ALIAS' })[flag] || 'NO_ACTION';
  return rows.flatMap(row => row.flags.map(flag => ({ documentId: row.documentId, priority: row.priority, flag, action: actionFor(flag), supportedNow: flag === 'SEARCH_MISSING' || flag === 'SEARCH_STALE' ? 'PARTIAL' : 'NO', requiresMigration: flag === 'MULTIPLE_LEGAL_KEYS' ? 'YES' : 'NO', humanReview: flag !== 'SEARCH_MISSING' && flag !== 'SEARCH_STALE', evidence: { qualityBand: row.band, fileIds: row.files.map(file => file.id), legalKey: row.legalKeys[0] || null, provenanceState: row.provenanceStatus, searchState: row.search.state }, applied: false })));
}
function htmlReport(summary, rows) {
  const safe = value => String(value ?? '').replace(/[&<>"']/gu, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
  const body = rows.map(row => `<tr data-band="${safe(row.band)}" data-year="${safe(row.decisionYear || 'UNKNOWN')}" data-room="${safe(row.chamber || 'UNKNOWN')}" data-source="${safe(row.provenanceRecords[0]?.sourceCode || 'UNKNOWN')}" data-flags="${safe(row.flags.join(' '))}"><td>${safe(row.documentId)}</td><td>${safe(row.band)} (${row.qualityScore})</td><td>${safe(row.priority)}</td><td>${safe(row.court)}</td><td>${safe(row.chamber)}</td><td>${safe(row.caseNumber)}</td><td>${safe(row.decisionYear || 'UNKNOWN')}</td><td>${safe(row.provenanceStatus)}</td><td>${safe(row.files.length)}</td><td>${safe(row.search.state)}</td><td>${safe(row.flags.join(', '))}</td></tr>`).join('');
  return `<!doctype html><html lang="es"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>J7 — Calidad Corpus Civil</title><style>body{font:14px system-ui;margin:24px;color:#18212f;background:#f6f7fb}h1{margin-bottom:4px}.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px}.card,section{background:white;padding:14px;border:1px solid #dbe1ea;border-radius:8px}.card b{display:block;font-size:22px}table{border-collapse:collapse;width:100%;font-size:12px}td,th{padding:7px;border-bottom:1px solid #dde2ea;text-align:left}th{position:sticky;top:0;background:#eef1f6}input,select{margin:4px;padding:7px}.wrap{overflow:auto;max-height:70vh}.note{color:#4e5969}</style><h1>Calidad del Corpus Civil</h1><p class="note">Instantánea local; distribución del Corpus observado, no cobertura global. Auditoría de solo lectura.</p><div class="cards">${Object.entries(summary.qualityBands).map(([key, value]) => `<div class="card">${safe(key)}<b>${value}</b></div>`).join('')}<div class="card">Documentos Civil<b>${summary.totalDocuments}</b></div><div class="card">Archivos auditados<b>${summary.files.audited}</b></div><div class="card">SHA duplicados<b>${summary.exactDuplicates.duplicateShas}</b></div></div><section><h2>Filtros</h2><label>Calidad <select id="band"><option value="">Todas</option>${Object.keys(summary.qualityBands).map(key => `<option>${safe(key)}</option>`).join('')}</select></label><label>Sala <input id="room" placeholder="Sala"></label><label>Año <input id="year" placeholder="Año"></label><label>Fuente <input id="source" placeholder="Código fuente"></label><label>Flag <input id="flag" placeholder="Flag"></label><p id="visible"></p><div class="wrap"><table><thead><tr><th>Documento</th><th>Calidad</th><th>Prioridad</th><th>Órgano</th><th>Sala</th><th>Expediente</th><th>Año</th><th>Procedencia</th><th>Archivos</th><th>Search</th><th>Flags</th></tr></thead><tbody>${body}</tbody></table></div></section><script>const q=s=>document.querySelector(s),rows=[...document.querySelectorAll('tbody tr')];function run(){let n=0;for(const r of rows){const ok=(!q('#band').value||r.dataset.band===q('#band').value)&&(!q('#room').value||r.dataset.room.toLowerCase().includes(q('#room').value.toLowerCase()))&&(!q('#year').value||r.dataset.year.includes(q('#year').value))&&(!q('#source').value||r.dataset.source.toLowerCase().includes(q('#source').value.toLowerCase()))&&(!q('#flag').value||r.dataset.flags.toLowerCase().includes(q('#flag').value.toLowerCase()));r.hidden=!ok;if(ok)n++}q('#visible').textContent='Filas visibles: '+n+' / '+rows.length}document.querySelectorAll('input,select').forEach(e=>e.addEventListener('input',run));run()</script></html>`;
}
function dataHashes(files, summary, qualityFlags, repairProposals) {
  return { inventory: sha256(stable(files)), qualityFlags: sha256(stable(qualityFlags)), repairProposals: sha256(stable(repairProposals)), summary: sha256(stable(summary)) };
}
async function run() {
  assertDevUrl();
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  const started = Date.now();
  const client = new Client({ connectionString: DATABASE_URL, connectionTimeoutMillis: 10000, statement_timeout: 120000 });
  const performance = {};
  let before;
  let rawRows;
  let expectedIdentity;
  try {
    await client.connect();
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const id = (await client.query(`SELECT current_database() database,current_user role,inet_server_addr()::text address,inet_server_port() port,current_setting('server_version_num')::int version_num`)).rows[0];
    if (id.database !== 'buscador_juridico_civil_dev' || id.role !== 'bjc_dev' || String(id.address || '').replace(/\/\d+$/u, '') !== '127.0.0.1' || Number(id.port) !== 55432 || id.version_num < 160000 || id.version_num >= 170000) throw new Error('J7_LIVE_DB_IDENTITY_REJECTED');
    expectedIdentity = { host: '127.0.0.1', port: 55432, database: id.database, role: id.role, serverMajor: 16 };
    const at = Date.now();
    const snapshot = await getSnapshot(client);
    rawRows = snapshot.rows;
    before = snapshot.sentinel;
    performance.dbInventoryMs = Date.now() - at;
    await client.query('ROLLBACK');
  } finally { await client.end(); }

  const civilRows = rawRows.filter(isCivil);
  const civilDocumentCount = civilRows.length;
  const transformAt = Date.now();
  const rows = transformRows(civilRows);
  rawRows = null;
  performance.provenanceAndPageTransformMs = Date.now() - transformAt;
  const cache = fs.existsSync(CACHE_FILE) ? JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8')) : {};
  const fileAt = Date.now();
  let fileIndex = 0;
  const uniqueFiles = new Map();
  for (const row of rows) for (const file of row.files) if (!uniqueFiles.has(file.id)) uniqueFiles.set(file.id, file);
  for (const file of uniqueFiles.values()) {
    const fingerprint = await fingerprintFile(file, cache);
    Object.assign(file, fingerprint);
    if (file.pdfPageCount != null) {
      file.pageAudit.pdfPageCount = file.pdfPageCount;
      const mismatch = (file.pageCount != null && Number(file.pageCount) !== file.pdfPageCount) || (file.pageAudit.pageRows > 0 && file.pageAudit.pageRows !== file.pdfPageCount);
      if (mismatch && !file.pageAudit.states.includes('PAGE_COUNT_MISMATCH')) file.pageAudit.states.push('PAGE_COUNT_MISMATCH');
    }
    fileIndex++;
    if (fileIndex % 100 === 0) { process.stdout.write(`J7_FILE_AUDIT=${fileIndex}/${uniqueFiles.size}\n`); writeJson(CACHE_FILE, cache); }
  }
  writeJson(CACHE_FILE, cache);
  performance.fileIntegrityMs = Date.now() - fileAt;
  for (const row of rows) { row.flags = makeFlags(row); row.priority = priority(row.flags); Object.assign(row, quality(row)); }
  const duplicateAt = Date.now();
  const indexes = buildIndexes(rows);
  let j6Rows = [];
  const j6Path = path.join(ROOT, '_recovery-work', 'jurisprudencia-j6', 'primary-identities.json');
  if (fs.existsSync(j6Path)) {
    const j6 = JSON.parse(fs.readFileSync(j6Path, 'utf8'));
    j6Rows = Array.isArray(j6) ? j6 : (j6.rows || j6.identities || j6.cases || []);
  }
  const duplicates = buildDuplicates(indexes, j6Rows);
  const currentBySha = new Map();
  for (const row of rows) for (const file of row.files) {
    const sha = String(file.sha256 || '').toLowerCase();
    if (!currentBySha.has(sha)) currentBySha.set(sha, []);
    currentBySha.get(sha).push({ documentId: row.documentId, fileId: file.id, legalKey: row.legalKeys[0] || null });
  }
  const j6ShaMatches = j6Rows.filter(item => currentBySha.has(String(item.sha || item.sha256 || '').toLowerCase())).map(item => ({ sha256: String(item.sha || item.sha256).toLowerCase(), groupId: item.groupId, proposedPrimaryCase: item.proposedPrimaryCase || null, classification: item.classification, currentCorpusMatches: currentBySha.get(String(item.sha || item.sha256).toLowerCase()) }));
  const j5Path = path.join(ROOT, '_recovery-work', 'jurisprudencia-j5', 'identity-graph.json');
  const j5Graph = fs.existsSync(j5Path) ? JSON.parse(fs.readFileSync(j5Path, 'utf8')) : null;
  const j5ShaMatches = (Array.isArray(j5Graph?.bySha) ? j5Graph.bySha : []).filter(item => currentBySha.has(String(item.sha256 || '').toLowerCase())).map(item => ({ sha256: item.sha256, sourceRecordCount: item.sourceRecords?.length || 0, legalKeys: item.legalKeys || [], snapshotCorpusDocuments: item.corpusDocuments || [], currentCorpusMatches: currentBySha.get(String(item.sha256).toLowerCase()) }));
  performance.duplicatesMs = Date.now() - duplicateAt;
  const summary = summarize(rows, duplicates);
  for (const row of rows) for (const file of row.files) delete file._normalizedText;
  const repairProposals = proposals(rows);
  const qualityFlags = rows.filter(row => row.flags.length).map(row => ({ documentId: row.documentId, flags: row.flags, priority: row.priority, qualityScore: row.qualityScore, qualityBand: row.band }));
  const completeness = summary.completeness;
  const allFiles = rows.flatMap(row => row.files.map(file => ({ ...file, documentId: row.documentId })));
  const fileIntegrity = { summary: summary.files, files: allFiles.map(file => ({ documentId: file.documentId, fileId: file.id, sha256: file.sha256, storageKey: file.storageKey, expectedBytes: file.sizeBytes, actualBytes: file.measuredSize ?? null, actualSha256: file.actualSha256 || null, integrityState: file.integrityState, kind: file.kind, pdfPageCount: file.pdfPageCount ?? null, pdfValidation: file.pdfValidation || null, error: file.error || null })) };
  const pageIntegrity = { summary: summary.pages, documents: rows.map(row => ({ documentId: row.documentId, files: row.files.map(file => ({ fileId: file.id, ...file.pageAudit })) })) };
  const sourceMap = { sources: summary.sources, variants: sourceAliasCandidates(summary.sources) };
  const readiness = rows.map(row => ({ documentId: row.documentId, state: row.files.length === 0 || row.files.some(file => ['MISSING_BLOB', 'HASH_MISMATCH', 'INVALID_PDF', 'HTML_AS_PDF', 'UNREADABLE'].includes(file.integrityState)) ? 'FILE_MISSING' : row.files.length > 1 ? 'MULTIPLE_FILE_AMBIGUITY' : row.files.some(file => !file.pageAudit.pageRows) ? 'PAGE_METADATA_MISSING' : row.files.some(file => !file.textHash || file.pageAudit.emptyPages === file.pageAudit.pageRows) ? 'TEXT_MISSING' : 'READY' }));
  const provenance = { summary: summary.provenance, documents: rows.map(row => ({ documentId: row.documentId, state: row.provenanceStatus, records: row.provenanceRecords })) };
  const inventory = rows.map(row => ({ documentId: row.documentId, instance: row.instance, court: row.court, sala: row.chamber, courtNumber: row.courtNumber, decisionDate: row.decisionDate, caseNumber: row.caseNumber, caseYear: row.caseYear, title: row.title, source: row.provenanceRecords, files: row.files, pageCount: row.files.reduce((n, file) => n + (file.pageAudit?.pageRows || 0), 0), search: row.search, completeness: row.completeness, provenanceStatus: row.provenanceStatus, legalKeys: row.legalKeys, alternateCaseReferences: row.alternateCaseReferences, conflicts: row.conflicts, conflictDetails: row.conflictDetails, flags: row.flags, priority: row.priority, qualityScore: row.qualityScore, band: row.band }));
  const fieldCompleteness = { fields: completeness, invalid: Object.fromEntries(Object.keys(completeness).map(field => [field, completeness[field].invalid])), matrix: completeness };
  const metadataAnomalies = {
    summary: summary.metadataAnomalies,
    courtVariants: groupValues(rows, 'court'), salaVariants: groupValues(rows, 'chamber'), instanceValues: groupValues(rows, 'instance'),
    instanceCourtContradictions: rows.filter(row => (/cámara/iu.test(row.court || '') && row.instance === 'FIRST_INSTANCE') || (/juzgado/iu.test(row.court || '') && row.instance === 'SECOND_INSTANCE')).map(row => ({ documentId: row.documentId, court: row.court, chamber: row.chamber, instance: row.instance })),
    unexpectedChambersForCivilCourt: rows.filter(row => /cámara/iu.test(row.court || '') && row.chamber && !/^(?:sala\s*)?[a-m]$/iu.test(normKey(row.chamber))).map(row => ({ documentId: row.documentId, court: row.court, chamber: row.chamber })),
    conflicts: rows.filter(row => row.conflictDetails.length).map(row => ({ documentId: row.documentId, conflicts: row.conflictDetails })),
    alternateCaseReferences: rows.filter(row => row.alternateCaseReferences.length).map(row => ({ documentId: row.documentId, corpusCase: row.caseNumber, alternateCaseReferences: row.alternateCaseReferences })),
    invalidDates: rows.filter(row => row.decisionDate && Number.isNaN(new Date(row.decisionDate).getTime())).map(row => row.documentId),
    futureDates: rows.filter(row => row.decisionDate && new Date(row.decisionDate).getTime() > Date.now() + 86400000).map(row => row.documentId),
    caseYearDecisionYearDifferences: rows.filter(row => row.caseYear && row.decisionYear && Number(row.caseYear) > row.decisionYear + 1).map(row => ({ documentId: row.documentId, caseYear: row.caseYear, decisionYear: row.decisionYear })),
    title: summary.title,
  };
  const searchAudit = { documents: rows.length, states: { OK: summary.search.ok, MISSING_SEARCH_DOC: summary.search.missing, STALE_SEARCH_DOC: summary.search.stale }, tokenDocuments: summary.search.tokenDocuments, tokenRows: summary.search.tokenCount, details: rows.map(row => ({ documentId: row.documentId, state: row.search.state, tokenCount: row.search.tokenCount, actualTokenRows: row.search.actualTokenRows, tokenStateUpdatedAt: row.search.updatedAt })) };
  const repairCsv = ['documentId,priority,flag,action,supportedNow,requiresMigration,humanReview,applied', ...repairProposals.map(item => [item.documentId, item.priority, item.flag, item.action, item.supportedNow, item.requiresMigration, item.humanReview, item.applied].map(value => `"${String(value).replace(/"/gu, '""')}"`).join(','))].join('\n') + '\n';
  const hashSet = dataHashes(inventory, summary, qualityFlags, repairProposals);
  performance.reportMs = Date.now() - started - (performance.dbInventoryMs || 0) - (performance.provenanceAndPageTransformMs || 0) - (performance.fileIntegrityMs || 0) - (performance.duplicatesMs || 0);
  performance.totalMs = Date.now() - started;
  const outputs = {
    'civil-inventory.json': inventory,
    'civil-inventory-summary.json': summary,
    'field-completeness.json': fieldCompleteness,
    'quality-bands.json': { bands: summary.qualityBands, scoreContract: { EXCELLENT: '90-100', GOOD: '75-89', REVIEW: '50-74', POOR: '20-49', BROKEN: '0-19 or inaccessible file', scoreIsTruth: false } },
    'provenance-audit.json': provenance,
    'source-map.json': sourceMap,
    'file-integrity.json': fileIntegrity,
    'page-integrity.json': pageIntegrity,
    'sha-duplicates.json': { summary: summary.exactDuplicates, groups: duplicates.shaGroups, j6ShaMatches, j5ShaMatches, j6J5CrosswalkCounts: { j6ShaMatches: j6ShaMatches.length, j5ShaMatches: j5ShaMatches.length } },
    'text-duplicates.json': { sameSha: duplicates.shaGroups, differentShaSameText: duplicates.exactText.filter(group => unique(group.entries.map(entry => entry.sha256)).length > 1), nearTextCandidates: duplicates.nearCandidates, representationsAffected: summary.exactDuplicates.representationsAffected },
    'legal-identity-groups.json': { counts: summary.legalIdentity, groups: duplicates.legalGroups, partial: duplicates.partialLegalKeys },
    'metadata-anomalies.json': metadataAnomalies,
    'corpus-distribution.json': summary.distribution,
    'search-readonly-audit.json': searchAudit,
    'viewer-readiness.json': { counts: readiness.reduce((out, item) => { count(out, item.state); return out; }, {}), documents: readiness },
    'quality-flags.json': { counts: summary.flags, priorities: summary.priorities, documents: qualityFlags },
    'repair-proposals.json': { summary: repairProposals.reduce((out, item) => { count(out, item.priority); return out; }, {}), actions: repairProposals.reduce((out, item) => { count(out, item.action); return out; }, {}), writesApplied: 0, proposals: repairProposals },
  };
  const beforeSentinel = { identity: expectedIdentity, counts: before, civilDocuments: civilDocumentCount, privateDocumentsExcluded: Number(before.privateDocuments) };
  const second = new Client({ connectionString: DATABASE_URL, connectionTimeoutMillis: 10000, statement_timeout: 120000 });
  await second.connect();
  let after;
  try {
    await second.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const identity = (await second.query(`SELECT current_database() database,current_user role,inet_server_addr()::text address,inet_server_port() port`)).rows[0];
    if (identity.database !== expectedIdentity.database || identity.role !== expectedIdentity.role || String(identity.address || '').replace(/\/\d+$/u, '') !== expectedIdentity.host || Number(identity.port) !== expectedIdentity.port) throw new Error('J7_AFTER_IDENTITY_REJECTED');
    after = (await getSnapshot(second)).sentinel;
    await second.query('ROLLBACK');
  } finally { await second.end(); }
  const sentinelEqual = stable(before) === stable(after);
  const priorSummaryPath = path.join(WORK, 'final-summary.json');
  const priorSummary = fs.existsSync(priorSummaryPath) ? JSON.parse(fs.readFileSync(priorSummaryPath, 'utf8')) : null;
  const sameVersionBaseline = priorSummary?.toolVersion === TOOL_VERSION && priorSummary.outputHashes;
  const summaryFile = { mission: 'SPRINT J7 — CIVIL CORPUS QUALITY + PROVENANCE AUDIT', toolVersion: TOOL_VERSION, status: sentinelEqual ? 'READ_ONLY_PASS' : 'PARTIAL_SENTINEL_MISMATCH', generatedAt: new Date().toISOString(), databaseIdentity: expectedIdentity, processed: rows.length, expectedCivilDocuments: 6070, errors: [], phases: performance, metrics: summary, j6J5ShaCrosswalk: { j6Matches: j6ShaMatches.length, j5Matches: j5ShaMatches.length, j6SnapshotUnmodified: true, j5SnapshotUnmodified: true }, outputHashes: hashSet, source: 'LOCAL DEV Corpus snapshot only; not global Civil coverage.', zeroWrite: { insert: 0, update: 0, delete: 0, ddl: 0, verifiedAtChanged: before.searchVerifiedAt !== after.searchVerifiedAt, corpusCountsMatch: ['documents', 'files', 'pages', 'ingestions', 'extractions'].every(key => String(before[key]) === String(after[key])), searchCountsMatch: before.searchDocuments === after.searchDocuments && before.searchTokens === after.searchTokens, timestampsMatch: stable(before) === stable(after), before: beforeSentinel, after }, limitations: { sourceMetadataConflictsAreCandidates: true, pdfSignatureCheckedForAll: true, structuralPdfParsing: `${allFiles.filter(file => file.pdfValidation === 'PARSED').length} parsed; ${allFiles.filter(file => file.pdfValidation === 'SKIPPED_SIZE_LIMIT').length} skipped over size cap`, nearText: 'Candidates use the same complete legal key only; no all-pairs comparison and no auto-dedup.' }, j61HumanUat: { status: 'UNCHANGED — READY FOR HUMAN UAT', cases: 187, sample: 20, decisionsCreated: 0 } };
  summaryFile.determinism = { artifacts: hashSet, baselineCompared: Boolean(sameVersionBaseline), baselineHashes: sameVersionBaseline ? priorSummary.outputHashes : null, pass: sameVersionBaseline ? stable(hashSet) === stable(priorSummary.outputHashes) : null, timestampsExcluded: true };
  outputs['civil-inventory-summary.json'] = summary;
  outputs['performance.json'] = performance;
  outputs['write-sentinel-before.json'] = beforeSentinel;
  outputs['write-sentinel-after.json'] = { identity: expectedIdentity, counts: after, civilDocuments: rows.length, privateDocumentsExcluded: Number(after.privateDocuments) };
  outputs['determinism.json'] = summaryFile.determinism;
  outputs['final-summary.json'] = summaryFile;
  outputs['audit-errors.json'] = [];
  fs.mkdirSync(WORK, { recursive: true });
  for (const [name, value] of Object.entries(outputs)) writeJson(path.join(WORK, name), value);
  fs.writeFileSync(path.join(WORK, 'repair-proposals.csv'), repairCsv, 'utf8');
  fs.writeFileSync(path.join(WORK, 'corpus-quality-report.html'), htmlReport(summary, rows), 'utf8');
  process.stdout.write(JSON.stringify({ status: summaryFile.status, processed: rows.length, files: summary.files, bands: summary.qualityBands, provenance: summary.provenance, search: summary.search, sentinelsEqual: sentinelEqual, determinism: summaryFile.determinism.pass, hashes: hashSet, performance }, null, 2) + '\n');
}
function groupValues(rows, field) {
  const groups = new Map();
  for (const row of rows) { const value = String(row[field] ?? '(null)'); if (!groups.has(value)) groups.set(value, { value, count: 0, normalized: normKey(value) }); groups.get(value).count++; }
  return [...groups.values()].sort((a, b) => b.count - a.count || a.value.localeCompare(b.value));
}
if (require.main === module) run().catch(error => { console.error(error.stack || error.message); process.exitCode = 1; });
module.exports = { stable, sha256, docket, legalKey, normalizeChamber, classifyProvenance, quality, pageAudit, textHash, shingles, jaccard, priority, normalizeFileKind, makeFlags, summarize, proposals, transformRows, buildIndexes, buildDuplicates, sourceAliasCandidates };
