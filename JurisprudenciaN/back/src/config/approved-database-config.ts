import { X509Certificate } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { PoolConfig } from 'pg';
import {
  resolveDeploymentEnvironment,
  type DeploymentEnvironment,
} from './deployment-environment';
import { isLoopbackOrLocalHost } from './network-host';

export type ApprovedDatabaseProfile = 'preprod' | 'production';

export type ApprovedDatabaseConfig = {
  host: string;
  port: number;
  database: string;
  user: string;
  caPath: string;
  tlsMode: 'verify-full';
  /** Secret-bearing URL for Prisma CLI only; never log or persist it. */
  prismaCliUrl: string;
  pgConfig: PoolConfig;
};

const PROFILE_SETTINGS = {
  preprod: {
    envPrefix: 'BJC_PREPROD',
    approvalKey: 'BJC_PREPROD_DATABASE_APPROVED',
    approvalError:
      'La identidad de la base preprod requiere aprobación explícita.',
  },
  production: {
    envPrefix: 'BJC_PRODUCTION',
    approvalKey: 'BJC_PRODUCTION_DATABASE_APPROVED',
    approvalError:
      'La identidad de la base production requiere aprobación explícita.',
  },
} as const;

const RESERVED_ROLES = new Set(['bjc_dev', 'preprod_user']);

