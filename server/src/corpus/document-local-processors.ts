import { createHash } from 'node:crypto';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { readdirSync, statSync } from 'node:fs';
import {
  mkdtemp,
  mkdir,
  readFile,
  rm,
  stat,
  statfs,
  writeFile,
} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { pathToFileURL } from 'node:url';
import { hasValidLegacyWordOleHeader } from './document-format-detector';

const MAX_SOURCE_BYTES = 20 * 1024 * 1024;
const MAX_TESSERACT_OUTPUT_BYTES = 4 * 1024 * 1024;
const MAX_STDERR_BYTES = 8 * 1024;
const MAX_EXTRACTED_TEXT_CHARS = 10_000_000;
const OLE_SIGNATURE = Buffer.from('d0cf11e0a1b11ae1', 'hex');

export type LocalProcessorCapabilities = {
  enginePath: string | null;
  engineVersion: string | null;
  languages: string[];
  rendererPath: string | null;
  rendererVersion: string | null;
  officePath: string | null;
  ocrAvailable: boolean;
  docAvailable: boolean;
  ocrEnabled: boolean;
};

export type OcrPageResult = {
  pageNumber: number;
  text: string;
  confidence: number | null;
  fingerprint: string;
};

export type OcrRunResult = {
  pages: OcrPageResult[];
  provenance: Record<string, unknown>;
};

export class LocalDocumentProcessingError extends Error {
  constructor(
    readonly code: string,
    message = code,
  ) {
    super(message);
    this.name = 'LocalDocumentProcessingError';
  }
}

export type RuntimeConfig = {
  enginePath: string | null;
  rendererPath: string | null;
  tessdataDir: string | null;
  officePath: string | null;
  languages: string[];
  dpi: number;
  timeoutMs: number;
  minFreeDiskBytes: number;
  maxPages: number;
  tempDir: string;
  enabled: boolean;
};

export function resolveLocalProcessorConfig(): RuntimeConfig {
  const enginePath = resolveFile(
    process.env.OCR_ENGINE_PATH,
    path.join(
      process.env.ProgramFiles ?? 'C:\\Program Files',
      'Tesseract-OCR',
      'tesseract.exe',
    ),
    path.join(
      process.env.LOCALAPPDATA ?? '',
      'Programs',
      'Tesseract-OCR',
      'tesseract.exe',
    ),
    path.join(
      process.env.LOCALAPPDATA ?? '',
      'Programs',
      'GalileiRuntime',
      'tesseract',
      'tesseract.exe',
    ),
    findOnPath('tesseract.exe'),
    findOnPath('tesseract'),
  );
  const rendererPath = resolveFile(
    process.env.OCR_RENDERER_PATH,
    path.join(
      process.env.ProgramFiles ?? 'C:\\Program Files',
      'Poppler',
      'Library',
      'bin',
      'pdftoppm.exe',
    ),
    findOnPath('pdftoppm.exe'),
    findOnPath('pdftoppm'),
    findInstalledPoppler(),
  );
  const officePath = resolveOfficePath();
  const tessdataDir = resolveDirectory(
    process.env.OCR_TESSDATA_DIR,
    process.env.TESSDATA_PREFIX,
    path.join(
      process.env.LOCALAPPDATA ?? '',
      'Programs',
      'GalileiRuntime',
      'tessdata',
    ),
    enginePath ? path.join(path.dirname(enginePath), 'tessdata') : null,
  );
  const languageSetting = process.env.OCR_LANGUAGES?.trim() || 'spa';
  const languages = languageSetting
    .split('+')
    .map((language) => language.trim());

  return {
    enginePath,
    rendererPath,
    tessdataDir,
    officePath,
    languages,
    dpi: readIntegerEnv('OCR_DPI', 250, 100, 600),
    timeoutMs: readIntegerEnv('OCR_TIMEOUT_MS', 90_000, 1_000, 3_600_000),
    minFreeDiskBytes: readIntegerEnv(
      'OCR_MIN_FREE_DISK_BYTES',
      512 * 1024 * 1024,
      32 * 1024 * 1024,
      20 * 1024 * 1024 * 1024,
    ),
    maxPages: readIntegerEnv('OCR_MAX_PAGES', 2_000, 1, 10_000),
    tempDir: path.resolve(process.env.OCR_TEMP_DIR || os.tmpdir()),
    enabled: isOcrEnabled(),
  };
}

