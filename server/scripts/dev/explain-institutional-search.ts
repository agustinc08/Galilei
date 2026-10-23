import { normalizeSearchText } from '../../src/busqueda/utils/search-normalizer';
import { PrismaService } from '../../src/prisma/prisma.service';

async function main() {
  if (!process.env.DATABASE_URL)
    throw new Error('Run through the DEV database guard.');
  const prisma = new PrismaService();
  try {
    await prisma.$connect();
    const run = await prisma.corpusImportRun.findFirst({
      where: { sourceCode: 'JURISPRUDENCIA_LOCAL_PDF', status: 'SUCCESS' },
      orderBy: { startedAt: 'desc' },
      select: { id: true },
    });
    if (!run) throw new Error('NO_SUCCESSFUL_INSTITUTIONAL_RUN');
    const item = await prisma.corpusImportRunItem.findFirst({
      where: { runId: run.id, status: 'INDEXED', documentId: { not: null } },
      orderBy: { itemKey: 'asc' },
      select: { documentId: true },
    });
    if (!item?.documentId) throw new Error('NO_INDEXED_INSTITUTIONAL_DOCUMENT');
    const document = await prisma.corpusDocument.findUnique({
      where: { id: item.documentId },
      select: { title: true, latestExtractionId: true },
    });
    if (!document?.latestExtractionId)
      throw new Error('NO_LATEST_INSTITUTIONAL_EXTRACTION');
    const page = await prisma.corpusDocumentPage.findFirst({
      where: { extractionId: document.latestExtractionId, text: { not: '' } },
      orderBy: { pageNumber: 'asc' },
      select: { text: true },
    });
    const term = page?.text.match(/[\p{L}]{10,}/u)?.[0];
    if (!term) throw new Error('NO_SEARCH_TERM');
    const titlePattern = `%${normalizeSearchText(document.title)}%`;
    const textPattern = `%${normalizeSearchText(term)}%`;
    const plan = await prisma.$queryRawUnsafe<Array<{ 'QUERY PLAN': string }>>(
      `EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT)
       SELECT COUNT(*)::text AS total
       FROM "CorpusDocument" d
       WHERE d."visibility" = ANY($1::text[])
         AND d."status" = 'INDEXED'
         AND translate(lower(coalesce(d."title",'')), 'áéíóúü', 'aeiouu') ILIKE $2 ESCAPE E'\\\\'
         AND d."searchText" ILIKE $3 ESCAPE E'\\\\'`,
      ['PUBLIC', 'INTERNAL'],
      titlePattern,
      textPattern,
    );
    console.log(
      JSON.stringify(
        {
          status: 'INSTITUTIONAL_SEARCH_EXPLAIN',
          runId: run.id,
          documentId: item.documentId,
          title: document.title,
          term,
          plan: plan.map((row) => row['QUERY PLAN']),
        },
        null,
        2,
      ),
    );
  } finally {
    await prisma.$disconnect();
  }
}

if (require.main === module)
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
