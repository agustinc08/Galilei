const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { rootCertificates } = require('node:tls');

test('preprod check validates isolation without connecting and rejects URL query routing', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bjc-preprod-guard-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const storage = {};
  for (const environment of ['dev', 'preprod', 'production']) {
    storage[environment] = path.join(root, `${environment}-storage`);
    fs.mkdirSync(storage[environment]);
  }
  const caPath = path.join(root, 'root-ca.pem');
  fs.writeFileSync(caPath, rootCertificates[0]);
  const password = 'synthetic-preprod-password-not-a-real-secret';
  const encodedCa = encodeURIComponent(caPath);
  const databaseUrl = `postgresql://preprod_runtime:${password}@preprod-db.internal:5432/buscador_juridico_civil_preprod?sslmode=verify-full&sslrootcert=${encodedCa}`;
  const env = { ...process.env };
  for (const key of [
    'BUSQUEDA_DEBUG',
    'BJC_SEARCH_PROFILE',
    'BJC_SEARCH_EXPLAIN_CAPTURE',
    'OPENSEARCH_CANDIDATE_ONLY',
  ])
    delete env[key];
  Object.assign(env, {
    NODE_ENV: 'production',
    BJC_DEPLOYMENT_ENV: 'preprod',
    DATABASE_URL: databaseUrl,
    BJC_PREPROD_DATABASE_APPROVED: 'true',
    BJC_PREPROD_DB_HOST: 'preprod-db.internal',
    BJC_PREPROD_DB_PORT: '5432',
    BJC_PREPROD_DB_NAME: 'buscador_juridico_civil_preprod',
    BJC_PREPROD_DB_USER: 'preprod_runtime',
    BJC_PREPROD_DB_CA_PATH: caPath,
    JWT_SECRET: 'K7m4V9q2X6b1N8c3R5t0W4y7A2d9F6h1P8u3',
    JWT_EXPIRES_IN: '2h',
    FRONTEND_URL: 'https://preprod.example.intra',
    BJC_CORPUS_STORAGE_PATH: storage.preprod,
    BJC_DEV_CORPUS_STORAGE_PATH: storage.dev,
    BJC_PRODUCTION_CORPUS_STORAGE_PATH: storage.production,
    BJC_API_BIND_HOST: '127.0.0.1',
    API_RATE_LIMIT_ENABLED: 'true',
    BJC_PREPROD_REPLICAS: '1',
    API_RATE_LIMIT_WINDOW_MS: '60000',
    API_RATE_LIMIT_AUTH_MAX: '15',
    API_RATE_LIMIT_SEARCH_MAX: '120',
    API_RATE_LIMIT_MATCHES_MAX: '120',
    API_RATE_LIMIT_DOWNLOAD_MAX: '120',
    BJC_SEARCH_STATEMENT_TIMEOUT_MS: '4000',
    SEARCH_ENGINE: 'opensearch',
    OPENSEARCH_NODE: 'https://preprod-search.internal:9200',
    OPENSEARCH_USERNAME: 'preprod-search-user',
    OPENSEARCH_PASSWORD: 'synthetic-opensearch-password',
    OPENSEARCH_INDEX_ALIAS: 'galilei-preprod-search-active',
    OPENSEARCH_INDEX_PREFIX: 'galilei-preprod-search',
  });

  const guard = path.resolve(__dirname, 'with-preprod-db-guard.cjs');
  const safe = spawnSync(process.execPath, [guard, 'check'], {
    cwd: path.resolve(__dirname, '..'),
    env,
    encoding: 'utf8',
  });
  assert.equal(safe.status, 0, safe.stderr);
  assert.match(safe.stdout, /NO_DATABASE_CONNECTION=TRUE/u);
  assert.equal(safe.stdout.includes(databaseUrl), false);
  assert.equal(safe.stdout.includes(password), false);

  const redirected = spawnSync(process.execPath, [guard, 'check'], {
    cwd: path.resolve(__dirname, '..'),
    env: {
      ...env,
      DATABASE_URL: `${databaseUrl}&host=production-db.invalid`,
    },
    encoding: 'utf8',
  });
  assert.equal(redirected.status, 2);
  assert.match(
    redirected.stderr,
    /DATABASE_URL_UNSUPPORTED_CONNECTION_PARAMETER/u,
  );
  assert.equal(redirected.stderr.includes(password), false);
});

