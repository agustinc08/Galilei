import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  CorpusIngestionService,
  type IngestionOutcome,
} from '../../src/corpus/corpus-ingestion.service';
import {
  DocumentIngestionPackageValidator,
  sha256,
  stableJson,
  type PreparedPackage,
} from '../../src/corpus/document-ingestion-package';
import type { DiscoveredDocument } from '../../src/corpus/document-source.adapter';
import { LocalDocumentStorageAdapter } from '../../src/corpus/document-storage.adapter';
import { PrismaService } from '../../src/prisma/prisma.service';

export type PackageCommandArgs = {
  command: string;
  packagePath?: string;
  receiptDir?: string;
  retryReceipt?: string;
};
type ReceiptEntry = {
  path: string;
  externalId: string;
  documentId?: string;
  ingestionId?: string;
  sha256: string;
  status: string;
  reused: boolean;
  error?: string;
};
export type ImportReceipt = {
  schemaVersion: '1.0';
  packageId: string;
  sourceCode: string;
  manifestSha256: string;
  runId: string;
  startedAt: string;
  finishedAt: string;
  status: 'SUCCESS' | 'PARTIAL_SUCCESS' | 'FAILED' | 'ALREADY_IMPORTED';
  documentsTotal: number;
  imported: number;
  skipped: number;
  failed: number;
  duplicateHashes: number;
  validationIssues: Array<{ path?: string; code: string; message: string }>;
  entries: ReceiptEntry[];
  receiptSha256?: string;
};

const validator = new DocumentIngestionPackageValidator();

async function main() {
  const args = parseArgs();
  if (args.command === 'status') return statusCommand(args);
  if (!args.packagePath)
    throw new Error(
      'Uso: corpus-package <draft|validate|dry-run|import> <directorio> [--receipt-dir <directorio>]',
    );
  if (args.command === 'draft') {
    const draft = await validator.writeDraft(args.packagePath);
    console.log(
      JSON.stringify({ status: 'DRAFT_CREATED', path: draft }, null, 2),
    );
    return;
  }
  const prepared = await validator.prepare(args.packagePath);
  if (args.command === 'validate') return printValidation(prepared);
  if (!['dry-run', 'import'].includes(args.command))
    throw new Error(`Comando desconocido: ${args.command}`);
  if (args.command === 'dry-run') return dryRun(prepared);
  return importPackage(prepared, args);
}

function parseArgs(): PackageCommandArgs {
  let tokens: string[];
  const guarded = process.env.BJC_CORPUS_PACKAGE_ARGS;
  if (guarded) {
    try {
      tokens = JSON.parse(guarded) as string[];
    } catch {
      throw new Error('Argumentos de paquete inválidos en el guard DEV.');
    }
  } else tokens = process.argv.slice(2);
  const command = tokens[0] ?? '';
  const args: PackageCommandArgs = { command };
  let index = 1;
  while (index < tokens.length) {
    const value = tokens[index];
    if (value === '--receipt-dir') {
      args.receiptDir = tokens[index + 1];
      index += 2;
      continue;
    }
    if (value === '--retry-failed') {
      args.retryReceipt = tokens[index + 1];
      index += 2;
      continue;
    }
    if (value.startsWith('--')) throw new Error(`Opción no admitida: ${value}`);
    if (!args.packagePath) args.packagePath = value;
    else throw new Error('Se recibió más de un directorio de paquete.');
    index += 1;
  }
  return args;
}

function printValidation(pkg: PreparedPackage) {
  console.log(
    JSON.stringify(
      {
        status: pkg.issues.length ? 'PARTIAL_SUCCESS' : 'VALID',
        packageId: pkg.packageId,
        source: pkg.source.code,
        manifest: pkg.manifestName,
        manifestSha256: pkg.manifestSha256,
        declared: pkg.documentsDeclared,
        validFiles: pkg.documents.length,
        totalBytes: pkg.documents.reduce(
          (sum, item) => sum + item.sizeBytes,
          0,
        ),
        duplicateHashes: pkg.warnings.filter(
          (item) => item.code === 'DUPLICATE_SHA256',
        ).length,
        issues: pkg.issues,
        warnings: pkg.warnings,
      },
      null,
      2,
    ),
  );
  if (pkg.issues.length) process.exitCode = 1;
}

