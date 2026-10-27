const { readdir, readFile } = require('node:fs/promises');
const path = require('node:path');

const REQUEST_ID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const OPERATIONS = new Set([
  'http.search',
  'federated.search',
  'source.jurisprudencia.search',
  'source.corpus.search',
  'opensearch.search',
  'postgres.hydrate',
  'workspace.acl',
]);
const EVENTS = new Set([
  'SEARCH_OPERATION',
  'SEARCH_SLOW_REQUEST',
  'SEARCH_HTTP_503',
]);
const SAFE_FIELDS = [
  'timestamp',
  'event',
  'requestId',
  'operation',
  'source',
  'durationMs',
  'success',
  'status',
  'resultCount',
  'pageSize',
  'errorCategory',
];

async function main() {
  const requestId = process.argv[2];
  if (!requestId || !REQUEST_ID.test(requestId)) {
    process.stderr.write(
      'Usage: pnpm search:events <server-generated-request-uuid>\n',
    );
    process.exitCode = 2;
    return;
  }

  const directory =
    process.env.SEARCH_OBSERVABILITY_LOG_DIR?.trim() ||
    path.join(process.cwd(), 'logs', 'search-observability');
  let files;
  try {
    files = await readdir(directory);
  } catch (error) {
    if (error && error.code === 'ENOENT') {
      process.stdout.write('[]\n');
      return;
    }
    throw error;
  }

  const eventFiles = files
    .filter((file) => /^search-events\.jsonl(?:\.[1-5])?$/u.test(file))
    .sort((left, right) => right.localeCompare(left));
  const events = [];
  for (const file of eventFiles) {
    const content = await readFile(path.join(directory, file), 'utf8');
    for (const line of content.split(/\r?\n/u)) {
      if (!line) continue;
      let event;
      try {
        event = JSON.parse(line);
      } catch {
        continue;
      }
      if (
        !event ||
        event.requestId !== requestId ||
        !REQUEST_ID.test(event.requestId) ||
        !OPERATIONS.has(event.operation) ||
        !EVENTS.has(event.event)
      )
        continue;
      const safe = {};
      for (const key of SAFE_FIELDS) {
        if (Object.hasOwn(event, key)) safe[key] = event[key];
      }
      events.push(safe);
    }
  }
  events.sort((left, right) =>
    String(left.timestamp).localeCompare(String(right.timestamp)),
  );
  process.stdout.write(`${JSON.stringify(events, null, 2)}\n`);
}

main().catch(() => {
  process.stderr.write('Unable to read Search observability events.\n');
  process.exitCode = 1;
});
