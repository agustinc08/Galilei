import { isDeepStrictEqual } from 'node:util';
import { readFileSync } from 'node:fs';
import { Client } from '@opensearch-project/opensearch';
import { readOpenSearchConfig } from '../../src/busqueda/opensearch/opensearch-config';

const V3 = 'galilei-search-v003-20261017t232432555z-a6af18cb';
const V4 = 'galilei-search-v004-20261020t094732495z-6015e394';
const PAGE_SIZE = 25;
const SEARCH_REQUEST_PAUSE_MS = 100;
const MAX_THROTTLE_RETRIES = 8;

type Hit = {
  _id: string;
  _source?: Record<string, unknown>;
  sort?: unknown[];
};

type SearchBody = {
  hits?: {
    hits?: Hit[];
  };
};

type CountBody = { count: number };

type Stream = {
  index: string;
  hits: Hit[];
  position: number;
  after?: unknown[];
  done: boolean;
  total?: number;
  previousId?: string;
};

function loadLocalEnvironment() {
  let text: string;
  try {
    text = readFileSync('.env.development.local', 'utf8');
  } catch {
    throw new Error('DEV_ENVIRONMENT_FILE_REQUIRED');
  }
  for (const line of text.split(/\r?\n/u)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/u);
    if (!match || match[1] in process.env) continue;
    const value = match[2];
    const quoted =
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"));
    process.env[match[1]] = quoted ? value.slice(1, -1) : value;
  }
}

function bodyOf<T>(response: unknown): T {
  return response && typeof response === 'object' && 'body' in response
    ? (response as { body: T }).body
    : (response as T);
}

async function nextHit(client: Client, stream: Stream): Promise<Hit | null> {
  while (stream.position >= stream.hits.length) {
    if (stream.done) return null;
    const search = {
      index: stream.index,
      body: {
        size: PAGE_SIZE,
        track_total_hits: false,
        sort: [{ id: { order: 'asc' } }],
        ...(stream.after ? { search_after: stream.after } : {}),
      },
    };
    await new Promise((resolve) =>
      setTimeout(resolve, SEARCH_REQUEST_PAUSE_MS),
    );
    let response: unknown;
    for (let attempt = 0; ; attempt += 1) {
      try {
        response = await client.search(search);
        break;
      } catch (error) {
        const candidate = error as {
          statusCode?: unknown;
          meta?: { statusCode?: unknown; headers?: Record<string, unknown> };
        };
        const statusCode = candidate.statusCode ?? candidate.meta?.statusCode;
        if (statusCode !== 429 || attempt >= MAX_THROTTLE_RETRIES) throw error;
        const retryAfterHeader = candidate.meta?.headers?.['retry-after'];
        const retryAfterSeconds = Number(retryAfterHeader);
        const backoffMs = Math.min(15_000, 1_000 * 2 ** attempt);
        const waitMs =
          Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0
            ? Math.min(15_000, retryAfterSeconds * 1_000)
            : backoffMs;
        await new Promise((resolve) => setTimeout(resolve, waitMs));
      }
    }
    const result = bodyOf<SearchBody>(response);
    if (!Array.isArray(result.hits?.hits)) {
      throw new Error('SEARCH_V4_PARITY_HITS_INVALID');
    }
    stream.hits = result.hits.hits;
    stream.position = 0;
    if (stream.hits.length === 0) {
      stream.done = true;
      return null;
    }
    const last = stream.hits[stream.hits.length - 1];
    if (!last.sort?.length) throw new Error('SEARCH_V4_PARITY_SORT_MISSING');
    stream.after = last.sort;
  }
  const hit = stream.hits[stream.position++];
  if (stream.previousId !== undefined && hit._id <= stream.previousId) {
    throw new Error('SEARCH_V4_PARITY_IDS_NOT_STRICTLY_SORTED');
  }
  stream.previousId = hit._id;
  return hit;
}

function comparableSource(source: Record<string, unknown> | undefined) {
  const normalized = JSON.parse(JSON.stringify(source ?? {})) as Record<
    string,
    unknown
  >;
  // These are the intentional V4 schema additions, not product-source fields.
  delete normalized.indexSchemaVersion;
  const sortFields = normalized.sortFields;
  if (
    sortFields &&
    typeof sortFields === 'object' &&
    !Array.isArray(sortFields)
  ) {
    delete (sortFields as Record<string, unknown>).numeroSentenciaCollation;
  }
  return normalized;
}

function derivedValueIsCorrect(source: Record<string, unknown> | undefined) {
  const sortFields = source?.sortFields;
  if (
    !sortFields ||
    typeof sortFields !== 'object' ||
    Array.isArray(sortFields)
  ) {
    return false;
  }
  const fields = sortFields as Record<string, unknown>;
  const expected = fields.numeroSentencia == null ? '' : fields.numeroSentencia;
  return fields.numeroSentenciaCollation === expected;
}

function schemaMarker(source: Record<string, unknown> | undefined) {
  const value = source?.indexSchemaVersion;
  if (typeof value === 'string' || typeof value === 'number')
    return String(value);
  return value == null ? 'missing' : 'non_scalar';
}

