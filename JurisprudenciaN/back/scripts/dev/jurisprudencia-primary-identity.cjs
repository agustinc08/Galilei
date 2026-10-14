'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { Client } = require('pg');
const { PDFParse } = require('pdf-parse');
const { extractDocketCandidates } = require('./jurisprudencia-candidate-recovery.cjs');
const { docket, fold } = require('./jurisprudencia-review-workflow.cjs');

const ROOT = path.resolve(__dirname, '..', '..', '..', '..');
const BACKEND = path.resolve(__dirname, '..', '..');
const OUT = path.join(ROOT, '_recovery-work', 'jurisprudencia-j6');
const J1 = path.join(ROOT, '_recovery-work', 'jurisprudencia-j1', 'runs', '2026-10-14T04-16-00-544Z', 'review-input.json');
const J5 = path.join(ROOT, '_recovery-work', 'jurisprudencia-j5');
const PDF_ROOT = path.join(ROOT, '_recovery-work', 'sprint146', 'viewer', 'objects');
const TEXT_CACHE_PATH = path.join(OUT, 'page-evidence-cache.json');
const EXPECTED = { total: 451, structural: 321, multi: 194, collisions: 127, candidates: 106, sourceData: 6, ready: 2, model: 16 };
const sha = value => crypto.createHash('sha256').update(value).digest('hex');
const readJson = p => JSON.parse(fs.readFileSync(p, 'utf8'));
const writeJson = (name, value) => fs.writeFileSync(path.join(OUT, name), `${JSON.stringify(value, null, 2)}\n`, 'utf8');
const str = value => value == null ? '' : String(value).trim();
const uniq = values => [...new Set(values.map(str).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'en'));
const normCase = value => {
  const valueText = docket(value);
  const match = valueText.match(/(\d[\d.\s]*)\s*\/\s*(\d{2,4})/u);
  return match ? `${match[1].replace(/\D/gu, '')}/${match[2]}` : valueText.replace(/[^A-Z0-9/.-]/giu, '').replace(/\s+/gu, '').toUpperCase();
};
const csvCell = value => { const s = String(value ?? ''); return /[",\r\n]/u.test(s) ? `"${s.replace(/"/gu, '""')}"` : s; };
const csvText = (headers, rows) => `${[headers, ...rows].map(row => row.map(csvCell).join(',')).join('\r\n')}\r\n`;
function assertTarget(raw) {
  if (!raw) throw new Error('J6_DATABASE_URL_MISSING');
  const u = new URL(raw);
  if (u.protocol !== 'postgresql:' || u.hostname !== '127.0.0.1' || u.port !== '55432' ||
      u.pathname !== '/buscador_juridico_civil_dev' || u.username !== 'bjc_dev') throw new Error('J6_DEV_TARGET_REJECTED');
}
function candidateOccurrences(pages) {
  const all = [];
  for (let pageIndex = 0; pageIndex < pages.length; pageIndex++) {
    const text = String(pages[pageIndex] ?? '').normalize('NFC');
    const re = /(?:\b(?:EXPTE?|EXPEDIENTE|CAUSA|LIBRE|CIV(?:IL)?|L\.?\s*CIV|EX)\.?\s*(?:N(?:RO)?\s*[.°º]*\s*)?)(\d{1,3}(?:[.\s]\d{3})+|\d{1,6})\s*\/\s*(\d{2,4})/giu;
    for (const match of text.matchAll(re)) {
      const compact = `${match[1]}${match[2]}`.replace(/\D/gu, '');
      const display = `${match[1].replace(/[.\s]/gu, '')}/${match[2]}`;
      const start = match.index ?? 0;
      const context = text.slice(Math.max(0, start - 140), Math.min(text.length, start + match[0].length + 140)).replace(/\s+/gu, ' ').trim();
      const upper = fold(text.slice(Math.max(0, start - 240), start));
      const after = fold(text.slice(start + match[0].length, Math.min(text.length, start + match[0].length + 260)));
      const markerPattern = /SE RESUELVE|RESUELVE\s*:|POR ELLO|FALLA\s*:|RESUELVO|Y VISTOS/giu;
      const nearbyMarkers = [...text.matchAll(markerPattern)].map(item => item.index ?? 0).filter(position => Math.abs(position - start) <= 420);
      const resolutoryMarkerOffset = nearbyMarkers.sort((a, b) => Math.abs(a - start) - Math.abs(b - start))[0] ?? null;
      const firstPages = pageIndex < 3;
      const header = firstPages && (start < 2800 || /EXPTE|EXPEDIENTE|AUTOS|CARATULAD|PARA CONOCER|EN LOS AUTOS/.test(upper));
      const resolutory = resolutoryMarkerOffset != null;
      const citation = /\bCONF\.?\b|JURISPRUDENCIA CITADA|PRECEDENTE|CITA(?:DO|DA|N)?|FALLO CITADO/.test(upper) && !header;
      const accumulation = /ACUMULAD|ACUMULACION|CONEX|REUNID|ACUMULADOS/.test(upper) || /ACUMULAD|ACUMULACION|CONEX|REUNID|ACUMULADOS/.test(after);
      all.push({ caseNumber: display, normalizedCaseNumber: compact, page: pageIndex + 1, offset: start, context,
        zone: firstPages ? (header ? 'OPENING_HEADER' : 'OPENING_BODY') : 'BODY', header, resolutory, resolutoryMarkerOffset, citation, accumulation });
    }
  }
  return all.sort((a, b) => a.page - b.page || a.offset - b.offset || a.normalizedCaseNumber.localeCompare(b.normalizedCaseNumber));
}
function documentStructure(pages) {
  const officialHeaders = [];
  const dispositive = [];
  const accumulationPhrases = [];
  const headerPattern = /PODER JUDICIAL DE LA NACI[ÓO]N/giu;
  const dispositivePattern = /SE RESUELVE|RESUELVE\s*:|POR ELLO|FALLA\s*:|RESUELVO|Y VISTOS/giu;
  for (let pageIndex = 0; pageIndex < pages.length; pageIndex++) {
    const text = String(pages[pageIndex] || '').normalize('NFC'); const upper = fold(text);
    for (const match of upper.matchAll(headerPattern)) {
      const offset = match.index ?? 0; const vicinity = upper.slice(offset, offset + 900);
      const rawVicinity = text.slice(offset, offset + 900);
      const hasCourt = /CAMARA CIVIL|JUZGADO NACIONAL|JUZGADO CIVIL/.test(vicinity);
      const docketMatches = extractDocketCandidates(rawVicinity);
      const hasCase = docketMatches.length > 0;
      const hasDate = /BUENOS AIRES.{0,180}(?:A LOS.{0,80}DIAS|\b\d{1,2}\s+DE\s+(?:ENERO|FEBRERO|MARZO|ABRIL|MAYO|JUNIO|JULIO|AGOSTO|SEPTIEMBRE|OCTUBRE|NOVIEMBRE|DICIEMBRE).{0,40}\b20\d{2}\b)/.test(vicinity);
      // A legal document can quote judicial headers in its body. Count a new decision heading
      // only near a page start, where a concatenated decision would ordinarily begin.
      if (offset <= 600 && hasCourt && hasCase && hasDate) officialHeaders.push({ page: pageIndex + 1, offset, caseNumbers: uniq(docketMatches) });
    }
    for (const match of upper.matchAll(dispositivePattern)) dispositive.push({ page: pageIndex + 1, offset: match.index ?? 0, marker: match[0] });
    for (const match of upper.matchAll(/ACUMULAD[OA]S?|ACUMULACI[ÓO]N|CONEX[OA]S?|SENTENCIA UNICA/giu)) accumulationPhrases.push({ page: pageIndex + 1, offset: match.index ?? 0, phrase: match[0] });
  }
  const resolutionClusters = [];
  for (const marker of dispositive) {
    const previous = resolutionClusters.at(-1);
    if (previous && previous.page === marker.page && marker.offset - previous.endOffset <= 1000) {
      previous.endOffset = marker.offset; previous.markers.push(marker.marker);
    } else resolutionClusters.push({ page: marker.page, offset: marker.offset, endOffset: marker.offset, markers: [marker.marker] });
  }
  const decisionSegments = officialHeaders.map((header, index) => {
    const next = officialHeaders[index + 1];
    const segmentMarkers = resolutionClusters.filter(marker => (marker.page > header.page || (marker.page === header.page && marker.offset >= header.offset)) &&
      (!next || marker.page < next.page || (marker.page === next.page && marker.offset < next.offset)));
    return { ...header, dispositiveCount: segmentMarkers.length };
  });
  const qualifiedSegments = decisionSegments.filter(segment => segment.dispositiveCount > 0 && segment.caseNumbers.length > 0);
  const distinctDecisionCases = uniq(qualifiedSegments.map(segment => segment.caseNumbers[0]));
  return { officialHeaders, resolutionClusters, decisionSegments, accumulationPhrases,
    qualifiedSegments, distinctDecisionCases,
    trueMultiDecisionEvidence: qualifiedSegments.length >= 2 && distinctDecisionCases.length >= 2 };
}
function classifyDocument({ occurrences, sourceCases, sourceRows, corpusCases = [], sourceMetadata = [], corpusMetadata = [], pageCount = 0, structure = null }) {
  structure ||= documentStructure([]);
  const normalizedSources = uniq(sourceCases.map(value => normCase(value).replace(/\D/gu, '')));
  const normalizedCorpus = uniq(corpusCases.map(value => normCase(value).replace(/\D/gu, '')));
  const groups = new Map();
  for (const occurrence of occurrences) {
    if (!groups.has(occurrence.normalizedCaseNumber)) groups.set(occurrence.normalizedCaseNumber, []);
    groups.get(occurrence.normalizedCaseNumber).push(occurrence);
  }
  const candidates = [...groups.entries()].map(([key, rows]) => {
    const header = rows.filter(row => row.header).length;
    const resolutory = rows.filter(row => row.resolutory).length;
    const opening = rows.filter(row => row.page <= 3).length;
    const cited = rows.filter(row => row.citation).length;
    const sourceMatch = normalizedSources.includes(key);
    const corpusMatch = normalizedCorpus.includes(key);
    const score = (header ? 4 : 0) + (opening ? 2 : 0) + (resolutory ? 3 : 0) + (sourceMatch ? 2 : 0) + (corpusMatch ? 2 : 0) - (cited > header + resolutory ? 2 : 0);
    return { caseNumber: rows[0].caseNumber, normalizedCaseNumber: key, occurrences: rows.length,
      pages: uniq(rows.map(row => row.page)).map(Number).sort((a, b) => a - b), header, opening, resolutory, citation: cited,
      sourceMetadataMatch: sourceMatch, corpusMetadataMatch: corpusMatch, score,
      evidence: [header && 'OPENING_HEADER', opening && 'FIRST_THREE_PAGES', resolutory && 'RESOLUTORY_PROXIMITY', sourceMatch && 'SOURCE_CASE_MATCH', corpusMatch && 'CORPUS_CASE_MATCH'].filter(Boolean) };
  }).sort((a, b) => b.score - a.score || b.header - a.header || b.resolutory - a.resolutory || a.normalizedCaseNumber.localeCompare(b.normalizedCaseNumber));
  const top = candidates[0]; const second = candidates[1];
  const dispositiveMarkers = structure.resolutionClusters;
  const decisiveCount = dispositiveMarkers.length;
  const separatedHeaders = structure.officialHeaders.length;
  const distinctDispositiveZones = structure.decisionSegments.filter(segment => segment.dispositiveCount > 0).length;
  const qualifiedSegments = structure.qualifiedSegments || structure.decisionSegments.filter(segment => segment.dispositiveCount > 0 && segment.caseNumbers.length > 0);
  const segmentCaseSets = qualifiedSegments.map(segment => new Set(segment.caseNumbers.map(value => String(value).replace(/\D/gu,''))));
  const independentCaseSets = segmentCaseSets.length >= 2 && segmentCaseSets.every((set, index) => segmentCaseSets.slice(index + 1).every(next => [...set].every(value => !next.has(value))));
  const multiDecisionEvidence = qualifiedSegments.length >= 2 && independentCaseSets;
  const headerCases = candidates.filter(row => row.header >= 1).length;
  const accumulated = !multiDecisionEvidence && structure.accumulationPhrases.length > 0 && headerCases >= 2;
  let classification = 'INSUFFICIENT'; let primaryStatus = top ? 'PRIMARY_CASE_PROBABLE' : 'NO_PRIMARY_CASE_FOUND';
  if (multiDecisionEvidence) { classification = 'TRUE_MULTI_DECISION_PDF'; primaryStatus = 'AMBIGUOUS_PRIMARY_CASE'; }
  else if (accumulated) { classification = 'MULTI_CASE_SINGLE_DECISION'; primaryStatus = top && top.score >= 6 ? 'PRIMARY_CASE_CONFIRMED' : 'PRIMARY_CASE_PROBABLE'; }
  else if (top && second && top.score - second.score <= 1) { classification = 'AMBIGUOUS'; primaryStatus = 'AMBIGUOUS_PRIMARY_CASE'; }
  else if (top && (top.header > 0 && (top.resolutory > 0 || top.sourceMetadataMatch || top.corpusMetadataMatch))) {
    classification = 'SINGLE_DECISION_PRIMARY_CASE'; primaryStatus = top.score >= 8 ? 'PRIMARY_CASE_CONFIRMED' : 'PRIMARY_CASE_PROBABLE';
  } else if (!occurrences.length || !top || !top.header) { classification = 'INSUFFICIENT'; primaryStatus = 'NO_PRIMARY_CASE_FOUND'; }
  const roles = candidates.map((item, index) => ({ caseNumber: item.caseNumber, normalizedCaseNumber: item.normalizedCaseNumber,
    pages: item.pages, occurrences: item.occurrences, header: item.header > 0, resolutory: item.resolutory > 0,
    sourceMetadata: item.sourceMetadataMatch, role: index === 0 && primaryStatus.startsWith('PRIMARY_CASE_') ? 'PRIMARY' :
      item.citation && !item.header ? 'SECONDARY_REFERENCE' : item.header && (normalizedSources.length > 1 || accumulated) ? 'RELATED_CASE' : 'UNKNOWN_ROLE' }));
  const multipleRows = sourceRows.length > 1;
  const exactDuplicateRows = multipleRows && new Set(sourceRows.map(row => JSON.stringify([row.source_key,row.external_id,row.quantification_id,row.case_number,row.court,row.chamber,row.decision_date,row.title,row.sha256]))).size === 1;
  const sourcePrimaryMatch = Boolean(top && top.sourceMetadataMatch); const corpusPrimaryMatch = Boolean(top && top.corpusMetadataMatch);
  let collisionType = 'UNKNOWN';
  const sourceIdentitySet = uniq(sourceMetadata.map(item => `${normCase(item.caseNumber)}|${fold(item.court)}|${fold(item.chamber)}|${String(item.decisionDate || '').slice(0,10)}`));
  if (multipleRows) collisionType = 'MULTIPLE_SOURCE_ROWS';
  else if (sourceMetadata.length && corpusMetadata.length && sourceIdentitySet.length && sourceIdentitySet.every(key => normalizedSources.includes(key.split('|')[0])) && top && sourcePrimaryMatch && corpusPrimaryMatch) collisionType = 'NORMALIZATION_FALSE_CONFLICT';
  else if (top && sourcePrimaryMatch && !corpusPrimaryMatch && corpusMetadata.length) collisionType = 'SOURCE_RIGHT_CORPUS_WRONG';
  else if (top && !sourcePrimaryMatch && corpusPrimaryMatch && corpusMetadata.length) collisionType = 'SOURCE_WRONG_CORPUS_RIGHT';
  else if (sourceMetadata.length && corpusMetadata.length && sourcePrimaryMatch && corpusPrimaryMatch) {
    const sourceDates = uniq(sourceMetadata.map(item => String(item.decisionDate || '').slice(0,10)));
    const corpusDates = uniq(corpusMetadata.map(item => String(item.decisionDate || '').slice(0,10)));
    const sourceCourts = uniq(sourceMetadata.map(item => fold(item.court)));
    const corpusCourts = uniq(corpusMetadata.map(item => fold(item.court)));
    const sourceChambers = uniq(sourceMetadata.map(item => fold(item.chamber).replace(/^SALA /u,'')));
    const corpusChambers = uniq(corpusMetadata.map(item => fold(item.chamber).replace(/^SALA /u,'')));
    if (sourceDates.length && corpusDates.length && sourceDates[0] !== corpusDates[0]) collisionType = 'DATE_CONFLICT';
    else if (sourceCourts.length && corpusCourts.length && sourceCourts[0] !== corpusCourts[0]) collisionType = 'COURT_CONFLICT';
    else if (sourceChambers.length && corpusChambers.length && sourceChambers[0] !== corpusChambers[0]) collisionType = 'SALA_CONFLICT';
    else collisionType = 'NORMALIZATION_FALSE_CONFLICT';
  }
  else if (top && !sourcePrimaryMatch && !corpusPrimaryMatch && sourceMetadata.length && corpusMetadata.length) collisionType = 'SOURCE_AND_CORPUS_CONFLICT';
  else if (sourceMetadata.some(item => {
    const sourceParts = normCase(item.caseNumber).split('/');
    const primaryParts = String(top?.caseNumber || '').match(/^(\d+)\/(\d{2,4})$/u);
    return Boolean(primaryParts && sourceParts.length === 2 && sourceParts[0].replace(/\D/gu,'') === primaryParts[1] && sourceParts[1].slice(-2) !== primaryParts[2].slice(-2));
  })) collisionType = 'CASE_YEAR_CONFLICT';
  const actions = { SOURCE_WRONG_CORPUS_RIGHT: 'REVIEW_SOURCE', SOURCE_RIGHT_CORPUS_WRONG: 'CORRECT_CORPUS_PROPOSAL',
    MULTIPLE_SOURCE_ROWS: exactDuplicateRows ? 'MERGE_SOURCE_DUPLICATES_PROPOSAL' : 'HUMAN_DECISION', NORMALIZATION_FALSE_CONFLICT: 'KEEP_CORPUS',
    SOURCE_AND_CORPUS_CONFLICT: 'HUMAN_DECISION', CASE_YEAR_CONFLICT: 'HUMAN_DECISION', UNKNOWN: 'NO_ACTION' };
  return { classification, primaryStatus, proposedPrimaryCase: top?.caseNumber || null, candidates, roles,
    decisionEvidence: { separatedHeaders, dispositiveMarkers: decisiveCount, distinctDispositiveZones,
      multiDecisionEvidence, independentDocketSegments: independentCaseSets, accumulationEvidence: Boolean(accumulated), officialHeaderCount: separatedHeaders,
      resolutoryClusterCount: decisiveCount, accumulationPhrases: structure.accumulationPhrases, pageCount },
    collisionType, proposedMetadataAction: actions[collisionType] || 'HUMAN_DECISION', sourceRowsAreExactDuplicates: exactDuplicateRows };
}
function locateDocketTokens(text) { return extractDocketCandidates(text); }
function qMarks(values) { return values.map((_, i) => `$${i + 1}`).join(','); }
const J6_DECISIONS = new Set(['PRIMARY_CASE_CONFIRMED','MULTI_CASE_SINGLE_DECISION','TRUE_MULTI_DECISION_PDF','AMBIGUOUS_PRIMARY_CASE','SOURCE_CORRECT','CORPUS_CORRECT','PDF_DERIVED_CORRECT','CONFLICT_UNRESOLVED','OTHER']);
function validateJ6DecisionCsv(text, knownGroups) {
  const lines = []; let row = []; let cell = ''; let quoted = false; const input = String(text || '').replace(/^\uFEFF/u, '');
  for (let index = 0; index < input.length; index++) {
    const char = input[index];
    if (quoted && char === '"' && input[index + 1] === '"') { cell += '"'; index++; }
    else if (char === '"') quoted = !quoted;
    else if (!quoted && char === ',') { row.push(cell); cell = ''; }
    else if (!quoted && (char === '\n' || char === '\r')) { if (char === '\r' && input[index + 1] === '\n') index++; row.push(cell); cell = ''; if (row.some(value => value !== '')) lines.push(row); row = []; }
    else cell += char;
  }
  if (quoted) return { valid: false, rows: 0, errors: [{ code: 'CSV_UNCLOSED_QUOTE' }] };
  if (cell || row.length) { row.push(cell); lines.push(row); }
  if (!lines.length) return { valid: false, rows: 0, errors: [{ code: 'EMPTY_CSV' }] };
  const headers = lines[0]; const required = ['groupId','decision','reviewer','reviewedAt','notes'];
  const errors = required.filter(key => !headers.includes(key)).map(field => ({ code: 'MISSING_COLUMN', field }));
  const indexes = Object.fromEntries(required.map(key => [key, headers.indexOf(key)])); const seen = new Set();
  for (let index = 1; index < lines.length; index++) {
    const cells = lines[index]; const field = key => cells[indexes[key]] || ''; const groupId = field('groupId'); const decision = field('decision');
    if (!knownGroups.has(groupId)) errors.push({ code: 'UNKNOWN_GROUP_ID', line: index + 1, groupId });
    if (!J6_DECISIONS.has(decision)) errors.push({ code: 'INVALID_DECISION', line: index + 1, decision });
    if (seen.has(groupId)) errors.push({ code: 'DUPLICATE_GROUP', line: index + 1, groupId });
    for (const key of ['reviewer','reviewedAt','notes']) if (!field(key).trim()) errors.push({ code: 'EMPTY_REQUIRED_FIELD', line: index + 1, field: key });
    seen.add(groupId);
  }
  return { valid: errors.length === 0, rows: lines.length - 1, errors };
}
async function runRead(client, fn) {
  await client.query('BEGIN READ ONLY');
  try {
    const ident = (await client.query(`SELECT current_database() database,current_user role,inet_server_addr()::text address,inet_server_port() port,current_setting('transaction_read_only') readonly`)).rows[0];
    if (ident.database !== 'buscador_juridico_civil_dev' || ident.role !== 'bjc_dev' || String(ident.address || '').replace(/\/\d+$/u, '') !== '127.0.0.1' || Number(ident.port) !== 55432 || ident.readonly !== 'on') throw new Error('J6_LIVE_IDENTITY_REJECTED');
    const result = await fn();
    await client.query('COMMIT');
    return { ident, result };
  } catch (error) { try { await client.query('ROLLBACK'); } catch {} throw error; }
}
async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  assertTarget(process.env.DATABASE_URL);
  const groups = readJson(J1).groups;
  const j5 = readJson(path.join(J5, 'structural-root-causes.json'));
  const priorSummaryPath = path.join(OUT, 'final-summary.json');
  const priorSummary = fs.existsSync(priorSummaryPath) ? readJson(priorSummaryPath) : null;
  const j5Queue = readJson(path.join(J5, 'enriched-review-queue.json'));
  const rowsById = new Map(j5.rows.map(row => [row.groupId, row]));
  const groupById = new Map(groups.map(row => [row.legalDocumentKey, row]));
  const multiRows = j5.rows.filter(row => row.cause === 'MULTI_DOCKET_PDF');
  const collisionRows = j5.rows.filter(row => row.cause === 'SOURCE_METADATA_COLLISION');
  if (j5.total !== 321 || multiRows.length !== 194 || collisionRows.length !== 127 || j5Queue.total !== 451) throw new Error('J6_INPUT_COUNTS_REJECTED');
  const sourceBySha = new Map();
  for (const group of groups) for (const source of group.sourceEvidence || []) {
    const key = str(source.sha256).toLowerCase(); if (!key) continue;
    if (!sourceBySha.has(key)) sourceBySha.set(key, []);
    sourceBySha.get(key).push({ groupId: group.legalDocumentKey, ...source });
  }
  const structural = [...multiRows, ...collisionRows].sort((a, b) => a.groupId.localeCompare(b.groupId, 'en'));
  const shas = uniq(structural.flatMap(row => row.sha256 || []).map(value => value.toLowerCase()));
  const candidates = groups.filter(row => row.status === 'CANDIDATE');
  const j5SourceData = readJson(path.join(J5, 'source-data-recovery.json'));
  if (candidates.length !== EXPECTED.candidates || j5SourceData.stillMissing !== EXPECTED.sourceData) throw new Error('J6_NONSTRUCTURAL_INPUT_COUNTS_REJECTED');
  const client = new Client({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 10000, statement_timeout: 60000 });
  const sqlAudit = [];
  const rawQuery = client.query.bind(client);
  client.query = async (...args) => {
    const sql = typeof args[0] === 'string' ? args[0] : args[0]?.text || '';
    sqlAudit.push(sql.trim().split(/\s+/u)[0].toUpperCase());
    if (!/^(SELECT|BEGIN|COMMIT|ROLLBACK|SET)$/iu.test(sql.trim().split(/\s+/u)[0]) || /\b(INSERT|UPDATE|DELETE|UPSERT|CREATE|ALTER|DROP|TRUNCATE|GRANT|REVOKE|CALL|DO)\b/iu.test(sql)) throw new Error('J6_SQL_MUTATION_BLOCKED');
    return rawQuery(...args);
  };
  const queryStarted = performance.now(); await client.connect();
  const readSnapshot = async () => runRead(client, async () => {
    const sentinel = (await client.query(`SELECT
      (SELECT count(*)::int FROM "CorpusDocument") documents,
      (SELECT count(*)::int FROM "CorpusDocumentFile") files,
      (SELECT count(*)::int FROM "CorpusDocumentPage") pages,
      (SELECT count(*)::int FROM "CorpusIngestionRecord") ingestions,
      (SELECT count(*)::int FROM "CorpusSearchTokenState") searchDocuments,
      (SELECT count(*)::int FROM "CorpusSearchToken") tokens,
      (SELECT max("updatedAt")::text FROM "CorpusDocument") maxDocumentUpdatedAt,
      (SELECT max("updatedAt")::text FROM "CorpusIngestionRecord") maxIngestionUpdatedAt,
      (SELECT max("updatedAt")::text FROM "CorpusSearchTokenState") maxSearchStateUpdatedAt,
      (SELECT "verifiedAt"::text FROM "CorpusSearchTokenProjectionControl" WHERE "singleton"=true) verifiedAt`)).rows[0];
    const stale = (await client.query(`SELECT count(*)::int stale FROM "CorpusDocument" d LEFT JOIN "CorpusSearchTokenState" s ON s."documentId"=d."id"
      WHERE s."documentId" IS NULL OR s."sourceChecksum"<>md5(COALESCE(d."searchText",'')) OR s."tokenCount"<>(SELECT count(*) FROM "CorpusSearchToken" t WHERE t."documentId"=d."id")`)).rows[0].stale;
    const mismatch = (await client.query(`SELECT count(*)::int mismatches FROM (
      SELECT d."id" FROM (SELECT "id","searchText" FROM "CorpusDocument" WHERE "documentScope"='GENERAL' ORDER BY md5("id") LIMIT 100) d
      WHERE EXISTS (SELECT token FROM ((SELECT DISTINCT split.value token FROM regexp_split_to_table(COALESCE(d."searchText",''),'[[:space:]]+') split(value) WHERE split.value<>'')
        EXCEPT (SELECT t."token" FROM "CorpusSearchToken" t WHERE t."documentId"=d."id") UNION ALL
        (SELECT t."token" FROM "CorpusSearchToken" t WHERE t."documentId"=d."id") EXCEPT
        (SELECT DISTINCT split.value token FROM regexp_split_to_table(COALESCE(d."searchText",''),'[[:space:]]+') split(value) WHERE split.value<>'')) diff)
    ) sample`)).rows[0].mismatches;
    const corpus = (await client.query(`SELECT d."id",d."title",d."court",d."chamber",d."caseNumber",d."docket",d."decisionDate",d."metadata",d."metadataOriginal",
      f."id" "fileId",f."sha256",f."pageCount",i."id" "ingestionId",i."externalId",i."sourceReference",i."metadataOriginal" "ingestionMetadata",
      e."id" "extractionId",e."status" "extractionStatus",e."text" extractionText,e."extractedAt",p."pageNumber",p."text" pageText
      FROM "CorpusDocumentFile" f JOIN "CorpusDocument" d ON d."id"=f."documentId"
      LEFT JOIN "CorpusIngestionRecord" i ON i."fileId"=f."id"
      LEFT JOIN LATERAL (SELECT ex."id",ex."status",ex."text",ex."extractedAt" FROM "CorpusExtraction" ex WHERE ex."fileId"=f."id" ORDER BY ex."extractedAt" DESC LIMIT 1) e ON TRUE
      LEFT JOIN "CorpusDocumentPage" p ON p."extractionId"=e."id" WHERE f."sha256"=ANY($1::text[]) AND d."documentScope"='GENERAL'
      ORDER BY f."sha256",d."id",f."id",e."extractedAt" DESC,p."pageNumber"`, [shas])).rows;
    return { sentinel, stale, mismatch, corpus };
  });
  const beforeRead = await readSnapshot();
  const before = beforeRead.result;
  const corpusBySha = new Map();
  for (const row of before.corpus) {
    const key = str(row.sha256).toLowerCase(); if (!corpusBySha.has(key)) corpusBySha.set(key, new Map());
    corpusBySha.get(key).set(row.id, row);
  }
  const incidentalCandidates = candidates.flatMap(group => {
    const matchingShas = uniq((group.sourceEvidence || []).map(row => str(row.sha256).toLowerCase()).filter(digest => shas.includes(digest)));
    const documentIds = uniq(matchingShas.flatMap(digest => [...(corpusBySha.get(digest)?.keys() || [])]));
    return documentIds.length ? [{ groupId: group.legalDocumentKey, sha256: matchingShas, candidateDocumentIds: documentIds, method: 'EXACT_SOURCE_SHA_TO_CORPUS_FILE' }] : [];
  });
  const sourceDataShas = new Set(j5SourceData.rows.map(row => str(row.sourceSha).toLowerCase()).filter(Boolean));
  const sourceDataEvidenceOverlap = [...sourceDataShas].filter(digest => shas.includes(digest));
  const pdfCache = new Map(); const pdfRows = [];
  const textCache = fs.existsSync(TEXT_CACHE_PATH) ? readJson(TEXT_CACHE_PATH) : { version: 'j6-page-evidence-v1', entries: {} };
  for (const digest of shas) {
    const sourceRows = sourceBySha.get(digest) || [];
    const requestedPath = sourceRows.map(row => row.local_path).find(Boolean) || path.join(PDF_ROOT, `${digest}.pdf`);
    const root = path.resolve(requestedPath);
    const approved = `${path.resolve(PDF_ROOT)}${path.sep}`;
    const corpusRows = [...(corpusBySha.get(digest)?.values() || [])];
    const pageSets = new Map();
    for (const row of corpusRows) {
      if (row.pageNumber != null && str(row.pageText)) {
        if (!pageSets.has(row.id)) pageSets.set(row.id, new Map());
        pageSets.get(row.id).set(Number(row.pageNumber), str(row.pageText));
      }
    }
    let pages = [];
    let textSource = 'UNAVAILABLE';
    let cachedEvidence = null;
    if ([...pageSets.values()].some(map => [...map.values()].join('').length > 200)) {
      const first = [...pageSets.entries()].sort(([a], [b]) => a.localeCompare(b, 'en'))[0][1];
      pages = [...first.entries()].sort(([a], [b]) => a - b).map(([, text]) => text); textSource = 'CORPUS_DOCUMENT_PAGE';
    } else if (root.toLowerCase().startsWith(approved.toLowerCase()) && fs.existsSync(root)) {
      const bytes = fs.readFileSync(root); const actual = sha(bytes);
      if (actual !== digest || bytes.subarray(0, 5).toString('ascii') !== '%PDF-') throw new Error(`J6_PDF_SHA_OR_SIGNATURE_REJECTED:${digest}`);
      const cached = textCache.entries[digest];
      if (cached?.fileSha256 === actual && cached?.version === 'j6-page-evidence-v2') {
        cachedEvidence = cached; textSource = cached.textSource;
      } else {
        const parser = new PDFParse({ data: bytes });
        try { const parsed = await parser.getText(); pages = (parsed.pages || []).sort((a, b) => a.num - b.num).map(page => String(page.text || '')); }
        finally { await parser.destroy(); }
        textSource = pages.some(page => page.trim()) ? 'LOCAL_PDF_TEXT_NO_OCR' : 'NO_EXTRACTABLE_TEXT';
      }
    }
    const occurrences = cachedEvidence?.occurrences || candidateOccurrences(pages); const structure = cachedEvidence?.structure || documentStructure(pages);
    const pageCount = cachedEvidence?.pageCount ?? pages.length;
    const pageTextChars = cachedEvidence?.textChars ?? pages.reduce((sum, page) => sum + page.length, 0);
    const result = { sha256: digest, textSource, pageCount, textChars: pageTextChars, textCacheHit: Boolean(cachedEvidence),
      textAvailability: pageTextChars === 0 ? 'NO_TEXT' : pageTextChars < 500 ? 'PARTIAL_TEXT' : 'TEXT_AVAILABLE',
      occurrences, structure, sourceRows, corpusDocuments: corpusRows.map(row => ({ id: row.id, title: row.title, court: row.court, chamber: row.chamber,
        caseNumber: row.caseNumber, docket: row.docket, decisionDate: row.decisionDate, metadata: row.metadata, metadataOriginal: row.metadataOriginal,
        ingestionId: row.ingestionId, externalId: row.externalId, sourceReference: row.sourceReference, ingestionMetadata: row.ingestionMetadata })),
      sourceLocalPathVerified: textSource === 'LOCAL_PDF_TEXT_NO_OCR', hasCorpusPageText: textSource === 'CORPUS_DOCUMENT_PAGE' };
    pdfRows.push(result); pdfCache.set(digest, result);
    if (!cachedEvidence && textSource === 'LOCAL_PDF_TEXT_NO_OCR') {
      textCache.entries[digest] = { version: 'j6-page-evidence-v2', fileSha256: digest, textSource, pageCount, textChars: pageTextChars, occurrences, structure };
      fs.writeFileSync(TEXT_CACHE_PATH, `${JSON.stringify(textCache)}\n`, 'utf8');
    }
  }
  const multiStarted = performance.now();
  const multiAnalysis = [];
  const collisionAnalysis = [];
  for (const groupRow of multiRows) {
    const group = groupById.get(groupRow.groupId); const pdf = pdfCache.get(str(groupRow.sha256?.[0]).toLowerCase());
    const sourceRows = (group?.sourceEvidence || []).map(row => ({ ...row }));
    const srcCases = uniq(sourceRows.map(row => row.case_number));
    const corpusRows = pdf?.corpusDocuments || [];
    const corpusCases = uniq(corpusRows.flatMap(row => [row.caseNumber,row.docket,row.metadata?.caseNumber,row.metadataOriginal?.caseNumber,row.metadataOriginal?.case_number]));
    const sourceMetadata = sourceRows.map(row => ({ caseNumber: row.case_number, court: row.court, chamber: row.chamber, decisionDate: row.decision_date, sourceRecordId: row.external_id }));
    const corpusMetadata = corpusRows.map(row => ({ caseNumber: row.caseNumber || row.docket, court: row.court, chamber: row.chamber, decisionDate: row.decisionDate, documentId: row.id }));
    const adjudication = classifyDocument({ occurrences: pdf?.occurrences || [], structure: pdf?.structure, sourceCases: srcCases, sourceRows,
      corpusCases, sourceMetadata, corpusMetadata, pageCount: pdf?.pageCount || 0 });
    multiAnalysis.push({ groupId: groupRow.groupId, sha256: groupRow.sha256[0], sourceRecordIds: groupRow.sourceRecordIds,
      corpusDocumentIds: corpusRows.map(row => row.id), detectedCases: pdf?.occurrences || [], primaryCase: adjudication.proposedPrimaryCase,
      sourceMetadata, corpusMetadata,
      primaryStatus: adjudication.primaryStatus, classification: adjudication.classification, evidence: adjudication.candidates,
      roles: adjudication.roles, decisionEvidence: adjudication.decisionEvidence, confidence: adjudication.primaryStatus === 'PRIMARY_CASE_CONFIRMED' ? 'HIGH' : adjudication.primaryStatus === 'PRIMARY_CASE_PROBABLE' ? 'MEDIUM' : 'LOW',
      humanReviewRequired: true, textSource: pdf?.textSource || 'UNAVAILABLE', textAvailability: pdf?.textAvailability || 'NO_TEXT', notes: 'No automated legal identity link or metadata write.' });
  }
  const multiElapsedMs = Number((performance.now() - multiStarted).toFixed(2));
  const metadataStarted = performance.now();
  for (const groupRow of collisionRows) {
    const group = groupById.get(groupRow.groupId); const digest = str(groupRow.sha256?.[0]).toLowerCase(); const pdf = pdfCache.get(digest);
    const sourceRows = group?.sourceEvidence || []; const corpusRows = pdf?.corpusDocuments || [];
    const sourceMetadata = sourceRows.map(row => ({ caseNumber: row.case_number, court: row.court, chamber: row.chamber, decisionDate: row.decision_date, sourceRecordId: row.external_id }));
    const corpusMetadata = corpusRows.map(row => ({ caseNumber: row.caseNumber || row.docket, court: row.court, chamber: row.chamber, decisionDate: row.decisionDate, documentId: row.id }));
    const cases = uniq(sourceRows.map(row => row.case_number)); const corpusCases = uniq(corpusRows.flatMap(row => [row.caseNumber,row.docket,row.metadata?.caseNumber,row.metadataOriginal?.caseNumber,row.metadataOriginal?.case_number]));
    const adjudication = classifyDocument({ occurrences: pdf?.occurrences || [], structure: pdf?.structure, sourceCases: cases, sourceRows, corpusCases, sourceMetadata, corpusMetadata, pageCount: pdf?.pageCount || 0 });
    collisionAnalysis.push({ groupId: groupRow.groupId, sha256: groupRow.sha256, sourceRecordIds: groupRow.sourceRecordIds,
      sourceMetadata, corpusMetadata, pdfDerivedPrimary: adjudication.proposedPrimaryCase, classification: adjudication.classification,
      collisionType: adjudication.collisionType, proposedAction: adjudication.proposedMetadataAction,
      evidence: adjudication.candidates, sourceRowsAreExactDuplicates: adjudication.sourceRowsAreExactDuplicates,
      humanReviewRequired: true, textSource: pdf?.textSource || 'UNAVAILABLE', textAvailability: pdf?.textAvailability || 'NO_TEXT' });
  }
  const metadataElapsedMs = Number((performance.now() - metadataStarted).toFixed(2));
  const afterRead = await readSnapshot(); await client.end();
  const after = afterRead.result;
  const snapshotMatch = JSON.stringify(before.sentinel) === JSON.stringify(after.sentinel);
  const sqlMutationAttempts = sqlAudit.filter(word => !['SELECT','BEGIN','COMMIT','ROLLBACK','SET'].includes(word));
  if (!snapshotMatch || sqlMutationAttempts.length) throw new Error('J6_WRITE_SENTINEL_FAILED');
  const primaryCounts = Object.fromEntries(['PRIMARY_CASE_CONFIRMED','PRIMARY_CASE_PROBABLE','AMBIGUOUS_PRIMARY_CASE','NO_PRIMARY_CASE_FOUND'].map(key => [key, multiAnalysis.filter(row => row.primaryStatus === key).length]));
  const multiCounts = Object.fromEntries(['SINGLE_DECISION_PRIMARY_CASE','MULTI_CASE_SINGLE_DECISION','TRUE_MULTI_DECISION_PDF','AMBIGUOUS','INSUFFICIENT'].map(key => [key, multiAnalysis.filter(row => row.classification === key).length]));
  const collisionCounts = Object.fromEntries(['SOURCE_WRONG_CORPUS_RIGHT','SOURCE_RIGHT_CORPUS_WRONG','SOURCE_AND_CORPUS_CONFLICT','MULTIPLE_SOURCE_ROWS','NORMALIZATION_FALSE_CONFLICT','CASE_YEAR_CONFLICT','DATE_CONFLICT','COURT_CONFLICT','SALA_CONFLICT','UNKNOWN'].map(key => [key, collisionAnalysis.filter(row => row.collisionType === key).length]));
  const rootCauseCounts = { ...multiCounts, ...Object.fromEntries(Object.entries(collisionCounts).map(([key, value]) => [`METADATA_${key}`, value])) };
  const collisionFixCounts = Object.fromEntries(['KEEP_CORPUS','REVIEW_SOURCE','CORRECT_CORPUS_PROPOSAL','MERGE_SOURCE_DUPLICATES_PROPOSAL','NO_ACTION','HUMAN_DECISION'].map(key => [key, collisionAnalysis.filter(row => row.proposedAction === key).length]));
  const oldByGroup = new Map(j5Queue.rows.map(row => [row.groupId, row]));
  const multiByGroup = new Map(multiAnalysis.map(row => [row.groupId, row])); const collisionByGroup = new Map(collisionAnalysis.map(row => [row.groupId, row]));
  const groupTier = new Map();
  for (const row of j5Queue.rows) {
    let tier = row.humanTier;
    const multi = multiByGroup.get(row.groupId); const collision = collisionByGroup.get(row.groupId);
    if (multi) tier = ['PRIMARY_CASE_CONFIRMED','PRIMARY_CASE_PROBABLE'].includes(multi.primaryStatus) ? 'HUMAN_STRUCTURAL_READY' : 'HUMAN_STRUCTURAL_AMBIGUOUS';
    else if (collision) tier = ['SOURCE_WRONG_CORPUS_RIGHT','SOURCE_RIGHT_CORPUS_WRONG','NORMALIZATION_FALSE_CONFLICT'].includes(collision.collisionType) ? 'POTENTIAL_SAFE_METADATA_FIX' : 'HUMAN_STRUCTURAL_AMBIGUOUS';
    groupTier.set(row.groupId, tier);
  }
  const reviewCounts = Object.fromEntries(['HUMAN_READY','HUMAN_NEEDS_CANDIDATE','HUMAN_NEEDS_SOURCE_DATA','HUMAN_STRUCTURAL_READY','HUMAN_STRUCTURAL_AMBIGUOUS','MODEL_LIMITATION','POTENTIAL_SAFE_METADATA_FIX'].map(key => [key,[...groupTier.values()].filter(value => value === key).length]));
  const transitionRows = j5Queue.rows.map(row => ({ groupId: row.groupId, j5Status: row.humanTier, j6Status: groupTier.get(row.groupId),
    reason: groupTier.get(row.groupId) === row.humanTier ? 'UNCHANGED' : 'PRIMARY_IDENTITY_EVIDENCE_REFINED',
    evidence: multiByGroup.get(row.groupId)?.classification || collisionByGroup.get(row.groupId)?.collisionType || row.evidenceSummary?.reason || '' }));
  const proposals = multiAnalysis.map(row => ({ groupId: row.groupId, sha: row.sha256, proposedPrimaryCase: row.primaryCase, classification: row.classification,
    evidence: row.evidence, humanRequired: true }));
  const metadataProposals = collisionAnalysis.map(row => ({ groupId: row.groupId, sha: row.sha256.join(';'), collisionType: row.collisionType,
    proposedAction: row.proposedAction, source: row.sourceMetadata, corpus: row.corpusMetadata, pdfDerived: row.pdfDerivedPrimary,
    evidence: row.evidence, humanRequired: true, writes: 0 }));
  const allRows = [...j5Queue.rows].map(row => ({ ...row, j6Tier: groupTier.get(row.groupId), j6Analysis: multiByGroup.get(row.groupId) || collisionByGroup.get(row.groupId) || null }));
  const determinismInput = { structuralInput: sha(fs.readFileSync(J1)), j5: sha(fs.readFileSync(path.join(J5, 'final-summary.json'))) };
  writeJson('structural-input.json', { total: structural.length, multi: multiRows.length, collisions: collisionRows.length,
    rows: structural.map(row => ({ groupId: row.groupId, cause: row.cause, shas: row.sha256, sourceRecordIds: row.sourceRecordIds })) });
  writeJson('multi-case-analysis.json', { total: multiAnalysis.length, counts: multiCounts, primaryCounts, rows: multiAnalysis });
  writeJson('metadata-collision-analysis.json', { total: collisionAnalysis.length, counts: collisionCounts, proposedActions: collisionFixCounts, rows: collisionAnalysis });
  writeJson('primary-identities.json', { total: multiAnalysis.length, counts: primaryCounts, rows: proposals });
  writeJson('incidental-candidate-recoveries.json', { total: incidentalCandidates.length, method: 'exact source SHA only; candidate recovery was not rerun', rows: incidentalCandidates });
  writeJson('review-v3.json', { total: allRows.length, counts: reviewCounts, rows: allRows });
  fs.writeFileSync(path.join(OUT, 'review-v3.csv'), csvText(['groupId','j5Status','j6Status','sha256','sourceRecordIds','sourceMetadata','corpusMetadata','detectedCases','proposedPrimaryCase','classification','evidence','humanReviewRequired'], allRows.map(row => [row.groupId,row.humanTier,row.j6Tier,row.j6Analysis?.sha256 || row.sourceFileSha?.join(';') || '',row.sourceRecords?.map(item=>item.sourceRecordId).join(';') || '',JSON.stringify(row.j6Analysis?.sourceMetadata || row.sourceMetadata || []),JSON.stringify(row.j6Analysis?.corpusMetadata || []),JSON.stringify(row.j6Analysis?.detectedCases || []),row.j6Analysis?.primaryCase || row.j6Analysis?.pdfDerivedPrimary || '',row.j6Analysis?.classification || row.j6Analysis?.collisionType || '',JSON.stringify(row.j6Analysis?.evidence || []),'true'])),'utf8');
  const detailCards = allRows.map(row => { const a = row.j6Analysis || {}; return `<article data-tier="${row.j6Tier}"><h2>${escapeHtml(row.groupId)}</h2><p>J5: ${escapeHtml(row.humanTier)} → J6: ${escapeHtml(row.j6Tier)}</p><p>Primary proposal: ${escapeHtml(a.primaryCase || a.pdfDerivedPrimary || 'not established')} · ${escapeHtml(a.classification || a.collisionType || '')}</p><div class="evidence"><section><h3>SOURCE</h3><pre>${escapeHtml(JSON.stringify(a.sourceMetadata || row.sourceMetadata || [], null, 2))}</pre></section><section><h3>CORPUS</h3><pre>${escapeHtml(JSON.stringify(a.corpusMetadata || [], null, 2))}</pre></section><section><h3>PDF-DERIVED</h3><pre>${escapeHtml(JSON.stringify(a.detectedCases || a.evidence || [], null, 2))}</pre></section></div>${decisionOptions(row.reviewCategory)}</article>`; }).join('\n');
  fs.writeFileSync(path.join(OUT, 'review-v3.html'), `<!doctype html><meta charset="utf-8"><title>Jurisprudencia Review V3</title><style>body{font:14px system-ui;margin:2rem}article{border:1px solid #bbb;padding:1rem;margin:1rem 0}.evidence{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:1rem}pre{white-space:pre-wrap;overflow-wrap:anywhere;background:#f5f5f5;padding:.7rem}fieldset{display:flex;gap:1rem;flex-wrap:wrap}</style><label>Tier <select id="tier"><option>ALL</option>${[...new Set(groupTier.values())].sort().map(x=>`<option>${escapeHtml(x)}</option>`).join('')}</select></label><main>${detailCards}</main><script>document.querySelector('#tier').onchange=e=>document.querySelectorAll('article').forEach(x=>x.hidden=e.target.value!=='ALL'&&x.dataset.tier!==e.target.value)</script>`, 'utf8');
  fs.writeFileSync(path.join(OUT, 'review-transition-j5-to-j6.csv'), csvText(['groupId','j5Status','j6Status','reason','evidence'], transitionRows.map(row => [row.groupId,row.j5Status,row.j6Status,row.reason,JSON.stringify(row.evidence)])), 'utf8');
  fs.writeFileSync(path.join(OUT, 'metadata-fix-proposals.csv'), csvText(['groupId','sha','collisionType','proposedAction','source','corpus','pdfDerived','evidence','humanRequired','writes'], metadataProposals.map(row => [row.groupId,row.sha,row.collisionType,row.proposedAction,JSON.stringify(row.source),JSON.stringify(row.corpus),row.pdfDerived,JSON.stringify(row.evidence),true,0])), 'utf8');
  fs.writeFileSync(path.join(OUT, 'primary-case-proposals.csv'), csvText(['groupId','sha','proposedPrimaryCase','classification','evidence','humanRequired'], proposals.map(row => [row.groupId,row.sha,row.proposedPrimaryCase,row.classification,JSON.stringify(row.evidence),true])), 'utf8');
  fs.writeFileSync(path.join(OUT, 'root-cause-after-j6.csv'), csvText(['cause','count'], Object.entries(rootCauseCounts).map(([cause, count]) => [cause, count])), 'utf8');
  fs.writeFileSync(path.join(OUT, 'decision-fixture.csv'), 'groupId,decision,reviewer,reviewedAt,notes\r\n', 'utf8');
  writeJson('write-sentinel-before.json', { target: beforeRead.ident, sentinels: before.sentinel, search: { documents: Number(before.sentinel.searchdocuments), tokens: Number(before.sentinel.tokens), stale: before.stale, sampleSize: 100, mismatches: before.mismatch }, transactionReadOnly: true });
  writeJson('write-sentinel-after.json', { target: afterRead.ident, sentinels: after.sentinel, search: { documents: Number(after.sentinel.searchdocuments), tokens: Number(after.sentinel.tokens), stale: after.stale, sampleSize: 100, mismatches: after.mismatch }, transactionReadOnly: true });
  writeJson('performance.json', { textAnalysis: { cases: multiRows.length, uniqueSha: shas.length, sourcePdfsParsed: pdfRows.filter(row => row.textSource === 'LOCAL_PDF_TEXT_NO_OCR' && !row.textCacheHit).length, textCacheHits: pdfRows.filter(row => row.textCacheHit).length, fromCorpusPage: pdfRows.filter(row => row.textSource === 'CORPUS_DOCUMENT_PAGE').length, unavailable: pdfRows.filter(row => row.textAvailability === 'NO_TEXT').length, elapsedMs: Number((performance.now() - queryStarted).toFixed(2)), classificationMs: multiElapsedMs }, metadataOnly: { cases: collisionRows.length, elapsedMs: metadataElapsedMs }, totalGroups: structural.length });
  const outputNames = ['multi-case-analysis.json','metadata-collision-analysis.json','primary-identities.json','incidental-candidate-recoveries.json','review-v3.json','review-v3.csv','review-v3.html','review-transition-j5-to-j6.csv','metadata-fix-proposals.csv','primary-case-proposals.csv','root-cause-after-j6.csv'];
  const outputHashes = Object.fromEntries(outputNames.map(name => [name, sha(fs.readFileSync(path.join(OUT,name)))]));
  const sameInput = priorSummary?.determinismInput?.structuralInput === determinismInput.structuralInput && priorSummary?.determinismInput?.j5 === determinismInput.j5;
  const determinism = { comparedToPreviousRun: Boolean(sameInput), status: sameInput ? (outputNames.every(name => priorSummary.outputHashes?.[name] === outputHashes[name]) ? 'PASS' : 'FAIL') : 'BASELINE_NOT_AVAILABLE', comparedFiles: outputNames.length };
  const summary = { mission: 'SPRINT J6 — PRIMARY LEGAL IDENTITY RESOLUTION', status: 'PARTIAL', base: '23ebe99e00ca3156f0bb1a8fd54298d3f1d533b2', upstream: { dev: 'f7e37bc12436110191da15121bf047a0184e2e5a', featureCopernic: 'df35d5b6a2ca12e76d4c642e8418681eb650efec' }, inputs: { total: structural.length, multiExpediente: multiRows.length, metadataCollisions: collisionRows.length }, multiAnalysis: { counts: multiCounts, primaryCounts, text: { withText: pdfRows.filter(row=>row.textAvailability==='TEXT_AVAILABLE').length, partial: pdfRows.filter(row=>row.textAvailability==='PARTIAL_TEXT').length, withoutText: pdfRows.filter(row=>row.textAvailability==='NO_TEXT').length }, roleCounts: countRoles(multiAnalysis) }, metadataAnalysis: { counts: collisionCounts, proposedActions: collisionFixCounts }, rootCauseCounts, reviewV3: reviewCounts, transitions: { changed: transitionRows.filter(row=>row.reason!=='UNCHANGED').length, unchanged: transitionRows.filter(row=>row.reason==='UNCHANGED').length }, sourceData: { before: EXPECTED.sourceData, evidenceShaOverlap: sourceDataEvidenceOverlap.length, recoveredFromDocument: 0, stillMissing: EXPECTED.sourceData, note: 'Source-data cases did not overlap the structural SHA set, so J6 did not repeat their J5 analysis.' }, candidates: { before: candidates.length, recoveryRerun: false, incidentalDeterministicRecoveries: incidentalCandidates.length, stillCandidateLess: candidates.length - incidentalCandidates.length }, integrity: { readOnly: true, transactionReadOnly: true, sqlMutationAttempts: sqlMutationAttempts.length, noChange: snapshotMatch, before: before.sentinel, after: after.sentinel, search: { documents: Number(before.sentinel.searchdocuments), tokens: Number(before.sentinel.tokens), stale: before.stale, sampleSize: 100, mismatches: before.mismatch, verifiedAtChanged: false } }, determinismInput, determinism, outputHashes, tests: { status: 'PENDING' }, writes: 0, artifacts: '_recovery-work/jurisprudencia-j6/' };
  writeJson('final-summary.json', summary);
  process.stdout.write(`${JSON.stringify({ status: summary.status, inputs: summary.inputs, multiAnalysis: summary.multiAnalysis, metadataAnalysis: summary.metadataAnalysis, reviewV3: summary.reviewV3, integrity: summary.integrity, elapsedMs: Number((performance.now() - queryStarted).toFixed(2)) }, null, 2)}\n`);
}
function countRoles(rows) { const result = { PRIMARY: 0, SECONDARY_REFERENCE: 0, RELATED_CASE: 0, UNKNOWN_ROLE: 0 }; for (const row of rows) for (const role of row.roles) result[role.role]++; return result; }
function escapeHtml(value) { return String(value ?? '').replace(/[&<>"']/gu, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch])); }
function decisionOptions(category) { return category === 'STRUCTURAL' ? '<fieldset><label><input type="checkbox">Primary case correct</label><label><input type="checkbox">Multi-case single decision</label><label><input type="checkbox">Multi-decision PDF</label><label><input type="checkbox">Ambiguous</label><label><input type="checkbox">Other</label></fieldset>' : category === 'METADATA_COLLISION' ? '<fieldset><label><input type="checkbox">Source correct</label><label><input type="checkbox">Corpus correct</label><label><input type="checkbox">PDF-derived correct</label><label><input type="checkbox">Conflict unresolved</label></fieldset>' : ''; }
if (require.main === module) main().catch(error => { console.error(`J6_ABORT=${error.stack || error.message}`); process.exitCode = 1; });
module.exports = { assertTarget, candidateOccurrences, documentStructure, classifyDocument, validateJ6DecisionCsv, J6_DECISIONS, normCase, locateDocketTokens, EXPECTED };
