import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { DocumentIngestionPackageValidator } from './document-ingestion-package';

describe('DocumentIngestionPackageValidator', () => {
  let root: string;
  let validator: DocumentIngestionPackageValidator;
  beforeEach(async () => {
    root = await mkdtemp(path.join(os.tmpdir(), 'bjc-package-'));
    await mkdir(path.join(root, 'files'));
    validator = new DocumentIngestionPackageValidator();
  });
  afterEach(async () => rm(root, { recursive: true, force: true }));

  it('validates a canonical manifest, calculates checksums, and warns on identical files', async () => {
    const bytes = Buffer.from('fixture plain text con ñ');
    await writeFile(path.join(root, 'files', 'a.txt'), bytes);
    await writeFile(path.join(root, 'files', 'b.txt'), bytes);
    await manifest(root, [
      {
        path: 'a.txt',
        filename: 'a.txt',
        mimeType: 'text/plain',
        externalId: 'stable-1',
        caseNumber: 'CIV 1/2025',
        decisionDate: '2025-01-02',
      },
      {
        path: 'b.txt',
        filename: 'b.txt',
        mimeType: 'text/plain',
        externalId: 'stable-2',
      },
    ]);
    const prepared = await validator.prepare(root);
    expect(prepared.issues).toEqual([]);
    expect(prepared.documents).toHaveLength(2);
    expect(prepared.documents[0].sha256).toMatch(/^[a-f0-9]{64}$/u);
    expect(prepared.documents[0].metadata.caseNumber).toBe('CIV 1/2025');
    expect(prepared.documents[0].decisionDate).toContain('2025-01-02');
    expect(prepared.warnings.map((item) => item.code)).toContain(
      'DUPLICATE_SHA256',
    );
  });

  it('rejects traversal, duplicate external IDs, and incorrect declared hashes before import', async () => {
    await writeFile(path.join(root, 'files', 'a.txt'), 'one');
    await writeFile(path.join(root, 'files', 'b.txt'), 'two');
    await writeFile(path.join(root, 'files', 'c.txt'), 'three');
    await manifest(root, [
      { path: 'a.txt', mimeType: 'text/plain', externalId: 'same' },
      { path: 'b.txt', mimeType: 'text/plain', externalId: 'same' },
      { path: 'c.txt', mimeType: 'text/plain', sha256: '0'.repeat(64) },
      { path: '../../outside.txt', mimeType: 'text/plain' },
    ]);
    const prepared = await validator.prepare(root);
    expect(prepared.documents).toHaveLength(1);
    expect(prepared.issues.map((item) => item.code)).toEqual(
      expect.arrayContaining([
        'HASH_MISMATCH',
        'DUPLICATE_EXTERNAL_ID',
        'UNSAFE_PATH',
      ]),
    );
  });

  it('supports UTF-8 BOM CSV metadata without mutating the CSV or file', async () => {
    await writeFile(path.join(root, 'files', 'fallo.txt'), 'contenido civil');
    const csv =
      '\uFEFFfilename,externalId,expediente,caratula,fecha,tribunal\r\nfallo.txt,exp-1,"CIV 1/2025","Peña, M. c/ Sol",2025-01-02,Juzgado Civil 1\r\n';
    await writeFile(path.join(root, 'metadata.csv'), csv, 'utf8');
    const prepared = await validator.prepare(root);
    expect(prepared.documents).toHaveLength(1);
    expect(prepared.documents[0].title).toBe('Peña, M. c/ Sol');
    expect(prepared.documents[0].caseNumber).toBe('CIV 1/2025');
    expect(prepared.documents[0].court).toBe('Juzgado Civil 1');
    expect(await readFile(path.join(root, 'metadata.csv'), 'utf8')).toBe(csv);
  });

  it('scans a folder and creates an explicit draft manifest only on request', async () => {
    await rm(path.join(root, 'files'), { recursive: true });
    await writeFile(path.join(root, 'nota.txt'), 'fixture');
    const before = await validator.prepare(root);
    expect(before.manifestName).toBe(
      'manifest.generated.json (borrador en memoria)',
    );
    expect(before.documents).toHaveLength(1);
    const draft = await validator.writeDraft(root);
    expect(path.basename(draft)).toBe('manifest.generated.json');
    const after = await validator.prepare(root);
    expect(after.packageId).toBe(before.packageId);
    expect(after.documents[0].sha256).toBe(before.documents[0].sha256);
  });
});

async function manifest(root: string, documents: unknown[]) {
  await writeFile(
    path.join(root, 'manifest.json'),
    JSON.stringify(
      {
        schemaVersion: '1.0',
        packageId: 'BJC-PACKAGE-TEST-001',
        source: {
          code: 'INSTITUTIONAL_IMPORT',
          name: 'Fixture fuente sin verificar',
          type: 'INSTITUTIONAL_IMPORT',
        },
        generatedAt: '2026-10-07T00:00:00.000Z',
        documents,
      },
      null,
      2,
    ),
  );
}