async function main() {
  loadLocalEnvironment();
  const config = readOpenSearchConfig({
    ...process.env,
    OPENSEARCH_REQUEST_TIMEOUT_MS:
      process.env.OPENSEARCH_REQUEST_TIMEOUT_MS ?? '30000',
  });
  if (config.node !== 'http://127.0.0.1:9200') {
    throw new Error('SEARCH_V4_PARITY_LOCAL_ENDPOINT_REQUIRED');
  }
  const client = new Client(config.clientOptions);
  const [v3CountResponse, v4CountResponse] = await Promise.all([
    client.count({ index: V3, body: { query: { match_all: {} } } }),
    client.count({ index: V4, body: { query: { match_all: {} } } }),
  ]).catch(async (error: unknown) => {
    await client.close();
    throw error;
  });
  const v3Total = bodyOf<CountBody>(v3CountResponse).count;
  const v4Total = bodyOf<CountBody>(v4CountResponse).count;
  const streams: [Stream, Stream] = [
    { index: V3, hits: [], position: 0, done: false, total: v3Total },
    { index: V4, hits: [], position: 0, done: false, total: v4Total },
  ];
  let idsCompared = 0;
  let missingInV4 = 0;
  let extraInV4 = 0;
  let sourcesCompared = 0;
  let unexpectedSourceDifferences = 0;
  let incorrectV4DerivedValues = 0;
  const unexpectedSourceIds: string[] = [];
  const missingIdSamples: string[] = [];
  const extraIdSamples: string[] = [];
  const v3SchemaMarkerCounts: Record<string, number> = {};
  const v4SchemaMarkerCounts: Record<string, number> = {};
  let peakRssBytes = process.memoryUsage().rss;
  try {
    let left = await nextHit(client, streams[0]);
    let right = await nextHit(client, streams[1]);
    while (left || right) {
      if (!right || (left && left._id < right._id)) {
        missingInV4 += 1;
        if (missingIdSamples.length < 10) missingIdSamples.push(left!._id);
        left = await nextHit(client, streams[0]);
      } else if (!left || right._id < left._id) {
        extraInV4 += 1;
        if (extraIdSamples.length < 10) extraIdSamples.push(right._id);
        right = await nextHit(client, streams[1]);
      } else {
        idsCompared += 1;
        sourcesCompared += 1;
        const v3Marker = schemaMarker(left._source);
        const v4Marker = schemaMarker(right._source);
        v3SchemaMarkerCounts[v3Marker] =
          (v3SchemaMarkerCounts[v3Marker] ?? 0) + 1;
        v4SchemaMarkerCounts[v4Marker] =
          (v4SchemaMarkerCounts[v4Marker] ?? 0) + 1;
        if (
          !isDeepStrictEqual(
            comparableSource(left._source),
            comparableSource(right._source),
          )
        ) {
          unexpectedSourceDifferences += 1;
          if (unexpectedSourceIds.length < 10)
            unexpectedSourceIds.push(left._id);
        }
        if (!derivedValueIsCorrect(right._source))
          incorrectV4DerivedValues += 1;
        left = await nextHit(client, streams[0]);
        right = await nextHit(client, streams[1]);
      }
      peakRssBytes = Math.max(peakRssBytes, process.memoryUsage().rss);
      if (idsCompared > 0 && idsCompared % 5000 === 0) {
        console.error(
          JSON.stringify({
            progress: idsCompared,
            total: streams[0].total,
            rssMiB:
              Math.round((process.memoryUsage().rss / 1024 / 1024) * 10) / 10,
          }),
        );
        (globalThis as { gc?: () => void }).gc?.();
      }
    }
    const result = {
      mode: 'READ_ONLY_STREAMING_SOURCE_PARITY',
      v3: { index: V3, documents: streams[0].total },
      v4: { index: V4, documents: streams[1].total },
      pageSize: PAGE_SIZE,
      idsCompared,
      missingInV4,
      extraInV4,
      sourcesCompared,
      unexpectedSourceDifferences,
      unexpectedSourceIds,
      missingIdSamples,
      extraIdSamples,
      v4DerivedValueMismatches: incorrectV4DerivedValues,
      allowedSchemaMarkerCounts: {
        v3: v3SchemaMarkerCounts,
        v4: v4SchemaMarkerCounts,
      },
      peakRssBytes,
      peakRssMiB: Math.round((peakRssBytes / 1024 / 1024) * 10) / 10,
      pass:
        streams[0].total === streams[1].total &&
        idsCompared === streams[0].total &&
        missingInV4 === 0 &&
        extraInV4 === 0 &&
        unexpectedSourceDifferences === 0 &&
        incorrectV4DerivedValues === 0,
    };
    console.log(JSON.stringify(result));
    if (!result.pass) process.exitCode = 1;
  } finally {
    await client.close();
  }
}

void main().catch((error: unknown) => {
  const code =
    error instanceof Error && /^[A-Z0-9_]+$/u.test(error.message)
      ? error.message
      : 'SEARCH_V4_SOURCE_PARITY_FAILED';
  const candidate = error as {
    name?: unknown;
    message?: unknown;
    statusCode?: unknown;
    meta?: { statusCode?: unknown };
  };
  const safeMessage =
    typeof candidate.message === 'string' &&
    /^[A-Z0-9_. -]{1,160}$/u.test(candidate.message)
      ? candidate.message
      : undefined;
  console.error(
    JSON.stringify({
      code,
      errorType:
        typeof candidate.name === 'string' ? candidate.name : 'UnknownError',
      statusCode: candidate.statusCode ?? candidate.meta?.statusCode ?? null,
      safeMessage,
    }),
  );
  process.exitCode = 1;
});
