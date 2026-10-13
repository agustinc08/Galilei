import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { LocalDocumentStorageAdapter } from '../../src/corpus/document-storage.adapter';
import { PrismaService } from '../../src/prisma/prisma.service';

const execFileAsync = promisify(execFile);
const workspaceRoot = path.resolve(process.cwd(), '..', '..');
const outputRoot = path.join(workspaceRoot, '_recovery-work', 'sprint10', 'ocr');
const tesseract = 'C:\\Program Files\\Tesseract-OCR\\tesseract.exe';
const tessdata = path.join(workspaceRoot, '_recovery-work', 'sprint9', 'ocr', 'tessdata');
const poppler = path.join(process.env.USERPROFILE ?? '', '.cache', 'codex-runtimes', 'codex-primary-runtime', 'dependencies', 'native', 'poppler', 'Library', 'bin');
const pdfInfo = path.join(poppler, 'pdfinfo.exe');
const pdfToPpm = path.join(poppler, 'pdftoppm.exe');
const modelSha256 = 'e2c1ffdad8b30f26c45d4017a9183d3a7f9aa69e59918be4f88b126fac99ab2c';

async function main() {
  const spaModel = await readFile(path.join(tessdata, 'spa.traineddata'));
  if (sha(spaModel) !== modelSha256) throw new Error('OCR_GROUND_TRUTH_SPANISH_MODEL_MISMATCH');
  const runId = `ground-truth-${randomUUID()}`;
  const runDir = path.join(outputRoot, runId);
  const tmpDir = path.join(runDir, 'tmp');
  await mkdir(tmpDir, { recursive: true });
  const prisma = new PrismaService();
  const storage = new LocalDocumentStorageAdapter();
  try {
    await prisma.$connect();
    const candidates = await prisma.corpusDocument.findMany({
      where: { status: 'INDEXED', visibility: { in: ['INTERNAL', 'PUBLIC'] }, ingestions: { some: { sourceSystem: { is: { code: 'DIGESTO_LOCAL' } } } }, latestExtractionId: { not: null } },
      orderBy: [{ id: 'asc' }],
      take: 500,
      select: { id: true, latestExtraction: { select: { extractor: true, pages: { orderBy: { pageNumber: 'asc' }, select: { pageNumber: true, text: true } } } }, files: { where: { mimeType: 'application/pdf' }, orderBy: { version: 'desc' }, take: 1, select: { storageKey: true, sha256: true, sizeBytes: true } } },
    });
    const sample: Array<{ documentId: string; originalSha256: string; pageNumber: number; reference: string; imagePath: string }> = [];
    for (const candidate of candidates.sort((a, b) => (a.files[0]?.sha256 ?? '').localeCompare(b.files[0]?.sha256 ?? '') || a.id.localeCompare(b.id))) {
      const file = candidate.files[0];
      const extraction = candidate.latestExtraction;
      if (!file || !extraction || extraction.extractor.toLowerCase().includes('tesseract') || Number(file.sizeBytes) > 25 * 1024 * 1024) continue;
      const pages = extraction.pages.filter((page) => page.text.trim().length >= 80).slice(0, 2);
      if (!pages.length) continue;
      const content = await storage.get(file.storageKey);
      if (sha(content) !== file.sha256) throw new Error(`OCR_GROUND_TRUTH_SOURCE_CHECKSUM_MISMATCH:${candidate.id}`);
      const documentDir = path.join(tmpDir, candidate.id);
      await mkdir(documentDir, { recursive: true });
      const pdfPath = path.join(documentDir, 'source.pdf');
      await writeFile(pdfPath, content, { flag: 'wx' });
      const info = await execFileAsync(pdfInfo, [pdfPath], { windowsHide: true, maxBuffer: 128 * 1024 });
      const pageCount = Number(info.stdout.match(/^Pages:\s+(\d+)/mu)?.[1] ?? 0);
      for (const page of pages) {
        if (page.pageNumber > pageCount) continue;
        const prefix = path.join(documentDir, `page-${page.pageNumber}`);
        await execFileAsync(pdfToPpm, ['-f', String(page.pageNumber), '-l', String(page.pageNumber), '-r', '160', '-gray', '-png', pdfPath, prefix], { windowsHide: true, maxBuffer: 128 * 1024 });
        const imageName = (await readdir(documentDir)).find((name) => name.startsWith(`page-${page.pageNumber}-`) && name.toLowerCase().endsWith('.png'));
        if (!imageName) throw new Error(`OCR_GROUND_TRUTH_RENDER_MISSING:${candidate.id}:${page.pageNumber}`);
        sample.push({ documentId: candidate.id, originalSha256: file.sha256, pageNumber: page.pageNumber, reference: page.text, imagePath: path.join(documentDir, imageName) });
        if (sample.length >= 20) break;
      }
      if (sample.length >= 20) break;
    }
    if (sample.length < 20) throw new Error(`OCR_GROUND_TRUTH_NEEDS_20_NATIVE_TEXT_PAGES:${sample.length}`);

    const pageResults: Array<Record<string, unknown>> = [];
    let charErrors = 0;
    let referenceCharacters = 0;
    let wordErrors = 0;
    let referenceWords = 0;
    const started = Date.now();
    for (const page of sample) {
      const result = await execFileAsync(tesseract, [page.imagePath, 'stdout', '-l', 'spa', '--tessdata-dir', tessdata, '--psm', '6'], { windowsHide: true, maxBuffer: 4 * 1024 * 1024 });
      const expected = normalizeForMetrics(page.reference);
      const actual = normalizeForMetrics(result.stdout);
      const expectedCharacters = Array.from(expected.replace(/\s/gu, ''));
      const actualCharacters = Array.from(actual.replace(/\s/gu, ''));
      const charDistance = levenshtein(expectedCharacters, actualCharacters);
      const expectedWords = expected.split(/\s+/u).filter(Boolean);
      const actualWords = actual.split(/\s+/u).filter(Boolean);
      const wordDistance = levenshtein(expectedWords, actualWords);
      charErrors += charDistance;
      referenceCharacters += expectedCharacters.length;
      wordErrors += wordDistance;
      referenceWords += expectedWords.length;
      pageResults.push({ documentId: page.documentId, originalSha256: page.originalSha256, pageNumber: page.pageNumber, referenceCharacters: expectedCharacters.length, recognizedCharacters: actualCharacters.length, characterEdits: charDistance, cer: rate(charDistance, expectedCharacters.length), referenceWords: expectedWords.length, recognizedWords: actualWords.length, wordEdits: wordDistance, wer: rate(wordDistance, expectedWords.length) });
    }
    const report = {
      status: 'OCR_GROUND_TRUTH_MEASURED',
      runId,
      method: 'Native text layer of the exact source PDF is the reference; rasterized original PDF pages are OCR input.',
      sourceDocuments: new Set(sample.map((page) => page.documentId)).size,
      pages: sample.length,
      language: 'spa',
      tool: 'Tesseract OCR',
      toolVersion: (await execFileAsync(tesseract, ['--version'], { windowsHide: true })).stdout.split(/\r?\n/u)[0],
      modelSha256,
      rendererVersion: (await execFileAsync(pdfInfo, ['-v'], { windowsHide: true })).stderr.trim().split(/\r?\n/u)[0] ?? 'Poppler',
      renderDpi: 160,
      cer: rate(charErrors, referenceCharacters),
      wer: rate(wordErrors, referenceWords),
      referenceCharacters,
      recognizedCharacters: pageResults.reduce((sum, item) => sum + Number(item.recognizedCharacters), 0),
      characterEditCount: charErrors,
      referenceWords,
      recognizedWords: pageResults.reduce((sum, item) => sum + Number(item.recognizedWords), 0),
      wordEditCount: wordErrors,
      elapsedMs: Date.now() - started,
      sourceOriginalsVerifiedReadOnly: true,
      pagesByDocument: pageResults,
    };
    await writeFile(path.join(runDir, 'ground-truth-report.json'), `${JSON.stringify(report, null, 2)}\n`, { flag: 'wx' });
    console.log(JSON.stringify(report, null, 2));
  } finally {
    await prisma.$disconnect();
    await rm(tmpDir, { recursive: true, force: true });
  }
}

function normalizeForMetrics(value: string) { return value.normalize('NFC').toLocaleLowerCase('es').replace(/\s+/gu, ' ').trim(); }
function rate(errors: number, total: number) { return total ? Number((errors / total).toFixed(4)) : 0; }
function sha(value: Buffer) { return createHash('sha256').update(value).digest('hex'); }
function levenshtein<T>(left: T[], right: T[]): number {
  let previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let i = 1; i <= left.length; i += 1) {
    const next = new Array<number>(right.length + 1);
    next[0] = i;
    for (let j = 1; j <= right.length; j += 1) next[j] = Math.min(next[j - 1] + 1, previous[j] + 1, previous[j - 1] + (left[i - 1] === right[j - 1] ? 0 : 1));
    previous = next;
  }
  return previous[right.length];
}

if (require.main === module) main().catch((error) => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
