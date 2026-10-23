import { createHash } from 'node:crypto';
import { lstat, mkdir, readFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import { Prisma } from '@prisma/client';
import { CorpusIngestionService } from '../../src/corpus/corpus-ingestion.service';
import type { DiscoveredDocument } from '../../src/corpus/document-source.adapter';
import { LocalDocumentStorageAdapter } from '../../src/corpus/document-storage.adapter';
import { PrismaService } from '../../src/prisma/prisma.service';

type Root = {
  id: string;
  name: string;
  path: string;
  type: string;
  source: string;
  readOnly: boolean;
  active: boolean;
  excludedReason?: string;
};
export type InventoryFile = {
  rootId: string;
  relativePath: string;
  filename: string;
  extension: string;
  sizeBytes: number;
  modifiedAt: string;
  sha256: string;
  detectedMime: string;
  signatureStatus: string;
};
type Inventory = {
  schemaVersion: string;
  scanId: string;
  generatedAt: string;
  roots: Array<Root & { relativePath: string }>;
  files: InventoryFile[];
  totals: Record<string, number>;
};
export type AssociationFile = {
  rootId: string;
  relativePath: string;
  sha256: string;
  confidence: string;
  sentenceIds: number[];
  candidateSentenceIds: number[];
  evidence: Array<{
    sentenciaId: number;
    legacyId: string | null;
    strategy: string;
  }>;
};
type AssociationReport = { files: AssociationFile[] };
type Options = {
  inventoryPath: string;
  associationPath?: string;
  limit?: number;
  batchSize: number;
  resume?: string;
  reprocess?: boolean;
  dryRun: boolean;
};
type Counters = {
  processed: number;
  newDocuments: number;
  reusedDocuments: number;
  linked: number;
  suggested: number;
  unresolved: number;
  extracted: number;
  pages: number;
  characters: bigint;
  ocrRequired: number;
  invalidPdf: number;
  failed: number;
  skipped: number;
  bytesProcessed: bigint;
};

const workspaceRoot = path.resolve(process.cwd(), '..');
const rootConfigPath = path.resolve(__dirname, 'institutional-pdf-roots.json');
const sourceCode = 'JURISPRUDENCIA_LOCAL_PDF';

async function main() {
  const options = parseArgs();
  const rawManifest = await readFile(options.inventoryPath);
  const inventory = JSON.parse(rawManifest.toString('utf8')) as Inventory;
  if (inventory.schemaVersion !== '1.0')
    throw new Error('INVENTORY_SCHEMA_UNSUPPORTED');
  const manifestSha256 = sha256(rawManifest);
  const sidecarPath = options.inventoryPath.replace(/\.json$/iu, '.sha256');
  const sidecar = (await readFile(sidecarPath, 'utf8')).trim().split(/\s+/u)[0];
  if (sidecar !== manifestSha256)
    throw new Error('INVENTORY_MANIFEST_HASH_MISMATCH');
  const rootConfig = JSON.parse(await readFile(rootConfigPath, 'utf8')) as {
    roots: Root[];
  };
  const roots = rootConfig.roots;
  verifyRoots(inventory.roots, roots);
  const associations = options.associationPath
    ? (JSON.parse(
        await readFile(options.associationPath, 'utf8'),
      ) as AssociationReport)
    : { files: [] };
  const associationByPath = new Map(
    associations.files.map((file) => [
      `${file.rootId}\0${file.relativePath}`,
      file,
    ]),
  );
  const groups = groupByHash(inventory.files);
  const selected = options.limit ? groups.slice(0, options.limit) : groups;
  const bytesPlanned = selected.reduce(
    (sum, group) => sum + group.files[0].sizeBytes,
    0,
  );
  const prisma = new PrismaService();
  const storage = new LocalDocumentStorageAdapter();
  const ingester = new CorpusIngestionService(prisma, storage);
  let started = Date.now();
  const durations: number[] = [];
  const counters: Counters = {
    processed: 0,
    newDocuments: 0,
    reusedDocuments: 0,
    linked: 0,
    suggested: 0,
    unresolved: 0,
    extracted: 0,
    pages: 0,
    characters: 0n,
    ocrRequired: 0,
    invalidPdf: 0,
    failed: 0,
    skipped: 0,
    bytesProcessed: 0n,
  };
  let runId = options.resume;
  try {
    await prisma.$connect();
    if (options.dryRun) {
      const rootsStored = await prisma.corpusDocumentRepositoryRoot.count();
      const source = await prisma.corpusSourceSystem.findUnique({
        where: { code: sourceCode },
        select: { id: true },
      });
      const known = source
        ? await prisma.corpusIngestionRecord.count({
            where: {
              sourceSystemId: source.id,
              checksum: { in: selected.map((item) => item.sha256) },
            },
          })
        : 0;
      for (const group of selected) await verifyFile(group.files[0], roots);
      console.log(
        JSON.stringify(
          {
            status: 'DRY_RUN',
            scanId: inventory.scanId,
            manifestSha256,
            runId: null,
            physicalFiles: inventory.files.length,
            uniqueHashes: groups.length,
            selectedUniqueHashes: selected.length,
            bytesPlanned,
            sourceRecordsAlreadyKnown: known,
            registeredRoots: rootsStored,
            writes: false,
            reprocess: options.reprocess ?? false,
            batchSize: options.batchSize,
          },
          null,
          2,
        ),
      );
      return;
    }
    for (const root of roots) {
      await prisma.corpusDocumentRepositoryRoot.upsert({
        where: { id: root.id },
        create: {
          id: root.id,
          name: root.name,
          relativePath: root.path,
          rootType: root.type,
          source: root.source,
          readOnly: root.readOnly,
          active: root.active,
          excludedReason: root.excludedReason,
        },
        update: {
          name: root.name,
          relativePath: root.path,
          rootType: root.type,
          source: root.source,
          readOnly: root.readOnly,
          active: root.active,
          excludedReason: root.excludedReason,
        },
      });
    }
    if (runId) {
      const existing = await prisma.corpusImportRun.findUnique({
        where: { id: runId },
      });
      if (
        !existing ||
        existing.scanId !== inventory.scanId ||
        existing.manifestSha256 !== manifestSha256
      )
        throw new Error('RESUME_RUN_MISMATCH');
      if (existing.status === 'SUCCESS')
        throw new Error('RUN_ALREADY_COMPLETE');
      await prisma.corpusImportRun.update({
        where: { id: runId },
        data: { status: 'RUNNING', finishedAt: null },
      });
      started = existing.startedAt.getTime();
      counters.processed = existing.processed;
      counters.newDocuments = existing.newDocuments;
      counters.reusedDocuments = existing.reusedDocuments;
      counters.linked = existing.linked;
      counters.suggested = existing.suggested;
      counters.unresolved = existing.unresolved;
      counters.extracted = existing.extracted;
      counters.pages = existing.pages;
      counters.characters = existing.characters;
      counters.ocrRequired = existing.ocrRequired;
      counters.invalidPdf = existing.invalidPdf;
      counters.failed = existing.failed;
      counters.skipped = existing.skipped;
      counters.bytesProcessed = existing.bytesProcessed;
    } else {
      runId = cryptoUuid();
      await prisma.corpusImportRun.create({
        data: {
          id: runId,
          scanId: inventory.scanId,
          manifestSha256,
          sourceCode,
          roots: roots as Prisma.InputJsonArray,
          scanned: inventory.files.length,
          physicalFiles: inventory.files.length,
          uniqueHashes: groups.length,
        },
      });
    }
    const runRows = await prisma.corpusImportRunItem.findMany({
      where: {
        runId,
        status: {
          in: ['INDEXED', 'OCR_REQUIRED', 'INVALID_PDF', 'FAILED', 'STORED'],
        },
      },
      select: {
        itemKey: true,
        status: true,
        extractionDurationMs: true,
        associationConfidence: true,
        bytes: true,
        pages: true,
        characters: true,
      },
    });
    const completedRows = runRows.filter((item) =>
      ['INDEXED', 'OCR_REQUIRED', 'INVALID_PDF'].includes(item.status),
    );
    if (options.resume) {
      const terminalCount = runRows.length;
      const failedCount = runRows.filter(
        (item) => item.status === 'FAILED',
      ).length;
      const missedProcessed = Math.max(0, terminalCount - counters.processed);
      const missedFailures = Math.max(0, failedCount - counters.failed);
      counters.newDocuments += Math.max(0, missedProcessed - missedFailures);
      counters.processed = terminalCount;
      counters.failed = failedCount;
      counters.extracted = runRows.filter(
        (item) => item.status === 'INDEXED',
      ).length;
      counters.ocrRequired = runRows.filter(
        (item) => item.status === 'OCR_REQUIRED',
      ).length;
      counters.invalidPdf = runRows.filter(
        (item) => item.status === 'INVALID_PDF',
      ).length;
      counters.pages = runRows.reduce((sum, item) => sum + item.pages, 0);
      counters.characters = runRows.reduce(
        (sum, item) => sum + BigInt(item.characters),
        0n,
      );
      counters.bytesProcessed = runRows.reduce(
        (sum, item) => sum + item.bytes,
        0n,
      );
      counters.suggested = runRows.filter((item) =>
        ['HIGH_CONFIDENCE', 'CANDIDATE'].includes(
          item.associationConfidence ?? '',
        ),
      ).length;
      counters.unresolved = runRows.filter(
        (item) => item.associationConfidence === 'UNRESOLVED',
      ).length;
      counters.linked = await prisma.corpusDocumentLink.count({
        where: {
          targetDomain: 'JURISPRUDENCIA',
          document: { importRunItems: { some: { runId } } },
        },
      });
    }
    const completedItems = new Set(completedRows.map((item) => item.itemKey));
    durations.push(
      ...completedRows
        .map((item) => item.extractionDurationMs ?? 0)
        .filter((value) => value > 0),
    );
    let batchProcessed = 0;
    for (const [groupIndex, group] of selected.entries()) {
      if (completedItems.has(group.sha256)) {
        continue;
      }
      const itemStarted = Date.now();
      const primary = group.files[0];
      const itemKey = group.sha256;
      const priorRunItem = await prisma.corpusImportRunItem.findUnique({
        where: { runId_itemKey: { runId, itemKey } },
        select: { status: true, documentId: true },
      });
      await prisma.corpusImportRunItem.upsert({
        where: { runId_itemKey: { runId, itemKey } },
        create: {
          runId,
          itemKey,
          status: 'RUNNING',
          bytes: BigInt(primary.sizeBytes),
          startedAt: new Date(),
        },
        update: {
          status: 'RUNNING',
          errorMessage: null,
          errorStage: null,
          startedAt: new Date(),
          finishedAt: null,
        },
      });
      try {
        const content = await verifyFile(primary, roots);
        const physicalAssociation = group.files
          .map((file) =>
            associationByPath.get(`${file.rootId}\0${file.relativePath}`),
          )
          .filter((value): value is AssociationFile => !!value);
        const association = summarizeAssociations(physicalAssociation);
        const sourcePath = `${primary.rootId}/${primary.relativePath}`;
        const item: DiscoveredDocument = {
          filename: primary.filename,
          externalId: `institutional-location:${sourcePath}`,
          sourceReference: sourcePath,
          sourcePath,
          obtainedAt: new Date(primary.modifiedAt),
          content,
          mimeType: 'application/pdf',
          title: primary.filename.replace(/\.[^.]+$/u, ''),
          documentType: 'DOCUMENT',
          jurisdiction: 'CIVIL',
          visibility: 'INTERNAL',
          metadata: {
            inventoryScanId: inventory.scanId,
            manifestSha256,
            physicalLocationCount: group.files.length,
            associationConfidence: association.confidence,
          },
          metadataOriginal: {
            institutionalInventory: {
              scanId: inventory.scanId,
              manifestSha256,
              sourceCode,
              primaryRootId: primary.rootId,
              relativePath: primary.relativePath,
              duplicateLocationCount: group.files.length - 1,
            },
          },
        };
        let outcome = await ingester.ingestOne(item, {
          sourceCode,
          sourceName: 'Jurisprudencia local — raíces read-only',
          sourceType: 'LOCAL_READ_ONLY_REPOSITORY',
        });
        let normalizedStatus = outcome.status;
        let extractionDurationMs =
          'extractionDurationMs' in outcome
            ? outcome.extractionDurationMs
            : undefined;
        let retryMetrics:
          | { pageCount: number; characterCount: number }
          | undefined;
        const retryStored =
          priorRunItem?.status === 'STORED' &&
          outcome.status === 'STORED' &&
          !!priorRunItem.documentId;
        if (retryStored) {
          const retried = await ingester.retryExtraction(
            priorRunItem.documentId!,
          );
          const latest = await prisma.corpusExtraction.findFirst({
            where: { id: retried.extractionId },
            select: { _count: { select: { pages: true } }, text: true },
          });
          normalizedStatus =
            retried.status === 'OCR_REQUIRED' ? 'OCR_REQUIRED' : 'INDEXED';
          extractionDurationMs = retried.extractionDurationMs;
          retryMetrics = {
            pageCount: latest?._count.pages ?? 0,
            characterCount: latest?.text.length ?? 0,
          };
        }
        // A second idempotency pass reuses the already extracted document. Carry
        // its observed page/character totals into the audit run without creating
        // another extraction or pretending extraction work happened again.
        if (
          !retryStored &&
          outcome.reused &&
          ['INDEXED', 'OCR_REQUIRED'].includes(normalizedStatus)
        ) {
          const latest = await prisma.corpusExtraction.findFirst({
            where: { documentId: outcome.documentId },
            orderBy: { extractedAt: 'desc' },
            select: { id: true, text: true },
          });
          retryMetrics = {
            pageCount: latest
              ? await prisma.corpusDocumentPage.count({
                  where: { extractionId: latest.id },
                })
              : 0,
            characterCount: latest?.text.length ?? 0,
          };
        }
        if (
          !retryStored &&
          (outcome.status === 'FAILED' ||
            (options.reprocess &&
              outcome.reused &&
              outcome.status !== 'INVALID_PDF'))
        ) {
          const priorIngestion = await prisma.corpusIngestionRecord.findUnique({
            where: { id: outcome.ingestionId },
            select: { retryable: true },
          });
          if (options.reprocess || priorIngestion?.retryable) {
            const retried = await ingester.retryExtraction(outcome.documentId);
            const latest = await prisma.corpusExtraction.findFirst({
              where: { id: retried.extractionId },
              select: { _count: { select: { pages: true } }, text: true },
            });
            normalizedStatus =
              retried.status === 'OCR_REQUIRED' ? 'OCR_REQUIRED' : 'INDEXED';
            extractionDurationMs = retried.extractionDurationMs;
            retryMetrics = {
              pageCount: latest?._count.pages ?? 0,
              characterCount: latest?.text.length ?? 0,
            };
          }
        }
        if (normalizedStatus === 'FAILED')
          throw new Error('EXTRACTION_FAILED_NOT_RETRYABLE');
        const totalMs = Date.now() - itemStarted;
        if (typeof extractionDurationMs === 'number')
          durations.push(extractionDurationMs);
        await saveLocations(prisma, group.files, roots, outcome.documentId);
        await saveAssociations(prisma, outcome.documentId, association);
        if (!retryStored) {
          counters.bytesProcessed += BigInt(primary.sizeBytes);
          if (outcome.reused) counters.reusedDocuments += 1;
          else counters.newDocuments += 1;
          if (association.confidence === 'EXACT')
            counters.linked += association.targets.filter(
              (target) => target.confidence === 'EXACT',
            ).length;
          else if (
            association.confidence === 'HIGH_CONFIDENCE' ||
            association.confidence === 'CANDIDATE'
          )
            counters.suggested += 1;
          else counters.unresolved += 1;
        }
        if (normalizedStatus === 'INDEXED') counters.extracted += 1;
        if (normalizedStatus === 'OCR_REQUIRED') counters.ocrRequired += 1;
        if (normalizedStatus === 'INVALID_PDF') counters.invalidPdf += 1;
        if (retryMetrics) counters.pages += retryMetrics.pageCount;
        else if ('pageCount' in outcome)
          counters.pages += outcome.pageCount ?? 0;
        if (retryMetrics)
          counters.characters += BigInt(retryMetrics.characterCount);
        else if ('characterCount' in outcome)
          counters.characters += BigInt(outcome.characterCount ?? 0);
        if (priorRunItem?.status === 'FAILED')
          counters.failed = Math.max(0, counters.failed - 1);
        else if (priorRunItem?.status !== 'STORED') counters.processed += 1;
        await prisma.corpusImportRunItem.update({
          where: { runId_itemKey: { runId, itemKey } },
          data: {
            documentId: outcome.documentId,
            status: normalizedStatus,
            extractionStatus: normalizedStatus,
            associationConfidence: association.confidence,
            bytes: BigInt(primary.sizeBytes),
            pages: retryMetrics
              ? retryMetrics.pageCount
              : 'pageCount' in outcome
                ? (outcome.pageCount ?? 0)
                : 0,
            characters: retryMetrics
              ? retryMetrics.characterCount
              : 'characterCount' in outcome
                ? (outcome.characterCount ?? 0)
                : 0,
            durationMs: totalMs,
            extractionDurationMs: extractionDurationMs ?? null,
            finishedAt: new Date(),
          },
        });
      } catch (error) {
        if (
          priorRunItem?.status !== 'FAILED' &&
          priorRunItem?.status !== 'STORED'
        )
          counters.processed += 1;
        counters.failed += priorRunItem?.status === 'FAILED' ? 0 : 1;
        const message =
          error instanceof Error ? error.message : 'Unknown import error';
        await prisma.corpusImportRunItem.update({
          where: { runId_itemKey: { runId, itemKey } },
          data: {
            status: 'FAILED',
            errorStage: 'INGEST',
            errorMessage: message.slice(0, 1000),
            durationMs: Date.now() - itemStarted,
            extractionDurationMs: null,
            finishedAt: new Date(),
          },
        });
      }
      batchProcessed += 1;
      if (
        batchProcessed >= options.batchSize ||
        groupIndex + 1 === selected.length
      ) {
        await updateRun(
          prisma,
          runId,
          counters,
          'RUNNING',
          durations,
          inventory,
        );
        batchProcessed = 0;
      }
      if (
        (groupIndex + 1) % options.batchSize === 0 ||
        groupIndex + 1 === selected.length
      ) {
        console.log(
          `INGEST_PROGRESS runId=${runId} unique=${groupIndex + 1}/${selected.length} processed=${counters.processed} new=${counters.newDocuments} reused=${counters.reusedDocuments} failed=${counters.failed} ocr=${counters.ocrRequired}`,
        );
      }
      if (
        counters.processed >= 100 &&
        counters.failed / counters.processed > 0.05
      ) {
        await updateRun(
          prisma,
          runId,
          counters,
          'STOPPED_ERROR_RATE',
          durations,
          inventory,
        );
        console.log(
          JSON.stringify(
            {
              status: 'STOPPED_ERROR_RATE',
              runId,
              processed: counters.processed,
              failed: counters.failed,
            },
            null,
            2,
          ),
        );
        return;
      }
    }
    const complete = selected.length === groups.length;
    const finalStatus = complete
      ? counters.failed
        ? 'PARTIAL_FAILURE'
        : 'SUCCESS'
      : 'LIMIT_REACHED';
    await updateRun(prisma, runId, counters, finalStatus, durations, inventory);
    console.log(
      JSON.stringify(
        {
          status: finalStatus,
          runId,
          scanId: inventory.scanId,
          manifestSha256,
          totals: {
            ...counters,
            characters: counters.characters.toString(),
            bytesProcessed: counters.bytesProcessed.toString(),
          },
          extractionDuration: summarize(durations),
          elapsedMs: Date.now() - started,
          uniqueHashesInRun: selected.length,
        },
        null,
        2,
      ),
    );
  } finally {
    await prisma.$disconnect();
  }
}

async function saveLocations(
  prisma: PrismaService,
  files: InventoryFile[],
  roots: Root[],
  documentId: string,
) {
  for (let index = 0; index < files.length; index += 500) {
    const chunk = files.slice(index, index + 500);
    await prisma.corpusDocumentLocation.createMany({
      data: chunk.map((file) => {
        const root = roots.find((item) => item.id === file.rootId)!;
        return {
          documentId,
          rootId: root.id,
          relativePath: file.relativePath,
          originalFilename: file.filename,
          sourceType: root.type,
          source: root.source,
          sizeBytes: BigInt(file.sizeBytes),
          sha256: file.sha256,
          modifiedAt: new Date(file.modifiedAt),
        };
      }),
      skipDuplicates: true,
    });
  }
}

export async function saveAssociations(
  prisma: PrismaService,
  documentId: string,
  association: ReturnType<typeof summarizeAssociations>,
) {
  const entries = association.targets.length
    ? association.targets
    : [
        {
          targetId: '',
          confidence: 'UNRESOLVED',
          sentenceIds: [],
          strategies: [],
        },
      ];
  for (const target of entries) {
    const reviewStatus =
      target.confidence === 'EXACT'
        ? 'APPROVED'
        : target.confidence === 'UNRESOLVED'
          ? 'UNRESOLVED'
          : 'REVIEW_PENDING';
    const associationWhere = {
      documentId_targetDomain_targetType_targetId: {
        documentId,
        targetDomain: 'JURISPRUDENCIA',
        targetType: 'SENTENCIA',
        targetId: target.targetId,
      },
    };
    const existing = await prisma.corpusDocumentAssociation.findUnique({
      where: associationWhere,
      select: { reviewStatus: true },
    });
    if (
      !existing ||
      !['APPROVED', 'REJECTED'].includes(existing.reviewStatus)
    ) {
      await prisma.corpusDocumentAssociation.upsert({
        where: associationWhere,
        create: {
          documentId,
          targetDomain: 'JURISPRUDENCIA',
          targetType: 'SENTENCIA',
          targetId: target.targetId,
          confidence: target.confidence,
          reviewStatus,
          origin: 'LEGACY',
          evidence: {
            sentenceIds: target.sentenceIds,
            strategies: target.strategies,
          } as Prisma.InputJsonValue,
        },
        update: {
          confidence: target.confidence,
          reviewStatus,
          evidence: {
            sentenceIds: target.sentenceIds,
            strategies: target.strategies,
          } as Prisma.InputJsonValue,
        },
      });
    }
    if (
      target.confidence === 'EXACT' &&
      target.targetId &&
      existing?.reviewStatus !== 'REJECTED'
    ) {
      await prisma.corpusDocumentLink.upsert({
        where: {
          documentId_targetDomain_targetType_targetId_relationship: {
            documentId,
            targetDomain: 'JURISPRUDENCIA',
            targetType: 'SENTENCIA',
            targetId: target.targetId,
            relationship: 'ATTACHMENT',
          },
        },
        create: {
          documentId,
          targetDomain: 'JURISPRUDENCIA',
          targetType: 'SENTENCIA',
          targetId: target.targetId,
          relationship: 'ATTACHMENT',
          metadata: { confidence: 'EXACT' },
        },
        update: { metadata: { confidence: 'EXACT' } },
      });
    }
  }
}

export function summarizeAssociations(records: AssociationFile[]) {
  const rank: Record<string, number> = {
    UNRESOLVED: 0,
    CANDIDATE: 1,
    HIGH_CONFIDENCE: 2,
    EXACT: 3,
  };
  const confidence = records.reduce(
    (best, record) =>
      rank[record.confidence] > rank[best] ? record.confidence : best,
    'UNRESOLVED',
  );
  const targets = new Map<
    string,
    {
      targetId: string;
      confidence: string;
      sentenceIds: number[];
      strategies: string[];
    }
  >();
  for (const record of records) {
    for (const sentenceId of record.sentenceIds) {
      const targetConfidence =
        record.confidence === 'EXACT' ? 'EXACT' : 'HIGH_CONFIDENCE';
      const key = `${targetConfidence}:${sentenceId}`;
      if (!targets.has(key))
        targets.set(key, {
          targetId: String(sentenceId),
          confidence: targetConfidence,
          sentenceIds: [sentenceId],
          strategies: [],
        });
      targets
        .get(key)!
        .strategies.push(
          ...record.evidence
            .filter((entry) => entry.sentenciaId === sentenceId)
            .map((entry) => entry.strategy),
        );
    }
    for (const sentenceId of record.candidateSentenceIds) {
      const key = `CANDIDATE:${sentenceId}`;
      if (!targets.has(key))
        targets.set(key, {
          targetId: String(sentenceId),
          confidence: 'CANDIDATE',
          sentenceIds: [sentenceId],
          strategies: [],
        });
      targets.get(key)!.strategies.push('EXPEDIENTE_OR_AMBIGUOUS_FILENAME');
    }
  }
  return {
    confidence,
    sentenceIds: [...new Set(records.flatMap((record) => record.sentenceIds))],
    targets: [...targets.values()].map((target) => ({
      ...target,
      strategies: [...new Set(target.strategies)],
    })),
  };
}

async function updateRun(
  prisma: PrismaService,
  runId: string,
  counters: Counters,
  status: string,
  durations: number[],
  inventory: Inventory,
) {
  const processing = await prisma.corpusImportRunItem.aggregate({
    where: { runId, durationMs: { not: null } },
    _sum: { durationMs: true },
  });
  const elapsedMs = Math.max(1, processing._sum.durationMs ?? 0);
  const minutes = elapsedMs / 60_000;
  await prisma.corpusImportRun.update({
    where: { id: runId },
    data: {
      status,
      processed: counters.processed,
      newDocuments: counters.newDocuments,
      reusedDocuments: counters.reusedDocuments,
      linked: counters.linked,
      suggested: counters.suggested,
      unresolved: counters.unresolved,
      extracted: counters.extracted,
      pages: counters.pages,
      characters: counters.characters,
      ocrRequired: counters.ocrRequired,
      invalidPdf: counters.invalidPdf,
      failed: counters.failed,
      skipped: counters.skipped,
      bytesProcessed: counters.bytesProcessed,
      filesPerMinute: counters.processed / minutes,
      mbPerMinute: Number(counters.bytesProcessed) / (1024 * 1024 * minutes),
      extractP50Ms: percentile(durations, 0.5),
      extractP95Ms: percentile(durations, 0.95),
      errorSummary: counters.failed
        ? { failed: counters.failed }
        : Prisma.JsonNull,
      finishedAt: status === 'RUNNING' ? null : new Date(),
    },
  });
}

async function verifyFile(file: InventoryFile, roots: Root[]) {
  const root = roots.find((item) => item.id === file.rootId);
  if (!root || !root.active || !root.readOnly)
    throw new Error(`ROOT_NOT_AUTHORIZED: ${file.rootId}`);
  const rootPath = await realpath(path.resolve(workspaceRoot, root.path));
  const target = path.resolve(rootPath, file.relativePath);
  const relative = path.relative(rootPath, target);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative))
    throw new Error(`UNSAFE_INVENTORY_PATH: ${file.relativePath}`);
  const details = await lstat(target);
  if (!details.isFile() || details.isSymbolicLink())
    throw new Error(
      `SOURCE_NOT_REGULAR_FILE: ${file.rootId}/${file.relativePath}`,
    );
  const resolved = await realpath(target);
  if (!resolved.startsWith(rootPath + path.sep))
    throw new Error(`SOURCE_OUTSIDE_ROOT: ${file.rootId}/${file.relativePath}`);
  const content = await readFile(resolved);
  if (sha256(content) !== file.sha256)
    throw new Error(
      `SOURCE_CHANGED_AFTER_INVENTORY: ${file.rootId}/${file.relativePath}`,
    );
  return content;
}