export function inspectLocalProcessors(
  config = resolveLocalProcessorConfig(),
): LocalProcessorCapabilities {
  const engineVersion = config.enginePath
    ? probe(config.enginePath, ['--version']).split(/\r?\n/u)[0].trim() || null
    : null;
  const languageOutput =
    config.enginePath && config.tessdataDir
      ? probe(config.enginePath, [
          '--list-langs',
          '--tessdata-dir',
          config.tessdataDir,
        ])
      : '';
  const installedLanguages = languageOutput
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => /^[a-z0-9_]+$/u.test(line));
  const rendererVersion = config.rendererPath
    ? probe(config.rendererPath, ['-v']).split(/\r?\n/u)[0].trim() || null
    : null;

  return {
    enginePath: config.enginePath,
    engineVersion,
    languages: installedLanguages,
    rendererPath: config.rendererPath,
    rendererVersion,
    officePath: config.officePath,
    ocrAvailable: Boolean(
      config.enginePath &&
      engineVersion &&
      config.rendererPath &&
      rendererVersion &&
      config.tessdataDir &&
      config.languages.length > 0 &&
      config.languages.every((language) =>
        installedLanguages.includes(language),
      ) &&
      installedLanguages.includes('spa'),
    ),
    docAvailable: Boolean(config.officePath),
    ocrEnabled: config.enabled,
  };
}

export class LocalPdfOcrProcessor {
  readonly config: RuntimeConfig;
  readonly capabilities: LocalProcessorCapabilities;

  constructor(config = resolveLocalProcessorConfig()) {
    this.config = config;
    this.capabilities = inspectLocalProcessors(config);
  }

  identity(dpi = this.config.dpi, languages = this.config.languages) {
    const { capabilities } = this;
    return [
      capabilities.engineVersion ?? 'engine-unavailable',
      capabilities.rendererVersion ?? 'renderer-unavailable',
      languages.join('+'),
      `dpi=${dpi}`,
      'psm=4',
      'oem=1',
    ].join(';');
  }

  fingerprint(
    fileSha256: string,
    pageNumbers: number[],
    dpi = this.config.dpi,
    languages = this.config.languages,
  ) {
    return createHash('sha256')
      .update(
        [
          fileSha256,
          [...pageNumbers].sort((a, b) => a - b).join(','),
          this.identity(dpi, languages),
        ].join('\0'),
      )
      .digest('hex');
  }

