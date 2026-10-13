import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { PrismaService } from '../../src/prisma/prisma.service';
import { CorpusSearchSourceAdapter } from '../../src/corpus/corpus-search.adapter';
import { CorpusDocumentAccessService } from '../../src/corpus/corpus-document-access.service';
import { parseSearchQuery } from '../../src/busqueda/utils/search-parser';
import type { SearchResult } from '../../src/busqueda/adapters/search-source.adapter';

const root = resolve(__dirname, '../../../..');
const sourceCode = 'CIVIL_CUANTIFICACION_DANOS';

function chooseSample<T extends { chamber: string | null; decisionDate: Date | null }>(documents: T[], limit = 6) {
  const selected: T[] = [];
  const chambers = new Set<string>();
  const periods = new Set<string>();
  const period = (date: Date | null) => {
    const year = date?.getUTCFullYear() ?? 0;
    return year < 2017 ? 'early' : year < 2021 ? 'middle' : year < 2025 ? 'recent' : 'current';
  };
  for (const document of documents) {
    const room = document.chamber ?? 'unknown';
    const band = period(document.decisionDate);
    if (chambers.has(room) || periods.has(band)) continue;
    selected.push(document);
    chambers.add(room);
    periods.add(band);
    if (selected.length === limit) return selected;
  }
  for (const document of documents) {
    const room = document.chamber ?? 'unknown';
    if (chambers.has(room)) continue;
    selected.push(document);
    chambers.add(room);
    if (selected.length === limit) break;
  }
  return selected;
}

