import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { BasicDocumentTextExtractor, InvalidPdfError } from '../../src/corpus/document-text-extractor';
import { PrismaService } from '../../src/prisma/prisma.service';

const workspaceRoot = path.resolve(process.cwd(), '..', '..');
const sourceRoot = path.join(workspaceRoot, 'digesto', 'server', 'pdfs');
const reportRoot = path.join(workspaceRoot, '_recovery-work', 'sprint10', 'digesto');

async function main() {
  const extractor = new BasicDocumentTextExtractor();
  const entries = (await readdir(sourceRoot, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith('.pdf'))
    .sort((a, b) => a.name.localeCompare(b.name, 'es'));
  const files: Array<Record<string, unknown> & { sha256: string; relativePath: string }> = [];
  for (const entry of entries) {
    const fullPath = path.join(sourceRoot, entry.name);
    const [content, info] = await Promise.all([readFile(fullPath), stat(fullPath)]);
    const sha256 = createHash('sha256').update(content).digest('hex');
    let result: Record<string, unknown>;
    try {
      const extracted = await extractor.extract(entry.name, 'application/pdf', content);
      result = {
        validity: 'VALID',
        extractionStatus: extracted.status,
        pages: extracted.pages.length,
        characters: extracted.text.length,
        words: extracted.text.split(/\s+/u).filter(Boolean).length,
      };
    } catch (error) {
      result = {
        validity: error instanceof InvalidPdfError ? 'INVALID_PDF' : 'EXTRACTION_FAILED',
        errorType: error instanceof Error ? error.name : 'unknown',
      };
    }
    files.push({
      relativePath: entry.name,
      sha256,
      sizeBytes: info.size,
      modifiedAt: info.mtime.toISOString(),
      ...result,
    });
  }

  const byHash = new Map<string, typeof files>();
  for (const file of files) byHash.set(file.sha256, [...(byHash.get(file.sha256) ?? []), file]);
  const prisma = new PrismaService();
  try {
    await prisma.$connect();
    const hashes = [...byHash.keys()];
    const existing = await prisma.corpusDocumentFile.findMany({
      where: { sha256: { in: hashes } },
      select: { sha256: true, documentId: true, document: { select: { visibility: true, status: true } } },
    });
    const existingByHash = new Map<string, typeof existing>();
    for (const item of existing) existingByHash.set(item.sha256, [...(existingByHash.get(item.sha256) ?? []), item]);
    const metadataFiles = (await readdir(path.join(workspaceRoot, 'digesto'), { withFileTypes: true }))
      .filter((entry) => entry.isFile() && /\.(csv|json|xml|sqlite|sqlite3|db|sql)$/iu.test(entry.name))
      .map((entry) => entry.name);
    const totals = {
      physicalPdfs: files.length,
      bytes: files.reduce((total, file) => total + Number(file.sizeBytes), 0),
      uniqueHashes: byHash.size,
      duplicatePhysicalFiles: files.length - byHash.size,
      validPdfs: files.filter((file) => file.validity === 'VALID').length,
      invalidPdfs: files.filter((file) => file.validity === 'INVALID_PDF').length,
      extractionFailures: files.filter((file) => file.validity === 'EXTRACTION_FAILED').length,
      withText: files.filter((file) => file.extractionStatus === 'TEXT_EXTRACTED').length,
      ocrRequired: files.filter((file) => file.extractionStatus === 'OCR_REQUIRED').length,
      duplicateHashesWithinDigesto: [...byHash.values()].filter((group) => group.length > 1).length,
      physicalShaAlreadyInCorpus: files.filter((file) => existingByHash.has(file.sha256)).length,
      uniqueShaAlreadyInCorpus: hashes.filter((hash) => existingByHash.has(hash)).length,
      uniqueShaNewToCorpus: hashes.filter((hash) => !existingByHash.has(hash)).length,
      matchingCorpusFileRows: existing.length,
      metadataExportFilesAtDigestoRoot: metadataFiles,
    };
    const report = {
      status: 'DIGESTO_LOCAL_READ_ONLY_SCAN',
      generatedAt: new Date().toISOString(),
      source: 'digesto/server/pdfs',
      readOnly: true,
      databaseTarget: '127.0.0.1:55432/buscador_juridico_civil_dev',
      totals,
      existingMatches: [...existingByHash.entries()].map(([sha256, rows]) => ({
        sha256,
        corpusDocuments: [...new Set(rows.map((row) => row.documentId))],
        visibility: [...new Set(rows.map((row) => row.document.visibility))],
      })),
      files,
    };
    await mkdir(reportRoot, { recursive: true });
    const reportPath = path.join(reportRoot, 'local-scan.json');
    await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, { flag: 'w' });
    console.log(JSON.stringify({ ...report, reportPath }, null, 2));
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : 'DIGESTO_SCAN_FAILED');
  process.exitCode = 1;
});