test('preprod migration guard passes only the canonical Prisma URL to its child', (t) => {
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), 'bjc-preprod-migration-guard-'),
  );
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const storage = {};
  for (const environment of ['dev', 'preprod', 'production']) {
    storage[environment] = path.join(root, `${environment}-storage`);
    fs.mkdirSync(storage[environment]);
  }
  const caPath = path.join(root, 'root-ca.pem');
  fs.writeFileSync(caPath, rootCertificates[0]);
  const password = 'synthetic-preprod-password-not-a-real-secret';
  const databaseUrl = `postgresql://preprod_runtime:${password}@preprod-db.internal:5432/buscador_juridico_civil_preprod?sslmode=verify-full&sslrootcert=${encodeURIComponent(caPath)}`;
  const capturePath = path.join(root, 'child-capture.json');
  const preloadPath = path.join(root, 'intercept-preprod-guard.cjs');
  fs.writeFileSync(
    preloadPath,
    `
    const Module = require('node:module');
    const { EventEmitter } = require('node:events');
    const originalLoad = Module._load;
    Module._load = function(request, parent, isMain) {
      if (request === './preprod-target-verify.cjs' && /with-preprod-db-guard/u.test(parent.filename)) {
        return { verifyPreprodTarget: async () => undefined };
      }
      const loaded = originalLoad.call(this, request, parent, isMain);
      if (request === 'node:child_process' && /with-preprod-db-guard/u.test(parent.filename)) {
        loaded.spawn = (command, args, options) => {
          require('node:fs').writeFileSync(process.env.BJC_GUARD_TEST_CAPTURE, JSON.stringify({
            command, args, databaseUrl: options.env.DATABASE_URL,
            guardValidated: options.env.BJC_PREPROD_GUARD_VALIDATED,
          }));
          const child = new EventEmitter();
          process.nextTick(() => child.emit('exit', 0, null));
          return child;
        };
      }
      return loaded;
    };
  `,
    'utf8',
  );

  const env = { ...process.env };
  for (const key of [
    'BUSQUEDA_DEBUG',
    'BJC_SEARCH_PROFILE',
    'BJC_SEARCH_EXPLAIN_CAPTURE',
    'OPENSEARCH_CANDIDATE_ONLY',
  ])
    delete env[key];
  Object.assign(env, {
    NODE_ENV: 'production',
    BJC_DEPLOYMENT_ENV: 'preprod',
    DATABASE_URL: databaseUrl,
    BJC_PREPROD_DATABASE_APPROVED: 'true',
    BJC_PREPROD_DB_HOST: 'preprod-db.internal',
    BJC_PREPROD_DB_PORT: '5432',
    BJC_PREPROD_DB_NAME: 'buscador_juridico_civil_preprod',
    BJC_PREPROD_DB_USER: 'preprod_runtime',
    BJC_PREPROD_DB_CA_PATH: caPath,
    JWT_SECRET: 'K7m4V9q2X6b1N8c3R5t0W4y7A2d9F6h1P8u3',
    JWT_EXPIRES_IN: '2h',
    FRONTEND_URL: 'https://preprod.example.intra',
    BJC_CORPUS_STORAGE_PATH: storage.preprod,
    BJC_DEV_CORPUS_STORAGE_PATH: storage.dev,
    BJC_PRODUCTION_CORPUS_STORAGE_PATH: storage.production,
    BJC_API_BIND_HOST: '127.0.0.1',
    API_RATE_LIMIT_ENABLED: 'true',
    BJC_PREPROD_REPLICAS: '1',
    API_RATE_LIMIT_WINDOW_MS: '60000',
    API_RATE_LIMIT_AUTH_MAX: '15',
    API_RATE_LIMIT_SEARCH_MAX: '120',
    API_RATE_LIMIT_MATCHES_MAX: '120',
    API_RATE_LIMIT_DOWNLOAD_MAX: '120',
    BJC_SEARCH_STATEMENT_TIMEOUT_MS: '4000',
    SEARCH_ENGINE: 'opensearch',
    OPENSEARCH_NODE: 'https://preprod-search.internal:9200',
    OPENSEARCH_USERNAME: 'preprod-search-user',
    OPENSEARCH_PASSWORD: 'synthetic-opensearch-password',
    OPENSEARCH_INDEX_ALIAS: 'galilei-preprod-search-active',
    OPENSEARCH_INDEX_PREFIX: 'galilei-preprod-search',
    BJC_GUARD_TEST_CAPTURE: capturePath,
    NODE_OPTIONS: `--require="${preloadPath.replace(/\\/gu, '/')}"`,
  });

  const guard = path.resolve(__dirname, 'with-preprod-db-guard.cjs');
  const result = spawnSync(process.execPath, [guard, 'migrate-status'], {
    cwd: path.resolve(__dirname, '..'),
    env,
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.includes(databaseUrl), false);
  assert.equal(result.stdout.includes(password), false);
  const child = JSON.parse(fs.readFileSync(capturePath, 'utf8'));
  assert.equal(child.guardValidated, 'true');
  assert.equal(child.args.at(-1), 'pnpm.cmd exec prisma migrate status');
  assert.notEqual(child.databaseUrl, databaseUrl);
  assert.equal(child.databaseUrl.includes(password), true);
  const generated = new URL(child.databaseUrl);
  assert.equal(generated.searchParams.get('sslmode'), 'require');
  assert.equal(generated.searchParams.get('sslaccept'), 'strict');
  assert.equal(generated.searchParams.get('sslcert'), caPath);
  assert.equal(generated.searchParams.has('sslrootcert'), false);
});
