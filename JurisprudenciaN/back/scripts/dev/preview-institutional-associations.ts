import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { PrismaService } from '../../src/prisma/prisma.service';

type InventoryFile = {
  rootId: string;
  relativePath: string;
  filename: string;
  sha256: string;
};
type Inventory = {
  scanId: string;
  roots: Array<{ id: string; relativePath: string }>;
  files: InventoryFile[];
};
type FileAssociation = {
  rootId: string;
  relativePath: string;
  sha256: string;
  confidence: 'EXACT' | 'HIGH_CONFIDENCE' | 'CANDIDATE' | 'UNRESOLVED';
  sentenceIds: number[];
  evidence: Array<{
    archivoPdfId?: number;
    sentenciaId: number;
    legacyId: string | null;
    strategy: string;
  }>;
  candidateSentenceIds: number[];
};

const workspaceRoot = path.resolve(process.cwd(), '..', '..');
const outputRoot = path.resolve(
  workspaceRoot,
  '_recovery-work',
  'sprint8',
  'inventory',
);

async function main() {
  const args = parseArgs();
  const inventoryPath = path.resolve(args[0] ?? '');
  if (!args[0])
    throw new Error('Uso: institutional-associations <ruta-inventory.json>');
  const inventory = JSON.parse(
    await readFile(inventoryPath, 'utf8'),
  ) as Inventory;
  const rootMap = new Map(
    inventory.roots.map((root) => [
      root.id,
      path.resolve(workspaceRoot, root.relativePath),
    ]),
  );
  const byAbsolutePath = new Map<string, InventoryFile>();
  const byBasename = new Map<string, InventoryFile[]>();
  const byStem = new Map<string, InventoryFile[]>();
  for (const file of inventory.files) {
    const rootPath = rootMap.get(file.rootId);
    if (!rootPath) continue;
    byAbsolutePath.set(
      normalizePath(path.resolve(rootPath, file.relativePath)),
      file,
    );
    const basename = file.filename.normalize('NFC').toLocaleLowerCase('en-US');
    if (!byBasename.has(basename)) byBasename.set(basename, []);
    byBasename.get(basename)!.push(file);
    const stem = normalizeIdentifier(
      path.basename(file.filename, path.extname(file.filename)),
    );
    if (!byStem.has(stem)) byStem.set(stem, []);
    byStem.get(stem)!.push(file);
  }
  const prisma = new PrismaService();
  try {
    await prisma.$connect();
    const rows = await prisma.archivoPdf.findMany({
      select: {
        id: true,
        legacyId: true,
        nombreArchivo: true,
        nombreOriginal: true,
        rutaArchivo: true,
        legacyPath: true,
        sentenciaId: true,
      },
    });
    const sentenceRows = await prisma.sentencia.findMany({
      select: {
        id: true,
        legacyId: true,
        legacyLink: true,
        numeroSentencia: true,
        expediente: true,
      },
    });
    const results = new Map<string, FileAssociation>();
    for (const file of inventory.files) {
      const key = `${file.rootId}\0${file.relativePath}`;
      results.set(key, {
        rootId: file.rootId,
        relativePath: file.relativePath,
        sha256: file.sha256,
        confidence: 'UNRESOLVED',
        sentenceIds: [],
        evidence: [],
        candidateSentenceIds: [],
      });
    }
    for (const row of rows) {
      const pathValues = [row.rutaArchivo, row.legacyPath].filter(
        (value): value is string => !!value?.trim(),
      );
      let matched: InventoryFile[] = [];
      let strategy = '';
      for (const value of pathValues) {
        const exact = exactPathCandidates(value, [...rootMap.values()])
          .map((candidate) => byAbsolutePath.get(normalizePath(candidate)))
          .filter((item): item is InventoryFile => !!item);
        if (exact.length) {
          matched = uniqueFiles(exact);
          strategy = 'EXACT_PATH';
          break;
        }
      }
      if (matched.length) {
        for (const file of matched) {
          const item = results.get(`${file.rootId}\0${file.relativePath}`)!;
          item.confidence = 'EXACT';
          item.sentenceIds.push(row.sentenciaId);
          item.evidence.push({
            archivoPdfId: row.id,
            sentenciaId: row.sentenciaId,
            legacyId: row.legacyId,
            strategy,
          });
        }
        continue;
      }
      const names = [row.nombreOriginal, row.nombreArchivo].filter(
        (value): value is string => !!value?.trim(),
      );
      const candidates = uniqueFiles(
        names.flatMap(
          (name) =>
            byBasename.get(
              path.basename(name).normalize('NFC').toLocaleLowerCase('en-US'),
            ) ?? [],
        ),
      );
      if (!candidates.length) continue;
      const sameHash =
        new Set(candidates.map((item) => item.sha256)).size === 1;
      const confidence =
        candidates.length === 1 || sameHash ? 'HIGH_CONFIDENCE' : 'CANDIDATE';
      for (const file of candidates) {
        const item = results.get(`${file.rootId}\0${file.relativePath}`)!;
        if (
          item.confidence === 'UNRESOLVED' ||
          (item.confidence === 'CANDIDATE' && confidence === 'HIGH_CONFIDENCE')
        )
          item.confidence = confidence;
        if (confidence === 'HIGH_CONFIDENCE') {
          item.sentenceIds.push(row.sentenciaId);
          item.evidence.push({
            archivoPdfId: row.id,
            sentenciaId: row.sentenciaId,
            legacyId: row.legacyId,
            strategy: 'UNIQUE_OR_SAME_HASH_FILENAME',
          });
        } else item.candidateSentenceIds.push(row.sentenciaId);
      }
    }
    const exactLegacyLinks = new Map<
      string,
      Array<{ sentenceId: number; legacyId: string | null }>
    >();
    const highLegacyIds = new Map<
      string,
      Array<{ sentenceId: number; legacyId: string | null }>
    >();
    const candidateLegacyIds = new Map<
      string,
      Array<{ sentenceId: number; legacyId: string | null }>
    >();
    for (const sentence of sentenceRows) {
      if (sentence.legacyLink?.trim()) {
        const linkedFiles = uniqueFiles(
          exactPathCandidates(sentence.legacyLink, [...rootMap.values()])
            .map((candidate) => byAbsolutePath.get(normalizePath(candidate)))
            .filter((item): item is InventoryFile => !!item),
        );
        if (linkedFiles.length) {
          for (const file of linkedFiles) {
            addMap(exactLegacyLinks, `${file.rootId}\0${file.relativePath}`, {
              sentenceId: sentence.id,
              legacyId: sentence.legacyId,
            });
          }
          continue;
        }
      }
      const idKeys = [sentence.legacyId, sentence.numeroSentencia].filter(
        (value): value is string => !!value?.trim(),
      );
      const exactIds = uniqueFiles(
        idKeys.flatMap((value) => byStem.get(normalizeIdentifier(value)) ?? []),
      );
      if (exactIds.length) {
        const hashes = new Set(exactIds.map((item) => item.sha256));
        for (const file of exactIds) {
          addMap(
            hashes.size === 1 ? highLegacyIds : candidateLegacyIds,
            `${file.rootId}\0${file.relativePath}`,
            { sentenceId: sentence.id, legacyId: sentence.legacyId },
          );
        }
        continue;
      }
      const linkedName = sentence.legacyLink?.trim()
        ? normalizeIdentifier(
            path.basename(
              sentence.legacyLink,
              path.extname(sentence.legacyLink),
            ),
          )
        : '';
      if (linkedName) {
        const namedFiles = uniqueFiles(byStem.get(linkedName) ?? []);
        if (namedFiles.length) {
          const hashes = new Set(namedFiles.map((item) => item.sha256));
          for (const file of namedFiles) {
            addMap(
              hashes.size === 1 ? highLegacyIds : candidateLegacyIds,
              `${file.rootId}\0${file.relativePath}`,
              { sentenceId: sentence.id, legacyId: sentence.legacyId },
            );
          }
          continue;
        }
      }
      const expediente = normalizeIdentifier(sentence.expediente ?? '');
      if (expediente.length >= 6) {
        for (const file of byStem.get(expediente) ?? []) {
          addMap(candidateLegacyIds, `${file.rootId}\0${file.relativePath}`, {
            sentenceId: sentence.id,
            legacyId: sentence.legacyId,
          });
        }
      }
    }
    for (const [key, matches] of exactLegacyLinks) {
      const item = results.get(key)!;
      item.confidence = 'EXACT';
      item.sentenceIds.push(...matches.map((match) => match.sentenceId));
      item.evidence.push(
        ...matches.map((match) => ({
          sentenciaId: match.sentenceId,
          legacyId: match.legacyId,
          strategy: 'SENTENCIA_LEGACY_LINK_EXACT',
        })),
      );
    }
    for (const [key, matches] of highLegacyIds) {
      const item = results.get(key)!;
      if (item.confidence !== 'EXACT') item.confidence = 'HIGH_CONFIDENCE';
      item.sentenceIds.push(...matches.map((match) => match.sentenceId));
      item.evidence.push(
        ...matches.map((match) => ({
          sentenciaId: match.sentenceId,
          legacyId: match.legacyId,
          strategy: 'EXACT_LEGACY_ID_OR_SENTENCE_NUMBER_FILENAME',
        })),
      );
    }
    for (const [key, matches] of candidateLegacyIds) {
      const item = results.get(key)!;
      if (item.confidence === 'UNRESOLVED') item.confidence = 'CANDIDATE';
      item.candidateSentenceIds.push(
        ...matches.map((match) => match.sentenceId),
      );
    }
    const files = [...results.values()].map((item) => ({
      ...item,
      sentenceIds: [...new Set(item.sentenceIds)],
      candidateSentenceIds: [...new Set(item.candidateSentenceIds)],
    }));
    const byConfidence = Object.fromEntries(
      ['EXACT', 'HIGH_CONFIDENCE', 'CANDIDATE', 'UNRESOLVED'].map((status) => [
        status,
        files.filter((file) => file.confidence === status).length,
      ]),
    );
    const uniqueHashes = new Map<string, FileAssociation['confidence']>();
    for (const file of files) {
      const prior = uniqueHashes.get(file.sha256);
      const confidence = prior
        ? stronger(prior, file.confidence)
        : file.confidence;
      uniqueHashes.set(file.sha256, confidence);
    }
    const summary = {
      schemaVersion: '1.0',
      scanId: inventory.scanId,
      reviewedAt: new Date().toISOString(),
      sourceRecords: rows.length,
      sentenceRecords: sentenceRows.length,
      sentencesWithLegacyId: sentenceRows.filter((row) => !!row.legacyId)
        .length,
      sentencesWithLegacyLink: sentenceRows.filter((row) => !!row.legacyLink)
        .length,
      physicalFiles: files.length,
      uniqueHashes: uniqueHashes.size,
      physicalFilesByConfidence: byConfidence,
      uniqueHashesByConfidence: Object.fromEntries(
        ['EXACT', 'HIGH_CONFIDENCE', 'CANDIDATE', 'UNRESOLVED'].map(
          (status) => [
            status,
            [...uniqueHashes.values()].filter((value) => value === status)
              .length,
          ],
        ),
      ),
      exactLinks: files.reduce(
        (sum, file) =>
          sum +
          file.evidence.filter(
            (entry) =>
              entry.strategy === 'EXACT_PATH' ||
              entry.strategy === 'SENTENCIA_LEGACY_LINK_EXACT',
          ).length,
        0,
      ),
      files,
    };
    const output = path.join(
      outputRoot,
      inventory.scanId,
      `association-preview-${Date.now()}.json`,
    );
    await mkdir(path.dirname(output), { recursive: true });
    await writeFile(output, `${JSON.stringify(summary, null, 2)}\n`, {
      flag: 'wx',
    });
    console.log(
      JSON.stringify(
        {
          status: 'ASSOCIATION_PREVIEW_COMPLETE',
          output,
          sourceRecords: rows.length,
          sentenceRecords: sentenceRows.length,
          sentencesWithLegacyId: summary.sentencesWithLegacyId,
          sentencesWithLegacyLink: summary.sentencesWithLegacyLink,
          physicalFiles: files.length,
          uniqueHashes: uniqueHashes.size,
          physicalFilesByConfidence: byConfidence,
          uniqueHashesByConfidence: summary.uniqueHashesByConfidence,
          exactLinks: summary.exactLinks,
        },
        null,
        2,
      ),
    );
  } finally {
    await prisma.$disconnect();
  }
}

