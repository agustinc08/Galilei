import { readFile } from 'node:fs/promises';
import { PrismaService } from '../../src/prisma/prisma.service';

type Manifest = { files: Array<{ sha256: string }> };

async function main() {
  const args = process.env.BJC_INSTITUTIONAL_ARGS
    ? (JSON.parse(process.env.BJC_INSTITUTIONAL_ARGS) as string[])
    : process.argv.slice(2);
  const [runId, inventoryPath] = args;
  if (!runId || !inventoryPath)
    throw new Error('Uso: institutional-reconcile <runId> <inventory.json>');
  const manifest = JSON.parse(
    await readFile(inventoryPath, 'utf8'),
  ) as Manifest;
  const expectedKeys = [
    ...new Set(manifest.files.map((file) => file.sha256)),
  ].sort();
  const prisma = new PrismaService();
  try {
    await prisma.$connect();
    const [run, rows] = await Promise.all([
      prisma.corpusImportRun.findUnique({ where: { id: runId } }),
      prisma.corpusImportRunItem.findMany({
        where: { runId },
        select: { itemKey: true, status: true, documentId: true },
      }),
    ]);
    if (!run) throw new Error('RUN_NOT_FOUND');
    const targetLimit = Math.min(expectedKeys.length, run.processed);
    const expectedPrefix = new Set(expectedKeys.slice(0, targetLimit));
    const actualKeys = new Set(rows.map((row) => row.itemKey));
    const expectedMissing = [...expectedPrefix].filter(
      (key) => !actualKeys.has(key),
    );
    const unexpected = rows.filter((row) => !expectedPrefix.has(row.itemKey));
    const statuses = rows.reduce<Record<string, number>>((result, row) => {
      result[row.status] = (result[row.status] ?? 0) + 1;
      return result;
    }, {});
    console.log(
      JSON.stringify(
        {
          status: 'RECONCILIATION_COMPLETE',
          runId,
          runProcessed: run.processed,
          itemCount: rows.length,
          uniqueItemKeys: actualKeys.size,
          itemsWithDocument: rows.filter((row) => row.documentId).length,
          statusCounts: statuses,
          expectedPrefix: targetLimit,
          expectedMissing: expectedMissing.length,
          unexpectedCount: unexpected.length,
          unexpectedSample: unexpected.slice(0, 25),
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
