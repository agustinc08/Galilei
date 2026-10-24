import { createHash } from 'node:crypto';
import {
  lstat,
  readFile,
  readdir,
  realpath,
  stat,
  writeFile,
} from 'node:fs/promises';
import path from 'node:path';

export type PackageSource = {
  code: string;
  name: string;
  type: string;
  baseUrl?: string;
};
export type PackageDocument = {
  path: string;
  filename: string;
  content: Buffer;
  mimeType: 'application/pdf' | 'text/plain';
  sha256: string;
  sizeBytes: number;
  externalId?: string;
  sourceReference?: string;
  sourceUrl?: string;
  decisionDate?: string;
  caseNumber?: string;
  title?: string;
  court?: string;
  chamber?: string;
  instance?: string;
  documentType?: string;
  visibility: 'PUBLIC' | 'INTERNAL' | 'RESTRICTED';
  metadata: Record<string, unknown>;
  metadataOriginal: Record<string, unknown>;
};
export type PackageIssue = { path?: string; code: string; message: string };
export type PreparedPackage = {
  root: string;
  packageId: string;
  schemaVersion: string;
  source: PackageSource;
  generatedAt?: string;
  manifestSha256: string;
  manifestName: string;
  documentsDeclared: number;
  documents: PackageDocument[];
  issues: PackageIssue[];
  warnings: PackageIssue[];
};

type RawManifest = {
  schemaVersion?: unknown;
  packageId?: unknown;
  source?: unknown;
  generatedAt?: unknown;
  documents?: unknown;
};
const SUPPORTED_VERSION = '1.0';
const MAX_FILE_BYTES = 100 * 1024 * 1024;
const SHA256 = /^[a-f0-9]{64}$/iu;
const SAFE_CODE = /^[A-Z0-9][A-Z0-9_-]{1,63}$/u;

export class DocumentIngestionPackageValidator {
  async prepare(packagePath: string): Promise<PreparedPackage> {
    const root = await realpath(path.resolve(packagePath));
    const rootStat = await stat(root);
    if (!rootStat.isDirectory())
      throw new Error('PACKAGE_INVALID: se requiere un directorio de paquete.');
    const manifestPath = await this.findManifest(root);
    let manifest: RawManifest;
    let rawBytes: Buffer;
    let manifestName: string;
    if (manifestPath) {
      rawBytes = await readFile(manifestPath);
      manifestName = path.basename(manifestPath);
      try {
        manifest = JSON.parse(
          new TextDecoder('utf-8').decode(rawBytes).replace(/^\uFEFF/u, ''),
        ) as RawManifest;
      } catch {
        throw new Error('PACKAGE_INVALID: manifest JSON inválido o no UTF-8.');
      }
    } else {
      const csvPath = path.join(root, 'metadata.csv');
      if (await exists(csvPath)) {
        const generated = await this.generateFromCsv(root, csvPath);
        manifest = generated.manifest;
        rawBytes = Buffer.from(stableJson(manifest), 'utf8');
        manifestName = 'metadata.csv (manifest derivado)';
        const prepared = await this.validateManifest(
          root,
          manifest,
          rawBytes,
          manifestName,
        );
        prepared.warnings.push(...generated.warnings);
        return prepared;
      }
      const generated = await this.generateFromFolder(root);
      manifest = generated.manifest;
      rawBytes = Buffer.from(stableJson(manifest), 'utf8');
      manifestName = 'manifest.generated.json (borrador en memoria)';
    }
    return this.validateManifest(root, manifest, rawBytes, manifestName);
  }

  async writeDraft(packagePath: string): Promise<string> {
    const root = await realpath(path.resolve(packagePath));
    const existing = await this.findManifest(root);
    if (existing) return existing;
    const csvPath = path.join(root, 'metadata.csv');
    const generated = (await exists(csvPath))
      ? await this.generateFromCsv(root, csvPath)
      : await this.generateFromFolder(root);
    const generatedAt =
      'generatedAt' in generated.manifest
        ? generated.manifest.generatedAt
        : undefined;
    const manifest = {
      ...generated.manifest,
      generatedAt: generatedAt ?? new Date().toISOString(),
    };
    const draftPath = path.join(root, 'manifest.generated.json');
    await writeFile(draftPath, `${stableJson(manifest)}\n`, { flag: 'wx' });
    return draftPath;
  }