export async function dryRun(pkg: PreparedPackage) {
  const prisma = new PrismaService();
  try {
    await prisma.$connect();
    const source = await prisma.corpusSourceSystem.findUnique({
      where: { code: pkg.source.code },
      select: { id: true },
    });
    const extIds = pkg.documents.map((doc) => externalIdentity(pkg, doc));
    const hashes = pkg.documents.map((doc) => doc.sha256);
    const existing: Array<{
      externalId: string | null;
      checksum: string;
      documentId: string;
      status: string;
    }> = [];
    if (source && extIds.length) {
      for (let index = 0; index < extIds.length; index += 500) {
        existing.push(
          ...(await prisma.corpusIngestionRecord.findMany({
            where: {
              sourceSystemId: source.id,
              externalId: { in: extIds.slice(index, index + 500) },
            },
            select: {
              externalId: true,
              checksum: true,
              documentId: true,
              status: true,
            },
          })),
        );
      }
    }
    const files: Array<{ sha256: string }> = [];
    for (let index = 0; index < hashes.length; index += 500) {
      files.push(
        ...(await prisma.corpusDocumentFile.findMany({
          where: { sha256: { in: hashes.slice(index, index + 500) } },
          select: { sha256: true },
        })),
      );
    }
    const byExternal = new Map<string, Set<string>>();
    for (const row of existing) {
      if (!row.externalId) continue;
      if (!byExternal.has(row.externalId))
        byExternal.set(row.externalId, new Set());
      byExternal.get(row.externalId)!.add(row.checksum);
    }
    let known = 0;
    let updates = 0;
    for (const [index, doc] of pkg.documents.entries()) {
      const priorHashes = byExternal.get(extIds[index]);
      if (priorHashes?.has(doc.sha256)) known += 1;
      else if (priorHashes?.size) updates += 1;
    }
    console.log(
      JSON.stringify(
        {
          status: pkg.issues.length ? 'PARTIAL_SUCCESS' : 'DRY_RUN',
          packageId: pkg.packageId,
          source: pkg.source.code,
          manifestSha256: pkg.manifestSha256,
          declared: pkg.documentsDeclared,
          validFiles: pkg.documents.length,
          new: pkg.documents.length - known - updates,
          alreadyKnown: known,
          possibleUpdates: updates,
          duplicateHashesInPackage: pkg.warnings.filter(
            (item) => item.code === 'DUPLICATE_SHA256',
          ).length,
          hashesAlreadyInCorpus: files.length,
          bytes: pkg.documents.reduce((sum, item) => sum + item.sizeBytes, 0),
          issues: pkg.issues,
          warnings: pkg.warnings,
          wouldWrite: false,
        },
        null,
        2,
      ),
    );
    if (pkg.issues.length) process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
}

export async function importPackage(
  pkg: PreparedPackage,
  args: PackageCommandArgs,
) {
  const retryPaths = args.retryReceipt
    ? await failedPaths(args.retryReceipt)
    : null;
  const selected = retryPaths
    ? pkg.documents.filter((item) => retryPaths.has(item.path))
    : pkg.documents;
  const prisma = new PrismaService();
  const storage = new LocalDocumentStorageAdapter();
  const ingestion = new CorpusIngestionService(prisma, storage);
  const runId = randomUUID();
  const receiptRoot = path.resolve(
    args.receiptDir ??
      path.join(pkg.root, '..', `${path.basename(pkg.root)}.bjc-receipts`),
  );
  const output = path.join(receiptRoot, pkg.packageId, runId);
  if (isInside(pkg.root, output))
    throw new Error(
      'El directorio de receipt no puede estar dentro del paquete recibido.',
    );
  const startedAt = new Date().toISOString();
  const entries: ReceiptEntry[] = [];
  let imported = 0;
  let skipped = 0;
  let failed = new Set(pkg.issues.map((issue) => issue.path ?? issue.code))
    .size;
  try {
    await prisma.$connect();
    for (const [index, doc] of selected.entries()) {
      const externalId = externalIdentity(pkg, doc);
      try {
        const item: DiscoveredDocument = {
          filename: doc.filename,
          externalId,
          externalUrl: doc.sourceUrl,
          sourceReference: doc.sourceReference,
          obtainedAt: new Date(),
          content: doc.content,
          mimeType: doc.mimeType,
          title: doc.title,
          documentType: doc.documentType,
          court: doc.court,
          chamber: doc.chamber,
          instance: doc.instance,
          caseNumber: doc.caseNumber,
          decisionDate: doc.decisionDate
            ? new Date(doc.decisionDate)
            : undefined,
          visibility: doc.visibility,
          metadata: doc.metadata,
          metadataOriginal: {
            ...doc.metadataOriginal,
            bjcPackage: {
              packageId: pkg.packageId,
              manifestSha256: pkg.manifestSha256,
              relativePath: doc.path,
              sourceCode: pkg.source.code,
            },
          },
        };
        const ingestOptions = {
          sourceCode: pkg.source.code,
          sourceName: pkg.source.name,
          sourceType: pkg.source.type,
        };
        const existingFile = await prisma.corpusDocumentFile.findFirst({
          where: { sha256: doc.sha256 },
          select: { id: true },
        });
        let outcome: IngestionOutcome = existingFile
          ? await ingestion.linkExisting(item, ingestOptions)
          : await ingestion.ingestOne(item, ingestOptions);
        let retried = false;
        if (
          outcome.reused &&
          ['FAILED', 'EXTRACTION_FAILED'].includes(outcome.status)
        ) {
          const retry = await ingestion.retryExtraction(outcome.documentId);
          outcome = {
            ...outcome,
            extractionId: retry.extractionId,
            status: retry.status,
          };
          retried = true;
        }
        if (
          outcome.status === 'FAILED' ||
          outcome.status === 'EXTRACTION_FAILED'
        )
          failed += 1;
        else if (outcome.reused && !retried) skipped += 1;
        else imported += 1;
        entries.push({
          path: doc.path,
          externalId,
          documentId: outcome.documentId,
          ingestionId: outcome.ingestionId,
          sha256: doc.sha256,
          status: outcome.status,
          reused: outcome.reused,
        });
      } catch (error) {
        failed += 1;
        entries.push({
          path: doc.path,
          externalId,
          sha256: doc.sha256,
          status: 'DOCUMENT_FAILED',
          reused: false,
          error:
            error instanceof Error
              ? error.message
              : 'Error de importación desconocido',
        });
      }
      if ((index + 1) % 100 === 0 || index + 1 === selected.length) {
        console.log(
          `PACKAGE_PROGRESS processed=${index + 1}/${selected.length} imported=${imported} skipped=${skipped} failed=${failed}`,
        );
      }
    }
  } finally {
    await prisma.$disconnect();
  }
  const finishedAt = new Date().toISOString();
  const receiptBase: ImportReceipt = {
    schemaVersion: '1.0',
    packageId: pkg.packageId,
    sourceCode: pkg.source.code,
    manifestSha256: pkg.manifestSha256,
    runId,
    startedAt,
    finishedAt,
    status:
      failed || pkg.issues.length
        ? imported || skipped
          ? 'PARTIAL_SUCCESS'
          : 'FAILED'
        : imported === 0 && skipped > 0
          ? 'ALREADY_IMPORTED'
          : 'SUCCESS',
    documentsTotal: pkg.documentsDeclared,
    imported,
    skipped,
    failed,
    duplicateHashes: pkg.warnings.filter(
      (item) => item.code === 'DUPLICATE_SHA256',
    ).length,
    validationIssues: pkg.issues,
    entries,
  };
  receiptBase.receiptSha256 = sha256(stableJson(receiptBase));
  await mkdir(output, { recursive: true });
  await writeFile(
    path.join(output, 'import-receipt.json'),
    `${stableJson(receiptBase)}\n`,
    { flag: 'wx' },
  );
  await writeFile(
    path.join(output, 'import-summary.md'),
    summaryMarkdown(receiptBase),
    { flag: 'wx' },
  );
  console.log(
    JSON.stringify(
      {
        ...receiptBase,
        receiptDir: output,
        partialValidationIssues: pkg.issues,
      },
      null,
      2,
    ),
  );
  if (failed || pkg.issues.length) process.exitCode = 1;
  return { receipt: receiptBase, receiptDir: output };
}

async function failedPaths(receiptPath: string) {
  const raw = JSON.parse(
    await readFile(path.resolve(receiptPath), 'utf8'),
  ) as ImportReceipt;
  return new Set(
    raw.entries
      .filter((entry) =>
        ['DOCUMENT_FAILED', 'FAILED', 'EXTRACTION_FAILED'].includes(
          entry.status,
        ),
      )
      .map((entry) => entry.path),
  );
}
async function statusCommand(args: PackageCommandArgs) {
  if (!args.packagePath)
    throw new Error('status requiere la ruta de import-receipt.json.');
  const receipt = JSON.parse(
    await readFile(path.resolve(args.packagePath), 'utf8'),
  ) as ImportReceipt;
  console.log(
    JSON.stringify(
      {
        ...receipt,
        retryablePaths: receipt.entries
          .filter((entry) => entry.error || entry.status === 'FAILED')
          .map((entry) => entry.path),
      },
      null,
      2,
    ),
  );
}
function externalIdentity(
  pkg: PreparedPackage,
  doc: PreparedPackage['documents'][number],
) {
  return doc.externalId ?? `package:${pkg.packageId}:${doc.path}`;
}
function summaryMarkdown(receipt: ImportReceipt) {
  return `# Import receipt ${receipt.packageId}\n\n- Estado: ${receipt.status}\n- Fuente: ${receipt.sourceCode}\n- Manifest SHA-256: \`${receipt.manifestSha256}\`\n- Receipt SHA-256: \`${receipt.receiptSha256}\`\n- Run ID: \`${receipt.runId}\`\n- Documentos procesados: ${receipt.documentsTotal}\n- Importados: ${receipt.imported}\n- Ya existentes: ${receipt.skipped}\n- Fallidos: ${receipt.failed}\n- Duplicados SHA en paquete: ${receipt.duplicateHashes}\n\n## Documentos\n\n| Ruta | Documento | SHA-256 | Estado | Reutilizado |\n|---|---|---|---|---:|\n${receipt.entries.map((entry) => `| ${entry.path.replace(/\|/gu, '\\|')} | ${entry.documentId ?? ''} | ${entry.sha256} | ${entry.status} | ${entry.reused ? 'sí' : 'no'} |`).join('\n')}\n`;
}
function isInside(root: string, target: string) {
  const relative = path.relative(path.resolve(root), path.resolve(target));
  return (
    relative === '' ||
    (!relative.startsWith('..') && !path.isAbsolute(relative))
  );
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
