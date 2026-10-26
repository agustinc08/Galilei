import { inflateRawSync } from 'node:zlib';
import type { Readable } from 'node:stream';
import {
  buildResearchBundle,
  createResearchBundleZip,
  safeCollectionSlug,
  type ResearchBundleInput,
} from './research-bundle.util';

function crc32(buffer: Buffer) {
  let value = 0xffffffff;
  for (const byte of buffer) {
    value ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? (value >>> 1) ^ 0xedb88320 : value >>> 1;
    }
  }
  return (value ^ 0xffffffff) >>> 0;
}

function readZip(buffer: Buffer) {
  let eocd = -1;
  for (
    let offset = buffer.length - 22;
    offset >= Math.max(0, buffer.length - 65557);
    offset -= 1
  ) {
    if (buffer.readUInt32LE(offset) === 0x06054b50) {
      eocd = offset;
      break;
    }
  }
  if (eocd < 0) throw new Error('ZIP_EOCD_MISSING');
  const count = buffer.readUInt16LE(eocd + 10);
  let cursor = buffer.readUInt32LE(eocd + 16);
  const entries = new Map<string, Buffer>();
  for (let index = 0; index < count; index += 1) {
    if (buffer.readUInt32LE(cursor) !== 0x02014b50)
      throw new Error('ZIP_CENTRAL_DIRECTORY_INVALID');
    const method = buffer.readUInt16LE(cursor + 10);
    const expectedCrc = buffer.readUInt32LE(cursor + 16);
    const compressedSize = buffer.readUInt32LE(cursor + 20);
    const uncompressedSize = buffer.readUInt32LE(cursor + 24);
    const nameLength = buffer.readUInt16LE(cursor + 28);
    const extraLength = buffer.readUInt16LE(cursor + 30);
    const commentLength = buffer.readUInt16LE(cursor + 32);
    const localOffset = buffer.readUInt32LE(cursor + 42);
    const name = buffer
      .subarray(cursor + 46, cursor + 46 + nameLength)
      .toString('utf8');
    if (buffer.readUInt32LE(localOffset) !== 0x04034b50)
      throw new Error('ZIP_LOCAL_HEADER_INVALID');
    const localNameLength = buffer.readUInt16LE(localOffset + 26);
    const localExtraLength = buffer.readUInt16LE(localOffset + 28);
    const start = localOffset + 30 + localNameLength + localExtraLength;
    const compressed = buffer.subarray(start, start + compressedSize);
    const content =
      method === 8 ? inflateRawSync(Uint8Array.from(compressed)) : compressed;
    if (content.length !== uncompressedSize || crc32(content) !== expectedCrc)
      throw new Error('ZIP_ENTRY_CHECKSUM_INVALID');
    entries.set(name, content);
    cursor += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

async function collect(stream: Readable) {
  const chunks: Uint8Array[] = [];
  for await (const chunk of stream) {
    if (typeof chunk === 'string') chunks.push(Buffer.from(chunk));
    else if (chunk instanceof Uint8Array) chunks.push(Uint8Array.from(chunk));
    else throw new Error('UNEXPECTED_ZIP_STREAM_CHUNK');
  }
  return Buffer.concat(chunks);
}

function fixtureInput(count = 2): ResearchBundleInput {
  const createdAt = new Date('2026-01-01T00:00:00.000Z');
  return {
    collection: {
      id: 41,
      nombre: 'Responsabilidad <script>alert(1)</script> & Daño ñ 😀',
      createdAt,
      updatedAt: createdAt,
    },
    generatedAt: new Date('2026-10-26T12:00:00.000Z'),
    omittedItemCount: 1,
    judgments: Array.from({ length: count }, (_, index) => ({
      id: index + 1,
      slugPublico: `fallo-${index + 1}`,
      caratula:
        index === 0 ? '<img src=x onerror=alert(1)>' : `Caso ${index + 1}`,
      numeroSentencia: `${index + 1}/2026`,
      expediente: `${index + 1}/2020`,
      sala: 'A',
      fecha: new Date(
        `2026-02-${String((index % 28) + 1).padStart(2, '0')}T00:00:00.000Z`,
      ),
      tipoFallo: 'Sentencia',
      nota: index === 0 ? '<script>alert("nota")</script>\nnota privada' : null,
      addedAt: new Date(createdAt.getTime() + index * 1000),
    })),
  };
}

describe('reproducible research bundle', () => {
  it.each([
    ['../../test', 'test'],
    ['..\\..\\foo', 'foo'],
    ['CON', 'coleccion-9'],
    ['NUL', 'coleccion-9'],
    ['<script>alert(1)</script>', 'script-alert-1-script'],
    ['quotes " and \'', 'quotes-and'],
    ['área 😀 civil', 'area-civil'],
    ['\\..\\..\\file', 'file'],
  ])(
    'sanitizes collection name %s into a safe archive component',
    (name, expected) => {
      expect(safeCollectionSlug(name, 9)).toBe(expected);
    },
  );

  it('escapes offline HTML, hashes every generated data file, and creates a valid ZIP', async () => {
    const bundle = buildResearchBundle(fixtureInput());
    const index = bundle.files.find((file) =>
      file.path.endsWith('/INDEX.html'),
    )!;
    expect(index.content).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(index.content).toContain('&lt;img src=x onerror=alert(1)&gt;');
    expect(index.content).not.toContain('<script>alert(1)</script>');
    const note = bundle.files.find((file) => file.path.endsWith('/notas.md'))!;
    expect(note.content).toContain('```');
    expect(note.content.indexOf('<script>')).toBeGreaterThan(
      note.content.indexOf('```'),
    );
    expect(bundle.files.every((file) => !file.path.includes('..'))).toBe(true);
    expect(
      bundle.files.some((file) => file.path.toLowerCase().endsWith('.pdf')),
    ).toBe(false);

    const entries = readZip(
      await collect(createResearchBundleZip(bundle.files)),
    );
    const manifestPath = [...entries.keys()].find((path) =>
      path.endsWith('/manifest.json'),
    )!;
    const manifest = JSON.parse(
      entries.get(manifestPath)!.toString('utf8'),
    ) as {
      contents: { judgmentCount: number; noteCount: number };
      hashes: Record<string, string>;
    };
    expect([...entries.keys()]).toEqual(
      expect.arrayContaining([
        `${bundle.rootDirectory}/INDEX.html`,
        `${bundle.rootDirectory}/README.md`,
        `${bundle.rootDirectory}/collection.json`,
      ]),
    );
    expect(manifest.contents).toEqual({
      judgmentCount: 2,
      noteCount: 1,
      filesGenerated: 11,
    });
    for (const [path, hash] of Object.entries(manifest.hashes)) {
      const content = entries.get(path);
      expect(content).toBeDefined();
      expect(
        await import('node:crypto').then(({ createHash }) =>
          createHash('sha256').update(content!).digest('hex'),
        ),
      ).toBe(hash);
    }
  });

  it('handles a 100-item collection without embedding PDFs and keeps ordering stable', () => {
    const bundle = buildResearchBundle(fixtureInput(100));
    const ids = bundle.manifest.judgments.map((judgment) => judgment.id);
    expect(ids).toEqual(Array.from({ length: 100 }, (_, index) => index + 1));
    expect(bundle.manifest.contents.judgmentCount).toBe(100);
    expect(
      bundle.files.some((file) =>
        file.path.includes('fallos/sentencia-100/metadata.json'),
      ),
    ).toBe(true);
  });

  it('creates a valid empty-collection archive', async () => {
    const bundle = buildResearchBundle({
      ...fixtureInput(0),
      omittedItemCount: 0,
    });
    const entries = readZip(
      await collect(createResearchBundleZip(bundle.files)),
    );
    expect(bundle.manifest.contents).toMatchObject({
      judgmentCount: 0,
      noteCount: 0,
    });
    expect([...entries.keys()]).toHaveLength(4);
    expect(
      [...entries.keys()].some((path) => path.endsWith('/INDEX.html')),
    ).toBe(true);
  });

  it('adds a backward-compatible evolution context file and hashes it in the shared manifest', async () => {
    const input = fixtureInput();
    input.judgmentOrder = 'INPUT';
    input.judgments.reverse();
    input.evolution = {
      name: 'Línea de responsabilidad',
      selectedJudgmentIds: [2, 1],
      chronologicalSlugs: ['fallo-2', 'fallo-1'],
      relationTypes: ['VERIFIED_CITATION', 'SAME_EXPEDIENTE'],
      verifiedCitationEdges: [
        {
          sourceSlug: 'fallo-2',
          targetSlug: 'fallo-1',
          evidence: 'Cita institucional verificada',
          page: 7,
        },
      ],
      sameExpedienteGroups: [
        { expediente: 'CIV 12/2020', slugs: ['fallo-2', 'fallo-1'] },
      ],
    };
    const bundle = buildResearchBundle(input);
    const archive = await collect(createResearchBundleZip(bundle.files));
    const entries = readZip(archive);
    const evolutionPath = `${bundle.rootDirectory}/evolucion.json`;
    const evolution = JSON.parse(
      entries.get(evolutionPath)!.toString('utf8'),
    ) as {
      chronologicalSlugs: string[];
      selectedJudgmentIds: number[];
      relationTypes: string[];
    };
    const manifest = JSON.parse(
      entries.get(`${bundle.rootDirectory}/manifest.json`)!.toString('utf8'),
    ) as {
      schemaVersion: string;
      researchContext: {
        chronologicalSlugs: string[];
        relationTypes: string[];
      };
      hashes: Record<string, string>;
      contents: { filesGenerated: number };
    };
    expect(evolution).toMatchObject({
      chronologicalSlugs: ['fallo-2', 'fallo-1'],
      selectedJudgmentIds: [2, 1],
      relationTypes: ['VERIFIED_CITATION', 'SAME_EXPEDIENTE'],
    });
    expect(manifest.schemaVersion).toBe('galilei-research-bundle/1');
    expect(manifest.researchContext.chronologicalSlugs).toEqual([
      'fallo-2',
      'fallo-1',
    ]);
    expect(manifest.researchContext.relationTypes).toEqual([
      'VERIFIED_CITATION',
      'SAME_EXPEDIENTE',
    ]);
    expect(manifest.contents.filesGenerated).toBe(entries.size);
    expect(manifest.hashes[evolutionPath]).toBeDefined();
    expect(
      await import('node:crypto').then(({ createHash }) =>
        createHash('sha256').update(entries.get(evolutionPath)!).digest('hex'),
      ),
    ).toBe(manifest.hashes[evolutionPath]);
    expect(bundle.manifest.judgments.map((item) => item.id)).toEqual([2, 1]);
  });

  it('benchmarks a complete 100-judgment ZIP and verifies all bundled hashes', async () => {
    const startedAt = performance.now();
    const bundle = buildResearchBundle(fixtureInput(100));
    const archive = await collect(createResearchBundleZip(bundle.files));
    const entries = readZip(archive);
    const elapsedMs = Math.round(performance.now() - startedAt);
    const hashes = Object.entries(bundle.manifest.hashes);
    for (const [path, expectedHash] of hashes) {
      const content = entries.get(path);
      expect(content).toBeDefined();
      expect(
        await import('node:crypto').then(({ createHash }) =>
          createHash('sha256').update(content!).digest('hex'),
        ),
      ).toBe(expectedHash);
    }
    expect(entries.size).toBe(bundle.manifest.contents.filesGenerated);
    expect(entries.size).toBe(305);
    console.info(
      `RESEARCH_BUNDLE_BENCHMARK_100 ${JSON.stringify({ elapsedMs, zipBytes: archive.length, entries: entries.size })}`,
    );
  });
});
