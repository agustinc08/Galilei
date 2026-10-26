'use strict';

// Offline evaluator. Human label files are the only source of expected values.
// Parser output is written as machine-candidate evidence, never as gold.
const fs = require('node:fs/promises');
const path = require('node:path');
const { performance } = require('node:perf_hooks');
const { parseStructuredJudgment, STRUCTURED_JUDGMENT_PARSER_VERSION } = require('../../src/sentencias/structured-judgment-parser.ts');
const { parseArgentineCitationsV2, resolveCitationV2, ARGENTINE_CITATION_PARSER_V2 } = require('../../src/research-relationships/citation-parser-v2.ts');

const DEFAULT_PACK = path.resolve(__dirname, '../../../_recovery-work/galilei-editorial-gold-recall-suite4/human-review');
const GOLD_ROOT = path.resolve(__dirname, '../../test-fixtures/legal-gold/civil-gold-v1');

function parseArgs(argv) {
  let pack = DEFAULT_PACK;
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--pack') pack = path.resolve(argv[++index] || '');
    else throw new Error('UNSUPPORTED_ARGUMENT');
  }
  return { pack };
}

async function readJson(filePath) { return JSON.parse(await fs.readFile(filePath, 'utf8')); }
async function readJsonl(filePath, optional = false) {
  let text;
  try { text = await fs.readFile(filePath, 'utf8'); }
  catch (error) { if (optional && error.code === 'ENOENT') return []; throw error; }
  return text.split(/\r?\n/u).map((line) => line.trim()).filter(Boolean).map((line, index) => {
    try { return JSON.parse(line); } catch { throw new Error(`INVALID_JSONL_LINE_${index + 1}`); }
  });
}
const normalize = (value) => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/gu, '').toUpperCase().replace(/\s+/gu, ' ').trim();
const pct = (value) => value === null ? null : Number((value * 100).toFixed(3));
const ratio = (a, b) => b === 0 ? 0 : a / b;
const f1 = (precision, recall) => precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);
function percentile(values, p) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return Number(sorted[Math.min(sorted.length - 1, Math.ceil(p * sorted.length) - 1)].toFixed(3));
}
function timingSummary(values) {
  const total = values.reduce((sum, value) => sum + value, 0);
  return {
    p50: percentile(values, 0.5),
    p95: percentile(values, 0.95),
    max: Number(Math.max(...values).toFixed(3)),
    total: Number(total.toFixed(3)),
    mean: Number((total / values.length).toFixed(3)),
  };
}
function typeKey(value) {
  if (value === 'RESULTANDO' || value === 'RESULTA') return 'RESULTA';
  if (value === 'NUMBERED_CONSIDERATION' || value === 'NUMBERED_SECTION') return 'NUMBERED_SECTION';
  if (value === 'FALLO' || value === 'PARTE_DISPOSITIVA') return 'RESUELVE';
  return value;
}
function keyStructure(item, human) {
  return [item.page ?? item.pageStart, typeKey(human ? item.expectedType : item.type), normalize(human ? item.rawHeading : item.rawHeading)].join('|');
}
function keyCitation(item, human) {
  return [human ? item.page : item.sourcePage, human ? item.family : item.family, normalize(human ? item.rawCitation : item.rawCitation)].join('|');
}
function weightedCounts(predictionsByDoc, labelsByDoc, keyFn, weightOf) {
  let tp = 0; let fp = 0; let fn = 0;
  let rawTp = 0; let rawFp = 0; let rawFn = 0;
  for (const [sampleId, predictions] of predictionsByDoc) {
    const gold = labelsByDoc.get(sampleId) || [];
    const weight = weightOf(sampleId);
    const available = new Map();
    for (const item of gold) {
      const key = keyFn(item, true);
      available.set(key, [...(available.get(key) || []), item]);
    }
    for (const prediction of predictions) {
      const key = keyFn(prediction, false);
      const matches = available.get(key) || [];
      const positiveIndex = matches.findIndex((item) => item.decision !== 'DO_NOT_DETECT');
      if (positiveIndex >= 0) {
        matches.splice(positiveIndex, 1);
        tp += weight; rawTp += 1;
      } else {
        fp += weight; rawFp += 1;
      }
    }
    for (const remaining of available.values()) {
      for (const item of remaining) {
        if (item.decision === 'DO_NOT_DETECT') continue;
        fn += weight; rawFn += 1;
      }
    }
  }
  const precision = ratio(tp, tp + fp);
  const recall = ratio(tp, tp + fn);
  return { truePositives: rawTp, falsePositives: rawFp, falseNegatives: rawFn, precision: pct(precision), recall: pct(recall), f1: pct(f1(precision, recall)), prevalenceWeighted: { truePositives: Number(tp.toFixed(3)), falsePositives: Number(fp.toFixed(3)), falseNegatives: Number(fn.toFixed(3)), precision: pct(precision), recall: pct(recall), f1: pct(f1(precision, recall)) } };
}
function summarizeStructureMetrics(predictionsByDoc, labelsByDoc, weights) {
  let metrics = weightedCounts(predictionsByDoc, labelsByDoc, keyStructure, (id) => weights.get(id) || 1);
  let outlined = 0; let partial = 0; let noOutlineExpected = 0; let wrongOutline = 0;
  for (const [sampleId, predictions] of predictionsByDoc) {
    const label = labelsByDoc.get(sampleId) || [];
    const positive = label.filter((item) => item.expectedType);
    const predKeys = new Set(predictions.map((item) => keyStructure(item, false)));
    const expectedKeys = new Set(positive.map((item) => keyStructure(item, true)));
    const matches = [...expectedKeys].filter((key) => predKeys.has(key)).length;
    if (predictions.length && !expectedKeys.size) wrongOutline += 1;
    else if (!predictions.length && expectedKeys.size) noOutlineExpected += 1;
    else if (predictions.length && matches === expectedKeys.size && matches === predKeys.size) outlined += 1;
    else if (matches > 0) partial += 1;
    else if (predictions.length && expectedKeys.size) wrongOutline += 1;
  }
  return { ...metrics, judgmentLevel: { outlineCorrectlyUseful: outlined, partialOutline: partial, noOutlineButExpected: noOutlineExpected, wrongOutline: wrongOutline } };
}
function resolutionLabelCheck(candidate, expected, sourceId, targets) {
  const resolution = resolveCitationV2(candidate, Number(sourceId), targets);
  const targetId = expected.expectedTarget?.documentId === null || expected.expectedTarget?.documentId === undefined ? null : Number(expected.expectedTarget.documentId);
  const expectedOutcome = expected.resolutionExpectation;
  const correct = expectedOutcome === 'UNIQUE'
    ? resolution.outcome === 'RESOLVED_UNIQUE' && resolution.targetSentenceId === targetId
    : expectedOutcome === 'AMBIGUOUS'
      ? resolution.outcome === 'AMBIGUOUS'
      : expectedOutcome === 'SELF_REFERENCE'
        ? resolution.outcome === 'SELF_REFERENCE'
        : ['UNRESOLVED', 'STATUTE_ONLY'].includes(expectedOutcome)
          ? resolution.outcome === 'UNRESOLVED'
          : true;
  return { expectedOutcome, actualOutcome: resolution.outcome, expectedTargetId: targetId, actualTargetId: resolution.targetSentenceId, wrongUnique: resolution.outcome === 'RESOLVED_UNIQUE' && (expectedOutcome !== 'UNIQUE' || resolution.targetSentenceId !== targetId), correct };
}
function summarizeCitationMetrics(predictionsByDoc, labelsByDoc, weights, sourceIds, targets) {
  const overall = weightedCounts(predictionsByDoc, labelsByDoc, keyCitation, (id) => weights.get(id) || 1);
  const families = {};
  const familyNames = new Set();
  for (const values of labelsByDoc.values()) for (const item of values) if (item.decision !== 'DO_NOT_DETECT' && item.family) familyNames.add(item.family);
  for (const values of predictionsByDoc.values()) for (const item of values) familyNames.add(item.family);
  for (const family of [...familyNames].sort()) {
    const preds = new Map([...predictionsByDoc].map(([id, values]) => [id, values.filter((item) => item.family === family)]));
    const labels = new Map([...labelsByDoc].map(([id, values]) => [id, values.filter((item) => item.family === family)]));
    const metric = weightedCounts(preds, labels, keyCitation, (id) => weights.get(id) || 1);
    let resolved = 0; let ambiguous = 0; let unresolved = 0;
    for (const values of labels.values()) for (const item of values) if (item.decision !== 'DO_NOT_DETECT') {
      if (item.resolutionExpectation === 'UNIQUE') resolved += 1;
      else if (item.resolutionExpectation === 'AMBIGUOUS') ambiguous += 1;
      else if (['UNRESOLVED', 'SELF_REFERENCE', 'STATUTE_ONLY'].includes(item.resolutionExpectation)) unresolved += 1;
    }
    families[family] = { support: [...labels.values()].flat().filter((item) => item.decision !== 'DO_NOT_DETECT').length, precision: metric.precision, recall: metric.recall, resolved, ambiguous, unresolved };
  }
  let wrongUnique = 0; let resolutionCorrect = 0; let resolutionTotal = 0;
  const resolutionReasons = {};
  const resolutionOutcomes = { UNIQUE: 0, AMBIGUOUS: 0, UNRESOLVED: 0, SELF_REFERENCE: 0, STATUTE_ONLY: 0, OUT_OF_SCOPE: 0 };
  for (const [sampleId, refs] of labelsByDoc) {
    const predictions = predictionsByDoc.get(sampleId) || [];
    const unmatched = [...predictions];
    for (const ref of refs) {
      if (ref.decision === 'DO_NOT_DETECT') { resolutionOutcomes.OUT_OF_SCOPE += 1; continue; }
      resolutionOutcomes[ref.resolutionExpectation] = (resolutionOutcomes[ref.resolutionExpectation] || 0) + 1;
      resolutionReasons[ref.resolutionReason || 'NOT_CLASSIFIED'] = (resolutionReasons[ref.resolutionReason || 'NOT_CLASSIFIED'] || 0) + 1;
      const index = unmatched.findIndex((candidate) => keyCitation(candidate, false) === keyCitation(ref, true));
      if (index < 0) continue;
      const [candidate] = unmatched.splice(index, 1);
      const check = resolutionLabelCheck(candidate, ref, sourceIds.get(sampleId), targets);
      wrongUnique += check.wrongUnique ? 1 : 0;
      resolutionCorrect += check.correct ? 1 : 0;
      resolutionTotal += 1;
    }
  }
  return { ...overall, families, resolution: { expectedOutcomes: resolutionOutcomes, reasonCategories: resolutionReasons, matchedReferenceResolutionAccuracy: resolutionTotal ? pct(resolutionCorrect / resolutionTotal) : 0, matchedReferenceCount: resolutionTotal, wrongUniqueResolutions: wrongUnique } };
}