  async processPdf(
    content: Buffer,
    fileSha256: string,
    pageNumbers: number[],
    options: { dpi?: number; timeoutMs?: number; languages?: string[] } = {},
  ): Promise<OcrRunResult> {
    if (!this.config.enabled)
      throw new LocalDocumentProcessingError('OCR_DISABLED');
    if (!this.capabilities.enginePath || !this.capabilities.engineVersion)
      throw new LocalDocumentProcessingError('OCR_ENGINE_UNAVAILABLE');
    const languages = options.languages ?? this.config.languages;
    if (
      !languages.length ||
      !languages.every((language) =>
        this.capabilities.languages.includes(language),
      )
    )
      throw new LocalDocumentProcessingError('OCR_LANGUAGE_UNAVAILABLE');
    if (!this.capabilities.languages.includes('spa'))
      throw new LocalDocumentProcessingError('OCR_LANGUAGE_UNAVAILABLE');
    if (!this.capabilities.rendererPath || !this.capabilities.rendererVersion)
      throw new LocalDocumentProcessingError('OCR_RENDER_FAILED');
    if (!this.config.tessdataDir)
      throw new LocalDocumentProcessingError('OCR_LANGUAGE_UNAVAILABLE');
    if (
      content.byteLength > MAX_SOURCE_BYTES ||
      !content.subarray(0, 5).equals(Buffer.from('%PDF-'))
    )
      throw new LocalDocumentProcessingError('FILE_INVALID');
    if (
      pageNumbers.length === 0 ||
      pageNumbers.length > this.config.maxPages ||
      pageNumbers.some((page) => !Number.isInteger(page) || page < 1)
    )
      throw new LocalDocumentProcessingError('OCR_PAGE_LIMIT');

    const dpi = options.dpi ?? this.config.dpi;
    const timeoutMs = options.timeoutMs ?? this.config.timeoutMs;
    if (dpi < 100 || dpi > 600)
      throw new LocalDocumentProcessingError('OCR_CONFIGURATION_INVALID');

    await mkdir(this.config.tempDir, { recursive: true });
    await this.assertFreeDisk(this.config.tempDir);
    const workDir = await mkdtemp(
      path.join(this.config.tempDir, 'galilei-ocr-'),
    );
    const pdfPath = path.join(workDir, 'source.pdf');
    const results: OcrPageResult[] = [];
    try {
      await writeFile(pdfPath, content, { flag: 'wx' });
      for (const pageNumber of [...new Set(pageNumbers)].sort(
        (a, b) => a - b,
      )) {
        await this.assertFreeDisk(workDir);
        const imagePrefix = path.join(workDir, 'page');
        try {
          await runChild(
            this.capabilities.rendererPath,
            [
              '-f',
              String(pageNumber),
              '-l',
              String(pageNumber),
              '-r',
              String(dpi),
              '-png',
              '-singlefile',
              pdfPath,
              imagePrefix,
            ],
            timeoutMs,
            MAX_STDERR_BYTES,
          );
        } catch (error) {
          throw wrapProcessingError(error, 'OCR_RENDER_FAILED');
        }
        const imagePath = `${imagePrefix}.png`;
        const imageStat = await stat(imagePath).catch(() => null);
        if (
          !imageStat?.isFile() ||
          imageStat.size === 0 ||
          imageStat.size > 128 * 1024 * 1024
        )
          throw new LocalDocumentProcessingError('OCR_RENDER_FAILED');

        let tsv: string;
        const tsvConfigAvailable = isFileSync(
          path.join(this.config.tessdataDir, 'configs', 'tsv'),
        );
        try {
          const output = await runChild(
            this.capabilities.enginePath,
            [
              imagePath,
              'stdout',
              '--tessdata-dir',
              this.config.tessdataDir,
              '-l',
              languages.join('+'),
              '--oem',
              '1',
              '--psm',
              '4',
              ...(tsvConfigAvailable ? ['tsv'] : []),
            ],
            timeoutMs,
            MAX_STDERR_BYTES,
            MAX_TESSERACT_OUTPUT_BYTES,
          );
          tsv = output.stdout;
        } catch (error) {
          throw wrapProcessingError(error, 'OCR_FAILED');
        }
        const parsed = tsvConfigAvailable
          ? parseTesseractTsv(tsv)
          : { text: normalizeExtractedText(tsv), confidence: null };
        if (!isUsableOcrPage(parsed.text, parsed.confidence))
          throw new LocalDocumentProcessingError('OCR_LOW_QUALITY');

        results.push({
          pageNumber,
          text: parsed.text,
          confidence: parsed.confidence,
          fingerprint: createHash('sha256')
            .update(
              [fileSha256, pageNumber, this.identity(dpi, languages)].join(
                '\0',
              ),
            )
            .digest('hex'),
        });
        await rm(imagePath, { force: true });
      }
      return {
        pages: results,
        provenance: {
          fileSha256,
          engine: 'tesseract',
          enginePath: this.capabilities.enginePath,
          engineVersion: this.capabilities.engineVersion,
          renderer: 'poppler-pdftoppm',
          rendererPath: this.capabilities.rendererPath,
          rendererVersion: this.capabilities.rendererVersion,
          languages,
          dpi,
          processorVersion: this.identity(dpi, languages),
          pageNumbers: results.map((page) => page.pageNumber),
          pageFingerprints: results.map((page) => ({
            pageNumber: page.pageNumber,
            fingerprint: page.fingerprint,
            confidence: page.confidence,
          })),
          processedAt: new Date().toISOString(),
          warnings: [],
        },
      };
    } finally {
      await rm(workDir, { recursive: true, force: true });
    }
  }

