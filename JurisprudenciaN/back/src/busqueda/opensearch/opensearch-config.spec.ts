import { readOpenSearchConfig } from './opensearch-config';

const local = {
  OPENSEARCH_NODE: 'http://127.0.0.1:9200',
  OPENSEARCH_ALLOW_INSECURE_LOCAL: 'true',
};

describe('OpenSearch runtime config security', () => {
  it('allows explicitly enabled loopback HTTP only outside production', () => {
    const config = readOpenSearchConfig({ ...local, NODE_ENV: 'development' });
    expect(config.allowInsecureLocal).toBe(true);
    expect(config.alias).toBe('galilei-search-active');
    expect(config.indexPrefix).toBe('galilei-search');
  });

  it('rejects loopback HTTP without the explicit development flag', () => {
    expect(() =>
      readOpenSearchConfig({
        OPENSEARCH_NODE: local.OPENSEARCH_NODE,
        NODE_ENV: 'development',
      }),
    ).toThrow('OPENSEARCH_INSECURE_ENDPOINT_REJECTED');
  });

  it('rejects HTTP in production even if the insecure flag is set', () => {
    expect(() =>
      readOpenSearchConfig({ ...local, NODE_ENV: 'production' }),
    ).toThrow('OPENSEARCH_INSECURE_ENDPOINT_REJECTED');
  });

  it('rejects non-loopback HTTP in development', () => {
    expect(() =>
      readOpenSearchConfig({
        ...local,
        OPENSEARCH_NODE: 'http://search.internal:9200',
      }),
    ).toThrow('OPENSEARCH_INSECURE_ENDPOINT_REJECTED');
  });

  it('requires auth for production HTTPS and keeps certificate verification on', () => {
    expect(() =>
      readOpenSearchConfig({
        OPENSEARCH_NODE: 'https://search.example:9200',
        NODE_ENV: 'production',
      }),
    ).toThrow('OPENSEARCH_PRODUCTION_CREDENTIALS_REQUIRED');
    const config = readOpenSearchConfig({
      OPENSEARCH_NODE: 'https://search.example:9200',
      NODE_ENV: 'production',
      OPENSEARCH_USERNAME: 'search-user',
      OPENSEARCH_PASSWORD: 'local-test-only',
    });
    expect(config.clientOptions.node).toBe('https://search.example:9200');
    expect(config.clientOptions).not.toHaveProperty('ssl');
  });

  it('rejects credentials embedded in a URL and paired credential omissions', () => {
    expect(() =>
      readOpenSearchConfig({
        OPENSEARCH_NODE: 'https://user:pass@search.example:9200',
      }),
    ).toThrow('OPENSEARCH_NODE_INVALID');
    expect(() =>
      readOpenSearchConfig({ ...local, OPENSEARCH_USERNAME: 'only-user' }),
    ).toThrow('OPENSEARCH_CREDENTIAL_PAIR_REQUIRED');
  });

  it('rejects endpoint paths and accepts explicitly enabled IPv6 loopback', () => {
    expect(() =>
      readOpenSearchConfig({
        ...local,
        OPENSEARCH_NODE: 'http://127.0.0.1:9200/other',
      }),
    ).toThrow('OPENSEARCH_NODE_INVALID');
    expect(
      readOpenSearchConfig({
        OPENSEARCH_NODE: 'http://[::1]:9200',
        OPENSEARCH_ALLOW_INSECURE_LOCAL: 'true',
        NODE_ENV: 'development',
      }).allowInsecureLocal,
    ).toBe(true);
  });

  it('accepts a validated environment-specific alias and physical-index prefix', () => {
    const config = readOpenSearchConfig({
      OPENSEARCH_NODE: 'https://preprod-search.internal:9200',
      OPENSEARCH_USERNAME: 'preprod-search-user',
      OPENSEARCH_PASSWORD: 'synthetic-test-only',
      OPENSEARCH_INDEX_ALIAS: 'galilei-preprod-search-active',
      OPENSEARCH_INDEX_PREFIX: 'galilei-preprod-search',
      BJC_DEPLOYMENT_ENV: 'preprod',
      NODE_ENV: 'production',
    });
    expect(config.alias).toBe('galilei-preprod-search-active');
    expect(config.indexPrefix).toBe('galilei-preprod-search');
  });

  it('rejects invalid physical-index prefixes', () => {
    expect(() =>
      readOpenSearchConfig({
        ...local,
        OPENSEARCH_INDEX_PREFIX: 'Galilei DEV',
        NODE_ENV: 'development',
      }),
    ).toThrow('OPENSEARCH_INDEX_PREFIX_INVALID');
  });
});