function candidateTerms(text: string) {
  const ignored = new Set(['contra', 'todos', 'todas', 'otros', 'otras', 'parte', 'partes', 'donde', 'sobre', 'entre', 'desde', 'hasta', 'mismo', 'misma', 'señor', 'señora', 'camara', 'poder', 'nacion', 'civil']);
  const words = text.normalize('NFD').replace(/[\u0300-\u036f]/gu, '').toLowerCase().match(/[a-z]{6,}/gu) ?? [];
  const counts = new Map<string, number>();
  for (const word of words) if (!ignored.has(word)) counts.set(word, (counts.get(word) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => a[1] - b[1] || b[0].length - a[0].length).map(([word]) => word).slice(0, 12);
}

async function main() {
  const rawUrl = process.env.DATABASE_URL;
  if (!rawUrl) throw new Error('Run through the DEV database guard.');
  const target = new URL(rawUrl);
  if (target.protocol !== 'postgresql:' || target.hostname !== '127.0.0.1' || target.port !== '55432' || target.pathname !== '/buscador_juridico_civil_dev' || target.username !== 'bjc_dev') throw new Error('SPRINT148_DEV_TARGET_REJECTED');

  const prisma = new PrismaService();
  const adapter = new CorpusSearchSourceAdapter(rawUrl);
  const access = new CorpusDocumentAccessService(prisma);
  try {
    await prisma.$connect();
    const identity = await prisma.$queryRawUnsafe<Array<{ database: string; role: string; host: string; port: number }>>(`
      SELECT current_database() AS database, current_user AS role,
             inet_server_addr()::text AS host, inet_server_port() AS port
    `);
    const live = identity[0];
    if (live.database !== 'buscador_juridico_civil_dev' || live.role !== 'bjc_dev' || live.host.replace(/\/\d+$/u, '') !== '127.0.0.1' || Number(live.port) !== 55432) throw new Error('SPRINT148_DEV_IDENTITY_REJECTED');

    const documents = await prisma.corpusDocument.findMany({
      where: {
        status: 'INDEXED', visibility: 'INTERNAL', latestExtractionId: { not: null },
        metadata: { path: ['acquisitionSprint'], equals: '14.8' },
      },
      select: { id: true, title: true, caseNumber: true, chamber: true, decisionDate: true, latestExtractionId: true },
      orderBy: [{ decisionDate: 'asc' }, { id: 'asc' }],
    });
    const samples = chooseSample(documents);
    if (samples.length < 4) throw new Error(`SPRINT148_VIEWER_SAMPLE_TOO_SMALL:${samples.length}`);
    const rows: Array<Record<string, unknown>> = [];
    for (const document of samples) {
      const page = await prisma.corpusDocumentPage.findFirst({
        where: { extractionId: document.latestExtractionId!, text: { not: '' } },
        orderBy: { pageNumber: 'asc' }, select: { pageNumber: true, text: true },
      });
      if (!page) throw new Error(`SPRINT148_VIEWER_NO_TEXT_PAGE:${document.id}`);
      const localTerms = candidateTerms(page.text);
      const frequencies = await prisma.$queryRawUnsafe<Array<{ token: string; documents: bigint }>>(`
        SELECT "token", count(DISTINCT "documentId") AS documents
          FROM "CorpusSearchToken"
         WHERE "token" = ANY($1::text[])
         GROUP BY "token"
      `, localTerms);
      const frequencyByTerm = new Map(frequencies.map(row => [row.token, Number(row.documents)]));
      const orderedTerms = [...localTerms].sort((a, b) => (frequencyByTerm.get(a) ?? Number.MAX_SAFE_INTEGER) - (frequencyByTerm.get(b) ?? Number.MAX_SAFE_INTEGER) || b.length - a.length);
      const projectionProbe = await prisma.$queryRawUnsafe<Array<{ status: string; visibility: string; textMatches: number; tokenMatches: number; projectionState: number }>>(`
        SELECT d."status", d."visibility",
               (SELECT count(*)::int FROM unnest($2::text[]) term WHERE d."searchText" ILIKE '%' || term || '%') AS "textMatches",
               (SELECT count(DISTINCT t."token")::int FROM "CorpusSearchToken" t WHERE t."documentId"=d."id" AND t."token"=ANY($2::text[])) AS "tokenMatches",
               (SELECT count(*)::int FROM "CorpusSearchTokenState" s WHERE s."documentId"=d."id") AS "projectionState"
          FROM "CorpusDocument" d WHERE d."id"=$1
      `, document.id, orderedTerms);
      let selectedTerm: string | undefined;
      for (const term of orderedTerms) {
        const candidate = await access.matches(document.id, 'INTERNAL', term);
        if (candidate.total >= 2) { selectedTerm = term; break; }
      }
      if (!selectedTerm) throw new Error(`SPRINT148_VIEWER_NO_REPEATABLE_TERM:${document.id}`);
      let result: SearchResult | undefined;
      let searchMs = 0;
      let searchAttempts = 0;
      for (const term of orderedTerms) {
        const startedAt = performance.now();
        const search = await adapter.search(parseSearchQuery(term), {
          visibility: 'INTERNAL', dialect: 'modern', publicationPolicy: 'published-active-only', page: 1, pageSize: 100,
        });
        searchAttempts += 1;
        searchMs += performance.now() - startedAt;
        result = search.results.find(item => item.sourceId === document.id);
        if (result) break;
      }
      if (!result || !result.snippet || !selectedTerm) throw new Error(`SPRINT148_VIEWER_SEARCH_RESULT_MISSING:${document.id};searchAttempts=${searchAttempts};tokenCandidates=${orderedTerms.length};rareCandidates=${Math.min(...orderedTerms.map(term => frequencyByTerm.get(term) ?? Number.MAX_SAFE_INTEGER))};probe=${JSON.stringify(projectionProbe[0])}`);
      searchMs = Number(searchMs.toFixed(3));
      const selectedPage = Number(result.metadata.pageNumber ?? page.pageNumber);
      const metadata = await access.metadata(document.id, 'INTERNAL', selectedPage);
      if (!metadata.selectedPage || metadata.selectedPage.pageNumber !== selectedPage) throw new Error(`SPRINT148_VIEWER_PAGE_NAVIGATION_FAILED:${document.id}`);
      const file = await access.file(document.id, 'INTERNAL');
      if (!file.content.subarray(0, 5).toString('ascii').startsWith('%PDF-') || createHash('sha256').update(file.content).digest('hex') !== file.sha256) throw new Error(`SPRINT148_VIEWER_FILE_CHECKSUM_FAILED:${document.id}`);
      const matches = await access.matches(document.id, 'INTERNAL', selectedTerm);
      const ordered = [...matches.matches] as unknown as Array<{ page: number; offset: number; ordinal: number; total: number }>;
      ordered.sort((a, b) => a.page - b.page || a.offset - b.offset);
      if (matches.total < 2 || ordered[0]?.ordinal !== 1 || ordered[1]?.ordinal !== 2 || ordered.some((match, index) => match.ordinal !== index + 1)) throw new Error(`SPRINT148_VIEWER_MATCH_NAVIGATION_FAILED:${document.id}`);
      const last = ordered.at(-1)!;
      const previous = ordered.at(-2)!;
      rows.push({
        documentId: document.id,
        year: document.decisionDate?.toISOString().slice(0, 4) ?? null,
        chamber: document.chamber,
        sourceCaseNumber: document.caseNumber,
        searchMs,
        searchAttempts,
        resultSnippetReturned: true,
        resultPage: result.metadata.pageNumber ?? null,
        selectedPage: metadata.selectedPage.pageNumber,
        pageCount: metadata.file?.pageCount,
        fileBytes: file.content.length,
        fileSha256Verified: true,
        matchCount: matches.total,
        nextOccurrenceOrdinal: ordered[1].ordinal,
        previousOccurrenceOrdinal: previous.ordinal,
        lastOccurrenceOrdinal: last.ordinal,
      });
    }
    const report = {
      status: process.env.BJC_SPRINT1492 === 'true' ? 'SPRINT1492_VIEWER_SMOKE_PASS' : process.env.BJC_SPRINT149 === 'true' ? 'SPRINT149_VIEWER_SMOKE_PASS' : 'SPRINT148_VIEWER_SMOKE_PASS', generatedAt: new Date().toISOString(),
      target: { endpoint: '127.0.0.1:55432', database: live.database, role: live.role },
      sampledDocuments: rows.length, newCorpusDocumentsAvailable: documents.length,
      checks: ['Search result', 'snippet', 'document metadata', 'PDF content and SHA-256', 'selected page', 'highlight occurrence order', 'next/previous occurrence ordinals'],
      results: rows,
    };
    const outDir = resolve(root, process.env.BJC_SPRINT1492 === 'true' ? '_recovery-work/sprint1492' : process.env.BJC_SPRINT149 === 'true' ? '_recovery-work/sprint149' : '_recovery-work/sprint148');
    await mkdir(outDir, { recursive: true });
    await writeFile(resolve(outDir, 'viewer-smoke.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8');
    console.log(JSON.stringify(report, null, 2));
  } finally {
    await adapter.close();
    await prisma.$disconnect();
  }
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : 'SPRINT148_VIEWER_SMOKE_FAILED');
  process.exitCode = 1;
});