  private async assertFreeDisk(directory: string) {
    const info = await statfs(directory).catch(() => null);
    if (!info)
      throw new LocalDocumentProcessingError('INSUFFICIENT_DISK_SPACE');
    const freeBytes = info.bavail * info.bsize;
    if (freeBytes < this.config.minFreeDiskBytes)
      throw new LocalDocumentProcessingError('INSUFFICIENT_DISK_SPACE');
  }
}

export type LegacyDocResult = {
  text: string;
  truncated: boolean;
  provenance: Record<string, unknown>;
};

export class LibreOfficeLegacyDocExtractor {
  async extract(content: Buffer, timeoutMs = 60_000): Promise<LegacyDocResult> {
    if (content.byteLength > MAX_SOURCE_BYTES)
      throw new LocalDocumentProcessingError('FILE_INVALID');
    if (
      !content.subarray(0, 8).equals(OLE_SIGNATURE) ||
      !hasValidLegacyWordOleHeader(content)
    )
      throw new LocalDocumentProcessingError('FILE_INVALID');
    if (containsMacroOrEmbeddedObjectMarker(content))
      throw new LocalDocumentProcessingError(
        'DOC_ACTIVE_OR_EMBEDDED_CONTENT_UNSUPPORTED',
      );
    const officePath = resolveOfficePath();
    if (!officePath)
      throw new LocalDocumentProcessingError('LEGACY_DOC_UNSUPPORTED');

    const workRoot = path.resolve(process.env.OCR_TEMP_DIR || os.tmpdir());
    await mkdir(workRoot, { recursive: true });
    const workDir = await mkdtemp(path.join(workRoot, 'galilei-doc-'));
    const profileDir = path.join(workDir, 'profile');
    const inputPath = path.join(workDir, 'source.doc');
    const outputPath = path.join(workDir, 'source.txt');
    try {
      await mkdir(profileDir, { recursive: true });
      await writeFile(inputPath, content, { flag: 'wx' });
      await writeLibreOfficeSafetyProfile(profileDir);
      const profileUrl = pathToFileURL(profileDir).href;
      const result = await runChild(
        officePath,
        [
          '--headless',
          '--nologo',
          '--nodefault',
          '--nolockcheck',
          '--norestore',
          '--nofirststartwizard',
          `-env:UserInstallation=${profileUrl}`,
          '--convert-to',
          'txt:Text',
          '--outdir',
          workDir,
          inputPath,
        ],
        timeoutMs,
        MAX_STDERR_BYTES,
      );
      const outputInfo = await stat(outputPath).catch(() => null);
      if (outputInfo && outputInfo.size > MAX_EXTRACTED_TEXT_CHARS * 4 + 4)
        throw new LocalDocumentProcessingError('DOC_OUTPUT_TOO_LARGE');
      const output = outputInfo ? await readFile(outputPath) : null;
      if (!output || output.byteLength === 0) {
        const diagnostic = `${result.stdout}\n${result.stderr}`.toLowerCase();
        if (/password|encrypted|encrypt|contraseñ|cifrad/u.test(diagnostic))
          throw new LocalDocumentProcessingError('ENCRYPTED_UNSUPPORTED');
        throw new LocalDocumentProcessingError('DOC_EXTRACTION_FAILED');
      }
      const decoded = new TextDecoder('utf-8', { fatal: true }).decode(output);
      const text = normalizeExtractedText(decoded);
      if (!text) throw new LocalDocumentProcessingError('EMPTY_EXTRACTED_TEXT');
      const truncated = text.length > MAX_EXTRACTED_TEXT_CHARS;
      return {
        text: truncated ? text.slice(0, MAX_EXTRACTED_TEXT_CHARS) : text,
        truncated,
        provenance: {
          fileSha256: createHash('sha256').update(content).digest('hex'),
          pageNumber: 1,
          extractor: 'LibreOffice-headless',
          extractorPath: officePath,
          extractorVersion: probe(officePath, ['--version'])
            .split(/\r?\n/u)[0]
            .trim(),
          outputFormat: 'TXT',
          macroSecurity: 'HIGH',
          remoteLinkUpdates: 'DISABLED',
          profile: 'ISOLATED_TEMPORARY',
          processedAt: new Date().toISOString(),
          warnings: [],
        },
      };
    } catch (error) {
      if (
        error instanceof LocalDocumentProcessingError &&
        error.code === 'PROCESS_TIMEOUT'
      )
        throw new LocalDocumentProcessingError('DOC_TIMEOUT');
      if (error instanceof LocalDocumentProcessingError) throw error;
      if (isTimeoutError(error))
        throw new LocalDocumentProcessingError('DOC_TIMEOUT');
      if (
        error instanceof Error &&
        /password|encrypted|encrypt|contraseñ|cifrad/iu.test(error.message)
      )
        throw new LocalDocumentProcessingError('ENCRYPTED_UNSUPPORTED');
      throw new LocalDocumentProcessingError('DOC_EXTRACTION_FAILED');
    } finally {
      await rm(workDir, { recursive: true, force: true });
    }
  }
}

