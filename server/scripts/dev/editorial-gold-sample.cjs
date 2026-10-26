'use strict';

// Deterministic read-only sampling for the external Editorial Gold review.
// This script must be invoked through with-dev-db-guard.cjs.
const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const { Client } = require('pg');

const EXPECTED = {
  host: '127.0.0.1',
  port: 55432,
  database: 'buscador_juridico_civil_dev',
  role: 'bjc_dev',
};
const ROOT = process.env.BJC_EDITORIAL_GOLD_EVIDENCE_ROOT;
const SEED_DEFAULT = 'galilei-civil-editorial-gold-v1';

function parseArgs() {
  const args = JSON.parse(process.env.BJC_EDITORIAL_GOLD_ARGS || '[]');
  const values = new Map();
  for (let index = 0; index < args.length; index += 1) {
    if (String(args[index]) === '--') continue;
    const [key, inline] = String(args[index]).split('=', 2);
    if (key === '--dry-run') {
      values.set(key, true);
      continue;
    }
    if (!key.startsWith('--')) throw new Error('UNSUPPORTED_ARGUMENT');
    const value = inline ?? args[++index];
    if (!value || String(value).startsWith('--')) throw new Error('MISSING_ARGUMENT_VALUE');
    values.set(key, String(value));
  }
  const limit = Number(values.get('--limit') ?? 400);
  const year = values.has('--year') ? Number(values.get('--year')) : null;
  const sala = values.get('--sala') ?? null;
  const seed = values.get('--seed') ?? SEED_DEFAULT;
  const output = values.get('--output') ?? 'human-review';
  if (!Number.isInteger(limit) || limit < 300 || limit > 500) throw new Error('LIMIT_OUT_OF_RANGE_300_500');
  if (year !== null && (!Number.isInteger(year) || year < 1800 || year > 2100)) throw new Error('YEAR_OUT_OF_RANGE');
  if (sala !== null && sala.length > 80) throw new Error('SALA_FILTER_TOO_LONG');
  if (seed.length < 1 || seed.length > 120) throw new Error('SEED_OUT_OF_RANGE');
  const outputPath = path.resolve(ROOT || '.', output);
  if (!ROOT || !isInside(path.resolve(ROOT), outputPath)) throw new Error('OUTPUT_PATH_REJECTED');
  return { limit, year, sala, seed, outputPath, outputRelative: path.relative(ROOT, outputPath) };
}

