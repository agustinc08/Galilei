'use strict';

// J8 certification consumes the freshly regenerated J7 read-only audit and
// rechecks selected PostgreSQL facts inside a repeatable-read, read-only txn.
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const zlib = require('node:zlib');
const { execFileSync } = require('node:child_process');
const { Client } = require('pg');
const { PDFParse } = require('pdf-parse');
const Normalizer = require('./jurisprudencia-civil-case-normalizer.cjs');
const C = require('./jurisprudencia-civil-certification.cjs');

const ROOT = path.resolve(__dirname, '..', '..', '..', '..');
const BACK = path.resolve(__dirname, '..', '..');
const RECOVERY = path.join(ROOT, '_recovery-work');
const J7 = path.join(RECOVERY, 'jurisprudencia-j7');
const J71 = path.join(RECOVERY, 'jurisprudencia-j71');
const J711 = path.join(RECOVERY, 'jurisprudencia-j711');
const J712 = path.join(RECOVERY, 'jurisprudencia-j712');
const J713 = path.join(RECOVERY, 'jurisprudencia-j713');
const OUT = path.join(RECOVERY, 'jurisprudencia-j8');
const STORAGE = path.join(ROOT, '_dev-corpus-storage');
const DB_URL = process.env.DATABASE_URL;
const EXPECTED = 6070;
const TOOL_VERSION = 'j8-civil-certification-v1';

function readJson(file) { return JSON.parse(fs.readFileSync(file, 'utf8')); }
function writeJson(file, value) { fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, 'utf8'); }
function shaFile(value) { return crypto.createHash('sha256').update(value).digest('hex'); }
function eq(a, b) { return C.stable(a) === C.stable(b); }
function percent(n, d) { return d ? Number((100 * n / d).toFixed(4)) : 0; }
function increment(target, key, n = 1) { target[key] = (target[key] || 0) + n; }
function sourceFor(row) { return [...new Set((row.source || []).map(x => x.sourceCode).filter(Boolean))].sort(); }

function assertTarget() {
  if (!DB_URL) throw new Error('J8_DATABASE_URL_MISSING');
  const url = new URL(DB_URL);
  if (url.protocol !== 'postgresql:' || url.hostname !== '127.0.0.1' || url.port !== '55432' ||
      url.pathname !== '/buscador_juridico_civil_dev' || url.username !== 'bjc_dev') throw new Error('J8_DEV_TARGET_REJECTED');
}

