import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import {
  saveAssociations,
  summarizeAssociations,
  type AssociationFile,
  type InventoryFile,
} from './ingest-institutional-pdfs';
import { PrismaService } from '../../src/prisma/prisma.service';

type Inventory = {
  scanId: string;
  files: InventoryFile[];
};
type AssociationReport = { files: AssociationFile[] };

async function main() {
  const args = process.env.BJC_INSTITUTIONAL_ARGS
    ? (JSON.parse(process.env.BJC_INSTITUTIONAL_ARGS) as string[])
    : process.argv.slice(2);
  const [runId, inventoryPath, associationPath] = args;
  if (!runId || !inventoryPath || !associationPath)
    throw new Error(
      'Uso: institutional-associations-reconcile <runId> <inventory.json> <association-preview.json>',
    );
  const inventoryRaw = await readFile(inventoryPath);
  const inventory = JSON.parse(inventoryRaw.toString('utf8')) as Inventory;
  const associationReport = JSON.parse(
    await readFile(associationPath, 'utf8'),
  ) as AssociationReport;
  const inventorySha = createHash('sha256').update(inventoryRaw).digest('hex');
  const sidecar = (
    await readFile(inventoryPath.replace(/\.json$/iu, '.sha256'), 'utf8')
  )
    .trim()
    .split(/\s+/u)[0];
  if (sidecar !== inventorySha)
    throw new Error('INVENTORY_MANIFEST_HASH_MISMATCH');
  const prisma = new PrismaService();
  try {
    await prisma.$connect();
    const run = await prisma.corpusImportRun.findUnique({
      where: { id: runId },
    });
    if (
      !run ||
      run.scanId !== inventory.scanId ||
      run.manifestSha256 !== inventorySha
    )
      throw new Error('RUN_INVENTORY_MISMATCH');
    const associationByPath = new Map(
      associationReport.files.map((file) => [
        `${file.rootId}\0${file.relativePath}`,
        file,
      ]),
    );
    const grouped = new Map<string, InventoryFile[]>();
    for (const file of inventory.files) {
      if (!grouped.has(file.sha256)) grouped.set(file.sha256, []);
      grouped.get(file.sha256)!.push(file);
    }
    const runItems = await prisma.corpusImportRunItem.findMany({
      where: {
        runId,
        documentId: { not: null },
        status: { in: ['INDEXED', 'OCR_REQUIRED', 'INVALID_PDF'] },
      },
      select: { itemKey: true, documentId: true },
    });
    let processed = 0;
    const confidenceCounts = {
      EXACT: 0,
      HIGH_CONFIDENCE: 0,
      CANDIDATE: 0,
      UNRESOLVED: 0,
    };
    for (const runItem of runItems) {
      if (!runItem.documentId) continue;
      const locations = grouped.get(runItem.itemKey);
      if (!locations)
        throw new Error(`RUN_ITEM_HASH_NOT_IN_INVENTORY: ${runItem.itemKey}`);
      const records = locations
        .map((file) =>
          associationByPath.get(`${file.rootId}\0${file.relativePath}`),
        )
        .filter((file): file is AssociationFile => !!file);
      const association = summarizeAssociations(records);
      await saveAssociations(prisma, runItem.documentId, association);
      if (association.confidence !== 'UNRESOLVED') {
        await prisma.corpusDocumentAssociation.deleteMany({
          where: {
            documentId: runItem.documentId,
            targetDomain: 'JURISPRUDENCIA',
            targetType: 'SENTENCIA',
            targetId: '',
            confidence: 'UNRESOLVED',
          },
        });
      }
      await prisma.corpusImportRunItem.update({
        where: { runId_itemKey: { runId, itemKey: runItem.itemKey } },
        data: { associationConfidence: association.confidence },
      });
      confidenceCounts[
        association.confidence as keyof typeof confidenceCounts
      ] += 1;
      processed += 1;
    }
    const [linked, suggested, unresolved] = await Promise.all([
      prisma.corpusDocumentLink.count({
        where: {
          targetDomain: 'JURISPRUDENCIA',
          document: { importRunItems: { some: { runId } } },
        },
      }),
      prisma.corpusImportRunItem.count({
        where: {
          runId,
          status: { in: ['INDEXED', 'OCR_REQUIRED'] },
          associationConfidence: { in: ['HIGH_CONFIDENCE', 'CANDIDATE'] },
        },
      }),
      prisma.corpusImportRunItem.count({
        where: {
          runId,
          status: { in: ['INDEXED', 'OCR_REQUIRED'] },
          associationConfidence: 'UNRESOLVED',
        },
      }),
    ]);
    await prisma.corpusImportRun.update({
      where: { id: runId },
      data: { linked, suggested, unresolved },
    });
    console.log(
      JSON.stringify(
        {
          status: 'ASSOCIATIONS_RECONCILED',
          runId,
          processed,
          confidenceCounts,
          linked,
          suggested,
          unresolved,
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
