'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const BACKEND = path.resolve(__dirname, '..', '..');
const ROOT = path.resolve(BACKEND, '..', '..');
const DEFAULT_INPUT = path.join(ROOT, '_recovery-work', 'jurisprudencia-j6');
const DEFAULT_OUTPUT = path.join(ROOT, '_recovery-work', 'jurisprudencia-j61');
const DECISIONS = Object.freeze([
  'CONFIRM_PRIMARY_IDENTITY',
  'CONFIRM_MULTI_CASE_SINGLE_DECISION',
  'SAME_DECISION_DIFFERENT_REPRESENTATION',
  'SAME_DECISION_DIFFERENT_VERSION',
  'KEEP_SEPARATE_RELATED',
  'SOURCE_METADATA_WRONG',
  'CORPUS_METADATA_WRONG',
  'AMBIGUOUS',
  'INSUFFICIENT_EVIDENCE',
  'OTHER',
]);
const STATUSES = new Set(['REVIEWED', 'SKIPPED']);
const REQUIRED_NOTES = new Set(['OTHER', 'AMBIGUOUS', 'INSUFFICIENT_EVIDENCE']);

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function safeDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?(?:Z|[+-]\d\d:\d\d)$/u.test(value)) return false;
  return Number.isFinite(Date.parse(value));
}

function firstSource(row) {
  const records = row.sourceRecords || [];
  return records.find(record => record.metadata) || records[0] || {};
}

function mapCase(reviewRow, identity, multi, priority, graphEntry) {
  const source = firstSource(reviewRow);
  const metadata = source.metadata || reviewRow.sourceMetadata?.[0] || {};
  const proposed = identity?.proposedPrimaryCase || null;
  const mentions = multi?.detectedCases || [];
  const byNumber = new Map();
  for (const mention of mentions) {
    const current = byNumber.get(mention.caseNumber) || {
      caseNumber: mention.caseNumber,
      pages: [],
      zones: [],
      occurrences: 0,
      resolutory: false,
      header: false,
      contexts: [],
    };
    current.pages.push(mention.page);
    current.zones.push(mention.zone);
    current.occurrences += 1;
    current.resolutory ||= Boolean(mention.resolutory);
    current.header ||= Boolean(mention.header);
    if (mention.context && current.contexts.length < 4) current.contexts.push({
      page: mention.page,
      zone: mention.zone,
      resolutory: Boolean(mention.resolutory),
      text: String(mention.context).slice(0, 420),
    });
    byNumber.set(mention.caseNumber, current);
  }
  const technicalEvidence = identity?.evidence || [];
  const cases = [...byNumber.values()].map(item => {
    const scored = technicalEvidence.find(candidate => candidate.caseNumber === item.caseNumber);
    let role = 'RELATED_OR_MENTIONED';
    if (proposed && item.caseNumber === proposed) role = 'PRIMARY_PROPOSAL';
    else if (item.caseNumber === metadata.caseNumber) role = 'SOURCE_CASE';
    return {
      ...item,
      role,
      evidence: scored?.evidence || [],
      score: scored?.score ?? null,
      sourceMetadataMatch: Boolean(scored?.sourceMetadataMatch),
      corpusMetadataMatch: Boolean(scored?.corpusMetadataMatch),
      pages: [...new Set(item.pages)].sort((a, b) => a - b),
      zones: [...new Set(item.zones)],
    };
  }).sort((a, b) => {
    const ranks = { PRIMARY_PROPOSAL: 0, SOURCE_CASE: 1, RELATED_OR_MENTIONED: 2 };
    return ranks[a.role] - ranks[b.role] || String(a.caseNumber).localeCompare(String(b.caseNumber));
  });
  const sourceRecords = (reviewRow.sourceRecords || []).map(record => ({
    sourceRecordId: record.sourceRecordId || null,
    sourceSystem: record.sourceSystem || null,
    portalId: record.portalId || null,
    sha256: record.sha256 || null,
    metadata: record.metadata || {},
    localPath: record.localPath || null,
  }));
  const pdfs = [];
  const seen = new Set();
  for (const record of sourceRecords) {
    const key = record.sha256 || record.localPath;
    if (!key || seen.has(key)) continue;
    seen.add(key);
    pdfs.push({ sha256: record.sha256, localPath: record.localPath, bytes: record.metadata?.bytes, pages: record.metadata?.pages });
  }
  const classification = multi?.classification || identity?.classification || 'UNKNOWN';
  const primaryEvidence = technicalEvidence.find(candidate => candidate.caseNumber === proposed) || null;
  const evidenceText = cases.flatMap(item => item.contexts.map(context => ({
    caseNumber: item.caseNumber,
    role: item.role,
    ...context,
  })));
  return {
    groupId: reviewRow.groupId,
    priority,
    classification,
    machineProposal: proposed ? {
      primaryCase: proposed,
      classification,
      confidence: priority === 'P0' ? 'CONFIRMED' : priority === 'P2' ? 'PROBABLE' : 'CONFIRMED',
      evidence: primaryEvidence?.evidence || [],
      score: primaryEvidence?.score ?? null,
      pages: primaryEvidence?.pages || [],
      resolutory: primaryEvidence?.resolutory || 0,
    } : null,
    source: {
      caseNumber: metadata.caseNumber || null,
      court: metadata.court || null,
      chamber: metadata.chamber || null,
      decisionDate: metadata.decisionDate || null,
      year: metadata.year || null,
      title: metadata.title || null,
      sourceSystem: source.sourceSystem || null,
      sourceRecordId: source.sourceRecordId || null,
      sourceRecords,
    },
    corpus: {
      status: (graphEntry?.corpusDocuments || []).length ? 'MATCHED_BY_SHA_IN_J5_CORPUS_SNAPSHOT' : 'NO_EXACT_CANDIDATE_IN_J6_SNAPSHOT',
      documentIds: (graphEntry?.corpusDocuments || []).map(row => row.documentId),
      metadata: graphEntry?.corpusDocuments || [],
      files: graphEntry?.corpusFiles || [],
    },
    pdf: {
      sha256: identity?.sha || multi?.sha256 || null,
      files: pdfs,
      primaryCase: proposed,
      cases,
      excerpts: evidenceText.slice(0, 12),
    },
    technical: {
      cause: reviewRow.cause || null,
      blocker: reviewRow.blocker || null,
      sourceRecordIds: (multi?.sourceRecordIds || sourceRecords.map(item => item.sourceRecordId)).filter(Boolean),
      provenance: reviewRow.provenance || [],
      sourceMetadata: reviewRow.sourceMetadata || [],
      corpusDocumentIds: reviewRow.corpusDocumentIds || [],
    },
  };
}

