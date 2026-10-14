import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { PrismaService } from '../../src/prisma/prisma.service';
import { CorpusSearchSourceAdapter } from '../../src/corpus/corpus-search.adapter';
import { parseSearchQuery } from '../../src/busqueda/utils/search-parser';

async function main() {
  if (!process.env.DATABASE_URL)
    throw new Error('Run through the DEV DB guard.');
  const prisma = new PrismaService();
  const adapter = new CorpusSearchSourceAdapter(process.env.DATABASE_URL);
  try {
    await prisma.$connect();
    const result = await adapter.search(parseSearchQuery('responsabilidad'), {
      visibility: 'ADMIN',
      dialect: 'modern',
      publicationPolicy: 'legacy-active-only',
      page: 1,
      pageSize: 20,
    });
    const ids = result.results.map((item) => item.sourceId);
    const privateLeaks = ids.length
      ? await prisma.corpusDocument.count({
          where: { id: { in: ids }, documentScope: 'PRIVATE_WORKSPACE' },
        })
      : 0;
    if (result.total < 1 || privateLeaks !== 0)
      throw new Error('SEARCH_GENERAL_SCOPE_FAILED');
    const report = {
      generatedAt: new Date().toISOString(),
      status: 'SPRINT152_GENERAL_SEARCH_PASS',
      target: {
        endpoint: '127.0.0.1:55432',
        database: 'buscador_juridico_civil_dev',
        role: 'bjc_dev',
      },
      queryType: 'common general term',
      total: result.total,
      returned: result.results.length,
      totalExact: result.totalExact ?? null,
      privateDocumentsInReturnedIds: privateLeaks,
    };
    const outputDir = resolve(
      process.cwd(),
      '..',
      '..',
      '_recovery-work',
      'sprint152',
    );
    await mkdir(outputDir, { recursive: true });
    await writeFile(
      resolve(outputDir, 'search-general-smoke.json'),
      `${JSON.stringify(report, null, 2)}\n`,
      'utf8',
    );
    console.log(JSON.stringify(report, null, 2));
  } finally {
    await adapter.close();
    await prisma.$disconnect();
  }
}

void main().catch((error) => {
  console.error(
    error instanceof Error ? error.message : 'SPRINT152_GENERAL_SEARCH_FAILED',
  );
  process.exitCode = 1;
});
