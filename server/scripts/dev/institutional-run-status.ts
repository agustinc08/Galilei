import { readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { LocalDocumentStorageAdapter } from '../../src/corpus/document-storage.adapter';
import { PrismaService } from '../../src/prisma/prisma.service';

const institutionalDocument = {
  ingestions: { some: { sourceSystem: { code: 'JURISPRUDENCIA_LOCAL_PDF' } } },
};

async function main() {
  const guardedArgs = process.env.BJC_INSTITUTIONAL_ARGS
    ? (JSON.parse(process.env.BJC_INSTITUTIONAL_ARGS) as string[])
    : [];
  const runId = guardedArgs[0] ?? process.argv[2];
  const prisma = new PrismaService();
  try {
    await prisma.$connect();
    const [
      runs,
      documents,
      files,
      locations,
      pages,
      classifications,
      classificationBreakdown,
      classificationByValue,
      ingestionRecords,
      associations,
      crossDomainLinks,
      dbSize,
    ] = await Promise.all([
      prisma.corpusImportRun.findMany({
        where: runId ? { id: runId } : undefined,
        orderBy: { startedAt: 'desc' },
        take: runId ? 1 : 10,
      }),
      prisma.corpusDocument.count({
        where: institutionalDocument,
      }),
      prisma.corpusDocumentFile.count({
        where: { document: institutionalDocument },
      }),
      prisma.corpusDocumentLocation.count({
        where: { document: institutionalDocument },
      }),
      prisma.corpusDocumentPage.count({
        where: { extraction: { document: institutionalDocument } },
      }),
      prisma.corpusDocumentClassification.count({
        where: { document: institutionalDocument },
      }),
      prisma.corpusDocumentClassification.groupBy({
        by: ['origin', 'reviewStatus'],
        where: { document: institutionalDocument },
        _count: { _all: true },
      }),
      prisma.corpusDocumentClassification.groupBy({
        by: ['category', 'value'],
        where: { document: institutionalDocument },
        _count: { _all: true },
        orderBy: { value: 'asc' },
      }),
      prisma.corpusIngestionRecord.count({
        where: {
          sourceSystem: { code: 'JURISPRUDENCIA_LOCAL_PDF' },
        },
      }),
      prisma.corpusDocumentAssociation.groupBy({
        by: ['confidence', 'reviewStatus'],
        where: { document: institutionalDocument },
        _count: { _all: true },
      }),
      prisma.corpusDocumentLink.groupBy({
        by: ['targetDomain'],
        where: { document: institutionalDocument },
        _count: { _all: true },
      }),
      prisma.$queryRaw<
        Array<{ bytes: bigint }>
      >`SELECT pg_database_size(current_database())::bigint AS bytes`,
    ]);
    const storage = new LocalDocumentStorageAdapter();
    const storageStats = await directoryStats(storage.root);
    const importRuns = await Promise.all(
      runs.map(async (run) => ({
        ...run,
        characters: run.characters.toString(),
        bytesProcessed: run.bytesProcessed.toString(),
        itemStatuses: await prisma.corpusImportRunItem.groupBy({
          by: ['status'],
          where: { runId: run.id },
          _count: { _all: true },
        }),
        failures: await prisma.corpusImportRunItem.findMany({
          where: { runId: run.id, status: 'FAILED' },
          select: {
            itemKey: true,
            errorStage: true,
            errorMessage: true,
            durationMs: true,
          },
          take: 20,
        }),
        itemCount: await prisma.corpusImportRunItem.count({
          where: { runId: run.id },
        }),
        itemDocumentCount: await prisma.corpusImportRunItem.count({
          where: { runId: run.id, documentId: { not: null } },
        }),
        incompleteItems: await prisma.corpusImportRunItem.findMany({
          where: { runId: run.id, status: { in: ['STORED', 'RUNNING'] } },
          select: {
            itemKey: true,
            status: true,
            documentId: true,
            createdAt: true,
            updatedAt: true,
            document: {
              select: {
                status: true,
                createdAt: true,
                ingestions: {
                  orderBy: { ingestedAt: 'desc' },
                  take: 1,
                  select: { status: true, ingestedAt: true, retryable: true },
                },
              },
            },
          },
        }),
      })),
    );
    console.log(
      JSON.stringify(
        {
          status: 'INSTITUTIONAL_STATUS',
          runs: importRuns,
          corpus: {
            documents,
            files,
            locations,
            pages,
            classifications,
            classificationBreakdown,
            classificationByValue,
            ingestionRecords,
            associations,
            crossDomainLinks,
            databaseBytes: dbSize[0]?.bytes.toString() ?? '0',
            storageRoot: path.relative(
              path.resolve(process.cwd(), '..'),
              storage.root,
            ),
            storage: storageStats,
          },
        },
        null,
        2,
      ),
    );
  } finally {
    await prisma.$disconnect();
  }
}

async function directoryStats(root: string) {
  let files = 0;
  let bytes = 0;
  const pending = [root];
  while (pending.length) {
    const directory = pending.pop()!;
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const fullPath = path.join(directory, entry.name);
      if (entry.isDirectory()) pending.push(fullPath);
      else if (entry.isFile()) {
        files += 1;
        bytes += (await stat(fullPath)).size;
      }
    }
  }
  return { files, bytes };
}

if (require.main === module)
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