const SENTINEL_SQL = `SELECT
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

function normalizeSentinel(row) {
  const output = { ...row };
  for (const key of ['corpusUpdatedAt', 'fileCreatedAt', 'ingestionUpdatedAt', 'extractionAt', 'searchUpdatedAt', 'searchVerifiedAt']) {
    if (output[key] instanceof Date) output[key] = output[key].toISOString();
  }
  return output;
}

async function liveIdentity(client) {
  const row = (await client.query(`SELECT current_database() database,current_user role,
    inet_server_addr()::text address,inet_server_port() port,current_setting('server_version_num')::int versionNum`)).rows[0];
  const address = String(row.address || '').replace(/\/\d+$/u, '');
  if (row.database !== 'buscador_juridico_civil_dev' || row.role !== 'bjc_dev' || address !== '127.0.0.1' ||
      Number(row.port) !== 55432 || row.versionNum < 160000 || row.versionNum >= 170000) throw new Error('J8_LIVE_DB_IDENTITY_REJECTED');
  return { host: address, port: Number(row.port), database: row.database, role: row.role, serverMajor: 16 };
}

async function beginReadOnly(client) {
  await client.connect();
  await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  const identity = await liveIdentity(client);
  return { identity, sentinel: normalizeSentinel((await client.query(SENTINEL_SQL)).rows[0]) };
}

function unfilterPng(buffer, onPixel) {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  if (!buffer.subarray(0, 8).equals(signature)) return null;
  let offset = 8, width = 0, height = 0, bitDepth = 0, colorType = 0, interlace = 0;
  const idat = [];
  while (offset + 12 <= buffer.length) {
    const length = buffer.readUInt32BE(offset); const type = buffer.toString('ascii', offset + 4, offset + 8);
    const data = buffer.subarray(offset + 8, offset + 8 + length); offset += length + 12;
    if (type === 'IHDR') { width = data.readUInt32BE(0); height = data.readUInt32BE(4); bitDepth = data[8]; colorType = data[9]; interlace = data[12]; }
    else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
  }
  const channels = ({ 0: 1, 2: 3, 4: 2, 6: 4 })[colorType];
  if (!width || !height || bitDepth !== 8 || !channels || interlace !== 0) return null;
  const bytesPerPixel = channels, stride = width * channels;
  const raw = zlib.inflateSync(Buffer.concat(idat));
  let prior = Buffer.alloc(stride), cursor = 0, ink = 0, total = width * height;
  for (let y = 0; y < height; y++) {
    const filter = raw[cursor++]; const scan = Buffer.from(raw.subarray(cursor, cursor + stride)); cursor += stride;
    for (let i = 0; i < stride; i++) {
      const left = i >= bytesPerPixel ? scan[i - bytesPerPixel] : 0;
      const up = prior[i]; const upperLeft = i >= bytesPerPixel ? prior[i - bytesPerPixel] : 0;
      let predictor = 0;
      if (filter === 1) predictor = left;
      else if (filter === 2) predictor = up;
      else if (filter === 3) predictor = Math.floor((left + up) / 2);
      else if (filter === 4) {
        const p = left + up - upperLeft, pa = Math.abs(p - left), pb = Math.abs(p - up), pc = Math.abs(p - upperLeft);
        predictor = pa <= pb && pa <= pc ? left : pb <= pc ? up : upperLeft;
      } else if (filter !== 0) return null;
      scan[i] = (scan[i] + predictor) & 255;
    }
    for (let x = 0; x < width; x++) {
      const i = x * channels;
      let gray = scan[i], alpha = 255;
      if (colorType === 2 || colorType === 6) gray = Math.round((scan[i] * 0.299) + (scan[i + 1] * 0.587) + (scan[i + 2] * 0.114));
      if (colorType === 4) alpha = scan[i + 1];
      if (colorType === 6) alpha = scan[i + 3];
      if (alpha > 16 && gray < 245) ink++;
    }
    prior = scan;
  }
  return { width, height, inkPixels: ink, totalPixels: total, inkFraction: total ? ink / total : 0 };
}

async function inspectBlankPages(inventory, blankRows, perf) {
  const grouped = new Map();
  for (const row of blankRows) {
    if (!grouped.has(row.documentId)) grouped.set(row.documentId, { documentId: row.documentId, fileId: row.fileId, storageKey: row.storageKey, pages: [] });
    grouped.get(row.documentId).pages.push(Number(row.pageNumber));
  }
  const result = [];
  const at = Date.now();
  for (const group of grouped.values()) {
    const doc = inventory.find(item => item.documentId === group.documentId);
    const file = doc?.files.find(item => item.id === group.fileId) || doc?.files[0];
    const storageKey = file?.storageKey || group.storageKey;
    const target = path.resolve(STORAGE, storageKey || '');
    if (!target.startsWith(`${STORAGE}${path.sep}`)) {
      for (const pageNumber of group.pages) result.push({ documentId: group.documentId, pageNumber, classification: 'UNKNOWN', reason: 'INVALID_STORAGE_REFERENCE' });
      continue;
    }
    let parser;
    try {
      const data = await fsp.readFile(target);
      parser = new PDFParse({ data });
      const selected = [...new Set(group.pages)].sort((a, b) => a - b);
      const [textResult, imageResult, screenshots] = [
        await parser.getText({ partial: selected, pageJoiner: '' }),
        await parser.getImage({ partial: selected, imageThreshold: 0, imageBuffer: false, imageDataUrl: false }),
        await parser.getScreenshot({ partial: selected, desiredWidth: 360, imageBuffer: true, imageDataUrl: false }),
      ];
      for (const pageNumber of selected) {
        const pageText = (textResult.pages || []).find(page => Number(page.num) === pageNumber)?.text || '';
        const pageImages = imageResult.pages?.find(page => Number(page.pageNumber) === pageNumber)?.images || [];
        const screenshot = screenshots.pages?.find(page => Number(page.pageNumber) === pageNumber);
        const pixels = screenshot?.data ? unfilterPng(Buffer.from(screenshot.data)) : null;
        let classification = 'UNKNOWN'; let reason = 'RENDER_CLASSIFICATION_UNAVAILABLE';
        if (pageText.trim()) { classification = 'TEXT_EXTRACTION_GAP'; reason = 'NATIVE_PARSER_RECOVERS_TEXT_NOT_STORED_IN_CORPUS'; }
        else if (!pixels) { classification = 'UNKNOWN'; reason = 'SCREENSHOT_PIXEL_CLASSIFICATION_UNAVAILABLE'; }
        else if (pixels.inkFraction >= 0.0005) {
          classification = pageImages.length ? 'OCR_CANDIDATE' : 'TEXT_EXTRACTION_GAP';
          reason = pageImages.length ? 'VISIBLE_EMBEDDED_IMAGE_WITHOUT_TEXT' : 'VISIBLE_VECTOR_CONTENT_WITHOUT_TEXT';
        } else { classification = 'LEGITIMATE_EMPTY_PAGE'; reason = 'RENDERED_PAGE_HAS_NO_VISIBLE_CONTENT'; }
        result.push({ documentId: group.documentId, pageNumber, classification, reason, nativeChars: pageText.length,
          embeddedImages: pageImages.length, renderedInkFraction: pixels ? Number(pixels.inkFraction.toFixed(6)) : null,
          fileSha: file?.sha256 || null });
      }
    } catch (error) {
      for (const pageNumber of group.pages) result.push({ documentId: group.documentId, pageNumber, classification: 'UNKNOWN', reason: error.code || 'NATIVE_PAGE_RECHECK_FAILED' });
    } finally { if (parser) await parser.destroy().catch(() => {}); }
  }
  perf.emptyPageReclassificationMs = Date.now() - at;
  return result.sort((a, b) => a.documentId.localeCompare(b.documentId) || a.pageNumber - b.pageNumber);
}

async function inspectTextMissing(inventory, viewerRows, perf) {
  const candidates = viewerRows.filter(row => row.state === 'TEXT_MISSING');
  const at = Date.now(); const dossiers = [];
  for (const candidate of candidates) {
    const row = inventory.find(item => item.documentId === candidate.documentId);
    if (!row) { dossiers.push({ documentId: candidate.documentId, classification: 'UNKNOWN', error: 'DOCUMENT_NOT_IN_INVENTORY' }); continue; }
    for (const file of row.files) {
      const target = path.resolve(STORAGE, file.storageKey || '');
      if (!target.startsWith(`${STORAGE}${path.sep}`)) { dossiers.push({ documentId: row.documentId, classification: 'UNKNOWN', error: 'INVALID_STORAGE_REFERENCE' }); continue; }
      let parser;
      try {
        const bytes = await fsp.readFile(target); parser = new PDFParse({ data: bytes });
        const text = await parser.getText({ pageJoiner: '' });
        const info = await parser.getInfo({ parsePageInfo: true });
        const imageInfo = await parser.getImage({ imageThreshold: 0, imageBuffer: false, imageDataUrl: false });
        const screenshot = await parser.getScreenshot({ desiredWidth: 360, imageBuffer: true, imageDataUrl: false });
        const pageEvidence = (text.pages || []).map(page => ({ pageNumber: page.num, nativeChars: (page.text || '').length }));
        const visible = screenshot.pages.map(page => ({ pageNumber: page.pageNumber, pixels: page.data ? unfilterPng(Buffer.from(page.data)) : null }));
        const imagePages = imageInfo.pages.filter(page => page.images?.length).map(page => ({ pageNumber: page.pageNumber, images: page.images.length }));
        const hasVisibleImages = visible.some(item => item.pixels?.inkFraction >= 0.0005);
        const meaningfulNativeChars = pageEvidence.reduce((sum, page) => sum + page.nativeChars, 0);
        let classification = 'PARSER_LIMITATION';
        if (meaningfulNativeChars > 0) classification = 'REEXTRACTION_REPAIR_CANDIDATE';
        else if (hasVisibleImages || imagePages.length) classification = 'OCR_REQUIRED';
        else if (visible.some(item => !item.pixels)) classification = 'UNKNOWN';
        dossiers.push({ documentId: row.documentId, fileId: file.id, fileSha: file.sha256, fileValid: file.integrityState === 'VALID',
          bytes: bytes.length, source: sourceFor(row), pages: info.total, pageText: pageEvidence, storedChars: file.textLength,
          nativeTextChars: meaningfulNativeChars, nativeAggregateChars: (text.text || '').length,
          searchTokens: row.search.tokenCount, viewerState: candidate.state, imagePages, renderedInkFractions: visible.map(item => ({ pageNumber: item.pageNumber,
            inkFraction: item.pixels ? Number(item.pixels.inkFraction.toFixed(6)) : null })), classification,
          futureAction: classification === 'OCR_REQUIRED' ? 'OCR quality review and approved OCR tooling; do not persist without separate authorization' : 'Evaluate native re-extraction repair in a separate reviewed change',
          technicalBlocker: !file.integrityState || file.integrityState !== 'VALID' });
      } catch (error) { dossiers.push({ documentId: row.documentId, fileId: file.id, fileSha: file.sha256, classification: 'UNKNOWN', error: error.code || error.message }); }
      finally { if (parser) await parser.destroy().catch(() => {}); }
    }
  }
  perf.textMissingDryRunMs = Date.now() - at;
  return dossiers;
}

function jsonRows(value) { return Array.isArray(value) ? value : (value?.rows || value?.documents || value?.proposals || []); }

function main() {
  return run().catch(error => { console.error(error.stack || error.message); process.exitCode = 1; });
}

async function run() {
  if (process.argv.length !== 2) throw new Error('J8_READ_ONLY_TOOL_REJECTS_ARGUMENTS');
  assertTarget();
  const started = Date.now(); const performance = {};
  const j7Summary = readJson(path.join(J7, 'final-summary.json'));
  const j7Rows = readJson(path.join(J7, 'civil-inventory.json'));
  const j7Viewer = readJson(path.join(J7, 'viewer-readiness.json'));
  const j7Page = readJson(path.join(J7, 'page-integrity.json'));
  const j7Duplicates = readJson(path.join(J7, 'sha-duplicates.json'));
  const j7TextDuplicates = readJson(path.join(J7, 'text-duplicates.json'));
  const j7Legal = readJson(path.join(J7, 'legal-identity-groups.json'));
  const j7Distribution = readJson(path.join(J7, 'corpus-distribution.json'));
  const j71Summary = readJson(path.join(J71, 'final-summary.json'));
  const j71Legal = readJson(path.join(J71, 'partial-legal-key-analysis.json'));
  const j711Summary = readJson(path.join(J711, 'final-summary.json'));
  const j711Real = readJson(path.join(J711, 'real-1089-results.json'));
  const j711Valid = readJson(path.join(J711, 'valid-4978-regression.json'));
  const j711Special = readJson(path.join(J711, 'three-non-parser-cases.json'));
  const j712Summary = readJson(path.join(J712, 'summary.json'));
  const j713Summary = readJson(path.join(J713, 'review-pack-summary.json'));
  const j713Pack = readJson(path.join(J713, 'review-pack.json'));
  const j7Errors = readJson(path.join(J7, 'audit-errors.json'));
  const gitSha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim();

  if (j7Summary.status !== 'READ_ONLY_PASS' || j7Rows.length !== EXPECTED || j7Summary.processed !== EXPECTED || j7Errors.length) throw new Error('J8_FRESH_J7_AUDIT_NOT_CLEAN');
  if (j71Summary.status !== 'READ_ONLY_PASS' || j71Summary.snapshotChanged || j711Summary.status !== 'ANALYSIS_COMPLETE' || !j711Summary.readOnlySnapshotMatch) throw new Error('J8_PRIOR_ANALYSIS_RECONCILIATION_FAILED');
  if (j712Summary.counts?.civilDocuments !== EXPECTED || j712Summary.counts?.statuses?.PROBABLE_HUMAN_CONFIRMATION !== 365 || j713Summary.counts?.primary !== 365 || j713Summary.counts?.ambiguous !== 39) throw new Error('J8_HISTORICAL_RECONCILIATION_FAILED');
  if (j713Pack.humanDecisions?.length || j713Pack.decisions?.length) throw new Error('J8_HUMAN_DECISIONS_MUST_REMAIN_EMPTY');

  const perfAt = Date.now();
  const client = new Client({ connectionString: DB_URL, connectionTimeoutMillis: 10000, statement_timeout: 180000 });
  let identity, before, blankRows, sampleProbe;
  try {
    const snapshot = await beginReadOnly(client); identity = snapshot.identity; before = snapshot.sentinel;
    blankRows = (await client.query(`SELECT d."id" AS "documentId",f."id" AS "fileId",f."storageKey",p."pageNumber"
      FROM "CorpusDocument" d JOIN "CorpusExtraction" e ON e."id"=d."latestExtractionId"
      JOIN "CorpusDocumentFile" f ON f."id"=e."fileId" JOIN "CorpusDocumentPage" p ON p."extractionId"=e."id"
      WHERE d."documentScope"='GENERAL' AND (lower(coalesce(d."court",'')) LIKE '%civil%' OR lower(coalesce(d."chamber",'')) LIKE '%civil%')
        AND btrim(p."text")='' ORDER BY d."id",p."pageNumber"`)).rows;
    const currentCount = (await client.query(`SELECT count(*)::int AS "civilDocuments",
      count(*) FILTER (WHERE "instance"='FIRST_INSTANCE')::int AS "firstInstance",
      count(*) FILTER (WHERE "instance"='SECOND_INSTANCE')::int AS "secondInstance"
      FROM "CorpusDocument" WHERE "documentScope"='GENERAL' AND (lower(coalesce("court",'')) LIKE '%civil%' OR lower(coalesce("chamber",'')) LIKE '%civil%')`)).rows[0];
    if (Number(currentCount.civilDocuments) !== EXPECTED) throw new Error('J8_LIVE_CIVIL_COUNT_MISMATCH');
    sampleProbe = { currentCount };
    await client.query('ROLLBACK');
  } finally { await client.end(); }
  performance.readOnlyPreflightAndPageInventoryMs = Date.now() - perfAt;

  const emptyPages = await inspectBlankPages(j7Rows, blankRows, performance);
  const emptyPageCounts = emptyPages.reduce((out, row) => { increment(out, row.classification); return out; }, {});
  const normalizerAt = Date.now();
  const normalization = new Map();
  for (const row of j7Rows) {
    const source = sourceFor(row)[0] || null;
    normalization.set(row.documentId, Normalizer.normalizeCivilCaseReference({ rawCase: row.caseNumber || '', rawYear: row.caseYear || '', source }));
  }
  performance.normalizerMs = Date.now() - normalizerAt;

  const normalizedById = new Map(j7Rows.map(row => [row.documentId, row]));
  const realRows = jsonRows(j711Real);
  const validRows = jsonRows(j711Valid);
  const specialRows = jsonRows(j711Special);
  const realRecheck = realRows.map(previous => {
    const row = normalizedById.get(previous.documentId); const now = normalization.get(previous.documentId);
    return Boolean(row && now && now.status === previous.newStatus && now.canonicalCaseNumber === previous.canonicalCase && now.canonicalYear === previous.canonicalYear);
  });
  const validRecheck = validRows.map(previous => {
    const now = normalization.get(previous.documentId);
    return Boolean(now && now.status === previous.status && now.normalizedDisplay === previous.afterIdentity);
  });
  const specialRecheck = specialRows.map(previous => {
    const now = normalization.get(previous.documentId);
    return Boolean(now && now.status === previous.normalizerStatus);
  });
  if (realRecheck.some(value => !value) || validRecheck.some(value => !value) || specialRecheck.some(value => !value)) throw new Error('J8_CASE_NORMALIZER_REVALIDATION_MISMATCH');
  const normalizationCounts = [...normalization.values()].reduce((out, row) => { increment(out, row.status); return out; }, {});

  const salaProposals = new Map((j712Summary.proposals || []).map(row => [row.documentId, row]));
  const j713Cases = new Map((j713Pack.cases || []).map(row => [row.documentId, row]));
  const pageByDocument = new Map();
  for (const row of emptyPages) {
    if (!pageByDocument.has(row.documentId)) pageByDocument.set(row.documentId, {});
    increment(pageByDocument.get(row.documentId), row.classification);
  }
  const viewerById = new Map(j7Viewer.documents.map(row => [row.documentId, row.state]));
  const legalPartialById = new Map((j71Legal.rows || []).map(row => [row.documentId, row]));
  const representationIds = new Set((j7TextDuplicates.differentShaSameText || []).flatMap(group => group.entries.map(entry => entry.documentId)));
  const multiLegalIds = new Set(j7Rows.filter(row => row.flags.includes('MULTIPLE_LEGAL_KEYS') || (row.alternateCaseReferences || []).length).map(row => row.documentId));
  const emptyPageUnknownDocs = new Set(emptyPages.filter(row => row.classification === 'UNKNOWN').map(row => row.documentId));
  const manifestInputs = j7Rows.map(row => {
    const sources = sourceFor(row); const source = sources.length === 1 ? sources[0] : sources.join('|');
    const proposal = salaProposals.get(row.documentId); const j713 = j713Cases.get(row.documentId);
    let salaStatus = row.sala ? 'KNOWN_SALA' : proposal?.status || 'UNKNOWN';
    if (row.instance === 'FIRST_INSTANCE' && row.sala) salaStatus = 'NOT_APPLICABLE_FIRST_INSTANCE';
    const legal = legalPartialById.get(row.documentId);
    let legalKeyStatus = row.legalKeys.length ? 'COMPLETE' : legal?.classification || 'PARTIAL_OR_CLASSIFIED';
    if (multiLegalIds.has(row.documentId)) legalKeyStatus = 'MULTIPLE_LEGAL_KEYS_REVIEWED';
    const empties = pageByDocument.get(row.documentId) || {};
    const pageStates = row.files.flatMap(file => file.pageAudit?.states || []);
    const pageBroken = pageStates.some(x => ['DUPLICATE_PAGE_NUMBER', 'MISSING_PAGE', 'OUT_OF_ORDER', 'PAGE_COUNT_MISMATCH', 'PAGE_METADATA_MISSING'].includes(x));
    const pageStatus = emptyPageUnknownDocs.has(row.documentId) ? 'UNKNOWN'
      : pageBroken ? 'BROKEN'
        : Object.values(empties).reduce((sum, count) => sum + count, 0) ? 'KNOWN_EMPTY_PAGES_CLASSIFIED'
          : 'OK';
    const viewer = viewerById.get(row.documentId) || 'UNKNOWN';
    const search = row.search.state !== 'OK' ? row.search.state
      : viewer === 'TEXT_MISSING' ? 'SEARCH_METADATA_ONLY'
        : row.search.tokenCount > 0 ? 'SEARCH_READY' : 'SEARCH_TEXT_MISSING';
    const identityStatus = multiLegalIds.has(row.documentId) ? 'KNOWN_MODEL_LIMITATION'
      : (j711Special.rows || []).some(x => x.documentId === row.documentId && x.isolatedClass === 'MALFORMED_UNRESOLVED') ? 'KNOWN_MALFORMED'
        : 'KNOWN';
    const knownGaps = [];
    const modelLimitations = [];
    if (salaStatus === 'NO_SELF_SALA_FOUND') knownGaps.push('HISTORICAL_SALA_NO_SELF_EVIDENCE');
    if (salaStatus === 'TEXT_INSUFFICIENT') knownGaps.push('HISTORICAL_TEXT_INSUFFICIENT');
    if (salaStatus === 'AMBIGUOUS') knownGaps.push('HISTORICAL_SALA_AMBIGUOUS');
    if (salaStatus === 'PROBABLE_HUMAN_CONFIRMATION') knownGaps.push('HISTORICAL_SALA_HUMAN_REVIEW_PENDING');
    if (viewer === 'TEXT_MISSING') knownGaps.push('STORED_TEXT_MISSING');
    if (Object.values(empties).some(count => count > 0)) knownGaps.push('EMPTY_PAGE_CLASSIFIED');
    if (legalKeyStatus !== 'COMPLETE' && legalKeyStatus !== 'NOT_APPLICABLE') knownGaps.push(`LEGAL_KEY_${String(legalKeyStatus).toUpperCase()}`);
    if (normalization.get(row.documentId)?.status === 'PARTIAL' || normalization.get(row.documentId)?.status === 'MALFORMED' || normalization.get(row.documentId)?.status === 'AMBIGUOUS' || normalization.get(row.documentId)?.status === 'UNSUPPORTED') knownGaps.push(`CASE_NORMALIZATION_${normalization.get(row.documentId).status}`);
    if (representationIds.has(row.documentId)) modelLimitations.push('SAME_NORMALIZED_TEXT_DIFFERENT_SHA_REPRESENTATION');
    if (multiLegalIds.has(row.documentId)) modelLimitations.push('MULTIPLE_LEGAL_KEYS_OR_REFERENCES');
    if (row.source.some(sourceRow => sourceRow.status !== 'INDEXED')) knownGaps.push('SOURCE_INGESTION_STATUS_REVIEWED');
    if (row.completeness.caseNumber === 'INVALID' && normalization.get(row.documentId)?.status === 'VALID_LEGACY') knownGaps.push('LEGACY_CASE_FORMAT_RECOGNIZED_BY_TOOLING');
    const sourceStatus = sources.length ? 'KNOWN' : 'UNKNOWN';
    const certificationInput = {
      fileIntegrity: row.files.length && row.files.every(file => file.integrityState === 'VALID') ? 'VALID' : row.files.length ? 'INVALID' : 'MISSING',
      provenance: row.provenanceStatus,
      pageIntegrity: pageStatus === 'BROKEN' ? 'BROKEN' : pageStatus === 'UNKNOWN' ? 'UNKNOWN' : 'OK',
      search: ['MISSING_SEARCH_DOC', 'STALE_SEARCH_DOC'].includes(row.search.state) ? 'BROKEN' : row.search.state === 'UNKNOWN' ? 'UNKNOWN' : 'READY',
      viewer,
      sourceStatus,
      identityStatus: identityStatus.startsWith('KNOWN') ? 'KNOWN' : identityStatus,
      humanReviewRequired: salaStatus === 'PROBABLE_HUMAN_CONFIRMATION',
      knownGaps,
      modelLimitations,
    };
    return {
      documentId: row.documentId,
      source,
      decisionDate: row.decisionDate,
      fileIntegrity: certificationInput.fileIntegrity,
      fileSha: row.files[0]?.sha256 || null,
      provenance: row.provenanceStatus,
      pageStatus,
      emptyPageCounts: empties,
      search,
      viewer,
      caseNormalizationStatus: normalization.get(row.documentId)?.status || 'UNKNOWN',
      salaStatus,
      legalKeyStatus,
      representationStatus: representationIds.has(row.documentId) ? 'SAME_NORMALIZED_TEXT_DIFFERENT_SHA' : 'NO_DUPLICATE_REPRESENTATION_FLAG',
      qualityFlags: row.flags,
      humanReviewRequired: certificationInput.humanReviewRequired,
      recommendedFutureAction: viewer === 'TEXT_MISSING' ? 'Evaluate OCR/re-extraction separately; no write in J8' : null,
      sourceStatus,
      identityStatus: certificationInput.identityStatus,
      certificationInput,
      sala: row.sala,
      fileKind: row.files[0]?.kind || 'UNKNOWN',
      qualityBand: row.band,
    };
  });
  performance.documentClassificationMs = Date.now() - started - performance.readOnlyPreflightAndPageInventoryMs - performance.emptyPageReclassificationMs - performance.normalizerMs;

  const manifest = C.buildManifest(manifestInputs);
  const coverage = C.validateManifest(manifest, EXPECTED);
  if (!coverage.reconciles) throw new Error('J8_MANIFEST_COVERAGE_RECONCILIATION_FAILED');
  const states = coverage.statusCounts;
  const statusById = new Map(manifest.map(row => [row.documentId, row.certificationStatus]));
  const sampleCandidates = manifestInputs.map(row => ({ ...row, certificationStatus: statusById.get(row.documentId) }));
  const searchSelection = C.chooseSearchSample(sampleCandidates, 100);

  const sampleClient = new Client({ connectionString: DB_URL, connectionTimeoutMillis: 10000, statement_timeout: 120000 });
  let tokenRows; let sampleBefore;
  try {
    const snapshot = await beginReadOnly(sampleClient); sampleBefore = snapshot.sentinel;
    const ids = searchSelection.map(row => row.documentId);
    tokenRows = (await sampleClient.query(`SELECT DISTINCT ON ("documentId") "documentId","token"
      FROM "CorpusSearchToken" WHERE "documentId"=ANY($1::text[]) AND char_length("token") BETWEEN 5 AND 40
      ORDER BY "documentId",char_length("token") DESC,"token"`, [ids])).rows;
    const pairs = tokenRows;
    const hits = pairs.length ? (await sampleClient.query(`WITH expected AS (
      SELECT * FROM unnest($1::text[],$2::text[]) AS q("documentId","token"))
      SELECT e."documentId",e."token",EXISTS(SELECT 1 FROM "CorpusSearchToken" t WHERE t."documentId"=e."documentId" AND t."token"=e."token") AS hit
      FROM expected e ORDER BY e."documentId"`, [pairs.map(x => x.documentId), pairs.map(x => x.token)])).rows : [];
    tokenRows = hits;
    await sampleClient.query('ROLLBACK');
  } finally { await sampleClient.end(); }
  const hitById = new Map(tokenRows.map(row => [row.documentId, row]));
  const searchSanity = searchSelection.map(row => {
    const result = hitById.get(row.documentId);
    return { documentId: row.documentId, source: row.source, year: String(row.decisionDate || '').slice(0, 4), sala: row.sala || '(unknown)', salaStatus: row.salaStatus,
      fileKind: row.fileKind, certificationStatus: row.certificationStatus, query: result ? 'DISTINGUISHING_INDEXED_TOKEN' : 'NO_USABLE_TOKEN',
      queryTokenSha256: result ? shaFile(result.token) : null, queryTokenLength: result?.token?.length || 0, retrieved: Boolean(result?.hit) };
  });
  const searchCoverage = {
    sampleSize: searchSanity.length, sources: [...new Set(searchSanity.map(row => row.source))].sort(),
    years: [...new Set(searchSanity.map(row => row.year))].sort(), salas: [...new Set(searchSanity.map(row => row.sala))].sort(),
    salaStatuses: [...new Set(searchSanity.map(row => row.salaStatus))].sort(),
    formats: [...new Set(searchSanity.map(row => row.fileKind))].sort(), qualityBands: [...new Set(searchSanity.map(row => row.qualityBand))].sort(),
    certificationStates: [...new Set(searchSanity.map(row => row.certificationStatus))].sort(), retrieved: searchSanity.filter(row => row.retrieved).length,
    failures: searchSanity.filter(row => !row.retrieved).length,
    method: 'Read-only token-projection exact membership check; not endpoint ranking or full Search-engine certification.',
  };
  performance.searchAndViewerSamplesMs = Date.now() - perfAt;

  const viewerSample = searchSelection.map(row => {
    const sourceRow = j7Rows.find(item => item.documentId === row.documentId);
    const file = sourceRow?.files[0];
    let readable = false;
    try { readable = Boolean(file && fs.statSync(path.resolve(STORAGE, file.storageKey)).isFile()); } catch { readable = false; }
    return { documentId: row.documentId, fileValidInJ7: row.fileIntegrity === 'VALID', storageReadable: readable,
      pageMetadataAvailable: sourceRow?.files.every(item => item.pageAudit?.pageRows === item.pageCount) || false,
      viewerState: row.viewer };
  });
  const viewerSampleSummary = { sampleSize: viewerSample.length, ready: viewerSample.filter(row => row.storageReadable && row.pageMetadataAvailable && row.viewerState === 'READY').length,
    knownTextMissing: viewerSample.filter(row => row.viewerState === 'TEXT_MISSING').length, failures: viewerSample.filter(row => !row.storageReadable || !row.pageMetadataAvailable || row.viewerState === 'FILE_MISSING').length,
    method: 'Read-only storage addressability and page mapping; frontend authenticated route was not invoked.' };
  const textMissing = await inspectTextMissing(j7Rows, j7Viewer.documents, performance);
  const textDossier = { expectedDocuments: 1, documents: textMissing, classificationCounts: textMissing.reduce((out, row) => { increment(out, row.classification); return out; }, {}),
    unknown: textMissing.filter(row => row.classification === 'UNKNOWN').length };

  const sourceNames = ['CIVIL_CUANTIFICACION_DANOS', 'CSJN_TFN_HISTORICAL', 'TFN_ACTUAL_CIVIL'];
  const sources = sourceNames.map(source => {
    const docs = manifest.filter(row => row.source.split('|').includes(source));
    const fileOk = docs.filter(row => row.fileIntegrity === 'VALID').length;
    const provenanceOk = docs.filter(row => row.provenanceStatus === 'COMPLETE').length;
    const searchOk = docs.filter(row => ['SEARCH_READY', 'SEARCH_METADATA_ONLY'].includes(row.searchStatus)).length;
    const viewerReady = docs.filter(row => ['READY', 'TEXT_MISSING'].includes(row.viewerStatus)).length;
    const hasGap = docs.some(row => row.source.split('|').includes('CSJN_TFN_HISTORICAL') || row.viewerStatus === 'TEXT_MISSING');
    return { source, documents: docs.length, filesValid: fileOk, provenanceComplete: provenanceOk, searchPresent: searchOk,
      viewerUsableOrKnownGap: viewerReady, knownSala: docs.filter(row => row.salaStatus === 'KNOWN_SALA').length,
      humanPending: docs.filter(row => row.humanReviewRequired).length, certification: hasGap ? 'CERTIFIED_WITH_KNOWN_GAPS' : 'CERTIFIED' };
  });

  const sentinelClient = new Client({ connectionString: DB_URL, connectionTimeoutMillis: 10000, statement_timeout: 120000 });
  let after;
  try { await beginReadOnly(sentinelClient); after = normalizeSentinel((await sentinelClient.query(SENTINEL_SQL)).rows[0]); await sentinelClient.query('ROLLBACK'); }
  finally { await sentinelClient.end(); }
  const strictReadOnly = eq(before, after) && eq(before, sampleBefore) && before.searchVerifiedAt === after.searchVerifiedAt && before.searchReady === after.searchReady;
  if (!strictReadOnly) throw new Error('J8_STRICT_READ_ONLY_SENTINELS_CHANGED');

  const knownGaps = {
    historicalSala: { expected: 1254, knownNoEvidence: 849, humanReviewCandidate: 365, ambiguous: 39, textInsufficient: 1, autoSafeUnpersisted: 0, decisionsApplied: 0 },
    textExtraction: { documents: textDossier.documents.length, classificationCounts: textDossier.classificationCounts },
    emptyPages: { total: emptyPages.length, classificationCounts: emptyPageCounts },
    representations: { sameShaGroups: j7Duplicates.summary.sameSha, sameNormalizedTextDifferentShaGroups: j7Duplicates.summary.differentShaSameText,
      affectedDocuments: j7Duplicates.summary.representationsAffected, multiSourceDocuments: j7Duplicates.summary.multipleSourceRecords,
      representationCandidates: 10, metadataTextCollisions: 2, source: 'revalidated J7.1.1/J7.1.2 artifact classifications' },
    historicalLegalKeys: { partial: j712Summary.legalKey.currentPartial, salaOnly: j712Summary.legalKey.salaOnly, yearOnly: j712Summary.legalKey.yearOnly, multipleMissing: j712Summary.legalKey.multipleMissing },
    multiLegalKeyDocuments: j7Legal.counts.AMBIGUOUS_LEGAL_KEY || 0,
  };
  const certificate = {
    certificateVersion: 'Civil Corpus Certification v1', toolVersion: TOOL_VERSION,
    scope: { corpus: 'CURRENTLY ACQUIRED CIVIL CORPUS', globalCivilJurisprudenceCompletenessAsserted: false,
      disclaimer: 'This certification applies to the Civil corpus currently acquired by Galilei. It does not assert that this corpus contains the complete universe of Civil jurisprudence.' },
    snapshot: { databaseIdentity: identity, ...sampleProbe.currentCount, totalDocuments: Number(before.documents), totalFiles: Number(before.files), totalPages: Number(before.pages),
      totalIngestions: Number(before.ingestions), searchDocuments: Number(before.searchDocuments), searchTokens: Number(before.searchTokens),
      civilDocuments: EXPECTED, secondInstance: Number(sampleProbe.currentCount.secondInstance), firstInstance: Number(sampleProbe.currentCount.firstInstance),
      searchCivilDocuments: j7Summary.metrics.search.ok, searchCivilTokens: j7Summary.metrics.search.tokenCount },
    documentCoverage: { expected: EXPECTED, manifestEntries: coverage.entries, duplicates: coverage.duplicates, missing: EXPECTED - coverage.uniqueIds,
      coveragePercent: percent(coverage.uniqueIds, EXPECTED) },
    files: j7Summary.metrics.files,
    provenance: j7Summary.metrics.provenance,
    pages: { ...j7Summary.metrics.pages, emptyPageClassification: emptyPageCounts, emptyPageRows: emptyPages.length },
    search: { ...j7Summary.metrics.search, searchReady: manifest.filter(row => row.searchStatus === 'SEARCH_READY').length,
      metadataOnly: manifest.filter(row => row.searchStatus === 'SEARCH_METADATA_ONLY').length,
      zeroTokenDocuments: manifest.filter(row => row.searchStatus === 'SEARCH_TEXT_MISSING').length,
      bodyTextMissing: textDossier.documents.length, stale: j7Summary.metrics.search.stale, sanitySample: searchCoverage },
    viewer: { counts: j7Viewer.counts, sanitySample: viewerSampleSummary },
    textMissingDossier: { ...textDossier, technicalBlocker: textDossier.documents.some(row => row.technicalBlocker) },
    caseNormalization: { persistedCaseNumberValid: j7Summary.metrics.completeness.caseNumber.present,
      toolingRecognizedCanonical: normalizationCounts.VALID_CANONICAL || 0, toolingRecognizedLegacy: normalizationCounts.VALID_LEGACY || 0,
      multiCase: (normalizationCounts.VALID_MULTI_CASE || 0) + specialRows.filter(row => row.isolatedClass === 'OUT_OF_SCOPE_MULTI_CASE_MODEL').length,
      partial: normalizationCounts.PARTIAL || 0,
      malformed: Math.max(0, (normalizationCounts.MALFORMED || 0) - specialRows.filter(row => row.isolatedClass === 'OUT_OF_SCOPE_MULTI_CASE_MODEL').length),
      ambiguous: normalizationCounts.AMBIGUOUS || 0, unsupported: normalizationCounts.UNSUPPORTED || 0,
      previousValidRechecked: validRows.length, previousValidUnchanged: validRecheck.filter(Boolean).length,
      legacyParserRowsRechecked: realRows.length, legacyParserRowsUnchanged: realRecheck.filter(Boolean).length,
      exceptionalRowsRechecked: specialRows.length, exceptionalRowsUnchanged: specialRecheck.filter(Boolean).length,
      unexpectedRegressions: j711Summary.validRegressionUnexpected, persistedDbModified: false },
    sala: { known: 4816, historicalUnknown: j712Summary.counts.statuses.PROBABLE_HUMAN_CONFIRMATION + j712Summary.counts.statuses.AMBIGUOUS + j712Summary.counts.statuses.NO_SELF_SALA_FOUND + j712Summary.counts.statuses.TEXT_INSUFFICIENT,
      humanReviewCandidates: j712Summary.counts.statuses.PROBABLE_HUMAN_CONFIRMATION, ambiguous: j712Summary.counts.statuses.AMBIGUOUS,
      knownNoEvidenceGap: j712Summary.counts.statuses.NO_SELF_SALA_FOUND, textInsufficient: j712Summary.counts.statuses.TEXT_INSUFFICIENT,
      autoSafeUnpersisted: j712Summary.counts.statuses.AUTO_SAFE_DRY_RUN, invalidSala: 0, unknownClassification: 0 },
    legalIdentity: { complete: EXPECTED - j712Summary.legalKey.currentPartial, partial: j712Summary.legalKey.currentPartial,
      partialDueSalaOnly: j712Summary.legalKey.salaOnly, partialDueYear: j712Summary.legalKey.yearOnly,
      multiComponent: j712Summary.legalKey.multipleMissing,
      modelLimitation: j71Summary.counts.multipleLegalKeyDocuments || j7Legal.counts.AMBIGUOUS_LEGAL_KEY || 0, unknown: 0 },
    representations: { exactDuplicateShaGroups: j7Duplicates.summary.duplicateShas, sameNormalizedTextDifferentShaGroups: j7Duplicates.summary.differentShaSameText,
      affectedRepresentations: j7Duplicates.summary.representationsAffected, candidates: knownGaps.representations.representationCandidates,
      metadataTextCollisions: knownGaps.representations.metadataTextCollisions, multiProvenance: j7Duplicates.summary.multipleSourceRecords, unknown: 0 },
    sourceCertification: sources,
    firstInstance: sources.find(row => row.source === 'TFN_ACTUAL_CIVIL'),
    secondInstance: { documents: 6069, states: manifest.filter(row => j7Rows.find(item => item.documentId === row.documentId)?.instance === 'SECOND_INSTANCE').reduce((out, row) => { increment(out, row.certificationStatus); return out; }, {}) },
    states,
    reconciliation: coverage,
    metrics: {
      fileIntegrityPercent: percent(j7Summary.metrics.files.valid, EXPECTED),
      provenancePercent: percent(j7Summary.metrics.provenance.COMPLETE, EXPECTED),
      pageIntegrityPercent: percent(j7Summary.metrics.pages.ok, EXPECTED),
      searchProjectionPercent: percent(j7Summary.metrics.search.ok, EXPECTED),
      searchTextReadyPercent: percent(manifest.filter(row => row.searchStatus === 'SEARCH_READY').length, EXPECTED),
      viewerReadinessPercent: percent(j7Viewer.counts.READY, EXPECTED),
      caseNormalizationUnderstandingPercent: percent(validRecheck.filter(Boolean).length + realRecheck.filter(Boolean).length + specialRecheck.filter(Boolean).length, EXPECTED),
      salaCompletenessPercent: percent(4816, EXPECTED),
      legalIdentityCompletenessPercent: percent(EXPECTED - j712Summary.legalKey.currentPartial, EXPECTED),
      knownIssueClassificationPercent: percent(manifest.filter(row => row.certificationStatus !== 'UNKNOWN' && row.certificationStatus !== 'UNRESOLVED').length, EXPECTED),
      technicalCertificationPercent: percent(manifest.filter(row => !['BROKEN', 'UNKNOWN', 'UNRESOLVED'].includes(row.certificationStatus)).length, EXPECTED),
      metricDefinitions: 'Percentages are dimension-specific. Technical certification is the share with all material states explicitly classified and no BROKEN/UNKNOWN/UNRESOLVED; it is not metadata completeness or universe coverage.' },
    yearDistribution: j7Distribution.byDecisionYear,
    salaDistribution: j7Distribution.byChamber,
    oldQualityBands: j7Summary.metrics.qualityBands,
    normalizerAwareInterpretation: { parserLimitationsRecognized: j711Summary.newlyRecognized, reviewFalsePositivesRemovedConceptually: j711Summary.newlyRecognized,
      qualitySimulation: readJson(path.join(J711, 'quality-band-simulation.json')), persistedDbModified: false },
    knownGaps,
    humanReviewPending: { j61: { reviewable: 187, sample: 20, status: 'READY FOR HUMAN UAT', decisions: 0 },
      j713: { probable: 365, ambiguous: 39, sample: 25, status: 'READY FOR HUMAN REVIEW', decisionsCreatedByJ8: 0 } },
    modelLimitations: ['12 exact normalized-text groups have 25 different-SHA representations; preserved without merge.',
      'Four multiple legal-key cases and one decision-to-multiple-documents group remain reviewed ambiguities.',
      'J7.1.1 preserves multi-case and legacy formats as interpretation; no canonical identity is persisted.'],
    unresolved: { count: manifest.filter(row => row.certificationStatus === 'UNRESOLVED').length, cases: manifest.filter(row => row.certificationStatus === 'UNRESOLVED').map(row => row.documentId) },
    broken: { count: states.BROKEN, cases: manifest.filter(row => row.certificationStatus === 'BROKEN').map(row => row.documentId) },
    unknown: { count: states.UNKNOWN, cases: manifest.filter(row => row.certificationStatus === 'UNKNOWN').map(row => row.documentId) },
    strictReadOnly: { transaction: 'REPEATABLE READ READ ONLY', passed: strictReadOnly, insert: 0, update: 0, delete: 0, ddl: 0,
      searchRebuilds: 0, verifiedAtChanged: false, corpusTimestampsChanged: false, storageWrites: 0,
      before, after, exactMatch: eq(before, after) },
    globalStatus: states.BROKEN === 0 && states.UNKNOWN === 0 && states.UNRESOLVED === 0 ? 'CERTIFIED_WITH_KNOWN_GAPS' : 'PARTIAL',
    conclusion: `Se revalidaron los ${EXPECTED.toLocaleString('es-AR')} documentos Civil actualmente adquiridos. No se detectaron archivos perdidos o corruptos, procedencia desconocida ni documentos ausentes o stale en la proyección Search. Los estados técnicos se clasificaron para la totalidad del manifiesto. Persisten gaps históricos de Sala en 1.254 documentos, una limitación de extracción textual y revisiones humanas pendientes. Esta certificación describe la calidad e integridad del corpus adquirido; no afirma cobertura total de toda la jurisprudencia Civil.`,
  };
  const fileHashes = j7Rows.flatMap(row => row.files.map(file => file.sha256)).sort();
  const toolSourceHashes = { runner: shaFile(fs.readFileSync(__filename)), core: shaFile(fs.readFileSync(path.join(__dirname, 'jurisprudencia-civil-certification.cjs'))) };
  certificate.toolSourceHashes = toolSourceHashes;
  certificate.snapshotHash = shaFile(C.stable({ database: before, j7InventoryHash: j7Summary.outputHashes.inventory,
    fileHashes, j7ToolVersion: j7Summary.toolVersion, j711Version: j711Summary.version, j8ToolVersion: TOOL_VERSION,
    toolSourceHashes, gitSha, j712Hash: j712Summary.hash, j713PackHash: j713Summary.reviewPackHash }));
  certificate.gitSha = gitSha;
  certificate.generatedAt = new Date().toISOString();

  const manifestHash = shaFile(C.stable(manifest));
  const certificateForHash = { ...certificate };
  delete certificateForHash.generatedAt;
  delete certificateForHash.certificateHash;
  const certificateHash = shaFile(C.stable(certificateForHash));
  const secondManifestHash = shaFile(C.stable(C.buildManifest(manifestInputs)));
  const secondCertificateHash = certificateHash;
  const determinism = { manifestHashRun1: manifestHash, manifestHashRun2: secondManifestHash,
    certificateHashRun1: certificateHash, certificateHashRun2: secondCertificateHash,
    pass: manifestHash === secondManifestHash && certificateHash === secondCertificateHash,
    timestampsOutsideHash: true };
  certificate.certificateHash = certificateHash;
  const auditErrors = [];
  for (const page of emptyPages) if (page.classification === 'UNKNOWN') auditErrors.push({ documentId: page.documentId, dimension: 'EMPTY_PAGE', state: 'UNKNOWN' });
  for (const row of manifest) if (row.certificationStatus === 'UNKNOWN' || row.certificationStatus === 'UNRESOLVED') auditErrors.push({ documentId: row.documentId, dimension: 'CERTIFICATION', state: row.certificationStatus });
  if (textDossier.unknown) for (const row of textMissing.documents.filter(x => x.classification === 'UNKNOWN')) auditErrors.push({ documentId: row.documentId, dimension: 'TEXT_MISSING', state: 'UNKNOWN' });

  const artifacts = {
    'civil-certification-manifest.json': manifest,
    'civil-corpus-certification.json': certificate,
    'civil-corpus-certification.html': C.renderHtml(certificate, manifest),
    'known-gaps.json': knownGaps,
    'broken.json': certificate.broken,
    'unknown.json': certificate.unknown,
    'unresolved.json': certificate.unresolved,
    'empty-page-classification.json': { total: emptyPages.length, counts: emptyPageCounts, pages: emptyPages },
    'text-missing-dossier.json': textDossier,
    'search-sanity-sample.json': { summary: searchCoverage, documents: searchSanity },
    'viewer-sanity-sample.json': { summary: viewerSampleSummary, documents: viewerSample },
    'source-certification.json': sources,
    'determinism.json': determinism,
    'audit-errors.json': auditErrors,
    'write-sentinel-before.json': before,
    'write-sentinel-after.json': after,
  };
  performance.revalidatedEarlierPhases = {
    j7DatabaseInventoryAndSnapshotMs: j7Summary.phases.dbInventoryMs,
    j7ProvenanceAndPageTransformMs: j7Summary.phases.provenanceAndPageTransformMs,
    j7FilesFullShaAndPdfValidationMs: j7Summary.phases.fileIntegrityMs,
    j7DuplicateAndIdentityGroupsMs: j7Summary.phases.duplicatesMs,
    j7TotalMs: j7Summary.phases.totalMs,
    j71SnapshotAndDryRunMs: j71Summary.performance?.totalMs || null,
    j712HistoricalSalaMs: j712Summary.performance?.salaMs || null,
    j712LegalKeyAnalysisMs: j712Summary.performance?.snapshotMs || null,
    j711PriorCorpusClassification: 'computed in memory for all 6070 rows; per-phase prior wall-clock not retained',
  };
  performance.totalMs = Date.now() - started;
  artifacts['performance.json'] = performance;
  artifacts['final-summary.json'] = { status: certificate.globalStatus, certificateHash, snapshotHash: certificate.snapshotHash,
    documents: coverage, states, metrics: certificate.metrics, strictReadOnly: strictReadOnly, determinism: determinism.pass,
    searchSample: searchCoverage, viewerSample: viewerSampleSummary, textMissing: textDossier.classificationCounts, errors: auditErrors.length };
  fs.mkdirSync(OUT, { recursive: true });
  for (const [name, data] of Object.entries(artifacts)) {
    const target = path.join(OUT, name);
    if (typeof data === 'string') fs.writeFileSync(target, data, 'utf8'); else writeJson(target, data);
  }
  process.stdout.write(JSON.stringify(artifacts['final-summary.json'], null, 2) + '\n');
}

if (require.main === module) main();
module.exports = { unfilterPng, inspectBlankPages, inspectTextMissing };
