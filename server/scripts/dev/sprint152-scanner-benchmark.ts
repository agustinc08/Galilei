import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { resolve } from 'node:path';
import {
  DocumentSourceScanner,
  type SourceFileSnapshot,
} from '../../src/corpus/document-source-scanner';

const root = resolve(process.cwd(), '..');
const scanner = new DocumentSourceScanner();

async function main() {
  const outputDir = resolve(root, '_recovery-work', 'sprint152');
  await mkdir(outputDir, { recursive: true });
  const rows: Array<Record<string, unknown>> = [];
  for (const count of [100, 1000, 5000]) {
    const fixtureRoot = await mkdtemp(
      path.join(tmpdir(), `galilei-sprint152-${count}-`),
    );
    try {
      const content = Buffer.alloc(128, 0x61);
      for (let index = 0; index < count; index += 1) {
        const bucket = path.join(fixtureRoot, `d${Math.floor(index / 250)}`);
        await mkdir(bucket, { recursive: true });
        await writeFile(path.join(bucket, `fixture-${index}.pdf`), content);
      }
      const firstStarted = performance.now();
      const first = await collect(fixtureRoot);
      const firstEnumerationMs = performance.now() - firstStarted;
      const secondStarted = performance.now();
      const second = await collect(fixtureRoot);
      const secondEnumerationMs = performance.now() - secondStarted;
      const compareStarted = performance.now();
      const previous = new Map(
        first.map((file) => [
          file.normalizedPath,
          `${file.sizeBytes}:${file.modifiedAt.getTime()}`,
        ]),
      );
      let unchanged = 0;
      let hashCount = 0;
      for (const file of second) {
        if (
          previous.get(file.normalizedPath) ===
          `${file.sizeBytes}:${file.modifiedAt.getTime()}`
        )
          unchanged += 1;
        else hashCount += 1;
      }
      const metadataComparisonMs = performance.now() - compareStarted;
      rows.push({
        files: count,
        mode: 'synthetic metadata-only; 128-byte fixture files; no PDF ingestion',
        firstScan: {
          filesSeen: first.length,
          enumerationMs: round(firstEnumerationMs),
          hashCount: 0,
          documentsReprocessed: 0,
        },
        unchangedScan: {
          filesSeen: second.length,
          enumerationMs: round(secondEnumerationMs),
          metadataComparisonMs: round(metadataComparisonMs),
          unchanged,
          hashCount,
          documentsReprocessed: 0,
          totalDurationMs: round(secondEnumerationMs + metadataComparisonMs),
        },
      });
    } finally {
      await rm(fixtureRoot, { recursive: true, force: true });
    }
  }
  await writeFile(
    resolve(outputDir, 'scanner-benchmark.json'),
    `${JSON.stringify({ generatedAt: new Date().toISOString(), synthetic: true, results: rows }, null, 2)}\n`,
    'utf8',
  );
  console.log(JSON.stringify(rows, null, 2));
}

async function collect(rootPath: string) {
  const files: SourceFileSnapshot[] = [];
  for await (const file of scanner.enumerate(rootPath, () => undefined))
    files.push(file);
  return files;
}

function round(value: number) {
  return Math.round(value * 100) / 100;
}

void main().catch((error) => {
  console.error(
    error instanceof Error ? error.message : 'SCANNER_BENCHMARK_FAILED',
  );
  process.exitCode = 1;
});