  private async findManifest(root: string): Promise<string | null> {
    for (const name of ['manifest.json', 'manifest.generated.json']) {
      const filePath = path.join(root, name);
      try {
        const info = await lstat(filePath);
        if (!info.isFile() || info.isSymbolicLink())
          throw new Error(
            'PACKAGE_INVALID: el manifest debe ser archivo regular.',
          );
        return filePath;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }
    }
    return null;
  }

  private async validateManifest(
    root: string,
    raw: RawManifest,
    manifestBytes: Buffer,
    manifestName: string,
  ): Promise<PreparedPackage> {
    if (raw.schemaVersion !== SUPPORTED_VERSION)
      throw new Error(
        `PACKAGE_INVALID: schemaVersion no soportada (esperada ${SUPPORTED_VERSION}).`,
      );
    const packageId =
      typeof raw.packageId === 'string' ? raw.packageId.trim() : '';
    if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{2,127}$/u.test(packageId))
      throw new Error(
        'PACKAGE_INVALID: packageId requerido (3–128 caracteres seguros).',
      );
    if (!Array.isArray(raw.documents))
      throw new Error('PACKAGE_INVALID: documents debe ser una lista.');
    const rawDocuments: unknown[] = raw.documents;
    if (rawDocuments.length > 50_000)
      throw new Error(
        'PACKAGE_INVALID: el paquete supera el límite de 50.000 documentos.',
      );
    const source = normalizeSource(raw.source);
    const generatedAt =
      typeof raw.generatedAt === 'string' &&
      !Number.isNaN(Date.parse(raw.generatedAt))
        ? raw.generatedAt
        : undefined;
    const prepared: PreparedPackage = {
      root,
      packageId,
      schemaVersion: SUPPORTED_VERSION,
      source,
      generatedAt,
      manifestSha256: sha256(manifestBytes),
      manifestName,
      documentsDeclared: rawDocuments.length,
      documents: [],
      issues: [],
      warnings: [],
    };
    const filesRoot = await this.filesRoot(
      root,
      manifestName.startsWith('manifest.generated') &&
        !(await exists(path.join(root, 'files')))
        ? root
        : path.join(root, 'files'),
    );
    const paths = new Set<string>();
    const externalIds = new Set<string>();
    const hashes = new Map<string, string>();
    for (let index = 0; index < rawDocuments.length; index += 1) {
      const item = rawDocuments[index];
      const label = `documents[${index}]`;
      if (!item || typeof item !== 'object' || Array.isArray(item)) {
        prepared.issues.push({
          path: label,
          code: 'INVALID_ENTRY',
          message: 'Cada entrada debe ser un objeto.',
        });
        continue;
      }
      const entry = item as Record<string, unknown>;
      const relativePath =
        typeof entry.path === 'string'
          ? entry.path
          : typeof entry.relativePath === 'string'
            ? entry.relativePath
            : '';
      const safeRelative = safePackagePath(relativePath);
      if (!safeRelative) {
        prepared.issues.push({
          path: label,
          code: 'UNSAFE_PATH',
          message: 'Ruta vacía, absoluta o con path traversal.',
        });
        continue;
      }
      const normalized = safeRelative.replace(/\\/gu, '/');
      if (paths.has(normalized)) {
        prepared.issues.push({
          path: normalized,
          code: 'DUPLICATE_PATH',
          message: 'La ruta aparece más de una vez.',
        });
        continue;
      }
      paths.add(normalized);
      const file = await this.readSafeFile(
        filesRoot,
        normalized,
        prepared.issues,
      );
      if (!file) continue;
      const mime = normalizeMime(entry.mimeType, normalized);
      if (!mime || !validContent(file.content, mime)) {
        prepared.issues.push({
          path: normalized,
          code: 'INVALID_CONTENT',
          message: 'Formato no permitido o contenido incompatible con PDF/TXT.',
        });
        continue;
      }
      const actualHash = sha256(file.content);
      if (
        typeof entry.sha256 === 'string' &&
        (!SHA256.test(entry.sha256) ||
          entry.sha256.toLowerCase() !== actualHash)
      ) {
        prepared.issues.push({
          path: normalized,
          code: 'HASH_MISMATCH',
          message: 'El SHA-256 declarado no coincide con el archivo.',
        });
        continue;
      }
      const externalId = optionalString(entry.externalId);
      if (externalId && externalIds.has(externalId)) {
        prepared.issues.push({
          path: normalized,
          code: 'DUPLICATE_EXTERNAL_ID',
          message: 'externalId repetido dentro del paquete.',
        });
        continue;
      }
      if (externalId) externalIds.add(externalId);
      const priorPath = hashes.get(actualHash);
      if (priorPath)
        prepared.warnings.push({
          path: normalized,
          code: 'DUPLICATE_SHA256',
          message: `Mismo contenido que ${priorPath}; se conserva la procedencia de ambas entradas.`,
        });
      else hashes.set(actualHash, normalized);
      const decisionDate = normalizeDate(
        entry.decisionDate ?? entry.fecha,
        normalized,
        prepared.warnings,
      );
      const visibility = ['PUBLIC', 'INTERNAL', 'RESTRICTED'].includes(
        String(entry.visibility),
      )
        ? (entry.visibility as PackageDocument['visibility'])
        : 'INTERNAL';
      prepared.documents.push({
        path: normalized,
        filename: optionalString(entry.filename) ?? path.basename(normalized),
        content: file.content,
        mimeType: mime,
        sha256: actualHash,
        sizeBytes: file.content.byteLength,
        externalId,
        sourceReference:
          optionalString(entry.sourceReference) ??
          optionalString(entry.caseNumber) ??
          optionalString(entry.expediente),
        sourceUrl: validHttpUrl(entry.sourceUrl),
        decisionDate,
        caseNumber:
          optionalString(entry.caseNumber) ?? optionalString(entry.expediente),
        title: optionalString(entry.title) ?? optionalString(entry.caratula),
        court: optionalString(entry.court) ?? optionalString(entry.tribunal),
        chamber:
          optionalString(entry.chamber) ??
          optionalString(entry.camara) ??
          optionalString(entry.sala) ??
          optionalString(entry.juzgado),
        instance:
          optionalString(entry.instance) ?? optionalString(entry.instancia),
        documentType:
          optionalString(entry.documentType) ??
          optionalString(entry.tipoDocumento),
        visibility,
        metadata: pickMetadata(entry),
        metadataOriginal:
          entry.metadataOriginal &&
          typeof entry.metadataOriginal === 'object' &&
          !Array.isArray(entry.metadataOriginal)
            ? (entry.metadataOriginal as Record<string, unknown>)
            : { ...entry },
      });
    }
    return prepared;
  }

  private async filesRoot(root: string, candidate: string) {
    const realRoot = await realpath(root);
    const realCandidate = await realpath(candidate).catch(() => null);
    if (!realCandidate)
      throw new Error('PACKAGE_INVALID: falta el directorio de archivos.');
    const relative = path.relative(realRoot, realCandidate);
    if (relative.startsWith('..') || path.isAbsolute(relative))
      throw new Error('PACKAGE_INVALID: files/ fuera del paquete.');
    return realCandidate;
  }

  private async readSafeFile(
    filesRoot: string,
    relative: string,
    issues: PackageIssue[],
  ) {
    const target = path.resolve(filesRoot, relative);
    if (!isWithin(filesRoot, target)) {
      issues.push({
        path: relative,
        code: 'UNSAFE_PATH',
        message: 'Ruta fuera de files/.',
      });
      return null;
    }
    try {
      const info = await lstat(target);
      if (!info.isFile() || info.isSymbolicLink())
        throw new Error('Archivo no regular.');
      if (info.size <= 0 || info.size > MAX_FILE_BYTES)
        throw new Error(
          `Tamaño fuera de rango (máx. ${MAX_FILE_BYTES} bytes).`,
        );
      const realTarget = await realpath(target);
      if (!isWithin(filesRoot, realTarget))
        throw new Error('Resolución fuera de files/.');
      const content = await readFile(realTarget);
      return { content };
    } catch (error) {
      issues.push({
        path: relative,
        code: 'FILE_UNAVAILABLE',
        message:
          error instanceof Error ? error.message : 'Archivo inaccesible.',
      });
      return null;
    }
  }

  private async generateFromFolder(root: string) {
    const existingFilesDir = path.join(root, 'files');
    const scanRoot = (await exists(existingFilesDir)) ? existingFilesDir : root;
    const found: Array<{ relative: string; content: Buffer }> = [];
    const visit = async (directory: string): Promise<void> => {
      const entries = await readdir(directory, { withFileTypes: true });
      for (const entry of entries.sort((a, b) =>
        a.name.localeCompare(b.name),
      )) {
        if (
          entry.isSymbolicLink() ||
          entry.name === 'manifest.json' ||
          entry.name === 'manifest.generated.json' ||
          entry.name.startsWith('.bjc-')
        )
          continue;
        const full = path.join(directory, entry.name);
        if (entry.isDirectory()) {
          await visit(full);
          continue;
        }
        if (!entry.isFile() || !/\.(pdf|txt)$/iu.test(entry.name)) continue;
        const content = await readFile(full);
        if (content.byteLength > 0 && content.byteLength <= MAX_FILE_BYTES)
          found.push({
            relative: path.relative(scanRoot, full).split(path.sep).join('/'),
            content,
          });
      }
    };
    await visit(scanRoot);
    const packageId = `folder-${sha256(Buffer.from(found.map((item) => `${item.relative}\0${sha256(item.content)}`).join('\n'))).slice(0, 24)}`;
    const documents = found.map(({ relative, content }) => ({
      path: relative,
      sha256: sha256(content),
      mimeType: relative.toLowerCase().endsWith('.pdf')
        ? 'application/pdf'
        : 'text/plain',
    }));
    return {
      scanRoot,
      manifest: {
        schemaVersion: SUPPORTED_VERSION,
        packageId,
        source: {
          code: 'INSTITUTIONAL_IMPORT',
          name: 'Institutional import (source unverified)',
          type: 'INSTITUTIONAL_IMPORT',
        },
        documents,
      },
    };
  }

  private async generateFromCsv(root: string, csvPath: string) {
    const bytes = await readFile(csvPath);
    let csv: string;
    let windowsEncoding = false;
    try {
      csv = new TextDecoder('utf-8', { fatal: true })
        .decode(bytes)
        .replace(/^\uFEFF/u, '');
    } catch {
      csv = new TextDecoder('windows-1252').decode(bytes);
      windowsEncoding = true;
    }
    const rows = parseCsv(csv);
    const headers = rows.shift()?.map((header) => header.trim()) ?? [];
    if (!headers.length || headers.some((header) => !header))
      throw new Error(
        'PACKAGE_INVALID: metadata.csv requiere encabezados no vacíos.',
      );
    if (new Set(headers).size !== headers.length)
      throw new Error(
        'PACKAGE_INVALID: metadata.csv contiene columnas duplicadas.',
      );
    const allowed = new Set([
      'filename',
      'relativePath',
      'path',
      'externalId',
      'sourceReference',
      'sourceUrl',
      'decisionDate',
      'fecha',
      'caseNumber',
      'expediente',
      'title',
      'caratula',
      'court',
      'tribunal',
      'chamber',
      'camara',
      'sala',
      'juzgado',
      'instance',
      'instancia',
      'documentType',
      'tipoDocumento',
      'visibility',
      'mimeType',
      'sha256',
    ]);
    const warnings: PackageIssue[] = [];
    if (windowsEncoding)
      warnings.push({
        code: 'CSV_WINDOWS_1252',
        message:
          'metadata.csv se decodificó como Windows-1252; se conservó el archivo original.',
      });
    for (const header of headers)
      if (!allowed.has(header))
        warnings.push({
          code: 'CSV_UNKNOWN_COLUMN',
          message: `Columna adicional preservada como metadata original: ${header}`,
        });
    const documents = rows
      .filter((row) => row.some(Boolean))
      .map((cells, rowIndex) => {
        const entry: Record<string, unknown> = {};
        headers.forEach((header, columnIndex) => {
          entry[header] = cells[columnIndex] ?? '';
        });
        const filePathValue = [
          entry.relativePath,
          entry.path,
          entry.filename,
        ].find((value) => typeof value === 'string' && value.length > 0);
        const filePath =
          typeof filePathValue === 'string' ? filePathValue.trim() : '';
        return {
          ...entry,
          path: filePath,
          metadataOriginal: { ...entry },
          csvRow: rowIndex + 2,
        };
      });
    const mtime = (await stat(csvPath)).mtime.toISOString();
    const packageId = `csv-${sha256(bytes).slice(0, 24)}`;
    return {
      warnings,
      manifest: {
        schemaVersion: SUPPORTED_VERSION,
        packageId,
        source: {
          code: 'INSTITUTIONAL_IMPORT',
          name: 'Institutional import (source unverified)',
          type: 'INSTITUTIONAL_IMPORT',
        },
        generatedAt: mtime,
        documents,
      },
    };
  }
}

