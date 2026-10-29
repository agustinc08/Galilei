import { existsSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { basename, dirname, resolve } from 'node:path';
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
  const localFile = resolve(process.cwd(), '.env.development.local');
  const configuredFile = process.env.DOTENV_CONFIG_PATH;
  let file = configuredFile ? resolve(configuredFile) : localFile;
  if (!existsSync(file)) {
    let canonicalRepositoryRoot = resolve(process.cwd(), '..');
    try {
      const commonDir = execFileSync('git', ['rev-parse', '--git-common-dir'], {
        cwd: canonicalRepositoryRoot,
        encoding: 'utf8',
      }).trim();
      const resolvedCommonDir = resolve(canonicalRepositoryRoot, commonDir);
      if (basename(resolvedCommonDir).toLowerCase() === '.git') {
        canonicalRepositoryRoot = dirname(resolvedCommonDir);
      }
    } catch {
      // Outside a Git checkout, use only the package-local environment file.
    }
    file = resolve(canonicalRepositoryRoot, 'server', '.env.development.local');
  }

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
    process.env[match[1]] = quoted ? rawValue.slice(1, -1) : rawValue;
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
  if (process.env.OPENSEARCH_DIAGNOSTICS_SAFE === 'true') {
    const diagnostic = safeOpenSearchDiagnostic(error);
    console.error(JSON.stringify({ code: safeCode, ...diagnostic }));
  } else console.error(safeCode);
  process.exitCode = 1;
});

function safeOpenSearchDiagnostic(error: unknown) {
  if (!error || typeof error !== 'object') return {};
  const value = error as {
    name?: unknown;
    meta?: {
      statusCode?: unknown;
      body?: { error?: { type?: unknown; reason?: unknown } };
    };
  };
  const statusCode = value.meta?.statusCode;
  const type = value.meta?.body?.error?.type;
  const reason = value.meta?.body?.error?.reason;
  return {
    name: typeof value.name === 'string' ? value.name : undefined,
    statusCode: typeof statusCode === 'number' ? statusCode : undefined,
    type: typeof type === 'string' ? type.slice(0, 80) : undefined,
    reason:
      typeof reason === 'string'
        ? reason.replace(/[\r\n\t]+/gu, ' ').slice(0, 240)
        : undefined,
  };
}

function readDatabaseErrorCode(error: unknown): string | undefined {
  if (!error || typeof error !== 'object') return undefined;
  const value = (error as { code?: unknown }).code;
  return typeof value === 'string' ? value : undefined;
}