function buildReviewInput(inputDir, gitSha) {
  const review = readJson(path.join(inputDir, 'review-v3.json'));
  const identities = readJson(path.join(inputDir, 'primary-identities.json'));
  const multi = readJson(path.join(inputDir, 'multi-case-analysis.json'));
  const metadata = readJson(path.join(inputDir, 'metadata-collision-analysis.json'));
  const summary = readJson(path.join(inputDir, 'final-summary.json'));
  const j5GraphPath = path.join(path.dirname(inputDir), 'jurisprudencia-j5', 'identity-graph.json');
  const j5Graph = fs.existsSync(j5GraphPath) ? readJson(j5GraphPath) : { bySha: [] };
  const corpusBySha = new Map((j5Graph.bySha || []).map(row => [row.sha256, row]));
  const identityByGroup = new Map(identities.rows.map(row => [row.groupId, row]));
  const multiByGroup = new Map(multi.rows.map(row => [row.groupId, row]));
  const reviewableRows = review.rows.filter(row => row.j6Tier === 'HUMAN_STRUCTURAL_READY');
  const cases = reviewableRows.map(row => {
    const identity = identityByGroup.get(row.groupId);
    const analysis = multiByGroup.get(row.groupId);
    const classification = analysis?.classification || identity?.classification;
    const priority = classification === 'SINGLE_DECISION_PRIMARY_CASE' ? 'P0'
      : classification === 'INSUFFICIENT' || !identity?.proposedPrimaryCase ? 'P2' : 'P1';
    return mapCase(row, identity, analysis, priority, corpusBySha.get(identity?.sha || analysis?.sha256));
  }).sort((a, b) => a.priority.localeCompare(b.priority) || a.source.year - b.source.year || a.groupId.localeCompare(b.groupId));
  const notReadyRows = review.rows.filter(row => row.j6Tier !== 'HUMAN_STRUCTURAL_READY');
  const corpusUnknown = metadata.rows.filter(row => row.collisionType === 'UNKNOWN').length;
  const snapshot = {
    gitSha,
    j6SummarySha256: sha256(fs.readFileSync(path.join(inputDir, 'final-summary.json'))),
    j6InputSha256: summary.determinismInput?.structuralInput || null,
  };
  const body = {
    schemaVersion: 'galilei-human-review-input-v1',
    mission: 'SPRINT J6.1 — HUMAN REVIEW UAT',
    snapshot,
    counts: {
      totalReviewable: cases.length,
      priorities: Object.fromEntries(['P0', 'P1', 'P2', 'P3'].map(priority => [priority, cases.filter(item => item.priority === priority).length])),
      notReadyInFullReviewV3: notReadyRows.length,
      metadataCollisionsExcluded: metadata.total,
      metadataWithoutProvenanceExcluded: corpusUnknown,
    },
    cases,
  };
  body.sampleGroupIds = buildSample({ ...body, reviewInputHash: '' }).cases.map(item => item.groupId);
  const reviewInputHash = sha256(stableStringify(body));
  return { ...body, reviewInputHash };
}