function groupByHash(files: InventoryFile[]) {
  const groups = new Map<string, InventoryFile[]>();
  for (const file of files) {
    if (!groups.has(file.sha256)) groups.set(file.sha256, []);
    groups.get(file.sha256)!.push(file);
  }
  return [...groups.entries()]
    .map(([sha256, occurrences]) => ({
      sha256,
      files: occurrences.sort(
        (a, b) =>
          a.rootId.localeCompare(b.rootId) ||
          a.relativePath.localeCompare(b.relativePath),
      ),
    }))
    .sort((a, b) => a.sha256.localeCompare(b.sha256));
}
function verifyRoots(manifestRoots: Inventory['roots'], configRoots: Root[]) {
  const configured = new Map(
    configRoots.filter((root) => root.active).map((root) => [root.id, root]),
  );
  for (const root of manifestRoots) {
    const configuredRoot = configured.get(root.id);
    if (
      !configuredRoot ||
      root.relativePath !== configuredRoot.path ||
      !configuredRoot.readOnly ||
      !configuredRoot.active
    )
      throw new Error(`INVENTORY_ROOT_CONFIG_MISMATCH: ${root.id}`);
  }
}
function parseArgs(): Options {
  const raw = process.env.BJC_INSTITUTIONAL_ARGS;
  const tokens = raw ? (JSON.parse(raw) as string[]) : process.argv.slice(2);
  const options: Options = { inventoryPath: '', batchSize: 100, dryRun: false };
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token === '--dry-run') {
      options.dryRun = true;
      continue;
    }
    if (token === '--limit') {
      options.limit = positiveInteger(tokens[++index], '--limit');
      continue;
    }
    if (token === '--batch-size') {
      options.batchSize = positiveInteger(tokens[++index], '--batch-size');
      if (![100, 250, 500].includes(options.batchSize))
        throw new Error('--batch-size debe ser 100, 250 o 500.');
      continue;
    }
    if (token === '--resume') {
      options.resume = tokens[++index];
      continue;
    }
    if (token === '--reprocess') {
      options.reprocess = true;
      continue;
    }
    if (token === '--association-file') {
      options.associationPath = tokens[++index];
      continue;
    }
    if (token.startsWith('--'))
      throw new Error(`Opción no soportada: ${token}`);
    if (!options.inventoryPath) options.inventoryPath = token;
    else throw new Error('Se recibió más de un manifest.');
  }
  if (!options.inventoryPath)
    throw new Error(
      'Uso: institutional-ingest <inventory.json> [--association-file <file>] [--dry-run] [--limit N] [--batch-size 100|250|500] [--resume runId | --reprocess]',
    );
  if (options.resume && options.reprocess)
    throw new Error(
      '--reprocess debe iniciar una corrida nueva, sin --resume.',
    );
  options.inventoryPath = path.resolve(options.inventoryPath);
  if (options.associationPath)
    options.associationPath = path.resolve(options.associationPath);
  return options;
}
function positiveInteger(value: string | undefined, option: string) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0)
    throw new Error(`${option} requiere un entero positivo.`);
  return parsed;
}
function sha256(value: Buffer | string) {
  return createHash('sha256').update(value).digest('hex');
}
function cryptoUuid() {
  return require('node:crypto').randomUUID() as string;
}
function percentile(values: number[], percent: number) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[
    Math.min(sorted.length - 1, Math.floor(sorted.length * percent))
  ];
}
function summarize(values: number[]) {
  return {
    count: values.length,
    p50Ms: percentile(values, 0.5),
    p95Ms: percentile(values, 0.95),
  };
}

if (require.main === module)
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
