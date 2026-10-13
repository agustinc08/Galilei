import { PrismaService } from '../../src/prisma/prisma.service';
import { CorpusSearchSourceAdapter } from '../../src/corpus/corpus-search.adapter';
import { CorpusDocumentAccessService } from '../../src/corpus/corpus-document-access.service';
import { parseSearchQuery } from '../../src/busqueda/utils/search-parser';

async function main() {
  if (!process.env.DATABASE_URL)
    throw new Error('Run through the DEV database guard.');
  const prisma = new PrismaService();
  const adapter = new CorpusSearchSourceAdapter(process.env.DATABASE_URL);
  try {
    await prisma.$connect();
    const run = await prisma.corpusImportRun.findFirst({
      where: { sourceCode: 'JURISPRUDENCIA_LOCAL_PDF', status: 'SUCCESS' },
      orderBy: { startedAt: 'desc' },
      select: { id: true },
    });
    if (!run) throw new Error('NO_SUCCESSFUL_INSTITUTIONAL_RUN');
    console.log(`SMOKE_RUN=${run.id}`);
    const item = await prisma.corpusImportRunItem.findFirst({
      where: { runId: run.id, status: 'INDEXED', documentId: { not: null } },
      orderBy: { itemKey: 'asc' },
      select: { documentId: true },
    });
    if (!item?.documentId) throw new Error('NO_INDEXED_INSTITUTIONAL_DOCUMENT');
    console.log(`SMOKE_DOCUMENT=${item.documentId}`);
    const document = await prisma.corpusDocument.findUnique({
      where: { id: item.documentId },
      select: { latestExtractionId: true, title: true },
    });
    if (!document?.latestExtractionId)
      throw new Error('NO_LATEST_INSTITUTIONAL_EXTRACTION');
    const page = await prisma.corpusDocumentPage.findFirst({
      where: { extractionId: document.latestExtractionId, text: { not: '' } },
      orderBy: { pageNumber: 'asc' },
      select: { pageNumber: true, text: true },
    });
    if (!page) throw new Error('NO_EXTRACTED_INSTITUTIONAL_PAGE');
    console.log(`SMOKE_PAGE=${page.pageNumber}`);
    const tokens =
      page.text
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/gu, '')
        .match(/[\p{L}]{6,}/gu) ?? [];
    const terms = [...new Set(tokens)].sort(
      (left, right) => right.length - left.length,
    );
    const selectedTerm = terms[0];
    if (!selectedTerm) throw new Error('NO_INSTITUTIONAL_PAGE_SEARCH_TERM');
    const escapedTitle = document.title
      .replace(/\\/gu, '\\\\')
      .replace(/"/gu, '\\"');
    const query = `caratula:"${escapedTitle}" AND ${selectedTerm}`;
    const searchStartedAt = Date.now();
    const result = await adapter.search(parseSearchQuery(query), {
      visibility: 'INTERNAL',
      dialect: 'modern',
      publicationPolicy: 'published-active-only',
      page: 1,
      pageSize: 25,
    });
    console.log(
      `SMOKE_QUERY_MS=${Date.now() - searchStartedAt}; results=${result.results.length}; total=${result.total}`,
    );
    const selectedResult = result.results.find(
      (resultItem) => resultItem.sourceId === item.documentId,
    );
    if (!selectedResult)
      throw new Error('INSTITUTIONAL_SEARCH_RESULT_NOT_FOUND');
    console.log(`SMOKE_MATCH_TERM=${selectedTerm}`);
    const access = new CorpusDocumentAccessService(prisma);
    const [metadata, file, matches] = await Promise.all([
      access.metadata(
        item.documentId,
        'INTERNAL',
        Number(selectedResult.metadata.pageNumber ?? page.pageNumber),
      ),
      access.file(item.documentId, 'INTERNAL'),
      access.matches(item.documentId, 'INTERNAL', selectedTerm),
    ]);
    if (
      !metadata.selectedPage ||
      file.content.length === 0 ||
      matches.total === 0
    )
      throw new Error('DOCUMENT_NAVIGATION_SMOKE_FAILED');
    console.log(
      JSON.stringify(
        {
          status: 'INSTITUTIONAL_SEARCH_SMOKE_PASS',
          query,
          documentId: item.documentId,
          title: selectedResult.title,
          snippet: selectedResult.snippet,
          searchPage: selectedResult.metadata.pageNumber,
          selectedPage: metadata.selectedPage.pageNumber,
          match: matches.matches[0],
          totalMatches: matches.total,
          fileBytes: file.content.length,
          fileSha256Verified: true,
          visibility: metadata.visibility,
        },
        null,
        2,
      ),
    );
  } finally {
    await adapter.close();
    await prisma.$disconnect();
  }
}

if (require.main === module)
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
