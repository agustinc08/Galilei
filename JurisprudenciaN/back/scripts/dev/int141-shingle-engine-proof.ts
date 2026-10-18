import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Client } from '@opensearch-project/opensearch';
import { normalizeSearchText } from '../../src/busqueda/utils/search-normalizer';
import {
  lexicalTokens,
  phraseBigramSequence,
  phraseSequence,
} from '../../src/busqueda/opensearch/opensearch-mapping';
import { readOpenSearchConfig } from '../../src/busqueda/opensearch/opensearch-config';

loadLocalEnvironment();

type Fixture = { name: string; document: string; phrase: string };

const long301 = Array.from(
  { length: 301 },
  (_, index) => `palabra${index}`,
).join(' ');
const long1000 = Array.from(
  { length: 125 },
  (_, index) => `termino${index}`,
).join(' ');
const long301Chars = Array.from(
  { length: 28 },
  (_, index) => `concepto${index}`,
).join(' ');
const fixtures: Fixture[] = [
  { name: 'two words', document: 'a b c', phrase: 'a b' },
  { name: 'three contiguous words', document: 'a b c', phrase: 'a b c' },
  { name: 'intervening word', document: 'a b x b c', phrase: 'a b c' },
  {
    name: 'separate occurrences',
    document: 'a b expediente x b c',
    phrase: 'a b c',
  },
  { name: 'four contiguous words', document: 'a b c d', phrase: 'a b c d' },
  { name: 'interior phrase', document: 'a b c d', phrase: 'b c d' },
  { name: 'skipped token', document: 'a b c', phrase: 'a c' },
  { name: 'repeated tokens', document: 'a a a', phrase: 'a a a' },
  {
    name: 'repeated tokens cannot skip',
    document: 'a a x a a',
    phrase: 'a a a',
  },
  { name: 'punctuation differs', document: 'a-b', phrase: 'a b' },
  { name: 'punctuation exact', document: 'a-b', phrase: 'a-b' },
  {
    name: 'slash and periods',
    document: 'c/ s.a. expediente',
    phrase: 'c/ s.a.',
  },
  {
    name: 'line boundary normalized as space',
    document: 'a\nb',
    phrase: 'a b',
  },
  {
    name: 'accent normalization',
    document: 'acción civil',
    phrase: 'accion civil',
  },
  {
    name: 'enye remains distinct',
    document: 'niño civil',
    phrase: 'nino civil',
  },
  { name: 'enye exact', document: 'niño civil', phrase: 'niño civil' },
  {
    name: 'numbers remain lexical',
    document: 'ley 123/2024 civil',
    phrase: '123/2024 civil',
  },
  {
    name: 'large document',
    document: `${'antecedente '.repeat(8000)}responsabilidad civil contractual${' cierre'.repeat(8000)}`,
    phrase: 'responsabilidad civil contractual',
  },
  { name: '301 word phrase', document: `${long301} final`, phrase: long301 },
  {
    name: 'about 301 character phrase',
    document: `${long301Chars} final`,
    phrase: long301Chars,
  },
  {
    name: 'about 1000 character phrase',
    document: `${long1000} final`,
    phrase: long1000,
  },
];

function oldExact(document: string, phrase: string) {
  const sequence = phraseSequence(normalizeSearchText(document))
    .split(' ')
    .filter(Boolean);
  const query = phraseSequence(normalizeSearchText(phrase))
    .split(' ')
    .filter(Boolean);
  for (let start = 0; start <= sequence.length - query.length; start += 1) {
    if (query.every((token, offset) => sequence[start + offset] === token))
      return true;
  }
  return false;
}

function loadLocalEnvironment() {
  const envPath = resolve(process.cwd(), '.env.development.local');
  const contents = readFileSync(envPath, 'utf8');
  for (const line of contents.split(/\r?\n/u)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/u);
    if (!match || match[1] in process.env) continue;
    const raw = match[2];
    process.env[match[1]] =
      (raw.startsWith('"') && raw.endsWith('"')) ||
      (raw.startsWith("'") && raw.endsWith("'"))
        ? raw.slice(1, -1)
        : raw;
  }
}