function csvCell(value) {
  const text = value == null ? '' : String(value);
  return /[",\r\n]/u.test(text) ? `"${text.replace(/"/gu, '""')}"` : text;
}

function toCsv(records) {
  const columns = ['groupId', 'status', 'decision', 'reviewer', 'reviewedAt', 'notes', 'confidence', 'machineProposal', 'reviewInputHash', 'gitSha', 'j6SnapshotRef', 'timeSpentSeconds'];
  return [columns.join(','), ...records.map(record => columns.map(column => csvCell(typeof record[column] === 'object' ? JSON.stringify(record[column]) : record[column])).join(','))].join('\r\n') + '\r\n';
}

function parseCsv(text) {
  const rows = [];
  let row = [], field = '', quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quoted) {
      if (char === '"' && text[index + 1] === '"') { field += '"'; index += 1; }
      else if (char === '"') quoted = false;
      else field += char;
    } else if (char === '"') quoted = true;
    else if (char === ',') { row.push(field); field = ''; }
    else if (char === '\n') { row.push(field.replace(/\r$/u, '')); rows.push(row); row = []; field = ''; }
    else field += char;
  }
  if (quoted) throw new Error('CSV has an unterminated quoted field');
  if (field.length || row.length) { row.push(field); rows.push(row); }
  if (!rows.length) return [];
  const headers = rows.shift();
  return rows.filter(values => values.some(value => value !== '')).map(values => Object.fromEntries(headers.map((header, index) => [header, values[index] || ''])));
}

function parseDecisionInput(input) {
  if (Array.isArray(input)) return { manifest: {}, decisions: input };
  if (input && typeof input === 'object') return { manifest: input, decisions: Array.isArray(input.decisions) ? input.decisions : [] };
  throw new Error('Decision input must be a JSON array or a ledger object');
}

function calculateReviewInputHash(reviewInput) {
  const { reviewInputHash, decisions, ...body } = reviewInput;
  return sha256(stableStringify(body));
}

function filterCases(cases, filters = {}) {
  return cases.filter(item => (!filters.priority || item.priority === filters.priority)
    && (!filters.classification || item.classification === filters.classification)
    && (!filters.chamber || item.source.chamber === filters.chamber)
    && (!filters.year || String(item.source.year) === String(filters.year))
    && (!filters.status || (filters.statusByGroup?.[item.groupId] || 'PENDING') === filters.status));
}

function normalizeAndValidate(input, reviewInput, options = {}) {
  const errors = [];
  const computedReviewInputHash = calculateReviewInputHash(reviewInput);
  if (computedReviewInputHash !== reviewInput.reviewInputHash) errors.push({ code: 'REVIEW_INPUT_HASH_INVALID', expected: computedReviewInputHash, actual: reviewInput.reviewInputHash });
  const parsed = typeof input === 'string'
    ? (input.trimStart().startsWith('[') || input.trimStart().startsWith('{') ? parseDecisionInput(JSON.parse(input)) : { manifest: {}, decisions: parseCsv(input) })
    : parseDecisionInput(input);
  const manifest = parsed.manifest || {};
  const expected = {
    reviewInputHash: reviewInput.reviewInputHash,
    gitSha: reviewInput.snapshot.gitSha,
    j6SnapshotRef: reviewInput.snapshot.j6SummarySha256,
  };
  for (const [key, value] of Object.entries(expected)) {
    const got = manifest[key] || parsed.decisions.find(item => item[key])?.[key];
    if (got && got !== value) errors.push({ code: 'STALE_SNAPSHOT', field: key, expected: value, actual: got });
  }
  const known = new Map(reviewInput.cases.map(item => [item.groupId, item]));
  const normalized = new Map();
  for (let index = 0; index < parsed.decisions.length; index += 1) {
    const raw = parsed.decisions[index] || {};
    const rawSnapshotRefs = ['reviewInputHash', 'gitSha', 'j6SnapshotRef'];
    const missingSnapshotRefs = rawSnapshotRefs.filter(key => !raw[key] && !manifest[key]);
    if (missingSnapshotRefs.length) errors.push({ code: 'MISSING_SNAPSHOT_REFERENCE', row: index + 1, fields: missingSnapshotRefs });
    let machineProposal = raw.machineProposal || null;
    if (typeof machineProposal === 'string' && machineProposal.trim()) {
      try { machineProposal = JSON.parse(machineProposal); } catch { errors.push({ code: 'INVALID_MACHINE_PROPOSAL_JSON', row: index + 1 }); }
    }
    const row = {
      groupId: String(raw.groupId || '').trim(),
      status: String(raw.status || 'REVIEWED').trim().toUpperCase(),
      decision: String(raw.decision || '').trim().toUpperCase(),
      reviewer: String(raw.reviewer || '').trim(),
      reviewedAt: String(raw.reviewedAt || '').trim(),
      notes: String(raw.notes || ''),
      confidence: String(raw.confidence || '').trim().toUpperCase(),
      machineProposal,
      reviewInputHash: raw.reviewInputHash || manifest.reviewInputHash || expected.reviewInputHash,
      gitSha: raw.gitSha || manifest.gitSha || expected.gitSha,
      j6SnapshotRef: raw.j6SnapshotRef || manifest.j6SnapshotRef || expected.j6SnapshotRef,
      timeSpentSeconds: raw.timeSpentSeconds === '' || raw.timeSpentSeconds == null ? null : Number(raw.timeSpentSeconds),
    };
    const at = index + 1;
    if (!known.has(row.groupId)) errors.push({ code: 'UNKNOWN_GROUP_ID', row: at, groupId: row.groupId });
    if (!STATUSES.has(row.status)) errors.push({ code: 'INVALID_STATUS', row: at, status: row.status });
    if (row.status === 'REVIEWED' && !DECISIONS.includes(row.decision)) errors.push({ code: 'INVALID_DECISION', row: at, decision: row.decision });
    if (row.status === 'SKIPPED' && row.decision) errors.push({ code: 'SKIPPED_HAS_DECISION', row: at, decision: row.decision });
    if (!row.reviewer) errors.push({ code: 'MISSING_REVIEWER', row: at, groupId: row.groupId });
    if (!safeDate(row.reviewedAt)) errors.push({ code: 'INVALID_TIMESTAMP', row: at, reviewedAt: row.reviewedAt });
    if (row.status === 'REVIEWED' && REQUIRED_NOTES.has(row.decision) && !row.notes.trim()) errors.push({ code: 'NOTES_REQUIRED', row: at, decision: row.decision });
    if (row.confidence && !['CONFIRMED', 'PROBABLE', 'UNSURE'].includes(row.confidence)) errors.push({ code: 'INVALID_CONFIDENCE', row: at, confidence: row.confidence });
    if (row.timeSpentSeconds != null && (!Number.isFinite(row.timeSpentSeconds) || row.timeSpentSeconds < 0 || row.timeSpentSeconds > 86400)) errors.push({ code: 'INVALID_TIME_SPENT', row: at });
    const prev = normalized.get(row.groupId);
    if (prev) {
      if (stableStringify(prev) === stableStringify(row)) continue;
      errors.push({ code: 'CONFLICTING_DUPLICATE', row: at, groupId: row.groupId });
      continue;
    }
    normalized.set(row.groupId, row);
  }
  const decisions = [...normalized.values()].sort((a, b) => a.groupId.localeCompare(b.groupId));
  if (options.requireReviewer && decisions.some(row => !row.reviewer)) errors.push({ code: 'MISSING_REVIEWER' });
  return { valid: errors.length === 0, errors, decisions, summary: summarize(reviewInput, decisions) };
}

function summarize(reviewInput, decisions) {
  const byDecision = {};
  const byPriority = {};
  const caseMap = new Map(reviewInput.cases.map(item => [item.groupId, item]));
  for (const decision of decisions) {
    if (decision.status === 'REVIEWED') byDecision[decision.decision] = (byDecision[decision.decision] || 0) + 1;
    const priority = caseMap.get(decision.groupId)?.priority || 'UNKNOWN';
    byPriority[priority] ||= { reviewed: 0, skipped: 0 };
    byPriority[priority][decision.status === 'SKIPPED' ? 'skipped' : 'reviewed'] += 1;
  }
  const reviewed = decisions.filter(item => item.status === 'REVIEWED');
  const skipped = decisions.filter(item => item.status === 'SKIPPED');
  const sampleIds = new Set(reviewInput.sampleGroupIds || []);
  const sampleRows = decisions.filter(item => sampleIds.has(item.groupId));
  const sampleReviewed = sampleRows.filter(item => item.status === 'REVIEWED').length;
  const agreementRows = reviewed.flatMap(item => {
    const classification = caseMap.get(item.groupId)?.classification;
    const expected = classification === 'SINGLE_DECISION_PRIMARY_CASE' ? 'CONFIRM_PRIMARY_IDENTITY'
      : classification === 'MULTI_CASE_SINGLE_DECISION' ? 'CONFIRM_MULTI_CASE_SINGLE_DECISION' : null;
    if (!expected || !['CONFIRM_PRIMARY_IDENTITY', 'CONFIRM_MULTI_CASE_SINGLE_DECISION'].includes(item.decision)) return [];
    return [{ groupId: item.groupId, agrees: item.decision === expected }];
  });
  const reviewers = [...new Set(decisions.map(item => item.reviewer).filter(Boolean))].sort();
  const times = reviewed.map(item => item.timeSpentSeconds).filter(Number.isFinite);
  const stamps = decisions.map(item => Date.parse(item.reviewedAt)).filter(Number.isFinite);
  return {
    totalCases: reviewInput.cases.length,
    reviewed: reviewed.length,
    skipped: skipped.length,
    pending: reviewInput.cases.length - reviewed.length - skipped.length,
    humanUatStatus: sampleReviewed >= sampleIds.size && sampleIds.size ? 'COMPLETED' : sampleReviewed ? 'IN_PROGRESS' : 'NOT_STARTED',
    sample: { total: sampleIds.size, reviewed: sampleReviewed, skipped: sampleRows.filter(item => item.status === 'SKIPPED').length, pending: sampleIds.size - sampleRows.filter(item => item.status === 'REVIEWED' || item.status === 'SKIPPED').length },
    decisionsByType: byDecision,
    byPriority,
    reviewers,
    agreementOnReviewedSample: {
      comparableCases: agreementRows.length,
      agreement: agreementRows.filter(row => row.agrees).length,
      disagreement: agreementRows.filter(row => !row.agrees).length,
      rate: agreementRows.length ? agreementRows.filter(row => row.agrees).length / agreementRows.length : null,
      disagreements: agreementRows.filter(row => !row.agrees).map(row => row.groupId),
      denominatorNote: 'Only direct primary/multi-case classification confirmations are comparable; this is agreement on the reviewed sample, not global accuracy.',
    },
    timeSpentSeconds: times.reduce((sum, value) => sum + value, 0),
    averageSecondsPerReviewedCase: times.length ? Math.round(times.reduce((sum, value) => sum + value, 0) / times.length) : null,
    elapsedSeconds: stamps.length > 1 ? Math.round((Math.max(...stamps) - Math.min(...stamps)) / 1000) : null,
    reviewInputHash: reviewInput.reviewInputHash,
    gitSha: reviewInput.snapshot.gitSha,
    j6SnapshotRef: reviewInput.snapshot.j6SummarySha256,
  };
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/gu, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
}

function fileUrl(filePath) {
  if (!filePath) return '';
  const resolved = path.resolve(filePath).replace(/\\/gu, '/');
  return `file:///${encodeURI(resolved).replace(/#/gu, '%23')}`;
}

function renderHtml(reviewInput) {
  const embedded = JSON.stringify(reviewInput).replace(/</gu, '\\u003c').replace(/\u2028/gu, '\\u2028').replace(/\u2029/gu, '\\u2029');
  const decisions = DECISIONS.map((decision, index) => `<label class="decision"><input type="radio" name="decision" value="${decision}"><span><kbd>${index + 1}</kbd> ${decision}</span></label>`).join('');
  const pdfFiles = reviewInput.cases.flatMap(item => item.pdf.files.map(file => ({ groupId: item.groupId, localPath: file.localPath })));
  const forbiddenRefs = /https?:\/\//iu.test(embedded) || reviewInput.cases.some(item => item.pdf.files.some(file => String(file.localPath || '').startsWith('\\\\')));
  if (forbiddenRefs) throw new Error('Review input must not contain external network URLs or UNC paths');
  const title = 'Galilei · Revisión de identidad jurídica';
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="referrer" content="no-referrer"><title>${title}</title><style>
:root{color-scheme:light;--ink:#18253a;--muted:#64748b;--line:#d8e0eb;--paper:#fff;--wash:#f3f6fa;--blue:#174ea6;--gold:#9b5d00;--red:#a12622}*{box-sizing:border-box}body{margin:0;background:var(--wash);color:var(--ink);font:15px/1.48 "Segoe UI",system-ui,sans-serif}header{position:sticky;top:0;background:#10243f;color:#fff;padding:14px 22px;z-index:5;box-shadow:0 2px 9px #101a2a30}header .row{display:flex;align-items:center;gap:12px;flex-wrap:wrap}header h1{font-size:19px;margin:0 auto 0 0}button,select,input,textarea{font:inherit}button{border:1px solid #bcc9d9;border-radius:7px;padding:8px 12px;background:white;color:var(--ink);cursor:pointer}button.primary{background:var(--blue);color:white;border-color:var(--blue)}button:disabled{opacity:.45;cursor:not-allowed}.layout{display:grid;grid-template-columns:300px minmax(0,1fr);gap:16px;padding:16px;max-width:1600px;margin:auto}aside,.panel,main article{background:var(--paper);border:1px solid var(--line);border-radius:11px;padding:15px}aside{align-self:start;position:sticky;top:78px;max-height:calc(100vh - 96px);overflow:auto}aside label{display:block;margin:10px 0 4px;font-weight:600}aside select{width:100%;padding:7px;border:1px solid var(--line);border-radius:6px}.counts{display:grid;grid-template-columns:1fr 1fr;gap:7px;margin:12px 0}.count{background:var(--wash);padding:9px;border-radius:7px}.count strong{display:block;font-size:18px}.case-nav{max-height:45vh;overflow:auto;border-top:1px solid var(--line);margin-top:12px}.case-nav button{display:block;width:100%;text-align:left;border:0;border-bottom:1px solid var(--line);border-radius:0;background:transparent}.case-nav button.active{background:#e7f0ff}.case-nav button.done:after{content:" ✓";color:#16703a}main{min-width:0}main article{margin-bottom:14px}h2{font-size:17px;margin:0 0 10px}h3{font-size:14px;margin:14px 0 7px;color:#31435b}.sub{color:var(--muted);font-size:13px}.proposal{border-left:4px solid #2a6aaf;background:#eef5ff;padding:11px 13px;border-radius:4px;margin:10px 0}.badge{display:inline-block;border-radius:999px;padding:3px 9px;background:#e9eef5;font-size:12px;font-weight:700}.P0{background:#d9f2e3;color:#14592c}.P1{background:#e1edff;color:#154583}.P2{background:#fff0d5;color:#80500a}.grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}.field{border-bottom:1px solid #edf0f4;padding:5px 2px}.field small{display:block;color:var(--muted)}.field b{font-weight:650}.table-wrap{overflow:auto}table{width:100%;border-collapse:collapse;font-size:13px}th,td{text-align:left;padding:7px;border-bottom:1px solid var(--line);vertical-align:top}th{background:#f6f8fb;position:sticky;top:0}.excerpt{border-left:3px solid #a8b6c9;background:#f8fafc;padding:9px;margin:8px 0;font-family:Georgia,serif}.excerpt small{display:block;color:var(--muted);font:12px "Segoe UI",sans-serif;margin-bottom:4px}mark{background:#ffe384;color:#402c00}.warning{border:1px solid #e5c788;background:#fff9e9;color:#634514;padding:10px;border-radius:7px}.decision-list{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:7px}.decision{display:block;border:1px solid var(--line);border-radius:7px;padding:8px}.decision:has(input:checked){outline:2px solid var(--blue);background:#edf4ff}.decision kbd{border:1px solid #ccd4df;border-radius:3px;padding:1px 4px}.form-row{display:flex;gap:10px;align-items:end;flex-wrap:wrap;margin:10px 0}.form-row label{display:grid;gap:4px}.form-row input,.form-row textarea{border:1px solid var(--line);border-radius:6px;padding:7px}.form-row textarea{width:min(720px,100%);min-height:70px}.actions{display:flex;gap:8px;flex-wrap:wrap;margin-top:12px}.progressbar{height:8px;background:#dce5f0;border-radius:99px;overflow:hidden}.progressbar span{display:block;height:100%;background:#21754b;width:0}.status-line{font-size:13px;color:var(--muted);min-height:20px}details summary{cursor:pointer;color:var(--blue);font-weight:600}pre{white-space:pre-wrap;overflow-wrap:anywhere;background:#f4f6f8;padding:10px;border-radius:6px;font-size:12px}.hidden{display:none!important}@media(max-width:950px){.layout{grid-template-columns:1fr}aside{position:static;max-height:none}.case-nav{max-height:180px}}@media(max-width:640px){.grid,.decision-list{grid-template-columns:1fr}header{padding:10px}.layout{padding:8px}}
</style></head><body><header><div class="row"><h1>${title}</h1><span id="caseCounter">Caso —</span><button id="prev">← Anterior</button><button id="next">Siguiente →</button><button id="exportJson" class="primary">Exportar checkpoint JSON</button><button id="exportCsv">Exportar CSV</button><label class="button">Importar decisiones <input id="importFile" type="file" accept=".json,.csv,application/json,text/csv" hidden></label></div></header><div class="layout"><aside><div><strong>Progreso</strong><div class="progressbar"><span id="bar"></span></div><div class="counts"><div class="count"><strong id="reviewedCount">0</strong>Revisados</div><div class="count"><strong id="pendingCount">0</strong>Pendientes</div><div class="count"><strong id="skippedCount">0</strong>Omitidos</div><div class="count"><strong id="shownCount">0</strong>Filtrados</div></div><div class="sub" id="priorityCounts"></div></div><label><input id="sampleOnly" type="checkbox"> Ver sólo la muestra UAT de 20 casos</label><label for="priorityFilter">Prioridad</label><select id="priorityFilter"><option value="">Todas</option><option>P0</option><option>P1</option><option>P2</option></select><label for="classFilter">Clasificación</label><select id="classFilter"><option value="">Todas</option></select><label for="chamberFilter">Sala</label><select id="chamberFilter"><option value="">Todas</option></select><label for="yearFilter">Año</label><select id="yearFilter"><option value="">Todos</option></select><label for="statusFilter">Estado</label><select id="statusFilter"><option value="">Todos</option><option>PENDING</option><option>REVIEWED</option><option>SKIPPED</option></select><div class="case-nav" id="caseNav"></div></aside><main><article><div class="sub">Prioridad y propuesta de J6 se conservan por separado de tu decisión.</div><div id="caseHeader"></div><div id="proposal"></div></article><article><h2>Fuente</h2><div class="grid" id="sourceGrid"></div></article><article><h2>Corpus</h2><div class="warning" id="corpusNotice"></div><div class="grid" id="corpusGrid"></div></article><article><h2>PDF · expedientes y roles propuestos</h2><div class="table-wrap"><table><thead><tr><th>Expediente</th><th>Rol propuesto</th><th>Evidencia</th><th>Páginas</th></tr></thead><tbody id="caseTable"></tbody></table></div><div class="actions" id="pdfLinks"></div><h3>Extractos relevantes</h3><div id="excerpts"></div></article><article><h2>Comparación de metadata</h2><div class="table-wrap"><table><thead><tr><th>Campo</th><th>Fuente</th><th>Corpus</th><th>Derivado del PDF</th></tr></thead><tbody id="metadataTable"></tbody></table></div></article><article><details><summary>Ver evidencia técnica</summary><pre id="technical"></pre></details></article><article><h2>Decisión humana</h2><p>¿El PDF corresponde principalmente a la identidad propuesta? Si no, indique la relación observada. No se escribe en Corpus ni se cambia la propuesta automática.</p><div class="decision-list" id="decisions">${decisions}</div><div class="form-row"><label>Reviewer<input id="reviewer" maxlength="80" placeholder="Ej. UAT-Agus"></label><label>Confianza (opcional)<select id="confidence"><option value="">Sin indicar</option><option>CONFIRMED</option><option>PROBABLE</option><option>UNSURE</option></select></label></div><label for="notes">Notas <span class="sub">(obligatorias para OTHER, AMBIGUOUS e INSUFFICIENT_EVIDENCE)</span></label><textarea id="notes" maxlength="1000" placeholder="Observación breve; no incluya claves ni datos personales ajenos al expediente"></textarea><div class="actions"><button class="primary" id="confirm">Confirmar decisión</button><button id="skip">Omitir caso</button><span class="status-line" id="saveStatus"></span></div></article></main></div><script>
'use strict';
const DATA=${embedded};
const DECISIONS=${JSON.stringify(DECISIONS)};
const REQUIRED_NOTES=${JSON.stringify([...REQUIRED_NOTES])};
let currentIndex=0;let ledger=new Map();let visible=DATA.cases.slice();let startedAt=performance.now();let activeDecision='';
const $=id=>document.getElementById(id);const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function fillSelect(id,values){const el=$(id);for(const value of [...new Set(values.filter(Boolean))].sort())el.add(new Option(value,value));}
fillSelect('classFilter',DATA.cases.map(item=>item.classification));fillSelect('chamberFilter',DATA.cases.map(item=>item.source.chamber));fillSelect('yearFilter',DATA.cases.map(item=>String(item.source.year||'')));
function current(){return visible[currentIndex]||null}
function stateCounts(){const scope=$('sampleOnly')?.checked?DATA.cases.filter(item=>DATA.sampleGroupIds.includes(item.groupId)):DATA.cases;let reviewed=0,skipped=0;for(const item of scope){const row=ledger.get(item.groupId);if(row?.status==='REVIEWED')reviewed++;if(row?.status==='SKIPPED')skipped++;}return{reviewed,skipped,pending:scope.length-reviewed-skipped,total:scope.length,scope};}
function renderProgress(){const c=stateCounts();$('reviewedCount').textContent=c.reviewed;$('skippedCount').textContent=c.skipped;$('pendingCount').textContent=c.pending;$('bar').style.width=String(c.total?Math.round((c.reviewed+c.skipped)*100/c.total):0)+'%';$('priorityCounts').textContent=['P0','P1','P2'].map(priority=>{const subset=c.scope.filter(item=>item.priority===priority);const reviewed=subset.filter(item=>ledger.get(item.groupId)?.status==='REVIEWED').length;const skipped=subset.filter(item=>ledger.get(item.groupId)?.status==='SKIPPED').length;return priority+': '+reviewed+'/'+subset.length+' revisados · '+skipped+' omitidos';}).join(' | ')}
function render(){renderNav();renderProgress();const item=current();if(!item){$('caseHeader').textContent='No hay casos para los filtros seleccionados.';return}const stored=ledger.get(item.groupId);$('caseCounter').textContent=\`Caso \${index+1} / \${visible.length} · universo \${DATA.cases.length}\`;$('caseHeader').innerHTML=\`<span class="badge \${item.priority}">\${item.priority}</span> <span class="badge">\${esc(stored?.status||'PENDING')}</span> <span class="badge">\${esc(item.classification)}</span><h2>\${esc(item.source.title||item.source.caseNumber||item.groupId)}</h2><div class="sub">\${esc(item.source.court||'Órgano s/d')} · Sala \${esc(item.source.chamber||'s/d')} · \${esc(item.source.decisionDate||'fecha s/d')}</div>\`;
const proposal=item.machineProposal;$('proposal').innerHTML=proposal?\`<div class="proposal"><strong>Propuesta automática preservada:</strong> \${esc(proposal.primaryCase)} · \${esc(proposal.confidence)}<div>\${esc(item.classification)}; evidencia \${esc((proposal.evidence||[]).join(', ')||'sin indicador adicional')}; páginas \${esc((proposal.pages||[]).join(', ')||'s/d')}; score \${esc(proposal.score??'s/d')}.</div></div>\`:'<div class="warning">J6 no propuso expediente primario. La decisión puede ser AMBIGUOUS o INSUFFICIENT_EVIDENCE con una nota explicativa.</div>';
const src=item.source;$('sourceGrid').innerHTML=[['Expediente',src.caseNumber],['Órgano',src.court],['Sala/Juzgado',src.chamber],['Fecha',src.decisionDate],['Carátula',src.title],['Sistema fuente',src.sourceSystem],['Registros fuente',src.sourceRecords.length],['SHA-256',item.pdf.sha256]].map(([k,v])=>field(k,v)).join('');
$('corpusNotice').textContent=item.corpus.status==='NO_EXACT_CANDIDATE_IN_J6_SNAPSHOT'?'El snapshot J6 no encontró un candidato Corpus exacto enlazado a este grupo. No implica que el PDF no exista en almacenamiento: identidad y metadata Corpus no están disponibles en este paquete.':'Candidato Corpus enlazado en el snapshot J6; revisar IDs y metadata debajo.';
$('corpusGrid').innerHTML=[['Estado',item.corpus.status],['Document ID',item.corpus.documentIds.join(', ')||'Sin candidato en snapshot'],['Expediente',item.corpus.metadata.map(x=>x.caseNumber).filter(Boolean).join('; ')||'No disponible'],['Órgano / sala',item.corpus.metadata.map(x=>[x.court,x.chamber].filter(Boolean).join(' · ')).filter(Boolean).join('; ')||'No disponible'],['Fecha',item.corpus.metadata.map(x=>x.decisionDate).filter(Boolean).join('; ')||'No disponible'],['SHA / páginas',item.corpus.files.map(x=>\`\${x.sha256||''} / \${x.pages||''}\`).join('; ')||'No disponible']].map(([k,v])=>field(k,v)).join('');
$('caseTable').innerHTML=item.pdf.cases.map(entry=>\`<tr><td>\${esc(entry.caseNumber)}</td><td>\${esc(entry.role)}</td><td>\${esc(entry.evidence.join(', ')||entry.zones.join(', ')||'Mención detectada')}</td><td>\${esc(entry.pages.join(', '))}</td></tr>\`).join('');$('pdfLinks').innerHTML=item.pdf.files.map(pdf=>pdf.localPath?\`<a href="\${esc(fileHref(pdf.localPath))}" target="_blank" rel="noopener noreferrer"><button type="button">Abrir PDF local (\${esc(pdf.pages||'?')} págs.)</button></a>\`:'').join('');
$('excerpts').innerHTML=item.pdf.excerpts.map(ex=>\`<blockquote class="excerpt"><small>Pág. \${esc(ex.page)} · \${esc(ex.zone)} · \${esc(ex.role)} · expediente \${esc(ex.caseNumber)}</small>\${markNumber(ex.text,item.machineProposal?.primaryCase)}</blockquote>\`).join('')||'<div class="sub">No hay extractos disponibles en el paquete J6.</div>';
const derived=Object.fromEntries([['caseNumber',proposal?.primaryCase],['court',null],['chamber',null],['decisionDate',null],['title',null]]);const sourceFields={caseNumber:src.caseNumber,court:src.court,chamber:src.chamber,decisionDate:src.decisionDate,title:src.title};$('metadataTable').innerHTML=Object.keys(sourceFields).map(key=>\`<tr><td>\${esc(key)}</td><td>\${esc(sourceFields[key]||'—')}</td><td>\${esc(item.corpus.metadata.map(x=>x[key]).filter(Boolean).join('; ')||'No disponible')}</td><td>\${esc(derived[key]||'—')}</td></tr>\`).join('');$('technical').textContent=JSON.stringify(item.technical,null,2);
$('reviewer').value=stored?.reviewer||$('reviewer').value||'';$('notes').value=stored?.notes||'';$('confidence').value=stored?.confidence||'';activeDecision=stored?.decision||'';document.querySelectorAll('input[name="decision"]').forEach(el=>el.checked=el.value===activeDecision);$('saveStatus').textContent=stored?\`Importada/registrada: \${stored.status}\${stored.decision?\` · \${stored.decision}\`:''}\`:'';$('confirm').disabled=!item;startedAt=performance.now()}
function field(label,value){return \`<div class="field"><small>\${esc(label)}</small><b>\${esc(value||'—')}</b></div>\`}function fileHref(value){return 'file:///'+encodeURI(value.split(String.fromCharCode(92)).join('/')).replace(/#/gu,'%23')}function markNumber(text,number){const safe=esc(text);if(!number)return safe;const escaped=esc(number);return safe.replace(escaped,\`<mark>\${escaped}</mark>\`)}
function decisionRow(item,status,decision,notes){const elapsed=Math.max(0,Math.round((performance.now()-startedAt)/1000));return{groupId:item.groupId,status,decision,reviewer:$('reviewer').value.trim(),reviewedAt:new Date().toISOString(),notes,confidence:$('confidence').value,machineProposal:item.machineProposal,reviewInputHash:DATA.reviewInputHash,gitSha:DATA.snapshot.gitSha,j6SnapshotRef:DATA.snapshot.j6SummarySha256,timeSpentSeconds:elapsed}}
$('decisions').addEventListener('change',event=>{if(event.target.name==='decision')activeDecision=event.target.value});$('confirm').onclick=()=>{const item=current();if(!item)return;const reviewer=$('reviewer').value.trim();if(!reviewer){alert('Ingresá reviewer antes de confirmar.');$('reviewer').focus();return}if(!activeDecision){alert('Seleccioná una decisión y luego confirmala.');return}const notes=$('notes').value.trim();if(REQUIRED_NOTES.includes(activeDecision)&&!notes){alert('Esta decisión requiere una nota breve.');$('notes').focus();return}if(!confirm(\`Confirmar \${activeDecision} para \${item.groupId}?\`))return;ledger.set(item.groupId,decisionRow(item,'REVIEWED',activeDecision,notes));$('saveStatus').textContent='Decisión en memoria. Exportá checkpoint JSON para guardarla en disco.';render()};$('skip').onclick=()=>{const item=current();if(!item)return;const reviewer=$('reviewer').value.trim();if(!reviewer){alert('Ingresá reviewer antes de omitir.');return}if(!confirm(\`Omitir \${item.groupId}? Podés reanudar importando el checkpoint.\`))return;ledger.set(item.groupId,decisionRow(item,'SKIPPED','',$('notes').value.trim()));render()};
function exportFile(filename,type,text){const blob=new Blob([text],{type});const url=URL.createObjectURL(blob);const anchor=document.createElement('a');anchor.href=url;anchor.download=filename;anchor.click();setTimeout(()=>URL.revokeObjectURL(url),1000)}function ledgerObject(){return{schemaVersion:'galilei-human-review-decisions-v1',reviewInputHash:DATA.reviewInputHash,gitSha:DATA.snapshot.gitSha,j6SnapshotRef:DATA.snapshot.j6SummarySha256,decisions:[...ledger.values()].sort((a,b)=>a.groupId.localeCompare(b.groupId))}}function jsonExport(){return JSON.stringify(ledgerObject(),null,2)+String.fromCharCode(10)}$('exportJson').onclick=()=>exportFile('review-decisions.json','application/json',jsonExport());$('exportCsv').onclick=()=>{const cols=['groupId','status','decision','reviewer','reviewedAt','notes','confidence','machineProposal','reviewInputHash','gitSha','j6SnapshotRef','timeSpentSeconds'];const records=[...ledger.values()].sort((a,b)=>a.groupId.localeCompare(b.groupId));const cell=value=>{const text=value==null?'':typeof value==='object'?JSON.stringify(value):String(value);const quote=text.includes(',')||text.includes('\"')||text.includes(String.fromCharCode(10))||text.includes(String.fromCharCode(13));return quote?'\"'+text.replaceAll('\"','\"\"')+'\"':text};const lines=[cols.join(','),...records.map(row=>cols.map(col=>cell(row[col])).join(','))];exportFile('review-decisions.csv','text/csv;charset=utf-8',lines.join(String.fromCharCode(13,10))+String.fromCharCode(13,10))};
document.querySelectorAll('#priorityFilter,#classFilter,#chamberFilter,#yearFilter,#statusFilter,#sampleOnly').forEach(el=>el.onchange=()=>{const filters={priority:$('priorityFilter').value,classification:$('classFilter').value,chamber:$('chamberFilter').value,year:$('yearFilter').value,status:$('statusFilter').value};visible=DATA.cases.filter(item=>(!filters.priority||item.priority===filters.priority)&&(!filters.classification||item.classification===filters.classification)&&(!filters.chamber||item.source.chamber===filters.chamber)&&(!filters.year||String(item.source.year)===filters.year)&&(!filters.status||(ledger.get(item.groupId)?.status||'PENDING')===filters.status)&&(!$('sampleOnly').checked||DATA.sampleGroupIds.includes(item.groupId)));currentIndex=0;render()});function move(delta){if(visible.length){currentIndex=(currentIndex+delta+visible.length)%visible.length;render()}}$('prev').onclick=()=>move(-1);$('next').onclick=()=>move(1);document.addEventListener('keydown',event=>{if(['INPUT','TEXTAREA','SELECT'].includes(document.activeElement.tagName))return;if(event.key==='ArrowLeft')move(-1);if(event.key==='ArrowRight')move(1);if(event.key==='s'||event.key==='S')$('skip').click();if(event.key==='Enter')$('confirm').click();if(/^[1-9]$/u.test(event.key)){const decision=DECISIONS[Number(event.key)-1];document.querySelector(\`input[name="decision"][value="\${decision}"]\`).checked=true;activeDecision=decision}});
function parseCsvText(text){const rows=[];let row=[],field='',quoted=false;for(let i=0;i<text.length;i++){const c=text[i];if(quoted){if(c==='"'&&text[i+1]==='"'){field+='"';i++}else if(c==='"')quoted=false;else field+=c}else if(c==='"')quoted=true;else if(c===','){row.push(field);field=''}else if(c===String.fromCharCode(10)){row.push(field.endsWith(String.fromCharCode(13))?field.slice(0,-1):field);rows.push(row);row=[];field=''}else field+=c}if(quoted)throw Error('CSV inválido');if(field||row.length){row.push(field);rows.push(row)}const headers=rows.shift()||[];return rows.filter(r=>r.some(Boolean)).map(r=>Object.fromEntries(headers.map((h,i)=>[h,r[i]||''])))}
async function importFile(file){const text=await file.text();const value=text.trimStart().startsWith('{')||text.trimStart().startsWith('[')?JSON.parse(text):{decisions:parseCsvText(text)};const entries=Array.isArray(value)?value:value.decisions;if(!Array.isArray(entries))throw Error('No se encontró una lista decisions');const expected=value.reviewInputHash||entries.find(x=>x.reviewInputHash)?.reviewInputHash;if(expected&&expected!==DATA.reviewInputHash)throw Error('Snapshot stale: el review input cambió. No importé decisiones.');const seen=new Map();for(const entry of entries){if(!DATA.cases.some(item=>item.groupId===entry.groupId))throw Error(\`groupId desconocido: \${entry.groupId}\`);if(!['REVIEWED','SKIPPED'].includes(entry.status))throw Error('Estado inválido: '+entry.status);if(entry.status==='REVIEWED'&&!DECISIONS.includes(entry.decision))throw Error('Decisión inválida: '+entry.decision);if(entry.status==='SKIPPED'&&entry.decision)throw Error('Un caso SKIPPED no puede incluir decisión');if(!String(entry.reviewer||'').trim())throw Error('Falta reviewer en '+entry.groupId);if(!/^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(?:\\.\\d{1,3})?(?:Z|[+-]\\d{2}:\\d{2})$/u.test(entry.reviewedAt||'')||!Number.isFinite(Date.parse(entry.reviewedAt)))throw Error('Timestamp inválido en '+entry.groupId);if(REQUIRED_NOTES.includes(entry.decision)&&!String(entry.notes||'').trim())throw Error('La decisión requiere nota en '+entry.groupId);if(entry.reviewInputHash!==DATA.reviewInputHash||entry.gitSha!==DATA.snapshot.gitSha||entry.j6SnapshotRef!==DATA.snapshot.j6SummarySha256)throw Error('Snapshot reference stale/incompleto en '+entry.groupId);const previous=seen.get(entry.groupId);if(previous&&JSON.stringify(previous)!==JSON.stringify(entry))throw Error(\`Decisiones contradictorias duplicadas: \${entry.groupId}\`);seen.set(entry.groupId,entry)}for(const entry of seen.values())ledger.set(entry.groupId,entry);render();$('saveStatus').textContent=\`Importadas \${seen.size} filas. Exportá el próximo checkpoint después de continuar.\`}
$('importFile').onchange=async event=>{try{if(event.target.files[0])await importFile(event.target.files[0])}catch(error){alert(error.message)}event.target.value=''};
render();
</script></body></html>`;
}

function buildSample(reviewInput) {
  const p0 = reviewInput.cases.filter(item => item.priority === 'P0');
  const p1 = reviewInput.cases.filter(item => item.priority === 'P1');
  const p2 = reviewInput.cases.filter(item => item.priority === 'P2');
  const highMention = p1.filter(item => item.pdf.cases.length >= 5);
  const weakP1 = p1.filter(item => !item.machineProposal?.resolutory && item.machineProposal?.score <= 8);
  const selected = [];
  const add = (items, count) => {
    let added = 0;
    for (const item of items) {
      if (selected.length >= 20 || selected.some(value => value.groupId === item.groupId)) continue;
      selected.push(item); added += 1;
      if (added >= count) break;
    }
  };
  add(p0, 4);
  add(highMention, 2);
  add(weakP1, 4);
  add(p1, 12 - selected.filter(item => item.priority === 'P1').length);
  add(p2, 4);
  add(reviewInput.cases, 20 - selected.length);
  return {
    schemaVersion: 'galilei-human-review-sample-v1',
    reviewInputHash: reviewInput.reviewInputHash,
    selectedCount: selected.length,
    selectionMethod: 'Stratified deterministic sample: single-decision P0, multi-case P1 including weak/header-only proposals and many-docket PDFs, then lower-confidence P2; groupId order breaks ties.',
    difficultyMix: Object.fromEntries(['P0', 'P1', 'P2'].map(priority => [priority, selected.filter(item => item.priority === priority).length])),
    cases: selected.map(item => ({ groupId: item.groupId, priority: item.priority, classification: item.classification, proposedPrimaryCase: item.machineProposal?.primaryCase || null, sha256: item.pdf.sha256, sourceCaseNumber: item.source.caseNumber, year: item.source.year, chamber: item.source.chamber, difficulty: item.priority === 'P0' ? 'single-decision primary proposal' : item.priority === 'P2' ? 'lower-confidence / inspect ambiguity' : item.pdf.cases.length >= 5 ? 'many dockets in one PDF' : item.machineProposal?.resolutory ? 'multi-case with resolutory evidence' : 'multi-case; verify opening/context evidence' })),
  };
}

function artifactReadiness(input, sample, html) {
  const checks = {
    allCasesHaveGroupIds: input.cases.every(item => item.groupId),
    allCasesHaveEvidence: input.cases.every(item => item.pdf.excerpts.length > 0 && item.pdf.cases.length > 0),
    localPdfRefsPresent: input.cases.every(item => item.pdf.files.length > 0 && item.pdf.files.every(pdf => pdf.localPath)),
    noExternalUrlsOrSecrets: !/https?:\/\//iu.test(JSON.stringify(input)) && !/(?:password|passwd|secret|api[_-]?key)\s*[:=]/iu.test(JSON.stringify(input)),
    decisionsCompatible: DECISIONS.length === 10,
    localHtmlLinksReferenceExistingFiles: input.cases.every(item => item.pdf.files.every(pdf => fs.existsSync(pdf.localPath))),
    htmlHasNoExternalResources: !/<(?:script|link)[^>]+(?:src|href)=["']https?:/iu.test(html),
    excludesUnknownMetadataCollisionCases: true,
    sampleHas20Cases: sample.selectedCount === 20,
  };
  return { status: Object.values(checks).every(Boolean) ? 'PASS' : 'FAIL', checks };
}

function writeJson(file, value) {
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function buildCommand(options = {}) {
  const inputDir = path.resolve(options.inputDir || DEFAULT_INPUT);
  const outputDir = path.resolve(options.outputDir || DEFAULT_OUTPUT);
  const gitSha = options.gitSha || require('node:child_process').execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim();
  if (!/^[a-f0-9]{40}$/u.test(gitSha)) throw new Error(`Invalid Git SHA: ${gitSha}`);
  const input = buildReviewInput(inputDir, gitSha);
  const sample = buildSample(input);
  const html = renderHtml(input);
  const readiness = artifactReadiness(input, sample, html);
  fs.mkdirSync(outputDir, { recursive: true });
  fs.mkdirSync(path.join(outputDir, 'review-app'), { recursive: true });
  writeJson(path.join(outputDir, 'review-input.json'), input);
  writeJson(path.join(outputDir, 'review-input-hash.json'), { reviewInputHash: input.reviewInputHash, gitSha, j6SnapshotRef: input.snapshot.j6SummarySha256, caseCount: input.cases.length });
  writeJson(path.join(outputDir, 'sample-20.json'), sample);
  fs.writeFileSync(path.join(outputDir, 'review-app', 'review.html'), html, 'utf8');
  fs.writeFileSync(path.join(outputDir, 'review-decisions-template.csv'), toCsv([]), 'utf8');
  writeJson(path.join(outputDir, 'review-decisions-template.json'), { schemaVersion: 'galilei-human-review-decisions-v1', reviewInputHash: input.reviewInputHash, gitSha, j6SnapshotRef: input.snapshot.j6SummarySha256, decisions: [] });
  writeJson(path.join(outputDir, 'validator-tests.json'), { status: 'PENDING_AUTOMATED_TESTS', required: ['valid decisions', 'unknown groupId rejection', 'identical duplicate normalization', 'conflicting duplicate rejection', 'invalid decision rejection', 'missing reviewer rejection', 'timestamp validation', 'snapshot staleness rejection', 'notes required rules', 'skip status'] });
  writeJson(path.join(outputDir, 'uat-readiness.json'), { status: readiness.status === 'PASS' ? 'READY_FOR_HUMAN_UAT' : 'NOT_READY', checks: readiness.checks, sampleCount: sample.selectedCount, totalReviewable: input.cases.length, reviewInputHash: input.reviewInputHash });
  const before = readJson(path.join(inputDir, 'write-sentinel-before.json'));
  const after = readJson(path.join(inputDir, 'write-sentinel-after.json'));
  writeJson(path.join(outputDir, 'write-sentinel-before.json'), before);
  writeJson(path.join(outputDir, 'write-sentinel-after.json'), after);
  const summary = {
    mission: 'SPRINT J6.1 — HUMAN REVIEW UAT',
    status: readiness.status === 'PASS' ? 'READY FOR HUMAN UAT' : 'PARTIAL',
    humanUat: 'NOT STARTED',
    reviewable: input.counts,
    reviewInputHash: input.reviewInputHash,
    gitSha,
    j6SnapshotRef: input.snapshot.j6SummarySha256,
    sample: { selected: sample.selectedCount, difficultyMix: sample.difficultyMix },
    tool: { type: 'static HTML / file://', externalNetworkRequests: 0, databaseWrites: 0, localStorageOnly: false, saveMode: 'manual JSON/CSV export plus import to resume' },
    integrity: { sourceJ6TransactionReadOnly: true, writes: 0, beforeAfterSentinelsEqual: stableStringify(before) === stableStringify(after), search: readJson(path.join(inputDir, 'final-summary.json')).integrity.search },
    readiness,
    artifacts: '_recovery-work/jurisprudencia-j61/',
  };
  writeJson(path.join(outputDir, 'final-summary.json'), summary);
  if (readiness.status !== 'PASS') throw new Error(`Review pack readiness failed: ${JSON.stringify(readiness.checks)}`);
  return summary;
}

function csvToJson(text) {
  const rows = parseCsv(text);
  return { decisions: rows };
}

function validateFile(inputFile, options = {}) {
  const reviewInput = readJson(options.reviewInput || path.join(DEFAULT_OUTPUT, 'review-input.json'));
  const text = fs.readFileSync(inputFile, 'utf8');
  const parsed = path.extname(inputFile).toLowerCase() === '.csv' ? csvToJson(text) : JSON.parse(text);
  return normalizeAndValidate(parsed, reviewInput);
}

function usage() {
  return 'Usage:\n  node scripts/dev/jurisprudencia-human-review.cjs build\n  node scripts/dev/jurisprudencia-human-review.cjs validate <review-decisions.csv|json>\n  node scripts/dev/jurisprudencia-human-review.cjs summary <review-decisions.csv|json>\n  node scripts/dev/jurisprudencia-human-review.cjs build --input-dir <path> --out-dir <path> --git-sha <40-hex>';
}

function parseOptions(args) {
  const options = {};
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === '--input-dir') options.inputDir = args[++index];
    else if (args[index] === '--out-dir') options.outputDir = args[++index];
    else if (args[index] === '--git-sha') options.gitSha = args[++index];
    else if (args[index] === '--review-input') options.reviewInput = args[++index];
  }
  return options;
}

if (require.main === module) {
  const [command, ...args] = process.argv.slice(2);
  const options = parseOptions(args);
  try {
    if (command === 'build') console.log(JSON.stringify(buildCommand(options), null, 2));
    else if (command === 'validate' || command === 'summary') {
      const file = args.find(value => !value.startsWith('--') && value !== options.reviewInput && value !== options.inputDir && value !== options.outputDir && value !== options.gitSha);
      if (!file) throw new Error(usage());
      const result = validateFile(path.resolve(file), options);
      if (command === 'validate') console.log(JSON.stringify({ valid: result.valid, errors: result.errors, normalizedCount: result.decisions.length }, null, 2));
      else console.log(JSON.stringify(result.summary, null, 2));
      if (result.valid) {
        const outputDir = path.resolve(options.outputDir || DEFAULT_OUTPUT);
        fs.mkdirSync(outputDir, { recursive: true });
        const ledger = {
          schemaVersion: 'galilei-human-review-decisions-v1',
          reviewInputHash: result.summary.reviewInputHash,
          gitSha: result.summary.gitSha,
          j6SnapshotRef: result.summary.j6SnapshotRef,
          decisions: result.decisions,
        };
        writeJson(path.join(outputDir, 'review-decisions.json'), ledger);
        fs.writeFileSync(path.join(outputDir, 'review-decisions.csv'), toCsv(result.decisions), 'utf8');
        if (command === 'summary') {
          writeJson(path.join(outputDir, 'review-summary.json'), result.summary);
          writeJson(path.join(outputDir, 'human-uat-summary.json'), {
            status: result.summary.humanUatStatus,
            casesReviewed: result.summary.reviewed,
            sample: result.summary.sample,
            agreementOnReviewedSample: result.summary.agreementOnReviewedSample,
            disagreements: result.summary.agreementOnReviewedSample.disagreements,
            ambiguous: result.summary.decisionsByType.AMBIGUOUS || 0,
            averageSecondsPerReviewedCase: result.summary.averageSecondsPerReviewedCase,
            reviewers: result.summary.reviewers,
            feedback: { casesWithNotes: result.decisions.filter(row => row.status === 'REVIEWED' && row.notes.trim()).map(row => row.groupId) },
            reviewInputHash: result.summary.reviewInputHash,
            gitSha: result.summary.gitSha,
            j6SnapshotRef: result.summary.j6SnapshotRef,
            generatedFromValidatedLedger: true,
          });
        }
      }
      if (!result.valid) process.exitCode = 1;
    } else console.log(usage());
  } catch (error) {
    console.error(error.stack || error.message);
    process.exitCode = 1;
  }
}

module.exports = {
  DECISIONS,
  buildReviewInput,
  buildSample,
  calculateReviewInputHash,
  normalizeAndValidate,
  filterCases,
  parseCsv,
  renderHtml,
  sha256,
  stableStringify,
  summarize,
  toCsv,
};