function parseArgs(): string[] {
  const raw = process.env.BJC_INSTITUTIONAL_ARGS;
  if (raw) return JSON.parse(raw) as string[];
  return process.argv.slice(2);
}
function exactPathCandidates(value: string, roots: string[]) {
  const normalized = value.replace(/^file:\/\//iu, '').replace(/%20/giu, ' ');
  const candidates = [
    path.resolve(normalized),
    path.resolve(workspaceRoot, normalized),
    path.resolve(process.cwd(), normalized),
  ];
  if (!path.isAbsolute(normalized))
    for (const root of roots) candidates.push(path.resolve(root, normalized));
  return [...new Set(candidates)];
}
function normalizePath(value: string) {
  return path
    .resolve(value)
    .replace(/[\\/]+/gu, '\\')
    .toLocaleLowerCase('en-US');
}
function normalizeIdentifier(value: string) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/gu, '')
    .replace(/[^A-Za-z0-9]/gu, '')
    .toLocaleLowerCase('en-US');
}
function addMap<K, V>(map: Map<K, V[]>, key: K, value: V) {
  if (!map.has(key)) map.set(key, []);
  map.get(key)!.push(value);
}
function uniqueFiles(items: InventoryFile[]) {
  return [
    ...new Map(
      items.map((item) => [`${item.rootId}\0${item.relativePath}`, item]),
    ).values(),
  ];
}
function stronger(
  a: FileAssociation['confidence'],
  b: FileAssociation['confidence'],
): FileAssociation['confidence'] {
  const rank = { UNRESOLVED: 0, CANDIDATE: 1, HIGH_CONFIDENCE: 2, EXACT: 3 };
  return rank[a] >= rank[b] ? a : b;
}

if (require.main === module)
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
