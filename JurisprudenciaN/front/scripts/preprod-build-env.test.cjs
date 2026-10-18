const test = require("node:test");
const assert = require("node:assert/strict");
const { validatePreprodBuildEnvironment } = require("./preprod-build-env.cjs");

const valid = {
  BJC_PREPROD_API_ORIGIN: "https://api-preprod.example.invalid",
  NEXT_PUBLIC_API_URL: "https://api-preprod.example.invalid/api",
};

test("accepts the approved HTTPS API origin and exact /api base", () => {
  assert.deepEqual(validatePreprodBuildEnvironment(valid), {
    apiOrigin: "https://api-preprod.example.invalid",
    apiPath: "/api",
  });
});

test("rejects the frontend default localhost API fallback", () => {
  assert.throws(
    () =>
      validatePreprodBuildEnvironment({
        ...valid,
        NEXT_PUBLIC_API_URL: "http://localhost:4001/api",
      }),
    /PREPROD_FRONTEND_API_MUST_MATCH_APPROVED_HTTPS_ORIGIN/,
  );
});

test("rejects a browser API URL that differs from the approved API origin", () => {
  assert.throws(
    () =>
      validatePreprodBuildEnvironment({
        ...valid,
        NEXT_PUBLIC_API_URL: "https://dev-api.example.invalid/api",
      }),
    /PREPROD_FRONTEND_API_MUST_MATCH_APPROVED_HTTPS_ORIGIN/,
  );
});

test("rejects non-root API paths, credentials and query strings", () => {
  for (const NEXT_PUBLIC_API_URL of [
    "https://api-preprod.example.invalid/v2/api",
    "https://user:pass@api-preprod.example.invalid/api",
    "https://api-preprod.example.invalid/api?debug=true",
  ]) {
    assert.throws(
      () => validatePreprodBuildEnvironment({ ...valid, NEXT_PUBLIC_API_URL }),
      /PREPROD_FRONTEND_API_MUST_MATCH_APPROVED_HTTPS_ORIGIN/,
    );
  }
});

test("requires explicit values and rejects loopback origins", () => {
  assert.throws(
    () => validatePreprodBuildEnvironment({}),
    /BJC_PREPROD_API_ORIGIN_REQUIRED/,
  );
  assert.throws(
    () =>
      validatePreprodBuildEnvironment({
        BJC_PREPROD_API_ORIGIN: "https://localhost",
        NEXT_PUBLIC_API_URL: "https://localhost/api",
      }),
    /PREPROD_FRONTEND_API_MUST_MATCH_APPROVED_HTTPS_ORIGIN/,
  );
});
