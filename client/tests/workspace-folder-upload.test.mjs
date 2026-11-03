import test from 'node:test';
import assert from 'node:assert/strict';
import { inspectWorkspaceFolderFiles } from '../src/app/(admin)/spaces/workspace-folder-upload.ts';

const file = (name, webkitRelativePath, size = 1024) => ({ name, webkitRelativePath, size });

test('workspace folder inspection preserves the selected root and nested relative folders', () => {
  const result = inspectWorkspaceFolderFiles([
    file('demanda.pdf', 'Expedientes 2026/Expediente 1234/demanda.pdf'),
    file('pericia.docx', 'Expedientes 2026/Expediente 1234/prueba/pericia.docx'),
    file('escrito.txt', 'Expedientes 2026/Expediente 5678/escrito.txt'),
  ]);

  assert.deepEqual(result.rootFolders, ['Expedientes 2026']);
  assert.deepEqual(result.files[1].folderSegments, [
    'Expedientes 2026',
    'Expediente 1234',
    'prueba',
  ]);
  assert.equal(result.folderCount, 4);
  assert.equal(result.omitted.length, 0);
  assert.equal(result.errors.length, 0);
});

test('workspace folder inspection rejects traversal, absolute paths, reserved names, and unsafe characters', () => {
  const result = inspectWorkspaceFolderFiles([
    file('escape.pdf', 'Docs/../../escape.pdf'),
    file('absolute.pdf', '/Docs/absolute.pdf'),
    file('drive.pdf', 'C:/Docs/drive.pdf'),
    file('bad.pdf', 'Docs/bad?.pdf'),
    file('report.pdf', 'Docs/../report.pdf'),
    file('nul.pdf', 'Docs/NUL/nul.pdf'),
  ]);

  assert.equal(result.files.length, 0);
  assert.equal(result.omitted.length, 6);
  assert.ok(result.omitted.every((entry) => entry.reason === 'Ruta o nombre no válido'));
});

test('workspace folder inspection keeps only existing allowed extensions and enforces per-file limits', () => {
  const result = inspectWorkspaceFolderFiles([
    file('a.pdf', 'Lote/a.pdf'),
    file('b.txt', 'Lote/b.txt'),
    file('c.rtf', 'Lote/c.rtf'),
    file('d.doc', 'Lote/d.doc'),
    file('e.docx', 'Lote/e.docx'),
    file('f.odt', 'Lote/f.odt'),
    file('image.png', 'Lote/image.png'),
    file('empty.pdf', 'Lote/empty.pdf', 0),
    file('large.pdf', 'Lote/large.pdf', 20 * 1024 * 1024 + 1),
    file('limit.pdf', 'Lote/limit.pdf', 20 * 1024 * 1024),
  ]);

  assert.equal(result.files.length, 7);
  assert.equal(result.omitted.length, 1);
  assert.deepEqual(result.errors.map((entry) => entry.name), [
    'Lote / empty.pdf',
    'Lote / large.pdf',
  ]);
});

test('synthetic selections of 3, 20, and 100 files retain paths at 1, 3, and 6 folder levels', () => {
  for (const [count, rootCount, depth] of [[3, 1, 1], [20, 3, 3], [100, 10, 6]]) {
    const files = Array.from({ length: count }, (_, index) => {
      const root = `Caso ${index % rootCount + 1}`;
      const segments = [root, ...Array.from({ length: depth - 1 }, (_, level) => `Nivel ${level + 2}`)];
      const name = `documento-${index + 1}.txt`;
      return file(name, `${segments.join('/')}/${name}`);
    });
    const result = inspectWorkspaceFolderFiles(files);
    assert.equal(result.files.length, count);
    assert.equal(result.files[0].folderSegments.length, depth);
    assert.equal(result.rootFolders.length, rootCount);
    assert.equal(result.folderCount, rootCount * depth);
  }
});

test('folder and file names preserve accents, ñ, spaces, and parentheses', () => {
  const result = inspectWorkspaceFolderFiles([
    file('resolución (1).pdf', 'Expedientes 2026/Sala Ñ/Acción civil (A)/resolución (1).pdf'),
  ]);

  assert.equal(result.files.length, 1);
  assert.deepEqual(result.files[0].folderSegments, [
    'Expedientes 2026',
    'Sala Ñ',
    'Acción civil (A)',
  ]);
});
