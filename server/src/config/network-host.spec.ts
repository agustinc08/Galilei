import { isLoopbackOrLocalHost } from './network-host';

describe('loopback host classification', () => {
  it.each([
    'localhost',
    'service.localhost',
    '127.0.0.1',
    '127.99.1.2',
    '0.0.0.0',
    '::1',
    '[::1]',
    '::',
    '::ffff:127.0.0.1',
    '::ffff:7f00:1',
    '0:0:0:0:0:ffff:7f00:1',
  ])('rejects local host %s', (host) => {
    expect(isLoopbackOrLocalHost(host)).toBe(true);
  });

  it.each(['preprod-db.internal', '10.10.4.8', '2001:db8::4'])(
    'accepts non-loopback host %s',
    (host) => {
      expect(isLoopbackOrLocalHost(host)).toBe(false);
    },
  );
});