function resolveOfficePath() {
  const programFiles = process.env.ProgramFiles ?? 'C:\\Program Files';
  return resolveFile(
    process.env.DOC_EXTRACTOR_PATH,
    path.join(programFiles, 'LibreOffice', 'program', 'soffice.com'),
    path.join(programFiles, 'LibreOffice', 'program', 'soffice.exe'),
    path.join(
      process.env.LOCALAPPDATA ?? '',
      'Programs',
      'LibreOffice',
      'program',
      'soffice.com',
    ),
    path.join(
      process.env.LOCALAPPDATA ?? '',
      'Programs',
      'GalileiRuntime',
      'libreoffice',
      'program',
      'soffice.com',
    ),
    findOnPath('soffice.com'),
    findOnPath('soffice.exe'),
  );
}

function resolveFile(...candidates: Array<string | null | undefined>) {
  return (
    candidates.find((candidate) => candidate && isFileSync(candidate)) ?? null
  );
}

function resolveDirectory(...candidates: Array<string | null | undefined>) {
  return (
    candidates.find((candidate) => candidate && isDirectorySync(candidate)) ??
    null
  );
}

function isFileSync(candidate: string) {
  try {
    return statSync(candidate).isFile();
  } catch {
    return false;
  }
}

function isDirectorySync(candidate: string) {
  try {
    return statSync(candidate).isDirectory();
  } catch {
    return false;
  }
}

function findOnPath(executable: string) {
  for (const directory of (process.env.PATH || '').split(path.delimiter)) {
    if (!directory) continue;
    const candidate = path.join(directory, executable);
    if (isFileSync(candidate)) return candidate;
  }
  return null;
}

function findInstalledPoppler() {
  const root = path.join(
    process.env.LOCALAPPDATA ?? '',
    'Programs',
    'GalileiRuntime',
    'poppler',
  );
  try {
    const versions = readdirSync(root, { withFileTypes: true })
      .filter((entry: { isDirectory(): boolean; name: string }) =>
        entry.isDirectory(),
      )
      .map((entry: { name: string }) => entry.name)
      .sort()
      .reverse();
    for (const version of versions) {
      const candidate = path.join(
        root,
        version,
        'Library',
        'bin',
        'pdftoppm.exe',
      );
      if (isFileSync(candidate)) return candidate;
    }
  } catch {
    return null;
  }
  return null;
}

function probe(executable: string, args: string[]) {
  const result = spawnSync(executable, args, {
    encoding: 'utf8',
    timeout: 4_000,
    windowsHide: true,
    shell: false,
    maxBuffer: 64 * 1024,
  });
  if (result.error || result.status !== 0) return '';
  return `${result.stdout || ''}${result.stderr || ''}`.slice(0, 64 * 1024);
}

