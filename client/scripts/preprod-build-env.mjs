import { isIP } from 'node:net';
import { pathToFileURL } from 'node:url';

function validatePreprodBuildEnvironment(env = process.env) {
  const rawApiOrigin = env.BJC_PREPROD_API_ORIGIN?.trim();
  const rawApiUrl = env.NEXT_PUBLIC_API_URL?.trim();
  if (!rawApiOrigin) throw new Error('BJC_PREPROD_API_ORIGIN_REQUIRED');
  if (!rawApiUrl) throw new Error('NEXT_PUBLIC_API_URL_REQUIRED');

  let apiOrigin;
  let apiUrl;
  try {
    apiOrigin = new URL(rawApiOrigin);
    apiUrl = new URL(rawApiUrl);
  } catch {
    throw new Error('PREPROD_API_URL_INVALID');
  }

  if (
    apiOrigin.protocol !== 'https:' ||
    apiOrigin.pathname !== '/' ||
    apiOrigin.search ||
    apiOrigin.hash ||
    apiOrigin.username ||
    apiOrigin.password ||
    apiUrl.protocol !== 'https:' ||
    apiUrl.origin !== apiOrigin.origin ||
    apiUrl.pathname !== '/api' ||
    apiUrl.search ||
    apiUrl.hash ||
    apiUrl.username ||
    apiUrl.password ||
    isLoopbackOrLocal(apiOrigin.hostname.replace(/^\[|\]$/gu, ''))
  ) {
    throw new Error('PREPROD_FRONTEND_API_MUST_MATCH_APPROVED_HTTPS_ORIGIN');
  }

  return { apiOrigin: apiOrigin.origin, apiPath: apiUrl.pathname };
}

function isLoopbackOrLocal(value) {
  const hostname = value.toLowerCase().replace(/\.$/u, '');
  if (hostname === 'localhost' || hostname.endsWith('.localhost')) return true;
  const kind = isIP(hostname);
  if (kind === 4) {
    const firstOctet = Number(hostname.split('.')[0]);
    return firstOctet === 127 || hostname === '0.0.0.0';
  }
  if (kind !== 6) return false;
  if (hostname === '::1' || hostname === '::') return true;
  const mapped = hostname.match(/^::ffff:(?:(\d{1,3}(?:\.\d{1,3}){3})|([0-9a-f]{1,4}):([0-9a-f]{1,4}))$/u);
  if (!mapped) return false;
  const ipv4 = mapped[1]
    ? mapped[1].split('.').map(Number)
    : [
        Number.parseInt(mapped[2] || '0', 16) >> 8,
        Number.parseInt(mapped[2] || '0', 16) & 255,
        Number.parseInt(mapped[3] || '0', 16) >> 8,
        Number.parseInt(mapped[3] || '0', 16) & 255,
      ];
  return ipv4.every((octet) => octet >= 0 && octet <= 255) && (ipv4[0] === 127 || ipv4.every((octet) => octet === 0));
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  try {
    const validated = validatePreprodBuildEnvironment();
    process.stdout.write(
      `PREPROD_FRONTEND_API_GUARD=PASS; origin=${validated.apiOrigin}; path=${validated.apiPath}\n`,
    );
  } catch (error) {
    process.stderr.write(
      `PREPROD_FRONTEND_API_GUARD=ABORT; ${error instanceof Error ? error.message : 'invalid configuration'}\n`,
    );
    process.exitCode = 2;
  }
}

export { validatePreprodBuildEnvironment };