export function stableJson(value: unknown): string {
  const normalize = (input: unknown): unknown => {
    if (Array.isArray(input)) return input.map(normalize);
    if (
      input &&
      typeof input === 'object' &&
      !(input instanceof Date) &&
      !Buffer.isBuffer(input)
    ) {
      return Object.fromEntries(
        Object.entries(input as Record<string, unknown>)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([key, item]) => [key, normalize(item)]),
      );
    }
    return input;
  };
  return JSON.stringify(normalize(value), null, 2);
}
export function sha256(content: Buffer | string) {
  return createHash('sha256').update(content).digest('hex');
}
function normalizeSource(value: unknown): PackageSource {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    return {
      code: 'INSTITUTIONAL_IMPORT',
      name: 'Institutional import (source unverified)',
      type: 'INSTITUTIONAL_IMPORT',
    };
  const source = value as Record<string, unknown>;
  const code =
    optionalString(source.code)?.toUpperCase() ?? 'INSTITUTIONAL_IMPORT';
  if (!SAFE_CODE.test(code))
    throw new Error(
      'PACKAGE_INVALID: source.code contiene caracteres no permitidos.',
    );
  return {
    code,
    name:
      optionalString(source.name) ?? 'Institutional import (source unverified)',
    type: optionalString(source.type) ?? 'INSTITUTIONAL_IMPORT',
    baseUrl: validHttpUrl(source.baseUrl) ?? undefined,
  };
}
function safePackagePath(value: string) {
  const normalized = value.trim().replace(/\\/gu, '/');
  if (
    !normalized ||
    normalized.startsWith('/') ||
    /^[A-Za-z]:/u.test(normalized) ||
    normalized.includes('\0')
  )
    return null;
  if (
    normalized.split('/').some((part) => !part || part === '.' || part === '..')
  )
    return null;
  return normalized;
}
function isWithin(root: string, target: string) {
  const relative = path.relative(root, target);
  return (
    relative === '' ||
    (!relative.startsWith('..') && !path.isAbsolute(relative))
  );
}
function normalizeMime(
  value: unknown,
  filename: string,
): PackageDocument['mimeType'] | null {
  const inferred = filename.toLowerCase().endsWith('.pdf')
    ? 'application/pdf'
    : filename.toLowerCase().endsWith('.txt')
      ? 'text/plain'
      : null;
  const declared =
    typeof value === 'string'
      ? value.split(';')[0].trim().toLowerCase()
      : inferred;
  if (declared !== 'application/pdf' && declared !== 'text/plain') return null;
  if (inferred && declared !== inferred) return null;
  return declared;
}
function validContent(content: Buffer, mime: PackageDocument['mimeType']) {
  if (!content.length) return false;
  if (mime === 'application/pdf')
    return content.subarray(0, 5).toString('ascii') === '%PDF-';
  return !content.includes(0);
}
function optionalString(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}
function validHttpUrl(value: unknown) {
  if (typeof value !== 'string') return undefined;
  try {
    const url = new URL(value);
    return ['https:', 'http:'].includes(url.protocol)
      ? url.toString()
      : undefined;
  } catch {
    return undefined;
  }
}
function normalizeDate(value: unknown, file: string, warnings: PackageIssue[]) {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value !== 'string' || Number.isNaN(Date.parse(value))) {
    warnings.push({
      path: file,
      code: 'INVALID_DATE',
      message:
        'Fecha de decisión inválida; el documento se conserva sin fecha normalizada.',
    });
    return undefined;
  }
  return new Date(value).toISOString();
}
function pickMetadata(entry: Record<string, unknown>) {
  const aliases: Record<string, string> = {
    expediente: 'caseNumber',
    caratula: 'title',
    tribunal: 'court',
    camara: 'chamber',
    sala: 'chamber',
    juzgado: 'chamber',
    instancia: 'instance',
    tipoDocumento: 'documentType',
    fecha: 'decisionDate',
  };
  const metadata: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(entry)) {
    if (
      [
        'path',
        'relativePath',
        'filename',
        'sha256',
        'mimeType',
        'externalId',
        'visibility',
        'sourceUrl',
        'sourceReference',
      ].includes(key)
    )
      continue;
    metadata[aliases[key] ?? key] = value;
  }
  return metadata;
}
function parseCsv(input: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let index = 0; index < input.length; index += 1) {
    const char = input[index];
    if (quoted) {
      if (char === '"' && input[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (char === '"') quoted = false;
      else field += char;
      continue;
    }
    if (char === '"' && field.length === 0) quoted = true;
    else if (char === ',') {
      row.push(field);
      field = '';
    } else if (char === '\n') {
      row.push(field.replace(/\r$/u, ''));
      rows.push(row);
      row = [];
      field = '';
    } else field += char;
  }
  if (quoted)
    throw new Error('PACKAGE_INVALID: comillas sin cerrar en metadata.csv.');
  if (field.length || row.length) {
    row.push(field.replace(/\r$/u, ''));
    rows.push(row);
  }
  return rows;
}
async function exists(filePath: string) {
  return stat(filePath).then(
    () => true,
    () => false,
  );
}