function isInside(root, target) {
  const relative = path.relative(root, target);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

function requireIdentity(row) {
  const host = String(row.host || '').replace(/\/\d+$/u, '');
  if (host !== EXPECTED.host || Number(row.port) !== EXPECTED.port ||
      row.database !== EXPECTED.database || row.role !== EXPECTED.role ||
      Number(row.server_version_num) < 160000 || Number(row.server_version_num) >= 170000) {
    throw new Error('DATABASE_IDENTITY_REJECTED');
  }
  return { host, port: Number(row.port), database: row.database, role: row.role, serverMajor: 16 };
}

function hash(value) {
  return crypto.createHash('sha256').update(String(value), 'utf8').digest('hex');
}

function frequency(values) {
  const counts = new Map();
  for (const value of values) {
    const key = value === null || value === undefined || value === '' ? 'UNKNOWN' : String(value);
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return Object.fromEntries([...counts.entries()].sort(([a], [b]) => a.localeCompare(b)));
}

function qualityBucket(row) {
  if (row.extractionStatus === 'OCR_REQUIRED') return 'OCR_REQUIRED';
  const kind = row.textKindCounts || {};
  const kinds = Object.keys(kind);
  if (kinds.length > 1) return 'MIXED_TEXT';
  if (kinds.includes('OCR')) return 'OCR_TEXT';
  if (kinds.includes('NATIVE')) return 'NATIVE_TEXT';
  return 'UNKNOWN_TEXT';
}

function lengthBucket(row) {
  const pages = Number(row.pageCount || 0);
  if (pages <= 10) return 'SHORT_1_10_PAGES';
  if (pages <= 30) return 'MEDIUM_11_30_PAGES';
  return 'LONG_31_PLUS_PAGES';
}

function stratum(row) {
  const year = row.year === null ? 'UNKNOWN_YEAR' : String(row.year);
  const sala = row.sala ? String(row.sala).trim() : 'UNKNOWN_SALA';
  const longDocument = Number(row.pageCount || row.pageRows || 0) > 30 ? 'LONG_31_PLUS_PAGES' : 'UP_TO_30_PAGES';
  return [year, sala, row.mimeType || 'UNKNOWN_MIME', qualityBucket(row), longDocument].join('|');
}

function populationDimensions(rows) {
  return {
    years: frequency(rows.map((row) => row.year)),
    salas: frequency(rows.map((row) => row.sala)),
    sourceStyles: frequency(rows.map((row) => row.mimeType)),
    extractionQuality: frequency(rows.map(qualityBucket)),
    lengthBands: frequency(rows.map(lengthBucket)),
  };
}

function deterministicOrder(seed, id) {
  return hash(`${seed}:${id}`);
}

function allocateProportionally(groups, target, seed) {
  const entries = [...groups.entries()].map(([key, rows]) => ({ key, rows, count: rows.length, allocated: 0 }));
  if (target >= entries.length) {
    for (const entry of entries) entry.allocated = 1;
  }
  let remaining = target - entries.reduce((sum, entry) => sum + entry.allocated, 0);
  while (remaining > 0) {
    const active = entries.filter((entry) => entry.allocated < entry.count);
    if (!active.length) break;
    const capacity = active.reduce((sum, entry) => sum + entry.count - entry.allocated, 0);
    const quotas = active.map((entry) => {
      const exact = (remaining * (entry.count - entry.allocated)) / capacity;
      const base = Math.min(entry.count - entry.allocated, Math.floor(exact));
      return { entry, base, remainder: exact - base, tie: hash(`${seed}:${entry.key}`) };
    });
    let used = 0;
    for (const quota of quotas) {
      quota.entry.allocated += quota.base;
      used += quota.base;
    }
    remaining -= used;
    if (remaining === 0) break;
    quotas.sort((left, right) => right.remainder - left.remainder || left.tie.localeCompare(right.tie));
    let awarded = 0;
    for (const quota of quotas) {
      if (remaining === 0) break;
      if (quota.entry.allocated >= quota.entry.count) continue;
      quota.entry.allocated += 1;
      remaining -= 1;
      awarded += 1;
    }
    if (used === 0 && awarded === 0) break;
  }
  return entries;
}

function chooseSample(rows, target, seed) {
  const groups = new Map();
  for (const row of rows) {
    const key = stratum(row);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }
  const allocations = allocateProportionally(groups, target, seed);
  const selected = [];
  for (const group of allocations) {
    group.rows.sort((left, right) => deterministicOrder(seed, left.sentenceId).localeCompare(deterministicOrder(seed, right.sentenceId)));
    const picked = group.rows.slice(0, group.allocated);
    for (const row of picked) {
      selected.push({ ...row, samplingStratum: group.key, stratumPopulation: group.count, stratumSample: group.allocated, documentWeight: group.allocated ? group.count / group.allocated : null });
    }
  }
  return selected.sort((left, right) => left.year - right.year || String(left.sala || '').localeCompare(String(right.sala || '')) || left.sentenceId - right.sentenceId);
}

function chooseReviewSubset(documents, target, seed, labelType) {
  const groups = new Map();
  for (const document of documents) {
    const key = `${document.year ?? 'UNKNOWN_YEAR'}|${document.sala || 'UNKNOWN_SALA'}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(document);
  }
  const allocations = allocateProportionally(groups, Math.min(target, documents.length), `${seed}:${labelType}`);
  const selected = [];
  for (const group of allocations) {
    group.rows.sort((left, right) => deterministicOrder(`${seed}:${labelType}`, left.sentenceId).localeCompare(deterministicOrder(`${seed}:${labelType}`, right.sentenceId)));
    for (const document of group.rows.slice(0, group.allocated)) {
      selected.push({ ...document, reviewStratum: group.key, reviewPopulation: group.count, reviewSample: group.allocated, reviewWeight: group.allocated ? group.count / group.allocated : null });
    }
  }
  return selected.sort((left, right) => left.year - right.year || String(left.sala || '').localeCompare(String(right.sala || '')) || left.sentenceId - right.sentenceId);
}

async function writeJsonl(filePath, rows) {
  await fs.writeFile(filePath, `${rows.map((row) => JSON.stringify(row)).join('\n')}\n`, 'utf8');
}

async function main() {
  const options = parseArgs();
  if (!process.env.DATABASE_URL || !ROOT) throw new Error('GUARDED_ENVIRONMENT_REQUIRED');
  const expectedRoot = path.resolve(__dirname, '../../../_recovery-work/galilei-editorial-gold-recall-suite4');
  if (path.resolve(ROOT) !== expectedRoot) throw new Error('EVIDENCE_ROOT_REJECTED');
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    await client.query("SET LOCAL statement_timeout = '120s'");
    const identity = requireIdentity((await client.query(`
      SELECT current_database() AS database, current_user AS role,
        inet_server_addr()::text AS host, inet_server_port() AS port,
        current_setting('server_version_num') AS server_version_num
    `)).rows[0]);
    const metadataResult = await client.query(`
      WITH eligible AS (
        SELECT DISTINCT ON (s.id)
          s.id AS "sentenceId", s.sala,
          s.expediente AS "sourceExpediente", s."numeroSentencia" AS "sourceNumeroSentencia",
          CASE WHEN s.fecha IS NULL THEN NULL ELSE EXTRACT(YEAR FROM s.fecha)::int END AS year,
          d.id AS "documentId", e.id AS "extractionId", e.status AS "extractionStatus",
          e.extractor, e."extractorVersion", file.sha256 AS "sourceChecksum",
          file."pageCount", file."mimeType", file."originalFilename"
        FROM "Sentencia" s
        JOIN "CorpusDocumentLink" l ON l."targetDomain"='JURISPRUDENCIA'
          AND l."targetType"='SENTENCIA' AND l."targetId"=s.id::text
        JOIN "CorpusDocument" d ON d.id=l."documentId" AND d."documentScope"='GENERAL'
        JOIN "CorpusExtraction" e ON e.id=d."latestExtractionId"
        JOIN "CorpusDocumentFile" file ON file.id=e."fileId"
        WHERE s.publicado=true AND s.activo=true
          AND e.status IN ('TEXT_EXTRACTED','EXTRACTED_TRUNCATED','OCR_REQUIRED')
          AND file.sha256 IS NOT NULL
        ORDER BY s.id, e."extractedAt" DESC, d.id
      ), page_facts AS (
        SELECT p."extractionId", count(*)::int AS page_rows,
          sum(char_length(p.text))::bigint AS text_characters
        FROM "CorpusDocumentPage" p GROUP BY p."extractionId"
      ), kind_facts AS (
        SELECT kinds."extractionId", jsonb_object_agg(kinds.kind, kinds.count) AS "textKindCounts"
        FROM (SELECT "extractionId", "textKind" AS kind, count(*)::int AS count
          FROM "CorpusDocumentPage" GROUP BY "extractionId", "textKind") kinds
        GROUP BY kinds."extractionId"
      )
      SELECT eligible.*, page_facts.page_rows AS "pageRows",
        page_facts.text_characters AS "textCharacters",
        kind_facts."textKindCounts"
      FROM eligible JOIN page_facts ON page_facts."extractionId"=eligible."extractionId"
      JOIN kind_facts ON kind_facts."extractionId"=eligible."extractionId"
      ORDER BY eligible."sentenceId"
    `);
    let candidates = metadataResult.rows.map((row) => ({
      sentenceId: Number(row.sentenceId),
      documentId: row.documentId,
      extractionId: row.extractionId,
      year: row.year === null ? null : Number(row.year),
      sala: row.sala,
      extractionStatus: row.extractionStatus,
      extractor: row.extractor,
      extractorVersion: row.extractorVersion,
      sourceChecksum: row.sourceChecksum,
      sourceExpediente: row.sourceExpediente,
      sourceNumeroSentencia: row.sourceNumeroSentencia,
      mimeType: row.mimeType,
      originalFilename: row.originalFilename,
      pageCount: Number(row.pageCount || row.pageRows || 0),
      pageRows: Number(row.pageRows || 0),
      textCharacters: Number(row.textCharacters || 0),
      textKindCounts: row.textKindCounts || {},
    }));
    if (options.year !== null) candidates = candidates.filter((row) => row.year === options.year);
    if (options.sala !== null) candidates = candidates.filter((row) => String(row.sala || '').toLocaleLowerCase() === options.sala.toLocaleLowerCase());
    if (candidates.length < options.limit) throw new Error('ELIGIBLE_POPULATION_BELOW_SAMPLE_LIMIT');
    const documents = chooseSample(candidates, options.limit, options.seed);
    const extractionIds = documents.map((row) => row.extractionId);
    const pagesResult = await client.query(`
      SELECT p."extractionId", p."pageNumber", p.text, p."textKind", p."processingStatus"
      FROM "CorpusDocumentPage" p
      WHERE p."extractionId" = ANY($1::text[])
      ORDER BY p."extractionId", p."pageNumber"
    `, [extractionIds]);
    const pagesByExtraction = new Map();
    for (const page of pagesResult.rows) {
      const values = pagesByExtraction.get(page.extractionId) || [];
      values.push({ pageNumber: Number(page.pageNumber), text: page.text, textKind: page.textKind, processingStatus: page.processingStatus });
      pagesByExtraction.set(page.extractionId, values);
    }
    const fullDocuments = documents.map((row) => {
      const pages = pagesByExtraction.get(row.extractionId) || [];
      const safeSourceHash = row.sourceChecksum;
      return {
        sampleId: hash(`${options.seed}:${row.sentenceId}:${row.sourceChecksum}`).slice(0, 24),
        documentId: String(row.sentenceId),
        sourceHash: safeSourceHash,
        year: row.year,
        sala: row.sala || null,
        textQualityBucket: qualityBucket(row),
        source: { mimeType: row.mimeType, extractor: row.extractor, extractorVersion: row.extractorVersion, extractionStatus: row.extractionStatus },
        sourceIdentity: { expediente: row.sourceExpediente || null, numeroSentencia: row.sourceNumeroSentencia || null },
        quality: { textKindCounts: row.textKindCounts, pageRows: row.pageRows, reportedPageCount: row.pageCount, textCharacters: row.textCharacters },
        sampling: { stratum: row.samplingStratum, population: row.stratumPopulation, sample: row.stratumSample, weight: row.documentWeight },
        pages,
      };
    });
    if (fullDocuments.some((doc) => doc.pages.length === 0)) throw new Error('SAMPLED_DOCUMENT_MISSING_PAGE_TEXT');
    const reviewableDocuments = fullDocuments.filter((doc) => doc.quality.textCharacters > 0);
    const excludedDocuments = fullDocuments.filter((doc) => doc.quality.textCharacters <= 0);
    const structureSubset = chooseReviewSubset(reviewableDocuments, 120, options.seed, 'structure');
    const citationSubset = chooseReviewSubset(reviewableDocuments, 150, options.seed, 'citations');
    const populationStrata = new Map();
    for (const candidate of candidates) populationStrata.set(stratum(candidate), (populationStrata.get(stratum(candidate)) || 0) + 1);
    const sampledStrata = new Map();
    for (const document of fullDocuments) sampledStrata.set(document.sampling.stratum, (sampledStrata.get(document.sampling.stratum) || 0) + 1);
    const targetCatalogResult = await client.query(`
      SELECT id, expediente, "numeroSentencia", sala,
        CASE WHEN fecha IS NULL THEN NULL ELSE EXTRACT(YEAR FROM fecha)::int END AS year,
        CASE WHEN fecha IS NULL THEN NULL ELSE to_char(fecha, 'YYYY-MM-DD') END AS "decisionDate"
      FROM "Sentencia" WHERE publicado=true AND activo=true ORDER BY id
    `);
    const manifestDocuments = fullDocuments.map(({ pages, ...doc }) => doc);
    const manifest = {
      goldVersion: 'civil-gold-v1',
      generatedAt: new Date().toISOString(),
      source: identity,
      sourceSelection: 'published=true AND active=true; latest GENERAL extraction; public judgment; at least one extracted page; no private scope',
      transaction: 'REPEATABLE READ READ ONLY; rolled back',
      deterministic: { seed: options.seed, algorithm: 'SHA-256 seeded ordering within proportional strata; allocation floors plus largest remainders; strata: year × Sala × MIME × extracted-text quality × long-document flag (>30 pages); detailed length bands are also recorded', limit: options.limit, filters: { year: options.year, sala: options.sala } },
      eligiblePopulationAfterFilters: candidates.length,
      eligiblePopulation: populationDimensions(candidates),
      sampleSize: fullDocuments.length,
      reviewableSampleSize: reviewableDocuments.length,
      excludedFromHumanReview: excludedDocuments.length,
      reviewExclusionReasons: frequency(excludedDocuments.map((doc) => doc.source.extractionStatus === 'OCR_REQUIRED' ? 'NO_EXTRACTED_TEXT_OCR_REQUIRED' : 'NO_EXTRACTED_TEXT')),
      strata: Object.fromEntries([...populationStrata.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([key, count]) => [key, { population: count, sampled: sampledStrata.get(key) || 0 }])),
      years: frequency(fullDocuments.map((doc) => doc.year)),
      salas: frequency(fullDocuments.map((doc) => doc.sala)),
      sourceStyles: frequency(fullDocuments.map((doc) => doc.source.mimeType)),
      quality: frequency(fullDocuments.map((doc) => doc.textQualityBucket)),
      lengthBands: frequency(fullDocuments.map((doc) => doc.quality.reportedPageCount <= 10 ? 'SHORT_1_10_PAGES' : doc.quality.reportedPageCount <= 30 ? 'MEDIUM_11_30_PAGES' : 'LONG_31_PLUS_PAGES')),
      structureReviewCount: structureSubset.length,
      citationReviewCount: citationSubset.length,
      documents: manifestDocuments,
    };
    const selectionRows = manifestDocuments.map((doc) => `${doc.sampleId}:${doc.sourceHash}`).sort();
    manifest.deterministicSelectionSha256 = hash(selectionRows.join('\n'));
    manifest.manifestSha256 = hash(JSON.stringify(manifest));
    const versionedManifest = {
      goldVersion: manifest.goldVersion,
      generatedAt: manifest.generatedAt,
      source: { host: identity.host, port: identity.port, database: identity.database, role: identity.role, serverMajor: identity.serverMajor },
      deterministic: manifest.deterministic,
      eligiblePopulationAfterFilters: manifest.eligiblePopulationAfterFilters,
      eligiblePopulation: manifest.eligiblePopulation,
      sampleSize: manifest.sampleSize,
      reviewableSampleSize: manifest.reviewableSampleSize,
      excludedFromHumanReview: manifest.excludedFromHumanReview,
      reviewExclusionReasons: manifest.reviewExclusionReasons,
      structureReviewCount: manifest.structureReviewCount,
      citationReviewCount: manifest.citationReviewCount,
      strata: manifest.strata,
      years: manifest.years,
      salas: manifest.salas,
      sourceStyles: manifest.sourceStyles,
      quality: manifest.quality,
      lengthBands: manifest.lengthBands,
      deterministicSelectionSha256: manifest.deterministicSelectionSha256,
      structureSampleIds: structureSubset.map((doc) => doc.sampleId).sort(),
      citationSampleIds: citationSubset.map((doc) => doc.sampleId).sort(),
      documents: manifest.documents.map((doc) => ({
        sampleId: doc.sampleId, documentId: doc.documentId, sourceHash: doc.sourceHash,
        year: doc.year, sala: doc.sala, textQualityBucket: doc.textQualityBucket, source: doc.source, quality: doc.quality,
        sampling: doc.sampling,
      })),
    };
    await fs.mkdir(options.outputPath, { recursive: true });
    const manifestPath = path.join(options.outputPath, 'sample-manifest.json');
    await fs.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
    await fs.writeFile(path.join(options.outputPath, 'versioned-sample-manifest.json'), `${JSON.stringify(versionedManifest, null, 2)}\n`, 'utf8');
    await writeJsonl(path.join(options.outputPath, 'sample-text.jsonl'), fullDocuments);
    const structureIds = new Set(structureSubset.map((doc) => doc.sampleId));
    const citationIds = new Set(citationSubset.map((doc) => doc.sampleId));
    await writeJsonl(path.join(options.outputPath, 'structure-review-pack.jsonl'), fullDocuments.filter((doc) => structureIds.has(doc.sampleId)).map((doc) => ({ ...doc, annotation: { status: 'PENDING_HUMAN_GOLD', exhaustive: false, reviewerId: null, sections: [], noStructuralHeading: null } })));
    await writeJsonl(path.join(options.outputPath, 'citation-review-pack.jsonl'), fullDocuments.filter((doc) => citationIds.has(doc.sampleId)).map((doc) => ({ ...doc, annotation: { status: 'PENDING_HUMAN_GOLD', exhaustive: false, reviewerId: null, references: [] } })));
    await writeJsonl(path.join(options.outputPath, 'target-catalog.jsonl'), targetCatalogResult.rows.map((row) => ({ documentId: String(row.id), expediente: row.expediente || null, numeroSentencia: row.numeroSentencia || null, sala: row.sala || null, year: row.year === null ? null : Number(row.year), decisionDate: row.decisionDate || null })));
    await writeJsonl(path.join(options.outputPath, 'structure-labels-template.jsonl'), structureSubset.map((doc) => ({ sampleId: doc.sampleId, documentId: doc.documentId, sourceHash: doc.sourceHash, status: 'PENDING_HUMAN_GOLD', exhaustive: false, reviewerId: null, reviewedAt: null, noStructuralHeading: null, sections: [] })));
    await writeJsonl(path.join(options.outputPath, 'citation-labels-template.jsonl'), citationSubset.map((doc) => ({ sampleId: doc.sampleId, documentId: doc.documentId, sourceHash: doc.sourceHash, status: 'PENDING_HUMAN_GOLD', exhaustive: false, reviewerId: null, reviewedAt: null, references: [] })));
    await writeJsonl(path.join(options.outputPath, 'excluded-from-human-review.jsonl'), excludedDocuments.map((doc) => ({ sampleId: doc.sampleId, documentId: doc.documentId, sourceHash: doc.sourceHash, reason: doc.source.extractionStatus === 'OCR_REQUIRED' ? 'NO_EXTRACTED_TEXT_OCR_REQUIRED' : 'NO_EXTRACTED_TEXT', pageRows: doc.quality.pageRows, extractedCharacters: doc.quality.textCharacters })));
    const repositoryRoot = path.resolve(__dirname, '../../../');
    await fs.copyFile(path.join(repositoryRoot, 'server/test-fixtures/legal-gold/civil-gold-v1/README.md'), path.join(options.outputPath, 'README-reviewers.md'));
    await fs.copyFile(path.join(repositoryRoot, 'docs/structure-gold-review-guide.md'), path.join(options.outputPath, 'structure-review-guide.md'));
    await fs.copyFile(path.join(repositoryRoot, 'docs/citation-gold-review-guide.md'), path.join(options.outputPath, 'citation-review-guide.md'));
    const checksumFiles = ['sample-manifest.json', 'versioned-sample-manifest.json', 'sample-text.jsonl', 'structure-review-pack.jsonl', 'citation-review-pack.jsonl', 'structure-labels-template.jsonl', 'citation-labels-template.jsonl', 'target-catalog.jsonl', 'excluded-from-human-review.jsonl', 'README-reviewers.md', 'structure-review-guide.md', 'citation-review-guide.md'];
    const checksums = {};
    for (const name of checksumFiles) checksums[name] = hash(await fs.readFile(path.join(options.outputPath, name)));
    await fs.writeFile(path.join(options.outputPath, 'SHA256SUMS.json'), `${JSON.stringify(checksums, null, 2)}\n`, 'utf8');
    await client.query('ROLLBACK');
    console.log(JSON.stringify({ status: 'EDITORIAL_GOLD_SAMPLE_READY', database: identity, population: candidates.length, targetCatalogSize: targetCatalogResult.rowCount, sample: fullDocuments.length, reviewable: reviewableDocuments.length, excludedFromHumanReview: excludedDocuments.length, reviewExclusionReasons: manifest.reviewExclusionReasons, structureExhaustiveTarget: structureSubset.length, citationsExhaustiveTarget: citationSubset.length, years: manifest.years, salas: manifest.salas, eligiblePopulation: manifest.eligiblePopulation, sourceStyles: manifest.sourceStyles, quality: manifest.quality, lengthBands: manifest.lengthBands, deterministicSelectionSha256: manifest.deterministicSelectionSha256, output: options.outputPath, manifestSha256: manifest.manifestSha256 }, null, 2));
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(`EDITORIAL_GOLD_SAMPLE=FAIL; ${error.code || error.message || 'UNKNOWN_ERROR'}`);
  process.exitCode = 1;
});
