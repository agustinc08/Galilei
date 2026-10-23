import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Client } from '@opensearch-project/opensearch';
import { OpenSearchDocumentRepository } from '../../src/busqueda/opensearch/opensearch-document.repository';
import { OpenSearchIndexService } from '../../src/busqueda/opensearch/opensearch-index.service';
import { readOpenSearchConfig } from '../../src/busqueda/opensearch/opensearch-config';
import { OpenSearchSyncWorker } from '../../src/busqueda/opensearch/opensearch-sync.worker';

loadLocalEnvironment();

async function main() {
  const action = process.argv[2];
  if (
    ![
      'status',
      'verify',
      'rebuild',
      'candidate',
      'sync-once',
      'retry-failed',
      'cleanup',
    ].includes(action ?? '')
  ) {
    throw new Error('OPENSEARCH_ACTION_INVALID');
  }
  if (action === 'candidate') process.env.OPENSEARCH_CANDIDATE_ONLY = 'true';

  const config = readOpenSearchConfig();
  const client = new Client(config.clientOptions);
  const repository = new OpenSearchDocumentRepository();
  const index = new OpenSearchIndexService(
    client,
    repository,
    config.alias,
    config.indexPrefix,
    config.searchSchemaVersion,
    config.readOnlyCandidate,
    config.searchTarget,
    config.trustedPhysicalWriter,
    config.topology === 'fresh-v4',
  );
  const worker = new OpenSearchSyncWorker(repository, index);
  try {
    switch (action) {
      case 'status':
        console.log(JSON.stringify(await index.status(), null, 2));
        break;
      case 'verify':
        console.log(JSON.stringify(await index.verifyActive(), null, 2));
        break;
      case 'rebuild':
        console.log(JSON.stringify(await index.rebuild(), null, 2));
        break;
      case 'candidate':
        console.log(JSON.stringify(await index.rebuild(), null, 2));
        break;
      case 'sync-once':
        await worker.tick();
        console.log(
          JSON.stringify(
            { synced: true, outbox: await repository.outboxStatus() },
            null,
            2,
          ),
        );
        break;
      case 'retry-failed':
        console.log(
          JSON.stringify({ retried: await worker.retryFailed() }, null, 2),
        );
        break;
      case 'cleanup':
        console.log(JSON.stringify(await index.cleanupOldIndexes(), null, 2));
        break;
    }
  } finally {
    await index.close();
    await client.close();
  }
}

function loadLocalEnvironment() {
  const file = resolve(process.cwd(), '.env.development.local');
  let contents: string;
  try {
    contents = readFileSync(file, 'utf8');
  } catch {
    throw new Error('DEV_ENV_FILE_MISSING');
  }
  for (const line of contents.split(/\r?\n/u)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/u);
    if (!match || match[1] in process.env) continue;
    const rawValue = match[2];
    const quoted =
      (rawValue.startsWith('"') && rawValue.endsWith('"')) ||
      (rawValue.startsWith("'") && rawValue.endsWith("'"));
    const value = quoted ? rawValue.slice(1, -1) : rawValue;
    process.env[match[1]] = value;
  }
}

void main().catch((error: unknown) => {
  const code =
    error instanceof Error ? error.message : 'OPENSEARCH_OPERATION_FAILED';
  const databaseCode = readDatabaseErrorCode(error);
  let safeCode = 'OPENSEARCH_OPERATION_FAILED';
  if (/^(?:OPENSEARCH|DEV|SEARCH)_[A-Z0-9_]+$/u.test(code)) safeCode = code;
  else if (databaseCode === '57014')
    safeCode = 'DEV_DATABASE_STATEMENT_TIMEOUT';
  else if (databaseCode === '55P03')
    safeCode = 'DEV_DATABASE_LOCK_NOT_AVAILABLE';
  console.error(safeCode);
  process.exitCode = 1;
});

function readDatabaseErrorCode(error: unknown): string | undefined {
  if (!error || typeof error !== 'object') return undefined;
  const value = (error as { code?: unknown }).code;
  return typeof value === 'string' ? value : undefined;
}
