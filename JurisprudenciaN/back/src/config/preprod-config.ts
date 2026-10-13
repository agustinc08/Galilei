import fs from 'node:fs';
import path from 'node:path';

const RATE_LIMIT_KEYS = [
  'API_RATE_LIMIT_WINDOW_MS',
  'API_RATE_LIMIT_AUTH_MAX',
  'API_RATE_LIMIT_SEARCH_MAX',
  'API_RATE_LIMIT_MATCHES_MAX',
  'API_RATE_LIMIT_DOWNLOAD_MAX',
] as const;

/** Validates explicit, non-secret preproduction identity and runtime settings. */
export function validatePreproductionConfig(env: NodeJS.ProcessEnv = process.env) {
  const required = [
    'DATABASE_URL',
    'BJC_PREPROD_DATABASE_APPROVED',
    'BJC_PREPROD_DB_HOST',
    'BJC_PREPROD_DB_PORT',
    'BJC_PREPROD_DB_NAME',
    'BJC_PREPROD_DB_USER',
    'JWT_SECRET',
    'JWT_EXPIRES_IN',
    'BJC_CORPUS_STORAGE_PATH',
    'API_RATE_LIMIT_ENABLED',
    'BJC_PREPROD_REPLICAS',
    'BJC_SEARCH_STATEMENT_TIMEOUT_MS',
    ...RATE_LIMIT_KEYS,
  ];
  const missing = required.filter((key) => !env[key]?.trim());
  if (missing.length) {
    throw new Error(`Configuración preprod incompleta: ${missing.join(', ')}.`);
  }

  if (env.NODE_ENV !== 'production' || env.BJC_DEPLOYMENT_ENV !== 'preprod') {
    throw new Error('Preproducción requiere NODE_ENV=production y BJC_DEPLOYMENT_ENV=preprod.');
  }
  if (env.BJC_PREPROD_DATABASE_APPROVED !== 'true') {
    throw new Error('La identidad de la base preprod requiere aprobación explícita.');
  }

  let database: URL;
  try {
    database = new URL(env.DATABASE_URL!);
  } catch {
    throw new Error('DATABASE_URL preprod no es una URL válida.');
  }
  const actualDatabase = decodeURIComponent(database.pathname.replace(/^\//u, ''));
  const actualUser = decodeURIComponent(database.username);
  const expectedPort = positiveInteger(env.BJC_PREPROD_DB_PORT!, 'BJC_PREPROD_DB_PORT');
  const databaseHost = database.hostname.toLowerCase().replace(/^\[|\]$/gu, '');
  const databaseIsLoopback = databaseHost === 'localhost' || databaseHost.endsWith('.localhost') ||
    databaseHost === '::1' || /^127(?:\.\d{1,3}){3}$/u.test(databaseHost);
  if (
    database.protocol !== 'postgresql:' ||
    !database.password ||
    databaseIsLoopback ||
    databaseHost !== env.BJC_PREPROD_DB_HOST!.toLowerCase() ||
    database.port !== String(expectedPort) ||
    actualDatabase !== env.BJC_PREPROD_DB_NAME ||
    actualUser !== env.BJC_PREPROD_DB_USER ||
    actualDatabase === 'buscador_juridico_civil_dev' ||
    actualUser === 'bjc_dev'
  ) {
    throw new Error('DATABASE_URL no coincide con la identidad preprod aprobada o apunta a DEV.');
  }

  const jwtSecret = env.JWT_SECRET!;
  if (jwtSecret.length < 32 || /change[-_ ]?me|example|secret/iu.test(jwtSecret)) {
    throw new Error('JWT_SECRET preprod debe tener al menos 32 caracteres y no ser un valor de ejemplo.');
  }
  if (!/^\d{1,6}(s|m|h|d)$/u.test(env.JWT_EXPIRES_IN!)) {
    throw new Error('JWT_EXPIRES_IN preprod debe declararse explícitamente como intervalo (s, m, h o d).');
  }

  const origins = [env.FRONTEND_URL, ...(env.FRONTEND_URLS?.split(',') ?? [])]
    .map((origin) => origin?.trim())
    .filter((origin): origin is string => Boolean(origin));
  if (!origins.length || origins.some((origin) => !isSecureOrigin(origin))) {
    throw new Error('CORS preprod requiere FRONTEND_URL/FRONTEND_URLS con origins HTTPS explícitos, sin wildcard.');
  }

  const storageRoot = env.BJC_CORPUS_STORAGE_PATH!;
  if (!path.isAbsolute(storageRoot) || storageRoot.toLowerCase().includes('_dev-corpus-storage')) {
    throw new Error('BJC_CORPUS_STORAGE_PATH debe ser absoluto y separado del storage DEV.');
  }
  try {
    if (!fs.statSync(storageRoot).isDirectory()) throw new Error();
  } catch {
    throw new Error('BJC_CORPUS_STORAGE_PATH debe existir y ser un directorio persistente.');
  }

  if (env.API_RATE_LIMIT_ENABLED !== 'true') {
    throw new Error('API_RATE_LIMIT_ENABLED debe ser true en preprod.');
  }
  const replicas = positiveInteger(env.BJC_PREPROD_REPLICAS!, 'BJC_PREPROD_REPLICAS');
  if (replicas !== 1) {
    throw new Error('El rate limit actual es por proceso; preprod requiere una sola réplica.');
  }
  for (const key of RATE_LIMIT_KEYS) positiveInteger(env[key]!, key);
  const statementTimeout = positiveInteger(env.BJC_SEARCH_STATEMENT_TIMEOUT_MS!, 'BJC_SEARCH_STATEMENT_TIMEOUT_MS');
  if (statementTimeout > 4500) {
    throw new Error('BJC_SEARCH_STATEMENT_TIMEOUT_MS no puede exceder 4500 ms.');
  }

  return {
    databaseHost: database.hostname,
    databasePort: database.port,
    databaseName: actualDatabase,
    databaseUser: actualUser,
    frontendOrigins: [...new Set(origins)],
    storageRoot,
  };
}

function positiveInteger(value: string, name: string) {
  if (!/^\d+$/u.test(value)) throw new Error(`${name} debe ser un entero positivo.`);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    throw new Error(`${name} debe ser un entero positivo.`);
  }
  return parsed;
}

function isSecureOrigin(value: string) {
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'https:' && parsed.origin === value && parsed.origin !== 'https://*';
  } catch {
    return false;
  }
}
