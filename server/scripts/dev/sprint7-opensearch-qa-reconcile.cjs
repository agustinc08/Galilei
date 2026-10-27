#!/usr/bin/env node
// Reprojects PostgreSQL truth to the exact isolated Suite 7 QA V4 index.
// Invoke only through with-dev-db-guard.cjs sprint7-opensearch-qa-reconcile.
const fs = require('node:fs');
const path = require('node:path');
const { Client: OpenSearchClient } = require('@opensearch-project/opensearch');
const { Client: PgClient } = require('pg');

const expectedDb = {
  host: '127.0.0.1',
  port: 55434,
  database: 'buscador_juridico_civil_deepqa',
  role: 'bjc_dev',
};
const expectedOs = {
  endpoint: 'http://127.0.0.1:19200',
  cluster: 'galilei-suite7-qa',
  clusterUuid: 'Vl0BD2lTTSWQkPyjhQB27Q',
  version: '2.19.6',
  alias: 'galilei-search-active',
};
const suiteRoot = path.resolve(__dirname, '../../../../');
const evidencePath = path.join(suiteRoot, 'evidence', 'sprint7-opensearch-qa-reconcile.json');

async function main() {
  if (
    process.env.BJC_SPRINT7_ALLOW_ISOLATED_DATABASE !== 'true' ||
    process.env.BJC_DEPLOYMENT_ENV !== 'development'
  ) throw new Error('SPRINT7_QA_ENVIRONMENT_NOT_ENABLED');

  const { getRuntimeDatabasePoolConfig } = require('../../dist/src/config/runtime-database-config.js');
  const { readOpenSearchConfig } = require('../../dist/src/busqueda/opensearch/opensearch-config.js');
  const { OpenSearchDocumentRepository } = require('../../dist/src/busqueda/opensearch/opensearch-document.repository.js');
  const { OpenSearchIndexService } = require('../../dist/src/busqueda/opensearch/opensearch-index.service.js');
  const databaseConfig = getRuntimeDatabasePoolConfig();
  if (
    databaseConfig.host !== expectedDb.host ||
    Number(databaseConfig.port) !== expectedDb.port ||
    databaseConfig.database !== expectedDb.database ||
    databaseConfig.user !== expectedDb.role
  ) throw new Error('SPRINT7_QA_DATABASE_TARGET_REJECTED');

  const pg = new PgClient(databaseConfig);
  await pg.connect();
  let identity;
  try {
    const result = await pg.query('SELECT host(inet_server_addr()) AS host, inet_server_port()::int AS port, current_database() AS database, current_user AS role');
    identity = result.rows[0];
  } finally {
    await pg.end();
  }
  if (
    identity.host !== expectedDb.host ||
    identity.port !== expectedDb.port ||
    identity.database !== expectedDb.database ||
    identity.role !== expectedDb.role
  ) throw new Error('SPRINT7_QA_DATABASE_IDENTITY_REJECTED');

  const bootstrapEvidence = JSON.parse(fs.readFileSync(path.join(path.dirname(evidencePath), 'sprint7-opensearch-qa.json'), 'utf8'));
  const target = bootstrapEvidence.target;
  if (!/^galilei-search-v004-\d{8}t\d{9}z-[a-f0-9]{8}$/u.test(target)) {
    throw new Error('SPRINT7_QA_SEARCH_TARGET_REJECTED');
  }
  process.env.OPENSEARCH_NODE = expectedOs.endpoint;
  process.env.OPENSEARCH_ALLOW_INSECURE_LOCAL = 'true';
  process.env.BJC_SEARCH_TOPOLOGY = 'fresh-v4';
  process.env.OPENSEARCH_SEARCH_SCHEMA_VERSION = '4';
  process.env.OPENSEARCH_INDEX_ALIAS = expectedOs.alias;
  process.env.OPENSEARCH_INDEX_PREFIX = 'galilei-search';
  process.env.OPENSEARCH_SEARCH_TARGET = target;
  process.env.OPENSEARCH_TRUSTED_PHYSICAL_WRITE = 'true';
  const config = readOpenSearchConfig();
  if (!config.trustedPhysicalWriter || config.searchTarget !== target) {
    throw new Error('SPRINT7_QA_TRUSTED_TARGET_REJECTED');
  }
  const client = new OpenSearchClient(config.clientOptions);
  try {
    const [infoResponse, healthResponse, aliasResponse] = await Promise.all([
      client.info(),
      client.cluster.health({ local: true }),
      client.indices.getAlias({ name: expectedOs.alias }),
    ]);
    const info = infoResponse.body;
    const health = healthResponse.body;
    const aliases = aliasResponse.body;
    if (
      info.cluster_name !== expectedOs.cluster ||
      info.cluster_uuid !== expectedOs.clusterUuid ||
      info.version?.number !== expectedOs.version ||
      health.status !== 'green' ||
      Object.keys(aliases).length !== 1 ||
      !Object.hasOwn(aliases, target)
    ) throw new Error('SPRINT7_QA_SEARCH_IDENTITY_REJECTED');

    const repository = new OpenSearchDocumentRepository(databaseConfig);
    const index = new OpenSearchIndexService(
      client,
      repository,
      expectedOs.alias,
      'galilei-search',
      4,
      false,
      target,
      true,
      true,
    );
    const projection = await index.projectFreshV4(target);
    const parity = await index.verifyFreshV4SourceParity(target, 50);
    if (!parity.pass || !parity.exactIdEquality || parity.missing !== 0 || parity.extra !== 0 || parity.sourceDifferences !== 0) {
      throw new Error('SPRINT7_QA_SEARCH_RECONCILIATION_FAILED');
    }
    const report = {
      database: { ...expectedDb, verified: true },
      search: {
        ...expectedOs,
        target,
        health: health.status,
        count: projection.total,
        projection,
        sourceParity: parity,
      },
      completedAt: new Date().toISOString(),
    };
    fs.writeFileSync(evidencePath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
    console.log(`SPRINT7_QA_SEARCH_RECONCILE=PASS; target=${target}; count=${projection.total}; parity=${parity.pass}`);
  } finally {
    await client.close();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : 'SPRINT7_QA_SEARCH_RECONCILIATION_FAILED');
  process.exitCode = 1;
});
