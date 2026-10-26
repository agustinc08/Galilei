import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  parseArgentineCitationsV2,
  resolveCitationV2,
} from '../../src/research-relationships/citation-parser-v2.ts';
import { parseStructuredJudgment } from '../../src/sentencias/structured-judgment-parser.ts';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const evidenceRoot = path.resolve(
  scriptDirectory,
  '../../../_recovery-work/galilei-structured-citations-suite3',
);

function parseArgs(args) {
  const values = new Map();
  for (let index = 0; index < args.length; index += 1) {
    const [key, inline] = String(args[index]).split('=', 2);
    if (key === '--dry-run') {
      values.set(key, true);
      continue;
    }
    if (!['--input', '--output', '--limit', '--offset'].includes(key)) {
      throw new Error('UNSUPPORTED_ARGUMENT');
    }
    const value = inline ?? args[++index];
    if (!value || String(value).startsWith('--')) {
      throw new Error('MISSING_ARGUMENT_VALUE');
    }
    values.set(key, String(value));
  }
  if (!values.get('--dry-run')) throw new Error('DRY_RUN_REQUIRED');
  const limit = Number(values.get('--limit') ?? 200);
  const offset = Number(values.get('--offset') ?? 0);
  if (!Number.isInteger(limit) || limit < 100 || limit > 500) {
    throw new Error('LIMIT_OUT_OF_RANGE_100_500');
  }
  if (!Number.isInteger(offset) || offset < 0 || offset > 5000) {
    throw new Error('OFFSET_OUT_OF_RANGE_0_5000');
  }
  const inputPath = path.resolve(
    values.get('--input') ?? path.join(evidenceRoot, 'real-corpus-pages-sample.json'),
  );
  const outputPath = path.resolve(values.get('--output') ?? evidenceRoot);
  if (outputPath !== evidenceRoot) throw new Error('OUTPUT_PATH_REJECTED');
  return { inputPath, outputPath, limit, offset };
}

