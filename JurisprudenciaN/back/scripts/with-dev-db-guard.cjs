#!/usr/bin/env node
// Runs a child command only when the local development URL is the exact DEV target.
// Never prints the URL because it contains a credential.
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

const envFile = path.resolve(__dirname, '..', '.env.development.local');
if (!fs.existsSync(envFile)) {
  console.error('DEV_DB_GUARD=ABORT; .env.development.local is missing.');
  process.exit(2);
}

const contents = fs.readFileSync(envFile, 'utf8');
const match = contents.match(/^\s*DATABASE_URL\s*=\s*(.*?)\s*$/m);
if (!match) {
  console.error('DEV_DB_GUARD=ABORT; DATABASE_URL is missing.');
  process.exit(2);
}

const rawUrl = match[1].replace(/^(["'])(.*)\1$/, '$2');
let target;
try {
  target = new URL(rawUrl);
} catch {
  console.error('DEV_DB_GUARD=ABORT; DATABASE_URL is invalid.');
  process.exit(2);
}

const valid =
  target.protocol === 'postgresql:' &&
  target.hostname === '127.0.0.1' &&
  target.port === '55432' &&
  target.pathname === '/buscador_juridico_civil_dev' &&
  target.username === 'bjc_dev';

if (!valid) {
  console.error(
    'DEV_DB_GUARD=ABORT; expected bjc_dev@127.0.0.1:55432/buscador_juridico_civil_dev.',
  );
  process.exit(2);
}

// Pass the already-validated local DEV URL to the child process. Several
// integration tests instantiate PrismaService directly and do not load Nest's
// .env.development.local configuration on their own.
process.env.DATABASE_URL = rawUrl;

const actions = {
  'prisma-generate': 'pnpm.cmd exec prisma generate',
  'prisma-format': 'pnpm.cmd exec prisma format',
  'prisma-validate': 'pnpm.cmd exec prisma validate',
  'prisma-migrate-status': 'pnpm.cmd exec prisma migrate status',
  'prisma-migrate-deploy': 'pnpm.cmd exec prisma migrate deploy',
  typecheck: 'pnpm.cmd exec tsc --noEmit',
  'schema-verify': 'node scripts/dev/verify-search-schema.cjs',
  'fixture-import':
    'pnpm.cmd exec ts-node scripts/dev/import-search-fixture.ts',
  benchmark: 'pnpm.cmd exec ts-node scripts/dev/benchmark-search-adapters.ts',
  'profile-performance':
    'pnpm.cmd exec ts-node scripts/dev/profile-search-performance.ts',
  'profile-after':
    'pnpm.cmd exec ts-node scripts/dev/profile-search-performance.ts after',
  'sprint122-term-profile':
    'pnpm.cmd exec ts-node scripts/dev/profile-search-performance.ts after TERM',
  'sprint122-term-benchmark':
    'pnpm.cmd exec ts-node scripts/dev/sprint122-term-benchmark.ts',
  'sprint122-semantic-parity':
    'pnpm.cmd exec ts-node scripts/dev/sprint122-semantic-parity.ts',
  'sprint122-field-parity':
    'pnpm.cmd exec ts-node scripts/dev/sprint122-semantic-parity.ts --family=FIELD',
  'sprint122-backup':
    'pnpm.cmd exec ts-node scripts/dev/sprint122-backup.ts',
  'sprint122-final-backup':
    'pnpm.cmd exec ts-node scripts/dev/sprint122-backup.ts --final',
  'sprint123-final-backup':
    'pnpm.cmd exec ts-node scripts/dev/sprint122-backup.ts --final',
  'sprint122-explain':
    'pnpm.cmd exec ts-node scripts/dev/sprint122-explain.ts',
  'sprint122-migration-schema':
    'pnpm.cmd exec ts-node scripts/dev/sprint122-migration-schema-smoke.ts',
  'sprint122-concurrency':
    'pnpm.cmd exec ts-node scripts/dev/sprint121-concurrency.ts',
  'sprint122-corpus-benchmark':
    'pnpm.cmd exec ts-node scripts/dev/sprint121-corpus-benchmark.ts',
  'sprint122-search-after':
    'pnpm.cmd exec ts-node scripts/dev/sprint12-search-benchmark.ts after',
  'sprint122-search-term-after':
    'pnpm.cmd exec ts-node scripts/dev/sprint12-search-benchmark.ts after TERM_COMMON',
  'sprint123-search-after':
    'pnpm.cmd exec ts-node scripts/dev/sprint12-search-benchmark.ts after',
  'sprint123-search-term-after':
    'pnpm.cmd exec ts-node scripts/dev/sprint12-search-benchmark.ts after TERM_COMMON',
  'sprint123-search-phrase-after':
    'pnpm.cmd exec ts-node scripts/dev/sprint12-search-benchmark.ts after PHRASE',
  'sprint123-search-short-after':
    'pnpm.cmd exec ts-node scripts/dev/sprint12-search-benchmark.ts after SHORT_TERM',
  'sprint123-search-path-comparison':
    'pnpm.cmd exec ts-node scripts/dev/sprint123-search-path-comparison.ts',
  'sprint123-explain':
    'pnpm.cmd exec ts-node scripts/dev/sprint123-search-explain.ts',
  'sprint123-concurrency':
    'pnpm.cmd exec ts-node scripts/dev/sprint121-concurrency.ts',
  'sprint123-parity':
    'pnpm.cmd exec ts-node scripts/dev/benchmark-search-adapters.ts',
  'sprint148-parity':
    'pnpm.cmd exec ts-node scripts/dev/benchmark-search-adapters.ts',
  'sprint148-search-term-after':
    'pnpm.cmd exec ts-node scripts/dev/sprint12-search-benchmark.ts after TERM_COMMON',
  'sprint148-search-phrase-after':
    'pnpm.cmd exec ts-node scripts/dev/sprint12-search-benchmark.ts after PHRASE',
  'sprint149-search-before':
    'pnpm.cmd exec ts-node scripts/dev/sprint12-search-benchmark.ts baseline',
  'sprint1491-search-before':
    'pnpm.cmd exec ts-node scripts/dev/sprint12-search-benchmark.ts baseline PHRASE',
  'sprint1491-search-after':
    'pnpm.cmd exec ts-node scripts/dev/sprint12-search-benchmark.ts after PHRASE',
  'sprint1492-search-before':
    'pnpm.cmd exec ts-node scripts/dev/sprint12-search-benchmark.ts baseline',
  'sprint1492-search-after':
    'pnpm.cmd exec ts-node scripts/dev/sprint12-search-benchmark.ts after',
  'sprint1492-search-phrase-after':
    'pnpm.cmd exec ts-node scripts/dev/sprint12-search-benchmark.ts after PHRASE',
  'sprint1492-parity':
    'pnpm.cmd exec ts-node scripts/dev/benchmark-search-adapters.ts',
  'sprint1492-search-verify':
    'pnpm.cmd exec ts-node scripts/dev/sprint122-search-projection.ts verify',
  'sprint1492-viewer-smoke':
    'pnpm.cmd exec ts-node scripts/dev/sprint148-viewer-smoke.ts',
  'sprint1492-concurrency':
    'pnpm.cmd exec ts-node scripts/dev/sprint121-concurrency.ts',
  'sprint149-search-after':
    'pnpm.cmd exec ts-node scripts/dev/sprint12-search-benchmark.ts after',
  'sprint149-search-phrase-after':
    'pnpm.cmd exec ts-node scripts/dev/sprint12-search-benchmark.ts after PHRASE',
  'sprint149-profile-before':
    'pnpm.cmd exec ts-node scripts/dev/sprint149-profile.ts before',
  'sprint149-profile-after':
    'pnpm.cmd exec ts-node scripts/dev/sprint149-profile.ts after',
  'sprint1492-profile-before':
    'pnpm.cmd exec ts-node scripts/dev/sprint149-profile.ts before',
  'sprint1492-profile-after':
    'pnpm.cmd exec ts-node scripts/dev/sprint149-profile.ts after',
  'sprint149-backup-before':
    'pnpm.cmd exec ts-node scripts/dev/sprint122-backup.ts',
  'sprint149-index-audit':
    'pnpm.cmd exec ts-node scripts/dev/sprint149-index-audit.ts',
  'sprint1491-vacuum-analyze':
    'pnpm.cmd exec ts-node scripts/dev/sprint1491-vacuum-analyze.ts',
  'sprint149-search-tests':
    'pnpm.cmd exec jest --runInBand --testTimeout=120000 --testPathPatterns=corpus-search.adapter.spec.ts --testPathPatterns=search-parser.spec.ts',
  'sprint149-parity':
    'pnpm.cmd exec ts-node scripts/dev/benchmark-search-adapters.ts',
  'sprint149-search-verify':
    'pnpm.cmd exec ts-node scripts/dev/sprint122-search-projection.ts verify',
  'sprint149-viewer-smoke':
    'pnpm.cmd exec ts-node scripts/dev/sprint148-viewer-smoke.ts',
  'sprint149-concurrency':
    'pnpm.cmd exec ts-node scripts/dev/sprint121-concurrency.ts',
  'sprint15-postgres-tests':
    'pnpm.cmd exec jest --runInBand --testTimeout=120000 --testPathPatterns=workspace-document.integration.spec.ts',
  'sprint1561-postgres-tests':
    'pnpm.cmd exec jest --runInBand --testTimeout=180000 --testPathPatterns=workspace-document.integration.spec.ts',
  'sprint1561-acl-tests':
    'pnpm.cmd exec jest --runInBand --testTimeout=180000 --testPathPatterns=sprint1561-personal-acl.integration.spec.ts',
  'sprint1561-e2e-users':
    'pnpm.cmd exec ts-node scripts/dev/sprint1561-e2e-users.ts',
  'sprint1561-e2e-cleanup':
    'pnpm.cmd exec ts-node scripts/dev/sprint1561-e2e-cleanup.ts',
  'sprint1561-default-queue-repro':
    'pnpm.cmd exec jest --runInBand --testTimeout=180000 --testPathPatterns=workspace-document.integration.spec.ts',
  'sprint1511-postgres-tests':
    'pnpm.cmd exec jest --runInBand --testTimeout=300000 --testPathPatterns=workspace-document.integration.spec.ts',
  'sprint152-source-tests':
    'pnpm.cmd exec jest --runInBand --testTimeout=300000 --testPathPatterns=document-source.integration.spec.ts',
  'sprint152-search-smoke':
    'pnpm.cmd exec ts-node scripts/dev/sprint152-search-smoke.ts',
  'sprint152-backup-before':
    'pnpm.cmd exec ts-node scripts/dev/sprint122-backup.ts',
  'sprint15-full-tests':
    'pnpm.cmd exec jest --runInBand --testTimeout=300000',
  'sprint155-golden':
    'set SPRINT155_POSTGRES_TEST=1&& pnpm.cmd exec jest --runInBand --testTimeout=300000 --testPathPatterns=sprint155-search-golden.integration.spec.ts',
  'sprint155-baseline':
    'pnpm.cmd exec ts-node scripts/dev/sprint155-baseline.ts',
  'sprint155-real-sample':
    'pnpm.cmd exec ts-node scripts/dev/sprint155-real-corpus-sample.ts',
  'sprint154a1-e2e-cleanup':
    'pnpm.cmd exec ts-node scripts/dev/sprint154a1-e2e-cleanup.ts',
  'sprint154a1-residue-audit':
    'pnpm.cmd exec ts-node scripts/dev/sprint154a1-residue-cleanup.ts',
  'sprint154a1-residue-cleanup':
    'pnpm.cmd exec ts-node scripts/dev/sprint154a1-residue-cleanup.ts --apply',
  'sprint151-ui-tests': 'node scripts/dev/sprint151-ui-run.cjs',
  'sprint148-explain':
    'pnpm.cmd exec ts-node scripts/dev/sprint123-search-explain.ts',
  'sprint148-viewer-smoke':
    'pnpm.cmd exec ts-node scripts/dev/sprint148-viewer-smoke.ts',
  'sprint122-search-projection-rebuild':
    'pnpm.cmd exec ts-node scripts/dev/sprint122-search-projection.ts rebuild',
  'sprint122-search-projection-verify':
    'pnpm.cmd exec ts-node scripts/dev/sprint122-search-projection.ts verify',
  'sprint122-search-projection-repair':
    'pnpm.cmd exec ts-node scripts/dev/sprint122-search-projection.ts repair',
  'sprint122-search-reindex':
    'pnpm.cmd exec ts-node scripts/dev/sprint122-search-reindex.ts',
  'sprint122-parity':
    'pnpm.cmd exec ts-node scripts/dev/benchmark-search-adapters.ts',
  'profile-suffix-match':
    'pnpm.cmd exec ts-node scripts/dev/profile-search-performance.ts after SUFFIX_MATCHING',
  'profile-identifier':
    'pnpm.cmd exec ts-node scripts/dev/profile-search-performance.ts after IDENTIFIER_FIELD',
  explain: 'pnpm.cmd exec ts-node scripts/dev/explain-search.ts',
  'explain-before':
    'pnpm.cmd exec ts-node scripts/dev/explain-search-performance.ts before',
  'explain-after':
    'pnpm.cmd exec ts-node scripts/dev/explain-search-performance.ts after',
  test: 'pnpm.cmd test --runInBand --testTimeout=120000',
  'postgres-tests':
    'pnpm.cmd exec jest --runInBand --testTimeout=120000 --testPathPatterns=postgres-jurisprudencia-search.adapter.spec.ts',
  'postgres-parity':
    'pnpm.cmd exec jest --runInBand --testTimeout=120000 --testPathPatterns=postgres-jurisprudencia-search.adapter.spec.ts --testNamePattern=BJC-001',
  'corpus-tests':
    'set NODE_OPTIONS=--experimental-vm-modules&& pnpm.cmd exec jest --runInBand --testTimeout=120000 --testPathPatterns=corpus.integration.spec.ts',
  'corpus-package-tests':
    'set NODE_OPTIONS=--experimental-vm-modules&& pnpm.cmd exec jest --runInBand --testTimeout=120000 --testPathPatterns=corpus-package.integration.spec.ts',
  'sprint9-postgres-tests':
    'pnpm.cmd exec jest --runInBand --testTimeout=120000 --testPathPatterns=corpus-curation.integration.spec.ts',
  'corpus-package': 'pnpm.cmd exec ts-node scripts/dev/corpus-package.ts',
  'civil-pilot-verify': 'pnpm.cmd exec ts-node scripts/sources/civil/verify-pilot.ts',
  'civil-current-verify': 'pnpm.cmd exec ts-node scripts/sources/civil/verify-current-feed.ts',
  'civil-coverage-summary': 'pnpm.cmd exec ts-node scripts/sources/civil/coverage-summary.ts',
  'civil-quantification-snapshot': 'pnpm.cmd exec ts-node scripts/sources/civil/quantification-corpus-snapshot.ts',
  'sprint148-audit': 'node scripts/dev/sprint148-live-audit.cjs',
  'sprint-j1-audit': 'node scripts/dev/sprint-j1-audit.cjs',
  'j7-corpus-quality-audit': 'node scripts/dev/jurisprudencia-corpus-quality-audit.cjs',
  'j7-quality-repair-dry-run': 'node scripts/dev/jurisprudencia-quality-repair-dry-run.cjs',
  'sprint-j712-historical-sala-readonly': 'node scripts/dev/sprint-j712-historical-sala-run.cjs',
  'sprint-j713-historical-sala-review-pack': 'node scripts/dev/sprint-j713-historical-sala-review-pack.cjs',
  'sprint-j8-civil-certification': 'node scripts/dev/sprint-j8-civil-certification.cjs',
  'sprint-j9-readonly-audit': 'node scripts/dev/sprint-j9-readonly-audit.cjs',
  'sprint-j911-readonly-audit': 'node scripts/dev/sprint-j911-readonly-audit.cjs',
  'sprint-j901-eligibility': 'node scripts/dev/sprint-j901-publication-eligibility.cjs',
  'sprint-j901-find-synthetic': 'node scripts/dev/sprint-j901-find-synthetic.cjs',
  'sprint-j901-api-benchmark': 'node scripts/dev/sprint-j901-api-benchmark.cjs',
  'sprint-j901-publication-dry-run': 'node scripts/dev/sprint-j901-publication-backfill.cjs --dry-run',
  'sprint-j901-publication-apply': 'node scripts/dev/sprint-j901-publication-backfill.cjs --apply',
  'sprint-j901-demote-collisions': 'node scripts/dev/sprint-j901-demote-collisions.cjs --apply',
  'sprint-j901-cleanup': 'node scripts/dev/sprint-j901-cleanup-batch.cjs --apply',
  'sprint-j9-postgres-tests': 'pnpm.cmd exec jest --runInBand --testTimeout=120000 --runTestsByPath src/sentencias/sentencias.workflow.integration.spec.ts',
  'sprint-j5-readonly': 'node scripts/dev/jurisprudencia-candidate-recovery.cjs',
  'sprint-j6-readonly': 'node scripts/dev/jurisprudencia-primary-identity.cjs',
  'sprint-j5-restore-projection-marker': 'node scripts/dev/sprint-j5-restore-projection-marker.cjs',
  'sprint-j2-first-instance-audit': 'node scripts/dev/sprint-j2-first-instance-audit.cjs',
  'sprint-j1-backup': 'pnpm.cmd exec ts-node scripts/dev/backup-dev-db.ts',
  'sprint-j1-write-dry-run': 'node scripts/dev/sprint-j1-apply.cjs',
  'sprint-j1-apply': 'node scripts/dev/sprint-j1-apply.cjs',
  'sprint148-ingest-preflight': 'node scripts/dev/sprint148-ingest.cjs',
  'sprint148-ingest': 'node scripts/dev/sprint148-ingest.cjs',
  'institutional-backup': 'pnpm.cmd exec ts-node scripts/dev/backup-dev-db.ts',
  'institutional-associations':
    'pnpm.cmd exec ts-node scripts/dev/preview-institutional-associations.ts',
  'institutional-ingest':
    'pnpm.cmd exec ts-node scripts/dev/ingest-institutional-pdfs.ts',
  'institutional-incremental':
    'pnpm.cmd exec ts-node scripts/dev/institutional-incremental-scan.ts',
  'institutional-ocr-pilot':
    'pnpm.cmd exec ts-node scripts/dev/ocr-institutional-pilot.ts',
  'sprint10-digesto-scan':
    'pnpm.cmd exec ts-node scripts/dev/sprint10-digesto-scan.ts',
  'sprint10-digesto-import':
    'pnpm.cmd exec ts-node scripts/dev/sprint10-digesto-import.ts',
  'sprint10-acceptance-seed':
    'pnpm.cmd exec ts-node scripts/dev/sprint10-acceptance-seed.ts',
  'sprint10-ocr-ground-truth':
    'pnpm.cmd exec ts-node scripts/dev/sprint10-ocr-ground-truth.ts',
  'sprint10-postgres-tests':
    'pnpm.cmd exec jest --runInBand --testTimeout=120000 --testPathPatterns=sprint10-pilot.integration.spec.ts',
  'sprint11-search-profile': 'pnpm.cmd exec ts-node scripts/dev/sprint11-search-profile.ts',
  'sprint11-db-audit': 'pnpm.cmd exec ts-node scripts/dev/sprint11-db-audit.ts',
  'sprint11-explain': 'pnpm.cmd exec ts-node scripts/dev/sprint11-explain.ts',
  'sprint11-backup-verify': 'pnpm.cmd exec ts-node scripts/dev/sprint11-backup-verify.ts',
  'sprint11-concurrency': 'pnpm.cmd exec ts-node scripts/dev/sprint11-concurrency.ts',
  'sprint11-ocr-eval': 'pnpm.cmd exec ts-node scripts/dev/sprint11-ocr-eval.ts',
  'sprint11-viewer-audit': 'pnpm.cmd exec ts-node scripts/dev/sprint11-viewer-audit.ts',
  'sprint11-demo-prepare': 'pnpm.cmd exec ts-node scripts/dev/sprint11-demo-prepare.ts',
  'sprint12-search-baseline': 'pnpm.cmd exec ts-node scripts/dev/sprint12-search-benchmark.ts baseline',
  'sprint12-search-after': 'pnpm.cmd exec ts-node scripts/dev/sprint12-search-benchmark.ts after',
  'sprint12-explain': 'pnpm.cmd exec ts-node scripts/dev/sprint12-explain.ts',
  'sprint12-explain-after': 'pnpm.cmd exec ts-node scripts/dev/sprint12-explain.ts after',
  'sprint12-backup-verify': 'pnpm.cmd exec ts-node scripts/dev/sprint12-backup-verify.ts',
  'sprint12-db-preflight': 'pnpm.cmd exec ts-node scripts/dev/sprint12-db-preflight.ts',
  'sprint12-concurrency': 'pnpm.cmd exec ts-node scripts/dev/sprint12-concurrency.ts',
  'sprint121-db-probe': 'pnpm.cmd exec ts-node scripts/dev/sprint121-db-probe.ts',
  'sprint121-explain': 'pnpm.cmd exec ts-node scripts/dev/sprint121-explain.ts',
  'sprint121-corpus-benchmark': 'pnpm.cmd exec ts-node scripts/dev/sprint121-corpus-benchmark.ts',
  'sprint121-backup': 'pnpm.cmd exec ts-node scripts/dev/sprint121-backup.ts',
  'sprint121-parity': 'pnpm.cmd exec ts-node scripts/dev/benchmark-search-adapters.ts',
  'sprint121-concurrency': 'pnpm.cmd exec ts-node scripts/dev/sprint121-concurrency.ts',
  'sprint121-legacy-explain': 'pnpm.cmd exec ts-node scripts/dev/sprint121-legacy-explain.ts',
  'sprint121-search-after': 'pnpm.cmd exec ts-node scripts/dev/sprint12-search-benchmark.ts after',
  'institutional-classify':
    'pnpm.cmd exec ts-node scripts/dev/classify-institutional-documents.ts',
  'institutional-classification-evaluate':
    'pnpm.cmd exec ts-node scripts/dev/evaluate-institutional-classification.ts',
  'institutional-status':
    'pnpm.cmd exec ts-node scripts/dev/institutional-run-status.ts',
  'institutional-search-smoke':
    'pnpm.cmd exec ts-node scripts/dev/institutional-search-smoke.ts',
  'institutional-search-explain':
    'pnpm.cmd exec ts-node scripts/dev/explain-institutional-search.ts',
  'institutional-reconcile':
    'pnpm.cmd exec ts-node scripts/dev/reconcile-institutional-run.ts',
  'institutional-associations-reconcile':
    'pnpm.cmd exec ts-node scripts/dev/reconcile-institutional-associations.ts',
  'search-smoke':
    'pnpm.cmd exec ts-node scripts/dev/smoke-search-regression.ts',
  build: 'pnpm.cmd build',
  serve: 'pnpm.cmd exec node dist/src/main.js',
};
const action = process.argv[2];
const commandLine = actions[action];
if (!commandLine) {
  console.error(
    `Usage: node scripts/with-dev-db-guard.cjs <${Object.keys(actions).join('|')}>`,
  );
  process.exit(2);
}

const childEnv = {
  ...process.env,
  DATABASE_URL: rawUrl,
  DOTENV_CONFIG_PATH: envFile,
  SEARCH_SPIKE_SQLITE_PATH: path.resolve(
    __dirname,
    '../../../_legacy-audit-work/extracted/jurisprudencia/jurisp_6/db/jurisprudencia_db.sqlite',
  ),
  SEARCH_POSTGRES_TEST:
    action === 'postgres-tests' || action === 'postgres-parity' || action === 'sprint122-parity' || action === 'sprint123-parity' ? '1' : '',
  CORPUS_POSTGRES_TEST: action === 'corpus-tests' ? '1' : '',
  CORPUS_PACKAGE_POSTGRES_TEST: action === 'corpus-package-tests' ? '1' : '',
  SPRINT9_POSTGRES_TEST: action === 'sprint9-postgres-tests' ? '1' : '',
  SPRINT10_POSTGRES_TEST: action === 'sprint10-postgres-tests' ? '1' : '',
  SPRINT_J9_POSTGRES_TEST: action === 'sprint-j9-postgres-tests' ? '1' : '',
  SPRINT15_POSTGRES_TEST: action === 'sprint15-postgres-tests' || action === 'sprint15-full-tests' || action === 'sprint1511-postgres-tests' || action.startsWith('sprint1561-') ? '1' : '',
  SPRINT1561_POSTGRES_TEST: action.startsWith('sprint1561-') ? '1' : '',
  BJC_OCR_QUEUE_NAME: action === 'sprint1561-postgres-tests'
    ? `sprint1561-${process.pid}-${Date.now()}`
    : action === 'sprint1561-default-queue-repro'
      ? 'default'
      : process.env.BJC_OCR_QUEUE_NAME,
  SPRINT152_SOURCE_TEST: action === 'sprint152-source-tests' ? '1' : '',
  BJC_SPRINT1511_PHASE: action === 'sprint1511-postgres-tests' || action === 'sprint15-full-tests' ? 'after' : process.env.BJC_SPRINT1511_PHASE,
  BJC_SEARCH_PROFILE: action === 'sprint11-search-profile' || action.startsWith('sprint121-search-') || action.startsWith('sprint122-search-') || action.startsWith('sprint123-search-') || action.startsWith('sprint148-search-') || action.startsWith('sprint149-search-') || action.startsWith('sprint1491-search-') || action.startsWith('sprint1492-search-') || action === 'sprint121-concurrency' || action === 'sprint122-concurrency' || action === 'sprint123-concurrency' || action === 'sprint149-concurrency' || action === 'sprint1492-concurrency' ? 'true' : '',
  BJC_SEARCH_STATEMENT_TIMEOUT_MS: action === 'sprint1492-parity' || action === 'sprint1561-postgres-tests' ? '4500' : process.env.BJC_SEARCH_STATEMENT_TIMEOUT_MS,
  BJC_SEARCH_BENCHMARK_ROOT: action.startsWith('sprint1492-search-') ? path.resolve(__dirname, '../../../_recovery-work/sprint1492') : action.startsWith('sprint1491-search-') ? path.resolve(__dirname, '../../../_recovery-work/sprint1491') : action.startsWith('sprint121-search-') ? path.resolve(__dirname, '../../../_recovery-work/sprint121/performance') : action.startsWith('sprint122-search-') ? path.resolve(__dirname, '../../../_recovery-work/sprint122/performance') : action.startsWith('sprint123-search-') ? path.resolve(__dirname, '../../../_recovery-work/sprint123/performance') : action.startsWith('sprint148-search-') ? path.resolve(__dirname, '../../../_recovery-work/sprint148/performance') : action.startsWith('sprint149-search-') ? path.resolve(__dirname, '../../../_recovery-work/sprint149/performance') : '',
  BJC_SPRINT122: action.startsWith('sprint122-') ? 'true' : '',
  BJC_SPRINT123: action.startsWith('sprint123-') ? 'true' : '',
  BJC_SPRINT148: action.startsWith('sprint148-search-') || action === 'sprint148-explain' ? 'true' : '',
  BJC_SPRINT149: action.startsWith('sprint149-') ? 'true' : '',
  BJC_SPRINT1491: action.startsWith('sprint1491-') ? 'true' : '',
  BJC_SPRINT1492: action.startsWith('sprint1492-') ? 'true' : '',
  BJC_SPRINT152: action.startsWith('sprint152-') ? 'true' : '',
  BJC_SPRINT_PROFILE_ROOT: action.startsWith('sprint1492-profile-') ? path.resolve(__dirname, '../../../_recovery-work/sprint1492') : '',
  BJC_SPRINT_PROFILE_SKIP_DIRECT: action.startsWith('sprint1492-profile-') ? 'true' : '',
  NODE_OPTIONS: action === 'sprint15-postgres-tests' || action === 'sprint15-full-tests' || action === 'sprint1511-postgres-tests' || action.startsWith('sprint1561-') || action === 'sprint152-source-tests' ? '--experimental-vm-modules' : action === 'sprint122-concurrency' ? '--trace-warnings' : process.env.NODE_OPTIONS,
  BJC_BENCHMARK_OUTPUT_ROOT: action === 'sprint121-parity' ? 'sprint121' : action === 'sprint122-parity' ? 'sprint122' : action === 'sprint123-parity' ? 'sprint123' : action === 'sprint148-parity' ? 'sprint148' : action === 'sprint149-parity' ? 'sprint149' : action === 'sprint1492-parity' ? 'sprint1492' : '',
  BJC_BENCHMARK_OUTPUT_PATH: action === 'sprint121-parity' ? path.resolve(__dirname, '../../../_recovery-work/sprint121/parity/benchmark.json') : action === 'sprint122-parity' ? path.resolve(__dirname, '../../../_recovery-work/sprint122/parity/benchmark.json') : action === 'sprint123-parity' ? path.resolve(__dirname, '../../../_recovery-work/sprint123/parity/benchmark.json') : action === 'sprint148-parity' ? path.resolve(__dirname, '../../../_recovery-work/sprint148/parity/benchmark.json') : action === 'sprint149-parity' ? path.resolve(__dirname, '../../../_recovery-work/sprint149/parity/benchmark.json') : action === 'sprint1492-parity' ? path.resolve(__dirname, '../../../_recovery-work/sprint1492/parity/benchmark.json') : '',
  BJC_CONCURRENCY_WAVES: action === 'sprint149-concurrency' || action === 'sprint1492-concurrency' ? '1,5,10' : process.env.BJC_CONCURRENCY_WAVES,
  BJC_CONCURRENCY_REQUESTS_PER_USER: action === 'sprint149-concurrency' || action === 'sprint1492-concurrency' ? '1' : process.env.BJC_CONCURRENCY_REQUESTS_PER_USER,
  BJC_CONCURRENCY_SEARCH_QUERY: action === 'sprint149-concurrency' || action === 'sprint1492-concurrency' ? '"responsabilidad civil"' : process.env.BJC_CONCURRENCY_SEARCH_QUERY,
  BJC_CORPUS_PACKAGE_ARGS:
    action === 'corpus-package' ? JSON.stringify(process.argv.slice(3)) : '',
  BJC_SPRINT148_MODE: action === 'sprint148-audit' ? (process.argv[3] || 'dry-run') : '',
  BJC_SPRINT_J1_MODE: action === 'sprint-j1-apply' ? 'apply' : action === 'sprint-j1-write-dry-run' ? 'dry-run' : '',
  BJC_DEV_BACKUP_DIR: action === 'sprint-j1-backup'
    ? path.resolve(__dirname, '../../../_recovery-work/jurisprudencia-j1/backups')
    : process.env.BJC_DEV_BACKUP_DIR,
  BJC_DEV_BACKUP_LABEL: action === 'sprint-j1-backup' ? 'sprint-j1-prewrite' : process.env.BJC_DEV_BACKUP_LABEL,
  BJC_SPRINT148_INGEST_MODE: action === 'sprint148-ingest-preflight' ? 'preflight' : '',
  BJC_CORPUS_STORAGE_PATH: action === 'sprint148-ingest'
    ? path.resolve(__dirname, '../../../_dev-corpus-storage')
    : action === 'sprint151-ui-tests'
      ? path.resolve(__dirname, '../../../_dev-corpus-storage-test/sprint151-ui')
      : process.env.BJC_CORPUS_STORAGE_PATH,
  BJC_INSTITUTIONAL_ARGS: action.startsWith('institutional-')
    ? JSON.stringify(process.argv.slice(3))
    : '',
};
if (action === 'sprint151-ui-tests') {
  fs.mkdirSync(childEnv.BJC_CORPUS_STORAGE_PATH, { recursive: true });
}
console.log(
  'DEV_DB_GUARD=PASS; host=127.0.0.1; port=55432; database=buscador_juridico_civil_dev; role=bjc_dev',
);

const child = spawn(
  process.env.ComSpec || 'cmd.exe',
  ['/d', '/s', '/c', commandLine],
  {
    cwd: path.resolve(__dirname, '..'),
    env: childEnv,
    stdio: 'inherit',
    shell: false,
  },
);
child.on('error', (error) => {
  console.error(`DEV_DB_GUARD child process failed: ${error.message}`);
  process.exitCode = 1;
});
child.on('exit', (code, signal) => {
  if (signal) {
    console.error(`Child exited with signal ${signal}.`);
    process.exitCode = 1;
  } else {
    process.exitCode = code ?? 1;
  }
});
