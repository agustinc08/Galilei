import { createHash } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { LocalDocumentStorageAdapter } from '../../src/corpus/document-storage.adapter';
import { PrismaService } from '../../src/prisma/prisma.service';

const execFileAsync = promisify(execFile);
const workspaceRoot = path.resolve(process.cwd(), '..', '..');
const targetDocumentId = 'cmuz0ei0z01ohfg8vr2dswghg';
const expectedSha256 = '0708cd3d85100fc9376e8945cbea2bbbfa1b747cc035bf4f244fdf2f36e81a2b';
const tesseract = 'C:\\Program Files\\Tesseract-OCR\\tesseract.exe';
const tessdata = path.join(workspaceRoot, '_recovery-work', 'sprint9', 'ocr', 'tessdata');
const poppler = path.join(process.env.USERPROFILE ?? '', '.cache', 'codex-runtimes', 'codex-primary-runtime', 'dependencies', 'native', 'poppler', 'Library', 'bin');

async function main() {
  assertDevDatabase(process.env.DATABASE_URL);
  const outputRoot = path.join(workspaceRoot, '_recovery-work', 'sprint11', 'ocr');
  const tmpDir = path.join(outputRoot, 'tmp');
  await mkdir(tmpDir, { recursive: true });
  const prisma = new PrismaService();
  const storage = new LocalDocumentStorageAdapter();
  try {
    await prisma.$connect();
    const document = await prisma.corpusDocument.findUniqueOrThrow({ where: { id: targetDocumentId }, select: { latestExtraction: { select: { pages: { where: { pageNumber: { in: [1, 2] } }, orderBy: { pageNumber: 'asc' }, select: { pageNumber: true, text: true } } } }, files: { where: { mimeType: 'application/pdf' }, orderBy: { version: 'desc' }, take: 1, select: { storageKey: true, sha256: true } } } });
    const file = document.files[0];
    if (!file || file.sha256 !== expectedSha256 || document.latestExtraction?.pages.length !== 2) throw new Error('OCR_REFERENCE_SOURCE_MISMATCH');
    const spa = await readFile(path.join(tessdata, 'spa.traineddata'));
    const modelSha256 = createHash('sha256').update(spa).digest('hex');
    if (modelSha256 !== 'e2c1ffdad8b30f26c45d4017a9183d3a7f9aa69e59918be4f88b126fac99ab2c') throw new Error('OCR_MODEL_MISMATCH');
    const source = await storage.get(file.storageKey);
    if (createHash('sha256').update(source).digest('hex') !== expectedSha256) throw new Error('OCR_SOURCE_CHECKSUM_MISMATCH');
    const pdfPath = path.join(tmpDir, `${targetDocumentId}.pdf`);
    await writeFile(pdfPath, source, { flag: 'wx' });
    const configs = [
      { name: 'baseline-160dpi-psm6', dpi: 160, psm: 6, threshold: undefined },
      { name: 'resample-300dpi-psm6', dpi: 300, psm: 6, threshold: undefined },
      { name: 'resample-300dpi-psm4', dpi: 300, psm: 4, threshold: undefined },
      { name: 'resample-300dpi-sauvola-psm6', dpi: 300, psm: 6, threshold: '2' },
    ];
    const results: Array<{ page: number; config: string; cer: number; wer: number; referenceCharacters: number; recognizedCharacters: number; referenceWords: number; recognizedWords: number }> = [];
    for (const page of document.latestExtraction.pages) {
      const reference = normalizeForMetrics(page.text);
      for (const config of configs) {
        const prefix = path.join(tmpDir, `${page.pageNumber}-${config.name}`);
        await execFileAsync(path.join(poppler, 'pdftoppm.exe'), ['-f', String(page.pageNumber), '-l', String(page.pageNumber), '-r', String(config.dpi), '-gray', '-png', '-singlefile', pdfPath, prefix], { windowsHide: true, maxBuffer: 128 * 1024 });
        const imagePath = `${prefix}.png`;
        const args = [imagePath, 'stdout', '-l', 'spa', '--tessdata-dir', tessdata, '--psm', String(config.psm)];
        if (config.threshold) args.push('-c', `thresholding_method=${config.threshold}`);
        const recognized = normalizeForMetrics((await execFileAsync(tesseract, args, { windowsHide: true, maxBuffer: 4 * 1024 * 1024 })).stdout);
        results.push({ page: page.pageNumber, config: config.name, ...metrics(reference, recognized) });
        await rm(imagePath, { force: true });
      }
    }
    const report = { status: 'SPRINT11_OCR_TARGETED_EVALUATION_COMPLETE', documentId: targetDocumentId, sourceSha256: expectedSha256, pages: [1, 2], sourceOriginalVerifiedReadOnly: true, modelSha256, preprocessingVariants: configs.map(({ name, dpi, psm, threshold }) => ({ name, dpi, psm, threshold: threshold ?? 'default' })), results };
    const outputPath = path.join(outputRoot, 'targeted-outlier-evaluation.json');
    await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, { flag: 'wx' });
    console.log(JSON.stringify({ status: report.status, output: outputPath, modelSha256, results }, null, 2));
  } finally {
    await prisma.$disconnect();
    await rm(tmpDir, { recursive: true, force: true });
  }
}

function normalizeForMetrics(value: string) { return value.normalize('NFC').toLocaleLowerCase('es').replace(/\s+/gu, ' ').trim(); }
function metrics(reference: string, recognized: string) {
  const referenceChars = Array.from(reference.replace(/\s/gu, ''));
  const recognizedChars = Array.from(recognized.replace(/\s/gu, ''));
  const referenceWords = reference.split(/\s+/u).filter(Boolean);
  const recognizedWords = recognized.split(/\s+/u).filter(Boolean);
  const charEdits = levenshtein(referenceChars, recognizedChars);
  const wordEdits = levenshtein(referenceWords, recognizedWords);
  return { cer: rate(charEdits, referenceChars.length), wer: rate(wordEdits, referenceWords.length), referenceCharacters: referenceChars.length, recognizedCharacters: recognizedChars.length, referenceWords: referenceWords.length, recognizedWords: recognizedWords.length };
}
function rate(errors: number, total: number) { return total ? Number((errors / total).toFixed(4)) : 0; }
function levenshtein<T>(left: T[], right: T[]) {
  let previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let i = 1; i <= left.length; i += 1) {
    const next = new Array<number>(right.length + 1); next[0] = i;
    for (let j = 1; j <= right.length; j += 1) next[j] = Math.min(next[j - 1] + 1, previous[j] + 1, previous[j - 1] + (left[i - 1] === right[j - 1] ? 0 : 1));
    previous = next;
  }
  return previous[right.length];
}
function assertDevDatabase(raw?: string) {
  if (!raw) throw new Error('DEV_DATABASE_URL_MISSING');
  const target = new URL(raw);
  if (target.protocol !== 'postgresql:' || target.hostname !== '127.0.0.1' || target.port !== '55432' || target.pathname !== '/buscador_juridico_civil_dev' || target.username !== 'bjc_dev') throw new Error('DEV_DATABASE_TARGET_REJECTED');
}
if (require.main === module) main().catch((error) => {
  const message = error instanceof Error ? error.message : 'UNKNOWN_ERROR';
  console.error(/DEV_DATABASE|OCR_(?:REFERENCE|MODEL|SOURCE)/u.test(message) ? message : 'SPRINT11_OCR_EVALUATION_FAILED');
  process.exitCode = 1;
});
