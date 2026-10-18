import { isLoopbackOrLocalHost } from './network-host';

export const RATE_LIMIT_KEYS = [
  'API_RATE_LIMIT_WINDOW_MS',
  'API_RATE_LIMIT_AUTH_MAX',
  'API_RATE_LIMIT_SEARCH_MAX',
  'API_RATE_LIMIT_MATCHES_MAX',
  'API_RATE_LIMIT_DOWNLOAD_MAX',
] as const;

export function assertRequiredEnvironment(
  env: NodeJS.ProcessEnv,
  keys: string[],
) {
  const missing = keys.filter((key) => !env[key]?.trim());
  if (missing.length)
    throw new Error(`Configuración incompleta: ${missing.join(', ')}.`);
}

export function validateJwtConfiguration(env: NodeJS.ProcessEnv) {
  const secret = env.JWT_SECRET!;
  if (secret.length < 32 || /change[-_ ]?me|example|secret/iu.test(secret)) {
    throw new Error(
      'JWT_SECRET debe tener al menos 32 caracteres y no ser un valor de ejemplo.',
    );
  }
  if (!/^\d{1,6}(s|m|h|d)$/u.test(env.JWT_EXPIRES_IN!)) {
    throw new Error(
      'JWT_EXPIRES_IN debe declararse explícitamente como intervalo (s, m, h o d).',
    );
  }
}

export function validateHttpsOrigins(env: NodeJS.ProcessEnv) {
  const origins = [env.FRONTEND_URL, ...(env.FRONTEND_URLS?.split(',') ?? [])]
    .map((origin) => origin?.trim())
    .filter((origin): origin is string => Boolean(origin));
  if (!origins.length || origins.some((origin) => !isSecureOrigin(origin))) {
    throw new Error(
      'FRONTEND_URL/FRONTEND_URLS requiere origins HTTPS explícitos, públicos y sin wildcard.',
    );
  }
  return [...new Set(origins)];
}

export function validateRateLimitConfiguration(
  env: NodeJS.ProcessEnv,
  replicasKey: 'BJC_PREPROD_REPLICAS' | 'BJC_PRODUCTION_REPLICAS',
  environmentName: 'preprod' | 'production',
) {
  if (env.API_RATE_LIMIT_ENABLED !== 'true') {
    throw new Error(
      `API_RATE_LIMIT_ENABLED debe ser true en ${environmentName}.`,
    );
  }
  const replicas = positiveInteger(env[replicasKey]!, replicasKey);
  if (replicas !== 1) {
    throw new Error(
      `El rate limit actual es por proceso; ${environmentName} requiere una sola réplica.`,
    );
  }
  for (const key of RATE_LIMIT_KEYS) positiveInteger(env[key]!, key);
  const statementTimeout = positiveInteger(
    env.BJC_SEARCH_STATEMENT_TIMEOUT_MS!,
    'BJC_SEARCH_STATEMENT_TIMEOUT_MS',
  );
  if (statementTimeout > 4500) {
    throw new Error(
      'BJC_SEARCH_STATEMENT_TIMEOUT_MS no puede exceder 4500 ms.',
    );
  }
}

function positiveInteger(value: string, name: string) {
  if (!/^\d+$/u.test(value))
    throw new Error(`${name} debe ser un entero positivo.`);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    throw new Error(`${name} debe ser un entero positivo.`);
  }
  return parsed;
}

function isSecureOrigin(value: string) {
  try {
    const parsed = new URL(value);
    const hostname = parsed.hostname.toLowerCase().replace(/^\[|\]$/gu, '');
    return (
      parsed.protocol === 'https:' &&
      parsed.origin === value &&
      !parsed.username &&
      !parsed.password &&
      !isLoopbackOrLocalHost(hostname)
    );
  } catch {
    return false;
  }
}
