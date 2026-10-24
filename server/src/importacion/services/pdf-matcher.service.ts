import { existsSync } from 'fs';
import { readdir } from 'fs/promises';
import { basename, extname, isAbsolute, join, relative, resolve } from 'path';
import {
  normalizeFilenameKey,
  normalizeNullableString,
} from '../utils/normalizadores';

type CandidateValue = string | undefined;

export type PdfFileEntry = {
  fullPath: string;
  relativePath: string;
  filename: string;
  filenameKey: string;
  pathKey: string;
  directoryKey: string;
};

export type PdfMatchStrategy =
  | 'legacy-link-exacto'
  | 'legacy-link-basename'
  | 'codigo-sentencia'
  | 'legacy-id'
  | 'expediente'
  | 'contiene-codigo'
  | 'contiene-legacy-id'
  | 'contiene-expediente';

export type PdfMatchResult = {
  file: PdfFileEntry;
  strategy: PdfMatchStrategy;
  candidatesCount: number;
};

export type PdfInspectionSummary = {
  totalPdfs: number;
  topLevelDirectories: Array<{ directory: string; total: number }>;
  samplePaths: string[];
  commonFilenames: Array<{ filename: string; total: number }>;
  detectedPatterns: Record<string, number>;
};

export class PdfMatcherService {
  private readonly files: PdfFileEntry[] = [];
  private readonly exactIndex = new Map<string, PdfFileEntry[]>();
  private readonly containsIndex: PdfFileEntry[] = [];

  private constructor(private readonly basePath: string) {}

  static async create(pdfBasePath: string) {
    const service = new PdfMatcherService(resolve(pdfBasePath));
    await service.walk(service.basePath);
    return service;
  }

  getAllFiles() {
    return this.files;
  }

  inspect(limit = 10): PdfInspectionSummary {
    const topLevelCount = new Map<string, number>();
    const filenamesCount = new Map<string, number>();
    const patterns = {
      numeric_filename: 0,
      contains_sen: 0,
      contains_expte: 0,
      nested_numeric_dir: 0,
    };

    for (const file of this.files) {
      const topDir = file.relativePath.split(/[\\/]/)[0] ?? '.';
      topLevelCount.set(topDir, (topLevelCount.get(topDir) ?? 0) + 1);
      filenamesCount.set(
        file.filename,
        (filenamesCount.get(file.filename) ?? 0) + 1,
      );

      if (/^\d+\.pdf$/i.test(file.filename)) {
        patterns.numeric_filename += 1;
      }
      if (/sen_/i.test(file.filename) || /sen_/i.test(file.relativePath)) {
        patterns.contains_sen += 1;
      }
      if (
        /expte|exped/i.test(file.filename) ||
        /expte|exped/i.test(file.relativePath)
      ) {
        patterns.contains_expte += 1;
      }
      if (/^\d+$/.test(topDir)) {
        patterns.nested_numeric_dir += 1;
      }
    }

    return {
      totalPdfs: this.files.length,
      topLevelDirectories: this.sortDirectoryCounts(topLevelCount).slice(
        0,
        limit,
      ),
      samplePaths: this.files.slice(0, limit).map((file) => file.relativePath),
      commonFilenames: this.sortFilenameCounts(filenamesCount).slice(0, limit),
      detectedPatterns: patterns,
    };
  }

  match(input: {
    explicitPdfPath?: CandidateValue;
    legacyLink?: CandidateValue;
    legacyId?: CandidateValue;
    numeroSentencia?: CandidateValue;
    expediente?: CandidateValue;
  }): PdfMatchResult | undefined {
    const explicitCandidates = [
      ...this.expandExplicitPath(input.explicitPdfPath),
      ...this.expandExplicitPath(input.legacyLink),
    ];

    for (const candidate of explicitCandidates) {
      const byExactPath = this.findExactByPath(candidate);
      if (byExactPath) {
        return byExactPath;
      }
    }

    for (const candidate of explicitCandidates) {
      const file = this.findByBasename(candidate);
      if (file) {
        return file;
      }
    }

    const normalizedNumeroSentencia = normalizeFilenameKey(
      input.numeroSentencia,
    );
    const normalizedLegacyId = normalizeFilenameKey(input.legacyId);
    const normalizedExpediente = normalizeFilenameKey(
      this.cleanExpediente(input.expediente),
    );

    const exactMatches: Array<[CandidateValue, PdfMatchStrategy]> = [
      [normalizedNumeroSentencia, 'codigo-sentencia'],
      [normalizedLegacyId, 'legacy-id'],
      [normalizedExpediente, 'expediente'],
    ];

    for (const [value, strategy] of exactMatches) {
      const match = value ? this.findExactByKey(value, strategy) : undefined;
      if (match) {
        return match;
      }
    }

    const containsMatches: Array<[CandidateValue, PdfMatchStrategy]> = [
      [normalizedNumeroSentencia, 'contiene-codigo'],
      [normalizedLegacyId, 'contiene-legacy-id'],
      [normalizedExpediente, 'contiene-expediente'],
    ];

    for (const [value, strategy] of containsMatches) {
      const match = value ? this.findContains(value, strategy) : undefined;
      if (match) {
        return match;
      }
    }

    return undefined;
  }

