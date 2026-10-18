import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { assertDisjointStorageReference } from './storage-isolation';

describe('assertDisjointStorageReference', () => {
  let root: string;
  let devStorage: string;
  let preprodStorage: string;
  let productionStorage: string;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'bjc-storage-ref-'));
    devStorage = path.join(root, 'dev');
    preprodStorage = path.join(root, 'preprod');
    productionStorage = path.join(root, 'production');
    for (const item of [devStorage, preprodStorage, productionStorage]) {
      fs.mkdirSync(item);
    }
  });

  afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

  it('accepts a new backup reservation outside all environment storage roots', () => {
    const output = path.join(root, 'backup', 'nightly');
    expect(assertDisjointStorageReference(output, protectedRoots())).toBe(
      output,
    );
  });

  it('rejects equal, ancestor, and descendant backup paths for every environment', () => {
    for (const { name, path: storage } of protectedRoots()) {
      expect(() =>
        assertDisjointStorageReference(storage, protectedRoots()),
      ).toThrow(`BJC_CORPUS_STORAGE_OVERLAP_${name}`);

      expect(() =>
        assertDisjointStorageReference(
          path.join(storage, 'backup-child'),
          protectedRoots(),
        ),
      ).toThrow(`BJC_CORPUS_STORAGE_OVERLAP_${name}`);

      expect(() =>
        assertDisjointStorageReference(path.dirname(storage), protectedRoots()),
      ).toThrow(/BJC_CORPUS_STORAGE_OVERLAP_/u);
    }
  });

  it('follows a backup path through a directory alias and compares Windows case aliases', () => {
    const alias = path.join(root, 'production-alias');
    try {
      fs.symlinkSync(
        productionStorage,
        alias,
        process.platform === 'win32' ? 'junction' : 'dir',
      );
      expect(() =>
        assertDisjointStorageReference(
          path.join(alias, 'backup'),
          protectedRoots(),
        ),
      ).toThrow('BJC_CORPUS_STORAGE_OVERLAP_PRODUCTION');
    } catch (error) {
      if (
        !['EPERM', 'EACCES', 'ENOTSUP'].includes(
          (error as NodeJS.ErrnoException).code ?? '',
        )
      ) {
        throw error;
      }
    }

    if (process.platform === 'win32') {
      expect(() =>
        assertDisjointStorageReference(
          devStorage.toUpperCase(),
          protectedRoots(),
        ),
      ).toThrow('BJC_CORPUS_STORAGE_OVERLAP_DEV');
    }
  });

  it('requires every peer storage identity', () => {
    expect(() =>
      assertDisjointStorageReference(path.join(root, 'backup'), [
        { name: 'PRODUCTION', path: '' },
      ]),
    ).toThrow('BJC_CORPUS_STORAGE_REFERENCE_REQUIRED_PRODUCTION');
  });

  function protectedRoots() {
    return [
      { name: 'DEV', path: devStorage },
      { name: 'PREPROD', path: preprodStorage },
      { name: 'PRODUCTION', path: productionStorage },
    ];
  }
});
