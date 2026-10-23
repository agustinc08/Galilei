import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { PrismaService } from '../../src/prisma/prisma.service';

type SampleRow = {
  id: string;
  status: string;
  scope: string;
  decisionYear: number | null;
  searchTextLength: number;
  fileCount: number;
  formats: string[];
  sourceCodes: string[];
  pageCount: number;
};

const sql = `
WITH file_summary AS (
  SELECT
    f."documentId",
    COUNT(*)::int AS "fileCount",
    ARRAY_AGG(DISTINCT CASE f."mimeType"
      WHEN 'application/pdf' THEN 'PDF'
      WHEN 'text/plain' THEN 'TXT'
      WHEN 'application/rtf' THEN 'RTF'
      WHEN 'application/msword' THEN 'DOC'
      WHEN 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' THEN 'DOCX'
      WHEN 'application/vnd.oasis.opendocument.text' THEN 'ODT'
      ELSE f."mimeType"
    END ORDER BY CASE f."mimeType"
      WHEN 'application/pdf' THEN 'PDF'
      WHEN 'text/plain' THEN 'TXT'
      WHEN 'application/rtf' THEN 'RTF'
      WHEN 'application/msword' THEN 'DOC'
      WHEN 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' THEN 'DOCX'
      WHEN 'application/vnd.oasis.opendocument.text' THEN 'ODT'
      ELSE f."mimeType"
    END) AS formats
  FROM "CorpusDocumentFile" f
  GROUP BY f."documentId"
), source_summary AS (
  SELECT
    i."documentId",
    ARRAY_AGG(DISTINCT s."code" ORDER BY s."code") AS "sourceCodes"
  FROM "CorpusIngestionRecord" i
  JOIN "CorpusSourceSystem" s ON s."id" = i."sourceSystemId"
  GROUP BY i."documentId"
), page_summary AS (
  SELECT e."id" AS "extractionId", COUNT(p."id")::int AS "pageCount"
  FROM "CorpusExtraction" e
  LEFT JOIN "CorpusDocumentPage" p ON p."extractionId" = e."id"
  GROUP BY e."id"
)
SELECT
  d."id",
  d."status",
  d."documentScope"::text AS scope,
  EXTRACT(YEAR FROM d."decisionDate")::int AS "decisionYear",
  LENGTH(d."searchText")::int AS "searchTextLength",
  COALESCE(f."fileCount", 0)::int AS "fileCount",
  COALESCE(f.formats, ARRAY[]::text[]) AS formats,
  COALESCE(s."sourceCodes", ARRAY[]::text[]) AS "sourceCodes",
  COALESCE(p."pageCount", 0)::int AS "pageCount"
FROM "CorpusDocument" d
LEFT JOIN file_summary f ON f."documentId" = d."id"
LEFT JOIN source_summary s ON s."documentId" = d."id"
LEFT JOIN page_summary p ON p."extractionId" = d."latestExtractionId"
WHERE d."documentScope" = 'GENERAL'::"CorpusDocumentScope"
  AND d."status" = 'INDEXED'
  AND d."searchText" <> ''
  AND d."id" NOT LIKE 's155%'
  AND COALESCE(f."fileCount", 0) > 0
ORDER BY MD5(d."id")
LIMIT 300
`;

function frequency<T extends string | number | null>(values: T[]) {
  const counts = new Map<string, number>();
  for (const value of values) {
    const key = value === null ? 'unknown' : String(value);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return Object.fromEntries([...counts.entries()].sort(([a], [b]) => a.localeCompare(b)));
}

async function main() {
  const prisma = new PrismaService();
  await prisma.$connect();
  try {
    const rows = await prisma.$queryRawUnsafe<SampleRow[]>(sql);
    const ids = rows.map((row) => row.id);
    const failures = rows.flatMap((row) => {
      const reasons: string[] = [];
      if (row.status !== 'INDEXED') reasons.push('not-indexed');
      if (row.scope !== 'GENERAL') reasons.push('not-general');
      if (row.searchTextLength <= 0) reasons.push('empty-search-text');
      if (row.fileCount <= 0 || row.formats.length === 0) reasons.push('missing-file');
      return reasons.length ? [{ id: row.id, reasons }] : [];
    });
    const uniqueIds = new Set(ids);
    const formatValues = rows.flatMap((row) => row.formats);
    const sourceValues = rows.flatMap((row) => row.sourceCodes);
    const sample = {
      generatedAt: new Date().toISOString(),
      target: 'bjc_dev@127.0.0.1:55432/buscador_juridico_civil_dev',
      sampling: 'Deterministic MD5 order over eligible indexed general corpus documents; limit 300.',
      sampleSize: rows.length,
      uniqueDocumentIds: uniqueIds.size,
      sourceCount: new Set(sourceValues).size,
      sources: frequency(sourceValues),
      years: frequency(rows.map((row) => row.decisionYear)),
      formats: frequency(formatValues),
      pageCountTotal: rows.reduce((sum, row) => sum + row.pageCount, 0),
      invariants: {
        expectedSampleSize: 300,
        uniqueIds: uniqueIds.size === rows.length,
        generalIndexedWithSearchTextAndFile: rows.length - failures.length,
        failures,
        status: rows.length === 300 && uniqueIds.size === rows.length && failures.length === 0 ? 'PASS' : 'FAIL',
      },
      documents: rows,
    };
    const output = path.resolve(process.cwd(), '../_recovery-work/sprint155/real-corpus-sample.json');
    await mkdir(path.dirname(output), { recursive: true });
    await writeFile(output, `${JSON.stringify(sample, null, 2)}\n`, 'utf8');
    console.log(JSON.stringify({
      status: sample.invariants.status,
      sampleSize: sample.sampleSize,
      uniqueDocumentIds: sample.uniqueDocumentIds,
      sourceCount: sample.sourceCount,
      yearBuckets: Object.keys(sample.years).length,
      formats: sample.formats,
      pages: sample.pageCountTotal,
      failures: failures.length,
      artifact: output,
    }));
    if (sample.invariants.status !== 'PASS') process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'SPRINT155_REAL_SAMPLE_FAILED');
  process.exitCode = 1;
});