async function main() {
  const client = new Client(readOpenSearchConfig().clientOptions);
  const index = `galilei-int141-proof-${Date.now()}`;
  const startedAt = Date.now();
  const outcomes: Array<Record<string, unknown>> = [];
  let indexCreated = false;
  let temporaryIndexDeleted = false;
  try {
    await client.indices.create({
      index,
      body: {
        settings: {
          number_of_shards: 1,
          number_of_replicas: 0,
          analysis: {
            analyzer: {
              galilei_sequence: {
                type: 'custom',
                tokenizer: 'whitespace',
                filter: [],
              },
            },
          },
        },
        mappings: {
          dynamic: 'strict',
          properties: {
            id: { type: 'keyword' },
            phraseBigrams: {
              type: 'text',
              analyzer: 'galilei_sequence',
              search_analyzer: 'galilei_sequence',
              index_options: 'positions',
              norms: false,
            },
            fields: {
              type: 'object',
              dynamic: 'strict',
              properties: {
                left: {
                  type: 'text',
                  analyzer: 'galilei_sequence',
                  index_options: 'positions',
                },
                right: {
                  type: 'text',
                  analyzer: 'galilei_sequence',
                  index_options: 'positions',
                },
              },
            },
          },
        },
      },
    });
    indexCreated = true;
    const bulkBody = fixtures.flatMap((fixture, fixtureIndex) => [
      { index: { _index: index, _id: String(fixtureIndex) } },
      {
        id: String(fixtureIndex),
        phraseBigrams: phraseBigramSequence(
          normalizeSearchText(fixture.document),
        ),
        fields: { left: '', right: '' },
      },
    ]);
    bulkBody.push(
      { index: { _index: index, _id: 'field-boundary' } },
      {
        id: 'field-boundary',
        phraseBigrams: '',
        fields: {
          left: phraseBigramSequence(normalizeSearchText('responsabilidad')),
          right: phraseBigramSequence(normalizeSearchText('civil')),
        },
      },
    );
    const bulk = await client.bulk({ body: bulkBody, refresh: true });
    const bulkBodyResult = (bulk as unknown as { body?: { errors?: boolean } })
      .body;
    if (bulkBodyResult?.errors) throw new Error('SHINGLE_PROOF_BULK_FAILED');

    for (const fixture of fixtures) {
      const referenceIds = fixtures
        .flatMap((candidate, candidateIndex) =>
          oldExact(candidate.document, fixture.phrase)
            ? [String(candidateIndex)]
            : [],
        )
        .sort();
      const queryBigrams = phraseBigramSequence(
        normalizeSearchText(fixture.phrase),
      );
      const response = await client.search({
        index,
        body: {
          size: fixtures.length + 1,
          track_total_hits: true,
          query: { match_phrase: { phraseBigrams: queryBigrams } },
          sort: [{ id: 'asc' }],
        },
      });
      const body = (
        response as unknown as {
          body?: { hits?: { hits?: Array<{ _id: string }> } };
        }
      ).body;
      const actualIds = (body?.hits?.hits ?? []).map((hit) => hit._id).sort();
      outcomes.push({
        name: fixture.name,
        phraseChars: fixture.phrase.length,
        phraseWords: lexicalTokens(normalizeSearchText(fixture.phrase)).length,
        referenceIds,
        actualIds,
        exact: JSON.stringify(actualIds) === JSON.stringify(referenceIds),
      });
    }

    const boundary = await client.search({
      index,
      body: {
        size: 10,
        track_total_hits: true,
        query: {
          bool: {
            should: [
              {
                match_phrase: {
                  'fields.left': phraseBigramSequence(
                    normalizeSearchText('responsabilidad civil'),
                  ),
                },
              },
              {
                match_phrase: {
                  'fields.right': phraseBigramSequence(
                    normalizeSearchText('responsabilidad civil'),
                  ),
                },
              },
            ],
            minimum_should_match: 1,
          },
        },
      },
    });
    const boundaryBody = (
      boundary as unknown as {
        body?: { hits?: { hits?: Array<{ _id: string }> } };
      }
    ).body;
    outcomes.push({
      name: 'separate field boundary',
      expectedIds: [],
      actualIds: (boundaryBody?.hits?.hits ?? []).map((hit) => hit._id),
      exact: (boundaryBody?.hits?.hits ?? []).length === 0,
    });

    await client.indices.delete({ index });
    temporaryIndexDeleted = true;
    const report = {
      generatedAt: new Date().toISOString(),
      engine: 'OpenSearch 2.19.6',
      index,
      temporaryIndexDeleted,
      fixtureCount: outcomes.length,
      passCount: outcomes.filter((item) => item.exact === true).length,
      allExact: outcomes.every((item) => item.exact === true),
      elapsedMs: Date.now() - startedAt,
      outcomes,
    };
    const artifactRoot = resolve(
      process.cwd(),
      '../../_recovery-work/search-engine-integration1',
    );
    mkdirSync(artifactRoot, { recursive: true });
    writeFileSync(
      resolve(artifactRoot, 'shingle-adversarial-fixtures.json'),
      `${JSON.stringify(report, null, 2)}\n`,
    );
    if (!report.allExact) process.exitCode = 1;
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } finally {
    if (indexCreated && !temporaryIndexDeleted)
      await client.indices.delete({ index }).catch(() => undefined);
    await client.close();
  }
}

void main().catch((error: unknown) => {
  process.stderr.write(
    `${error instanceof Error ? error.message : 'SHINGLE_PROOF_FAILED'}\n`,
  );
  process.exitCode = 1;
});
