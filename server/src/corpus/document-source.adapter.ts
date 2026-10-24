import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';

export type DiscoveredDocument = {
  filename: string;
  sourcePath?: string;
  externalId?: string;
  externalUrl?: string;
  sourceReference?: string;
  obtainedAt?: Date;
  content: Buffer;
  mimeType?: string;
  title?: string;
  documentType?: string;
  jurisdiction?: string;
  court?: string;
  chamber?: string;
  instance?: string;
  caseNumber?: string;
  decisionDate?: Date;
  metadata?: Record<string, unknown>;
  metadataOriginal?: Record<string, unknown>;
  visibility?: 'PUBLIC' | 'INTERNAL' | 'RESTRICTED';
};

export interface DocumentSourceAdapter {
  discover(): Promise<DiscoveredDocument[]>;
}

export class ManualFixtureSourceAdapter implements DocumentSourceAdapter {
  constructor(private readonly documents: DiscoveredDocument[]) {}
  discover(): Promise<DiscoveredDocument[]> {
    return Promise.resolve([...this.documents]);
  }
}

/** Explicit one-shot scan. Symlinks are ignored and folder names remain provenance only. */
export class LocalFolderDocumentSourceAdapter implements DocumentSourceAdapter {
  constructor(private readonly root: string) {}

  async discover(): Promise<DiscoveredDocument[]> {
    const root = path.resolve(this.root);
    const result: DiscoveredDocument[] = [];
    const visit = async (directory: string): Promise<void> => {
      const entries = await readdir(directory, { withFileTypes: true });
      for (const entry of entries.sort((a, b) =>
        a.name.localeCompare(b.name),
      )) {
        const fullPath = path.join(directory, entry.name);
        if (entry.isSymbolicLink()) continue;
        if (entry.isDirectory()) {
          await visit(fullPath);
          continue;
        }
        if (!entry.isFile() || !/\.(pdf|txt)$/iu.test(entry.name)) continue;
        const fileStat = await stat(fullPath);
        const relative = path
          .relative(root, fullPath)
          .split(path.sep)
          .join('/');
        result.push({
          filename: entry.name,
          sourcePath: relative,
          externalId: relative,
          content: await readFile(fullPath),
          mimeType:
            path.extname(entry.name).toLowerCase() === '.pdf'
              ? 'application/pdf'
              : 'text/plain',
          title: path.basename(entry.name, path.extname(entry.name)),
          metadataOriginal: {
            relativePath: relative,
            sizeBytes: fileStat.size,
          },
        });
      }
    };
    await visit(root);
    return result;
  }
}