  private async walk(currentPath: string): Promise<void> {
    const entries = await readdir(currentPath, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = join(currentPath, entry.name);

      if (entry.isDirectory()) {
        await this.walk(fullPath);
        continue;
      }

      if (!entry.isFile() || extname(entry.name).toLowerCase() !== '.pdf') {
        continue;
      }

      const relativePath = relative(this.basePath, fullPath);
      const filename = entry.name;
      const filenameKey = normalizeFilenameKey(basename(filename, '.pdf'));
      const pathKey = normalizeFilenameKey(relativePath);
      const directoryKey = normalizeFilenameKey(
        relativePath.replace(filename, ''),
      );

      const file: PdfFileEntry = {
        fullPath,
        relativePath,
        filename,
        filenameKey,
        pathKey,
        directoryKey,
      };

      this.files.push(file);
      this.containsIndex.push(file);

      const keys = new Set([filenameKey, pathKey]);
      for (const key of keys) {
        if (!key) {
          continue;
        }
        const collection = this.exactIndex.get(key) ?? [];
        collection.push(file);
        this.exactIndex.set(key, collection);
      }
    }
  }

  private expandExplicitPath(value: CandidateValue) {
    const normalized = normalizeNullableString(value);
    if (!normalized) {
      return [];
    }

    const candidates = [normalized];
    if (!normalized.toLowerCase().endsWith('.pdf')) {
      candidates.push(`${normalized}.pdf`);
    }

    return candidates.map((candidate) =>
      isAbsolute(candidate)
        ? resolve(candidate)
        : resolve(this.basePath, candidate),
    );
  }

  private findExactByPath(candidate: string) {
    if (!existsSync(candidate)) {
      return undefined;
    }

    const relativePath = relative(this.basePath, candidate);
    const key = normalizeFilenameKey(relativePath);
    const matches = this.exactIndex.get(key) ?? [];
    const file = matches.find((item) => item.fullPath === resolve(candidate));

    return file
      ? {
          file,
          strategy: 'legacy-link-exacto' as const,
          candidatesCount: matches.length,
        }
      : undefined;
  }

  private findByBasename(candidate: string) {
    const key = normalizeFilenameKey(basename(candidate, extname(candidate)));
    const matches = this.exactIndex.get(key) ?? [];
    const file = matches[0];

    return file
      ? {
          file,
          strategy: 'legacy-link-basename' as const,
          candidatesCount: matches.length,
        }
      : undefined;
  }

  private findExactByKey(value: string, strategy: PdfMatchStrategy) {
    const matches = this.exactIndex.get(value) ?? [];
    const file = matches[0];

    return file
      ? { file, strategy, candidatesCount: matches.length }
      : undefined;
  }

  private findContains(value: string, strategy: PdfMatchStrategy) {
    const matches = this.containsIndex.filter(
      (file) =>
        file.filenameKey.includes(value) ||
        file.pathKey.includes(value) ||
        file.directoryKey.includes(value),
    );
    if (matches.length !== 1) {
      return undefined;
    }

    return {
      file: matches[0],
      strategy,
      candidatesCount: matches.length,
    };
  }

  private cleanExpediente(value: CandidateValue) {
    const normalized = normalizeNullableString(value);
    return normalized?.replace(/[^\dA-Za-z]/g, '') ?? undefined;
  }

  private sortDirectoryCounts(map: Map<string, number>) {
    return [...map.entries()]
      .map(([directory, total]) => ({ directory, total }))
      .sort(
        (a, b) => b.total - a.total || a.directory.localeCompare(b.directory),
      );
  }

  private sortFilenameCounts(map: Map<string, number>) {
    return [...map.entries()]
      .map(([filename, total]) => ({ filename, total }))
      .sort(
        (a, b) => b.total - a.total || a.filename.localeCompare(b.filename),
      );
  }
}
