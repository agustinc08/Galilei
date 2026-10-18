const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);

function validatePreprodBuildEnvironment(env = process.env) {
  const rawApiOrigin = env.BJC_PREPROD_API_ORIGIN?.trim();
  const rawApiUrl = env.NEXT_PUBLIC_API_URL?.trim();
  if (!rawApiOrigin) throw new Error("BJC_PREPROD_API_ORIGIN_REQUIRED");
  if (!rawApiUrl) throw new Error("NEXT_PUBLIC_API_URL_REQUIRED");

  let apiOrigin;
  let apiUrl;
  try {
    apiOrigin = new URL(rawApiOrigin);
    apiUrl = new URL(rawApiUrl);
  } catch {
    throw new Error("PREPROD_API_URL_INVALID");
  }

  if (
    apiOrigin.protocol !== "https:" ||
    apiOrigin.origin !== rawApiOrigin ||
    apiUrl.protocol !== "https:" ||
    apiUrl.origin !== apiOrigin.origin ||
    apiUrl.pathname !== "/api" ||
    apiUrl.search ||
    apiUrl.hash ||
    apiUrl.username ||
    apiUrl.password ||
    LOOPBACK_HOSTS.has(apiOrigin.hostname.toLowerCase()) ||
    apiOrigin.hostname.toLowerCase().endsWith(".localhost")
  ) {
    throw new Error("PREPROD_FRONTEND_API_MUST_MATCH_APPROVED_HTTPS_ORIGIN");
  }

  return { apiOrigin: apiOrigin.origin, apiPath: apiUrl.pathname };
}

if (require.main === module) {
  try {
    const validated = validatePreprodBuildEnvironment();
    process.stdout.write(
      `PREPROD_FRONTEND_API_GUARD=PASS; origin=${validated.apiOrigin}; path=${validated.apiPath}\n`,
    );
  } catch (error) {
    process.stderr.write(
      `PREPROD_FRONTEND_API_GUARD=ABORT; ${error instanceof Error ? error.message : "invalid configuration"}\n`,
    );
    process.exitCode = 2;
  }
}

module.exports = { validatePreprodBuildEnvironment };