function frequency(values) {
  const counts = new Map();
  for (const value of values) {
    const key = value || 'UNKNOWN';
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return Object.fromEntries([...counts.entries()].sort(([left], [right]) => left.localeCompare(right)));
}

function stableRank(value) {
  return createHash('sha256').update(`citation-v2-manual:${value}`).digest('hex');
}

function sampleCandidates(candidates) {
  const quotas = {
    EXPEDIENTE_IDENTIFIER: 18,
    CIVIL_EXPEDIENTE: 5,
    CSJN_FALLOS: 5,
    CNCIV_SALA_DATE: 5,
    OTHER_COURT: 5,
    CNCIV_ROLLO: 5,
    STATUTE_REFERENCE: 5,
    CSJN_CASE: 1,
    CSJN_DECISION_DATE: 1,
  };
  const remaining = [...candidates];
  const selected = [];
  for (const [family, quota] of Object.entries(quotas)) {
    const familyCandidates = remaining
      .filter((candidate) => candidate.family === family)
      .sort((left, right) => left.reviewRank.localeCompare(right.reviewRank));
    const picked = familyCandidates.slice(0, quota);
    selected.push(...picked);
    for (const item of picked) remaining.splice(remaining.indexOf(item), 1);
    quotas[family] = picked.length;
  }
  if (selected.length < 50) {
    remaining.sort((left, right) => left.reviewRank.localeCompare(right.reviewRank));
    selected.push(...remaining.slice(0, 50 - selected.length));
  }
  return {
    selected: selected.slice(0, 50).map(({ reviewRank: _rank, ...candidate }) => ({
      ...candidate,
      annotation: null,
    })),
    quota: quotas,
  };
}

function main() {
  const { inputPath, outputPath, limit, offset } = parseArgs(process.argv.slice(2));
  if (!existsSync(inputPath)) throw new Error('SAMPLE_FILE_NOT_FOUND');
  const sample = JSON.parse(readFileSync(inputPath, 'utf8'));
  if (!Array.isArray(sample.documents)) throw new Error('SAMPLE_SCHEMA_REJECTED');
  const targetPath = path.join(evidenceRoot, 'citation-resolution-targets.json');
  if (!existsSync(targetPath)) throw new Error('RESOLUTION_TARGETS_NOT_FOUND');
  const resolutionData = JSON.parse(readFileSync(targetPath, 'utf8'));
  if (!Array.isArray(resolutionData.targets)) throw new Error('RESOLUTION_TARGETS_SCHEMA_REJECTED');
  const documents = sample.documents.slice(offset, offset + limit);
  const structureDocuments = [];
  const citations = [];
  const resolutionTotals = {};

  for (const document of documents) {
    const parsedSections = parseStructuredJudgment(
      document.pages.map(({ pageNumber, text }) => ({ pageNumber, text })),
      { completeSource: document.pages.length >= document.pageCount },
    );
    structureDocuments.push({
      sentenceId: document.sentenceId,
      year: document.year,
      sala: document.sala,
      pages: document.pageCount,
      sections: parsedSections,
    });

    for (const citation of parseArgentineCitationsV2(document.pages, {
      expediente: document.sourceExpediente,
      numeroSentencia: document.sourceNumeroSentencia,
    })) {
      const resolution = resolveCitationV2(
        citation,
        document.sentenceId,
        resolutionData.targets,
      );
      resolutionTotals[resolution.outcome] = (resolutionTotals[resolution.outcome] ?? 0) + 1;
      const sourceIdentifier = citation.identifierType === 'NUMERO_SENTENCIA'
        ? document.sourceNumeroSentencia
        : document.sourceExpediente;
      const candidate = {
        sentenceId: document.sentenceId,
        year: document.year,
        sala: document.sala,
        page: citation.sourcePage,
        family: citation.family,
        rawCitation: citation.rawCitation,
        sourceStartOffset: citation.sourceStartOffset,
        sourceEndOffset: citation.sourceEndOffset,
        sourceTextKind: citation.sourceTextKind,
        identifierType: citation.identifierType,
        normalizedIdentifier: citation.normalizedIdentifier,
        parsedFields: citation.parsedFields,
        sourceIdentityMatch: citation.resolutionOutcome === 'SELF_REFERENCE',
        sourceDocketPresent: Boolean(sourceIdentifier),
        context: citation.sourceContext,
        outcome: citation.resolutionOutcome,
        resolutionOutcome: resolution.outcome,
        candidateTargetCount: resolution.candidateTargetIds.length,
        reviewRank: stableRank(`${document.sentenceId}:${citation.sourcePage}:${citation.sourceStartOffset}:${citation.family}`),
      };
      citations.push(candidate);
    }
  }

  const manualReview = sampleCandidates(citations);
  const structureReport = {
    generatedAt: new Date().toISOString(),
    sourceGeneratedAt: sample.generatedAt,
    sampling: { method: sample.sampling?.method ?? 'pre-sampled real corpus', limit, offset },
    sampleSize: documents.length,
    documentsWithOutline: structureDocuments.filter((item) => item.sections.length > 0).length,
    documentsWithoutOutline: structureDocuments.filter((item) => item.sections.length === 0).length,
    detectedSections: structureDocuments.reduce((sum, item) => sum + item.sections.length, 0),
    byType: frequency(structureDocuments.flatMap((item) => item.sections.map((section) => section.type))),
    manualClassification: 'all emitted section headings manually inspected in source page context',
    documents: structureDocuments,
  };
  const citationReport = {
    generatedAt: new Date().toISOString(),
    sourceGeneratedAt: sample.generatedAt,
    sampling: structureReport.sampling,
    allDetected: citations.length,
    families: frequency(citations.map((candidate) => candidate.family)),
    selfReferencesSuppressed: citations.filter((candidate) => candidate.sourceIdentityMatch).length,
    relationEligibleAfterSelfSuppression: citations.filter(
      (candidate) => candidate.identifierType && candidate.normalizedIdentifier && !candidate.sourceIdentityMatch,
    ).length,
    resolutionTargets: resolutionData.count,
    resolutions: resolutionTotals,
    resolutionOfIdentifiedCandidates: frequency(
      citations
        .filter((candidate) => candidate.identifierType && candidate.normalizedIdentifier)
        .map((candidate) => candidate.resolutionOutcome),
    ),
    manualReview: { selected: manualReview.selected.length, quota: manualReview.quota, classification: 'pending' },
    candidates: manualReview.selected,
  };

  mkdirSync(outputPath, { recursive: true });
  writeFileSync(path.join(outputPath, 'structure-evaluation.json'), `${JSON.stringify(structureReport, null, 2)}\n`, 'utf8');
  writeFileSync(path.join(outputPath, 'citation-parser-evaluation.json'), `${JSON.stringify(citationReport, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify({
    status: 'SAMPLE_EVALUATED_READ_ONLY',
    sampleSize: documents.length,
    structure: {
      documentsWithOutline: structureReport.documentsWithOutline,
      detectedSections: structureReport.detectedSections,
      byType: structureReport.byType,
    },
    citations: {
      allDetected: citationReport.allDetected,
      families: citationReport.families,
      selfReferencesSuppressed: citationReport.selfReferencesSuppressed,
      relationEligibleAfterSelfSuppression: citationReport.relationEligibleAfterSelfSuppression,
      resolutions: citationReport.resolutions,
      resolutionOfIdentifiedCandidates: citationReport.resolutionOfIdentifiedCandidates,
      manualReview: citationReport.manualReview.selected,
    },
    outputPath,
  }, null, 2));
}

try {
  main();
} catch (error) {
  console.error(`SPRINT3_SAMPLE_EVALUATION=FAIL; ${error?.message ?? 'UNKNOWN_ERROR'}`);
  process.exitCode = 1;
}
