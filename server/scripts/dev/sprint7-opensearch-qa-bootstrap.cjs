#!/usr/bin/env node
// Builds an isolated V4 search projection only after proving both QA targets.
// Invoke only through with-dev-db-guard.cjs sprint7-opensearch-qa-bootstrap.
const fs = require('node:fs');
const path = require('node:path');
const { Client: OpenSearchClient } = require('@opensearch-project/opensearch');
const { Client: PgClient } = require('pg');
const {
  getRuntimeDatabasePoolConfig,
} = require('../../dist/src/config/runtime-database-config.js');
const {
  OpenSearchDocumentRepository,
} = require('../../dist/src/busqueda/opensearch/opensearch-document.repository.js');
const {
  OpenSearchIndexService,
} = require('../../dist/src/busqueda/opensearch/opensearch-index.service.js');
const {
  readOpenSearchConfig,
} = require('../../dist/src/busqueda/opensearch/opensearch-config.js');

const EXPECTED_PG = {
  host: '127.0.0.1',
  port: 55434,
  database: 'buscador_juridico_civil_deepqa',
  role: 'bjc_dev',
};
const EXPECTED_OS = {
  endpoint: 'http://127.0.0.1:19200',
  cluster: 'galilei-suite7-qa',
  version: '2.19.6',
};
const evidencePath = path.resolve(__dirname, '../../../../evidence/sprint7-opensearch-qa.json');

function bodyOf(response) {
  return response && typeof response === 'object' && 'body' in response
    ? response.body
    : response;
}

async function main() {
  if (
    process.env.BJC_SPRINT7_ALLOW_ISOLATED_DATABASE !== 'true' ||
    process.env.BJC_DEEP_QA_ALLOW_ISOLATED_DATABASE !== 'true' ||
    process.env.BJC_DEPLOYMENT_ENV !== 'development'
  ) {
    throw new Error('SPRINT7_QA_ENVIRONMENT_NOT_ENABLED');
  }
  const databaseConfig = getRuntimeDatabasePoolConfig();
  if (
    databaseConfig.host !== EXPECTED_PG.host ||
    Number(databaseConfig.port) !== EXPECTED_PG.port ||
    databaseConfig.database !== EXPECTED_PG.database ||
    databaseConfig.user !== EXPECTED_PG.role
  ) {
    throw new Error('SPRINT7_QA_DATABASE_TARGET_REJECTED');
  }
  const pg = new PgClient(databaseConfig);
  await pg.connect();
  try {
    const result = await pg.query(
      'SELECT host(inet_server_addr()) AS host, inet_server_port()::int AS port, current_database() AS database, current_user AS role',
    );
    const identity = result.rows[0];
    if (
      identity.host !== EXPECTED_PG.host ||
      identity.port !== EXPECTED_PG.port ||
      identity.database !== EXPECTED_PG.database ||
      identity.role !== EXPECTED_PG.role
    ) {
      throw new Error('SPRINT7_QA_DATABASE_IDENTITY_REJECTED');
    }
  } finally {
    await pg.end();
  }

  const stamp = new Date().toISOString().replace(/[-:.]/gu, '').toLowerCase();
  const random = require('node:crypto').randomUUID().slice(0, 8);
  const createdTarget = `galilei-search-v004-${stamp}-${random}`;
  process.env.OPENSEARCH_SEARCH_TARGET = createdTarget;
  const config = readOpenSearchConfig();
  if (
    config.node !== EXPECTED_OS.endpoint ||
    config.topology !== 'fresh-v4' ||
    config.searchSchemaVersion !== 4 ||
    config.alias !== 'galilei-search-active' ||
    config.indexPrefix !== 'galilei-search' ||
    !config.trustedPhysicalWriter
  ) {
    throw new Error('SPRINT7_QA_OPENSEARCH_CONFIG_REJECTED');
  }
  const client = new OpenSearchClient(config.clientOptions);
  let activated = false;
  try {
    const info = bodyOf(await client.info());
    if (
      info.cluster_name !== EXPECTED_OS.cluster ||
      info.version?.number !== EXPECTED_OS.version
    ) {
      throw new Error('SPRINT7_QA_OPENSEARCH_IDENTITY_REJECTED');
    }
    const health = bodyOf(await client.cluster.health({ local: true }));
    if (health.status !== 'green') {
      throw new Error('SPRINT7_QA_OPENSEARCH_NOT_GREEN');
    }
    const aliases = bodyOf(
      await client.indices.getAlias({ name: config.alias }).catch(() => ({ body: {} })),
    );
    if (Object.keys(aliases ?? {}).length !== 0) {
      throw new Error('SPRINT7_QA_SEARCH_ALIAS_ALREADY_EXISTS');
    }

    const repository = new OpenSearchDocumentRepository(databaseConfig);
    const index = new OpenSearchIndexService(
      client,
      repository,
      config.alias,
      config.indexPrefix,
      4,
      false,
      createdTarget,
      true,
      true,
    );
    await index.createFreshV4Index(createdTarget);
    const projection = await index.projectFreshV4(createdTarget);
    const parity = await index.verifyFreshV4SourceParity(createdTarget, 50);
    if (
      !parity.pass ||
      !parity.exactIdEquality ||
      parity.sourceDifferences !== 0 ||
      parity.missing !== 0 ||
      parity.extra !== 0
    ) {
      throw new Error('SPRINT7_QA_SEARCH_SOURCE_PARITY_FAILED');
    }
    await client.indices.updateAliases({
      body: {
        actions: [
          {
            add: {
              index: createdTarget,
              alias: config.alias,
              is_write_index: true,
            },
          },
        ],
      },
    });
    activated = true;
    const current = bodyOf(
      await client.indices.getAlias({ name: config.alias }),
    );
    if (Object.keys(current).length !== 1 || !current[createdTarget]) {
      throw new Error('SPRINT7_QA_SEARCH_ALIAS_VERIFICATION_FAILED');
    }
    const report = {
      database: { ...EXPECTED_PG, verified: true },
      opensearch: {
        ...EXPECTED_OS,
        clusterUuid: info.cluster_uuid,
        health: health.status,
        verified: true,
      },
      schemaVersion: 4,
      alias: config.alias,
      target: createdTarget,
      projection,
      sourceParity: parity,
      aliasActivated: true,
      createdAt: new Date().toISOString(),
    };
    fs.writeFileSync(evidencePath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
    console.log(
      `SPRINT7_QA_SEARCH=PASS; cluster=${EXPECTED_OS.cluster}; target=${createdTarget}; documents=${projection.total}; sourceParity=${parity.pass}`,
    );
  } catch (error) {
    if (createdTarget && !activated) {
      await client.indices.delete({ index: createdTarget }).catch(() => undefined);
    }
    throw error;
  } finally {
    await client.close();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : 'SPRINT7_QA_SEARCH_FAILED');
  process.exitCode = 1;
});
