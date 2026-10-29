import { createHash } from 'node:crypto';
import {
  access,
  mkdir,
  readFile,
  rename,
  stat,
  writeFile,
} from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';

export type StoredDocument = {
  storageKey: string;
  sha256: string;
  sizeBytes: number;
};

export interface DocumentStorageAdapter {
  readonly root?: string;
  put(filename: string, content: Buffer): Promise<StoredDocument>;
  get(storageKey: string): Promise<Buffer>;
  isAvailable?(): Promise<boolean>;
}

export class LocalDocumentStorageAdapter implements DocumentStorageAdapter {
  readonly root: string;
  constructor(
    root = process.env.BJC_CORPUS_STORAGE_PATH ||
      path.resolve(process.cwd(), '../_dev-corpus-storage'),
  ) {
    this.root = path.resolve(root);
  }

  async put(filename: string, content: Buffer): Promise<StoredDocument> {
    const sha256 = createHash('sha256').update(content).digest('hex');
    const ext =
      path
        .extname(filename)
        .toLowerCase()
        .replace(/[^.a-z0-9]/gu, '')
        .slice(0, 11) || '.bin';
    const storageKey = `${sha256.slice(0, 2)}/${sha256}${ext}`;
    const target = this.resolveKey(storageKey);
    await mkdir(path.dirname(target), { recursive: true });
    try {
      const existing = await readFile(target);
      const existingHash = createHash('sha256').update(existing).digest('hex');
      if (existingHash !== sha256)
        throw new Error(`Storage integrity failure for ${storageKey}.`);
    } catch {
      const temporary = `${target}.${process.pid}.${Date.now()}.tmp`;
      await writeFile(temporary, content, { flag: 'wx' });
      try {
        await rename(temporary, target);
      } catch (error) {
        // A concurrent writer may have committed the same content-addressed key.
        try {
          await readFile(target);
        } catch {
          throw error;
        }
      }
    }
    return { storageKey, sha256, sizeBytes: content.byteLength };
  }

  async get(storageKey: string) {
    return readFile(this.resolveKey(storageKey));
  }

  async isAvailable() {
    try {
      const info = await stat(this.root);
      if (!info.isDirectory()) return false;
      await access(this.root, constants.R_OK | constants.W_OK);
      return true;
    } catch {
      return false;
    }
  }

  private resolveKey(storageKey: string) {
    if (!/^[a-f0-9]{2}\/[a-f0-9]{64}\.[a-z0-9]{1,10}$/u.test(storageKey)) {
      throw new Error('Storage key inválida.');
    }
    const target = path.resolve(this.root, storageKey);
    if (!target.startsWith(`${this.root}${path.sep}`))
      throw new Error('Storage key fuera de la raíz permitida.');
    return target;
  }
}