/** Parse one approved target, then derive consumer-specific pg/Prisma/libpq adapters. */
export function getApprovedDatabaseConfig(
  env: NodeJS.ProcessEnv,
  profile: ApprovedDatabaseProfile,
): ApprovedDatabaseConfig {
  const expectedEnvironment: DeploymentEnvironment = profile;
  if (resolveDeploymentEnvironment(env) !== expectedEnvironment) {
    throw new Error('DATABASE_DEPLOYMENT_ENVIRONMENT_MISMATCH');
  }

  const settings = PROFILE_SETTINGS[profile];
  const hostKey = `${settings.envPrefix}_DB_HOST`;
  const portKey = `${settings.envPrefix}_DB_PORT`;
  const nameKey = `${settings.envPrefix}_DB_NAME`;
  const userKey = `${settings.envPrefix}_DB_USER`;
  const caKey = `${settings.envPrefix}_DB_CA_PATH`;
  const required = [
    'DATABASE_URL',
    settings.approvalKey,
    hostKey,
    portKey,
    nameKey,
    userKey,
    caKey,
  ];
  const missing = required.filter((key) => !env[key]?.trim());
  if (missing.length) {
    throw new Error(
      `Configuración PostgreSQL ${profile} incompleta: ${missing.join(', ')}.`,
    );
  }
  if (env[settings.approvalKey] !== 'true')
    throw new Error(settings.approvalError);

  const expectedHost = normalizeHost(env[hostKey]!);
  const expectedPort = positivePort(env[portKey]!, portKey);
  const expectedDatabase = env[nameKey]!.trim();
  const expectedUser = env[userKey]!.trim();
  const passwordForbiddenForProfile =
    profile === 'preprod'
      ? expectedUser === 'bjc_dev'
      : RESERVED_ROLES.has(expectedUser);

  let databaseUrl: URL;
  try {
    databaseUrl = new URL(env.DATABASE_URL!);
  } catch {
    throw new Error('DATABASE_URL no es una URL PostgreSQL válida.');
  }
  if (databaseUrl.protocol !== 'postgresql:') {
    throw new Error('DATABASE_URL debe usar postgresql:.');
  }

  let actualUser: string;
  let password: string;
  let actualDatabase: string;
  try {
    actualUser = decodeURIComponent(databaseUrl.username);
    password = decodeURIComponent(databaseUrl.password);
    actualDatabase = decodeURIComponent(
      databaseUrl.pathname.replace(/^\//u, ''),
    );
  } catch {
    throw new Error(
      'DATABASE_URL contiene credenciales o identidad codificadas inválidas.',
    );
  }

  const actualHost = normalizeHost(databaseUrl.hostname);
  const actualPort = positivePort(databaseUrl.port, 'DATABASE_URL port');
  const caPath = resolveAndValidateCaPath(env[caKey]!, databaseUrl);
  const isLoopback = isLoopbackOrLocalHost(actualHost);
  if (
    databaseUrl.hash ||
    databaseUrl.href.includes('#') ||
    !password ||
    isLoopback ||
    actualHost !== expectedHost ||
    actualPort !== expectedPort ||
    !/^[A-Za-z_][A-Za-z0-9_]{0,62}$/u.test(actualDatabase) ||
    !/^[A-Za-z_][A-Za-z0-9_]{0,62}$/u.test(actualUser) ||
    actualDatabase !== expectedDatabase ||
    actualUser !== expectedUser ||
    (profile === 'preprod' &&
      actualDatabase !== 'buscador_juridico_civil_preprod') ||
    actualDatabase === 'buscador_juridico_civil_dev' ||
    (profile === 'production' &&
      actualDatabase === 'buscador_juridico_civil_preprod') ||
    passwordForbiddenForProfile
  ) {
    throw new Error(
      `DATABASE_URL no coincide con la identidad ${profile} aprobada.`,
    );
  }

  const ca = fs.readFileSync(caPath);
  const pgConfig: PoolConfig = {
    host: actualHost,
    port: actualPort,
    user: actualUser,
    password,
    database: actualDatabase,
    ssl: { ca, rejectUnauthorized: true },
  };
  const uriHost = actualHost.includes(':') ? `[${actualHost}]` : actualHost;
  const prismaCliUrl = new URL(
    `postgresql://${encodeURIComponent(actualUser)}:${encodeURIComponent(password)}@${uriHost}:${actualPort}/${encodeURIComponent(actualDatabase)}`,
  );
  // Prisma ORM 7 documents require + sslcert; libpq keeps its separate
  // verify-full + sslrootcert contract in the dump adapter.
  prismaCliUrl.searchParams.set('sslmode', 'require');
  prismaCliUrl.searchParams.set('sslcert', caPath);

  return {
    host: actualHost,
    port: actualPort,
    database: actualDatabase,
    user: actualUser,
    caPath,
    tlsMode: 'verify-full',
    prismaCliUrl: prismaCliUrl.toString(),
    pgConfig,
  };
}

function resolveAndValidateCaPath(configuredCaPath: string, databaseUrl: URL) {
  const parameters = [...databaseUrl.searchParams.entries()];
  const seen = new Set<string>();
  for (const [key] of parameters) {
    if (seen.has(key))
      throw new Error('DATABASE_URL_DUPLICATE_SECURITY_PARAMETER');
    seen.add(key);
    if (!['sslmode', 'sslrootcert'].includes(key)) {
      throw new Error('DATABASE_URL_UNSUPPORTED_CONNECTION_PARAMETER');
    }
  }

  const sslModes = databaseUrl.searchParams.getAll('sslmode');
  const rootCerts = databaseUrl.searchParams.getAll('sslrootcert');
  if (
    parameters.length !== 2 ||
    sslModes.length !== 1 ||
    sslModes[0] !== 'verify-full' ||
    rootCerts.length !== 1
  ) {
    throw new Error('DATABASE_URL_TLS_PARAMETERS_INVALID');
  }

  if (!path.isAbsolute(configuredCaPath) || !path.isAbsolute(rootCerts[0])) {
    throw new Error('DATABASE_CA_PATH_MUST_BE_ABSOLUTE');
  }

  let canonicalCaPath: string;
  let canonicalUrlCaPath: string;
  try {
    canonicalCaPath = fs.realpathSync.native(configuredCaPath);
    canonicalUrlCaPath = fs.realpathSync.native(rootCerts[0]);
  } catch {
    throw new Error('DATABASE_CA_FILE_UNREADABLE');
  }
  if (!samePath(canonicalCaPath, canonicalUrlCaPath)) {
    throw new Error('DATABASE_URL_CA_PATH_MISMATCH');
  }

  let contents: string;
  try {
    contents = fs.readFileSync(canonicalCaPath, 'utf8');
  } catch {
    throw new Error('DATABASE_CA_FILE_UNREADABLE');
  }
  const certificates =
    contents.match(
      /-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/gu,
    ) ?? [];
  if (!certificates.length) throw new Error('DATABASE_CA_CERTIFICATE_INVALID');

  let containsCa = false;
  try {
    for (const pem of certificates) {
      if (new X509Certificate(pem).ca) containsCa = true;
    }
  } catch {
    throw new Error('DATABASE_CA_CERTIFICATE_INVALID');
  }
  if (!containsCa) throw new Error('DATABASE_CA_CERTIFICATE_INVALID');

  return canonicalCaPath;
}

function positivePort(value: string, name: string) {
  if (!/^\d{1,5}$/u.test(value))
    throw new Error(`${name} debe ser un puerto explícito.`);
  const port = Number(value);
  if (!Number.isSafeInteger(port) || port < 1 || port > 65535) {
    throw new Error(`${name} debe estar entre 1 y 65535.`);
  }
  return port;
}

function normalizeHost(host: string) {
  return host
    .trim()
    .toLowerCase()
    .replace(/^\[|\]$/gu, '')
    .replace(/\.$/u, '');
}

function samePath(left: string, right: string) {
  const leftResolved = path.resolve(left).replace(/[\\/]+$/u, '');
  const rightResolved = path.resolve(right).replace(/[\\/]+$/u, '');
  return process.platform === 'win32'
    ? leftResolved.toLowerCase() === rightResolved.toLowerCase()
    : leftResolved === rightResolved;
}