function runChild(
  executable: string,
  args: string[],
  timeoutMs: number,
  maxStderrBytes: number,
  maxStdoutBytes = 1024 * 1024,
) {
  return new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
    let child: ChildProcess;
    try {
      child = spawn(executable, args, {
        windowsHide: true,
        shell: false,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch {
      reject(new LocalDocumentProcessingError('PROCESS_START_FAILED'));
      return;
    }
    const stdoutStream = child.stdout;
    const stderrStream = child.stderr;
    if (!stdoutStream || !stderrStream) {
      child.kill();
      reject(new LocalDocumentProcessingError('PROCESS_START_FAILED'));
      return;
    }
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let stdoutLength = 0;
    let stderrLength = 0;
    let timedOut = false;
    let outputExceeded = false;
    let terminationPromise: Promise<void> | undefined;
    const terminate = () => {
      terminationPromise ??= terminateProcessTree(child);
      return terminationPromise;
    };
    const timer = setTimeout(() => {
      timedOut = true;
      void terminate();
    }, timeoutMs);
    timer.unref?.();

    stdoutStream.on('data', (chunk: Buffer) => {
      stdoutLength += chunk.length;
      if (stdoutLength > maxStdoutBytes) {
        outputExceeded = true;
        void terminate();
        return;
      }
      stdout.push(Buffer.from(chunk));
    });
    stderrStream.on('data', (chunk: Buffer) => {
      if (stderrLength >= maxStderrBytes) return;
      const remaining = maxStderrBytes - stderrLength;
      const clipped = Buffer.from(chunk).subarray(0, remaining);
      stderr.push(clipped);
      stderrLength += clipped.length;
    });
    child.once('error', () => {
      clearTimeout(timer);
      reject(new LocalDocumentProcessingError('PROCESS_START_FAILED'));
    });
    child.once('close', (code: number | null) => {
      clearTimeout(timer);
      if (timedOut) {
        void terminate().then(() =>
          reject(new LocalDocumentProcessingError('PROCESS_TIMEOUT')),
        );
      } else if (outputExceeded) {
        void terminate().then(() =>
          reject(new LocalDocumentProcessingError('PROCESS_OUTPUT_TOO_LARGE')),
        );
      } else if (code !== 0) {
        reject(
          new LocalDocumentProcessingError(
            'PROCESS_EXIT_NONZERO',
            Buffer.concat(stderr).toString('utf8').slice(0, maxStderrBytes),
          ),
        );
      } else {
        resolve({
          stdout: Buffer.concat(stdout).toString('utf8'),
          stderr: Buffer.concat(stderr).toString('utf8'),
        });
      }
    });
  });
}

function terminateProcessTree(child: ChildProcess) {
  if (!child.pid) return Promise.resolve();
  child.kill();
  if (process.platform !== 'win32') return Promise.resolve();
  return new Promise<void>((resolve) => {
    const killer = spawn(
      'taskkill.exe',
      ['/PID', String(child.pid), '/T', '/F'],
      { windowsHide: true, shell: false, stdio: 'ignore' },
    );
    killer.once('error', () => resolve());
    killer.once('close', () => resolve());
  });
}

export function parseTesseractTsv(tsv: string) {
  const lineWords = new Map<string, string[]>();
  const confidences: number[] = [];
  for (const row of tsv.split(/\r?\n/u)) {
    const columns = row.split('\t');
    if (columns[0] !== '5' || columns.length < 12) continue;
    const confidence = Number(columns[10]);
    const word = columns.slice(11).join('\t').trim();
    if (!word) continue;
    const key = columns.slice(1, 5).join(':');
    const words = lineWords.get(key) ?? [];
    words.push(word);
    lineWords.set(key, words);
    if (Number.isFinite(confidence) && confidence >= 0)
      confidences.push(confidence);
  }
  const text = [...lineWords.values()]
    .map((words) => words.join(' '))
    .join('\n')
    .replace(/\n{3,}/gu, '\n\n')
    .trim();
  const confidence = confidences.length
    ? confidences.reduce((total, value) => total + value, 0) /
      confidences.length
    : null;
  return { text, confidence };
}

export function isUsableOcrPage(text: string, confidence: number | null) {
  const normalized = text.trim();
  const lettersAndNumbers = (normalized.match(/[\p{L}\p{N}]/gu) ?? []).length;
  const visible = (normalized.match(/[\p{L}\p{N}\p{P}\p{Z}\t\r\n]/gu) ?? [])
    .length;
  const qualityRatio = normalized.length > 0 ? visible / normalized.length : 0;
  if (lettersAndNumbers === 0 || qualityRatio < 0.4) return false;
  if (normalized.length < 8 && (confidence === null || confidence < 60))
    return false;
  return confidence === null || confidence >= 20;
}

export function normalizeExtractedText(value: string) {
  return value
    .replaceAll('\u0000', '')
    .replace(/\r\n?/gu, '\n')
    .replace(/[ \t]+\n/gu, '\n')
    .replace(/\n{3,}/gu, '\n\n')
    .trim();
}

function wrapProcessingError(error: unknown, fallback: string) {
  if (error instanceof LocalDocumentProcessingError) {
    if (error.code === 'PROCESS_TIMEOUT')
      return new LocalDocumentProcessingError('OCR_TIMEOUT');
    if (error.code === 'PROCESS_OUTPUT_TOO_LARGE')
      return new LocalDocumentProcessingError('OCR_OUTPUT_TOO_LARGE');
    if (error.code === 'PROCESS_START_FAILED')
      return new LocalDocumentProcessingError(
        fallback === 'OCR_RENDER_FAILED'
          ? 'OCR_RENDER_FAILED'
          : 'OCR_ENGINE_UNAVAILABLE',
      );
  }
  return new LocalDocumentProcessingError(fallback);
}

function containsMacroOrEmbeddedObjectMarker(content: Buffer) {
  const markers = [
    '_vba_project_cur',
    'vbaproject',
    'ole10native',
    'objectpool',
  ];
  const latin = content.toString('latin1').toLowerCase();
  const utf16 = content.toString('utf16le').toLowerCase();
  return markers.some(
    (marker) => latin.includes(marker) || utf16.includes(marker),
  );
}

async function writeLibreOfficeSafetyProfile(profileDir: string) {
  const userConfigDir = path.join(profileDir, 'user');
  await mkdir(userConfigDir, { recursive: true });
  const profile = `<?xml version="1.0" encoding="UTF-8"?>
<oor:items xmlns:oor="http://openoffice.org/2001/registry" xmlns:xs="http://www.w3.org/2001/XMLSchema" xmlns:install="http://openoffice.org/2004/installation">
  <item oor:path="/org.openoffice.Office.Common/Security/Scripting">
    <prop oor:name="MacroSecurityLevel" oor:op="fuse"><value>3</value></prop>
  </item>
  <item oor:path="/org.openoffice.Office.Common/Load/Save/Document">
    <prop oor:name="UpdateDocMode" oor:op="fuse"><value>0</value></prop>
  </item>
</oor:items>`;
  await writeFile(
    path.join(userConfigDir, 'registrymodifications.xcu'),
    profile,
    { encoding: 'utf8', flag: 'wx' },
  );
}

function isTimeoutError(error: unknown) {
  return (
    error instanceof LocalDocumentProcessingError &&
    error.code === 'PROCESS_TIMEOUT'
  );
}

function readIntegerEnv(
  name: string,
  fallback: number,
  minimum: number,
  maximum: number,
) {
  const value = Number.parseInt(process.env[name] ?? '', 10);
  return Number.isInteger(value)
    ? Math.min(maximum, Math.max(minimum, value))
    : fallback;
}

function isOcrEnabled() {
  const override = process.env.OCR_ENABLED?.trim().toLowerCase();
  if (override === 'true' || override === '1') return true;
  if (override === 'false' || override === '0') return false;
  return process.env.NODE_ENV !== 'production';
}
