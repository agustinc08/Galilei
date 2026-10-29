import test from 'node:test';
import assert from 'node:assert/strict';
import { inspectPersonalFolderFiles } from '../src/app/(admin)/personal/personal-folder-upload.ts';

const file = (name, webkitRelativePath, size = 1024) => ({ name, webkitRelativePath, size });

test('folder upload keeps only supported documents and preserves nested folders', () => {
  const selected = inspectPersonalFolderFiles([
    file('fallo.pdf', 'Legajos/Contratos/fallo.pdf'),
    file('informe.docx', 'Legajos/Informes/informe.docx'),
    file('escritura.doc', 'Legajos/Escrituras/escritura.doc'),
    file('foto.png', 'Legajos/Contratos/foto.png'),
    file('paquete.zip', 'Legajos/paquete.zip'),
    file('~$borrador.docx', 'Legajos/Informes/~$borrador.docx'),
    file('oculto.pdf', 'Legajos/.privado/oculto.pdf'),
    file('desktop.ini', 'Legajos/desktop.ini'),
  ]);

  assert.deepEqual(selected.files.map((entry) => entry.file.name), [
    'fallo.pdf',
    'informe.docx',
    'escritura.doc',
  ]);
  assert.deepEqual(selected.files[0].relativeFolders, ['Contratos']);
  assert.deepEqual(selected.files[1].relativeFolders, ['Informes']);
  assert.equal(selected.omitted.length, 5);
  assert.equal(selected.errors.length, 0);
});

test('folder upload ignores unsafe relative paths', () => {
  const selected = inspectPersonalFolderFiles([
    file('outside.pdf', 'Legajos/../../outside.pdf'),
    file('absolute.pdf', '/outside.pdf'),
    file('drive.pdf', 'C:/outside.pdf'),
  ]);

  assert.equal(selected.files.length, 0);
  assert.equal(selected.omitted.length, 3);
  assert.equal(selected.errors.length, 0);
  assert.ok(selected.omitted.every((entry) => entry.reason === 'Ruta no válida'));
});

test('a corrupt document with an allowed extension reaches server-side content validation', () => {
  const selected = inspectPersonalFolderFiles([
    file('corrupto.docx', 'Legajos/corrupto.docx'),
  ]);

  assert.equal(selected.files.length, 1);
  assert.equal(selected.omitted.length, 0);
  assert.equal(selected.errors.length, 0);
});

test('folder upload reports empty and oversized allowed documents as per-file errors', () => {
  const selected = inspectPersonalFolderFiles([
    file('vacío.pdf', 'Legajos/vacío.pdf', 0),
    file('grande.docx', 'Legajos/grande.docx', 20 * 1024 * 1024 + 1),
    file('válido.pdf', 'Legajos/válido.pdf', 20 * 1024 * 1024),
  ]);

  assert.deepEqual(selected.files.map((entry) => entry.file.name), ['válido.pdf']);
  assert.deepEqual(selected.errors.map((item) => item.name), ['vacío.pdf', 'grande.docx']);
  assert.equal(selected.omitted.length, 0);
});
