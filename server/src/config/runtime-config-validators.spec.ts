import { validateHttpsOrigins } from './runtime-config-validators';

describe('runtime HTTPS origins', () => {
  it('accepts an explicit HTTPS origin', () => {
    expect(
      validateHttpsOrigins({ FRONTEND_URL: 'https://preprod.example.invalid' }),
    ).toEqual(['https://preprod.example.invalid']);
  });

  it.each([
    'http://preprod.example.invalid',
    'https://localhost',
    'https://127.0.0.1',
    'https://127.42.0.9',
    'https://[::1]',
    'https://[::ffff:7f00:1]',
    'https://user:pass@preprod.example.invalid',
    'https://preprod.example.invalid/path',
    'https://preprod.example.invalid?x=1',
    'https://preprod.example.invalid#fragment',
    'not a URL',
  ])('rejects invalid or local origin %s', (FRONTEND_URL) => {
    expect(() => validateHttpsOrigins({ FRONTEND_URL })).toThrow(/HTTPS/);
  });
});