function buildAdversarialText() {
  const near = 'C.S.J.N. 999999/20__ R. 1.234 de fecha 99-99-9999 Fallos 0000:999999 art. 999999 ley 999999\n';
  return near.repeat(Math.ceil(900_000 / near.length)).slice(0, 900_000);
}

async function main() {
  const { pack } = parseArgs(process.argv.slice(2));
  const machineEvidence = path.resolve(pack, '..', 'machine-evaluation');
  await fs.mkdir(machineEvidence, { recursive: true });
  const manifest = await readJson(path.join(pack, 'sample-manifest.json'));
  const documents = await readJsonl(path.join(pack, 'sample-text.jsonl'));
  const structureLabelsArray = await readJsonl(path.join(GOLD_ROOT, 'structure', 'labels.jsonl'), true);
  const citationLabelsArray = await readJsonl(path.join(GOLD_ROOT, 'citations', 'labels.jsonl'), true);
  const structurePack = await readJsonl(path.join(pack, 'structure-review-pack.jsonl'));
  const citationPack = await readJsonl(path.join(pack, 'citation-review-pack.jsonl'));
  const targetsRaw = await readJsonl(path.join(pack, 'target-catalog.jsonl'));
  const targets = targetsRaw.map((target) => ({ ...target, id: Number(target.documentId), fecha: target.decisionDate, publicado: true, activo: true }));
  const structureLabels = new Map(structureLabelsArray.map((label) => [label.sampleId, label.sections.map((item) => ({ ...item, page: item.page }))]));
  const citationLabels = new Map(citationLabelsArray.map((label) => [label.sampleId, label.references]));
  const structureAssigned = new Set(structurePack.map((doc) => doc.sampleId));
  const citationAssigned = new Set(citationPack.map((doc) => doc.sampleId));
  const structureComplete = structureAssigned.size > 0 && structureLabelsArray.length === structureAssigned.size && structureLabelsArray.every((label) => structureAssigned.has(label.sampleId) && label.status === 'HUMAN_REVIEW_COMPLETE' && label.exhaustive === true);
  const citationComplete = citationAssigned.size > 0 && citationLabelsArray.length === citationAssigned.size && citationLabelsArray.every((label) => citationAssigned.has(label.sampleId) && label.status === 'HUMAN_REVIEW_COMPLETE' && label.exhaustive === true);
  const structurePredictions = new Map();
  const citationPredictions = new Map();
  const structureTimes = [];
  const citationTimes = [];
  const predictionsOutput = [];
  for (const document of documents) {
    const pageInput = document.pages.map(({ pageNumber, text }) => ({ pageNumber, text }));
    const structureStart = performance.now();
    const sections = parseStructuredJudgment(pageInput, { completeSource: true });
    structureTimes.push(performance.now() - structureStart);
    const citationStart = performance.now();
    const citations = parseArgentineCitationsV2(document.pages.map(({ pageNumber, text, textKind }) => ({ pageNumber, text, textKind })), document.sourceIdentity || {});
    citationTimes.push(performance.now() - citationStart);
    structurePredictions.set(document.sampleId, sections.map((item) => ({ ...item, page: item.pageStart })));
    citationPredictions.set(document.sampleId, citations);
    predictionsOutput.push({ sampleId: document.sampleId, documentId: document.documentId, sourceHash: document.sourceHash, structure: sections, citations });
  }
  await fs.writeFile(path.join(machineEvidence, 'parser-candidates.jsonl'), `${predictionsOutput.map((row) => JSON.stringify(row)).join('\n')}\n`, 'utf8');
  const structureWeights = new Map(structurePack.map((doc) => [doc.sampleId, Number(doc.sampling.weight || 1) * Number(doc.reviewWeight || 1)]));
  const citationWeights = new Map(citationPack.map((doc) => [doc.sampleId, Number(doc.sampling.weight || 1) * Number(doc.reviewWeight || 1)]));
  const structurePredAssigned = new Map([...structureAssigned].map((id) => [id, structurePredictions.get(id) || []]));
  const citationPredAssigned = new Map([...citationAssigned].map((id) => [id, citationPredictions.get(id) || []]));
  const sourceIds = new Map([...documents].map((doc) => [doc.sampleId, Number(doc.documentId)]));
  const stressText = buildAdversarialText();
  const stressStart = performance.now();
  parseArgentineCitationsV2([{ pageNumber: 1, text: stressText }, { pageNumber: 2, text: stressText }, { pageNumber: 3, text: stressText }]);
  const regexStressMs = Number((performance.now() - stressStart).toFixed(3));
  const projectionScale = manifest.eligiblePopulationAfterFilters / documents.length;
  const resolutionProjection = { RESOLVED_UNIQUE: 0, AMBIGUOUS: 0, UNRESOLVED: 0, SELF_REFERENCE: 0 };
  let projectedCandidateRowsInSample = 0;
  const parsedCitationDetectionsInSample = predictionsOutput.reduce((sum, row) => sum + row.citations.length, 0);
  for (const row of predictionsOutput) {
    for (const citation of row.citations) {
      if (!citation.identifierType || !citation.normalizedIdentifier) continue;
      if (citation.resolutionOutcome === 'SELF_REFERENCE') {
        resolutionProjection.SELF_REFERENCE += 1;
        continue;
      }
      projectedCandidateRowsInSample += 1;
      const resolution = resolveCitationV2(citation, Number(row.documentId), targets);
      resolutionProjection[resolution.outcome] += 1;
    }
  }
  const parserCpuSampleMs = structureTimes.reduce((sum, value) => sum + value, 0) + citationTimes.reduce((sum, value) => sum + value, 0);
  const projectedCandidateRows = Math.round(projectedCandidateRowsInSample * projectionScale);
  const projectedCitationDetections = Math.round(parsedCitationDetectionsInSample * projectionScale);
  const projectedParserCpuMs = Number((parserCpuSampleMs * projectionScale).toFixed(3));
  const workloadScenarios = (candidateCount) => Object.fromEntries([10, 30, 60].map((secondsPerCandidate) => [String(secondsPerCandidate), Number((candidateCount * secondsPerCandidate / 3600).toFixed(1))]));
  const structureMetrics = structureComplete ? summarizeStructureMetrics(structurePredAssigned, structureLabels, structureWeights) : 'PENDING_HUMAN_GOLD';
  const citationMetrics = citationComplete ? summarizeCitationMetrics(citationPredAssigned, citationLabels, citationWeights, sourceIds, targets) : 'PENDING_HUMAN_GOLD';
  const summary = {
    goldVersion: manifest.goldVersion,
    manifestSha256: manifest.manifestSha256,
    candidateSha: require('node:child_process').execFileSync('git', ['rev-parse', 'HEAD'], { cwd: path.resolve(__dirname, '../../..'), encoding: 'utf8' }).trim(),
    parserVersions: { structure: STRUCTURED_JUDGMENT_PARSER_VERSION, citations: ARGENTINE_CITATION_PARSER_V2 },
    sampleSize: documents.length,
    structureGold: { assigned: structurePack.length, exhaustiveHumanLabels: structureLabelsArray.length, status: structureComplete ? 'COMPLETE' : 'PENDING_HUMAN_GOLD', metrics: structureMetrics },
    citationGold: { assigned: citationPack.length, exhaustiveHumanLabels: citationLabelsArray.length, status: citationComplete ? 'COMPLETE' : 'PENDING_HUMAN_GOLD', metrics: citationMetrics },
    observedParserOutput: {
      structureDocumentsWithOutline: predictionsOutput.filter((row) => row.structure.length > 0).length,
      structureSections: predictionsOutput.reduce((sum, row) => sum + row.structure.length, 0),
      citations: predictionsOutput.reduce((sum, row) => sum + row.citations.length, 0),
      citationFamilies: Object.fromEntries([...new Set(predictionsOutput.flatMap((row) => row.citations.map((item) => item.family)))].sort().map((family) => [family, predictionsOutput.reduce((sum, row) => sum + row.citations.filter((item) => item.family === family).length, 0)])),
    },
    readOnlyBackfillProjection: {
      populationDocuments: manifest.eligiblePopulationAfterFilters,
      sampleDocuments: documents.length,
      method: 'sample parser output projected linearly to the eligible public population; exact published/active catalog lookup; not a quality estimate or principal write plan',
      parsedCitationDetectionsInSample,
      parsedCitationDetectionsProjected: projectedCitationDetections,
      parsedCitationDetectionsPer1000Judgments: Number((parsedCitationDetectionsInSample / documents.length * 1000).toFixed(1)),
      candidateRowsInSample: projectedCandidateRowsInSample,
      candidateRowsProjected: projectedCandidateRows,
      candidateRowsPer1000Judgments: Number((projectedCandidateRowsInSample / documents.length * 1000).toFixed(1)),
      resolutionOutcomesInSample: resolutionProjection,
      resolutionOutcomesProjected: Object.fromEntries(Object.entries(resolutionProjection).map(([key, value]) => [key, Math.round(value * projectionScale)])),
      parserCpuMsForSample: Number(parserCpuSampleMs.toFixed(3)),
      parserCpuMsProjected: projectedParserCpuMs,
      reviewWorkloadScenariosHours: {
        perDetectedCitation: workloadScenarios(projectedCitationDetections),
        perCaseRelationshipCandidate: workloadScenarios(projectedCandidateRows),
        assumption: 'hypothetical seconds per machine-emitted item; excludes exhaustive source reading needed to find missed citations and is not an observed review rate',
      },
      storageImpact: 'NOT_MEASURED; requires a separate isolated PostgreSQL dry-run',
    },
    performanceMs: {
      structurePerDocument: timingSummary(structureTimes),
      citationsPerDocument: timingSummary(citationTimes),
      regexAdversarialCitationInput: { inputBytes: Buffer.byteLength(stressText) * 3, elapsedMs: regexStressMs, status: regexStressMs < 5000 ? 'PASS' : 'REVIEW_REQUIRED' },
    },
    parserChanges: 'NONE; no parser modification is justified until human gold exists',
    generatedAt: new Date().toISOString(),
  };
  await fs.writeFile(path.join(machineEvidence, 'evaluation.json'), `${JSON.stringify(summary, null, 2)}\n`, 'utf8');
  const markdown = [
    '# Civil Gold v1 — evaluation', '',
    `- Sample: ${summary.sampleSize} published judgments`,
    `- Structure: ${summary.structureGold.status}; ${summary.structureGold.exhaustiveHumanLabels}/${summary.structureGold.assigned} exhaustive human labels`,
    `- Citations: ${summary.citationGold.status}; ${summary.citationGold.exhaustiveHumanLabels}/${summary.citationGold.assigned} exhaustive human labels`,
    '- Precision, recall, F1 and prevalence-weighted metrics that require human labels remain `PENDING_HUMAN_GOLD` until every assigned document is reviewed.',
    '- Parser candidates are stored separately and are not expected labels.',
    `- Observed structure output: ${summary.observedParserOutput.structureDocumentsWithOutline} judgments with outline; ${summary.observedParserOutput.structureSections} sections.`,
    `- Observed citation output: ${summary.observedParserOutput.citations} detections; families: ${Object.entries(summary.observedParserOutput.citationFamilies).map(([family, count]) => `${family}=${count}`).join(', ')}.`,
    `- Read-only linear projection over ${summary.readOnlyBackfillProjection.populationDocuments} judgments: ${summary.readOnlyBackfillProjection.parsedCitationDetectionsProjected} parsed citations and ${summary.readOnlyBackfillProjection.candidateRowsProjected} case-relationship candidate rows; not a quality estimate.`,
    `- Exact-catalog machine outcomes projected (not human validated): unique ${summary.readOnlyBackfillProjection.resolutionOutcomesProjected.RESOLVED_UNIQUE}; ambiguous ${summary.readOnlyBackfillProjection.resolutionOutcomesProjected.AMBIGUOUS}; unresolved ${summary.readOnlyBackfillProjection.resolutionOutcomesProjected.UNRESOLVED}; self-reference ${summary.readOnlyBackfillProjection.resolutionOutcomesProjected.SELF_REFERENCE}.`,
    `- Hypothetical triage hours at 10/30/60 sec per emitted citation: ${summary.readOnlyBackfillProjection.reviewWorkloadScenariosHours.perDetectedCitation['10']}/${summary.readOnlyBackfillProjection.reviewWorkloadScenariosHours.perDetectedCitation['30']}/${summary.readOnlyBackfillProjection.reviewWorkloadScenariosHours.perDetectedCitation['60']}; source reading for missed citations is additional and no actual review rate is known.`,
    `- Case-relationship candidates only at 10/30/60 sec each: ${summary.readOnlyBackfillProjection.reviewWorkloadScenariosHours.perCaseRelationshipCandidate['10']}/${summary.readOnlyBackfillProjection.reviewWorkloadScenariosHours.perCaseRelationshipCandidate['30']}/${summary.readOnlyBackfillProjection.reviewWorkloadScenariosHours.perCaseRelationshipCandidate['60']} hours.`,
    `- Projected parser CPU: ${summary.readOnlyBackfillProjection.parserCpuMsProjected} ms. Storage impact: ${summary.readOnlyBackfillProjection.storageImpact}.`,
    `- Structure parser: p50 ${summary.performanceMs.structurePerDocument.p50} ms, p95 ${summary.performanceMs.structurePerDocument.p95} ms, max ${summary.performanceMs.structurePerDocument.max} ms per document.`,
    `- Citation parser: p50 ${summary.performanceMs.citationsPerDocument.p50} ms, p95 ${summary.performanceMs.citationsPerDocument.p95} ms, max ${summary.performanceMs.citationsPerDocument.max} ms per document.`,
    `- Citation regex stress: ${summary.performanceMs.regexAdversarialCitationInput.inputBytes} bytes in ${regexStressMs} ms (${summary.performanceMs.regexAdversarialCitationInput.status}).`,
    '- Parser changes: none; do not tune detectors or resolvers before human gold.',
    '',
  ].join('\n');
  await fs.writeFile(path.join(machineEvidence, 'evaluation.md'), markdown, 'utf8');
  console.log(JSON.stringify(summary, null, 2));
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`LEGAL_GOLD_EVALUATION=FAIL; ${error.code || error.message || 'UNKNOWN_ERROR'}`);
    process.exitCode = 1;
  });
}

module.exports = { weightedCounts, summarizeStructureMetrics, summarizeCitationMetrics, keyStructure, keyCitation, buildAdversarialText };
