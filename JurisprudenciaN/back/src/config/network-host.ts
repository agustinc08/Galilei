import { isIP } from 'node:net';

export function isLoopbackOrLocalHost(value: string) {
  const host = value
    .trim()
    .toLowerCase()
    .replace(/^\[|\]$/gu, '')
    .replace(/\.$/u, '');
  if (host === 'localhost' || host.endsWith('.localhost')) return true;
  if (isIP(host) === 4) {
    return Number(host.split('.')[0]) === 127 || host === '0.0.0.0';
  }
  if (isIP(host) !== 6) return false;
  if (host === '::1' || host === '::') return true;

  const words = expandIpv6(host);
  if (
    !words ||
    words.slice(0, 5).some((word) => word !== 0) ||
    words[5] !== 0xffff
  ) {
    return false;
  }
  const firstMappedOctet = words[6] >> 8;
  return firstMappedOctet === 127 || (words[6] === 0 && words[7] === 0);
}

function expandIpv6(host: string) {
  const normalized = host.replace(
    /:(\d{1,3}(?:\.\d{1,3}){3})$/u,
    (_match, dotted: string) => {
      const octets = dotted.split('.').map(Number);
      if (octets.some((octet) => octet < 0 || octet > 255)) return ':invalid';
      const high = ((octets[0] << 8) | octets[1]).toString(16);
      const low = ((octets[2] << 8) | octets[3]).toString(16);
      return `:${high}:${low}`;
    },
  );
  const halves = normalized.split('::');
  if (halves.length > 2) return null;
  const left = halves[0] ? halves[0].split(':') : [];
  const right = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
  const missing = 8 - left.length - right.length;
  if ((halves.length === 1 && missing !== 0) || missing < 0) return null;
  const groups = [...left, ...new Array<string>(missing).fill('0'), ...right];
  if (
    groups.length !== 8 ||
    groups.some((group) => !/^[0-9a-f]{1,4}$/u.test(group))
  )
    return null;
  return groups.map((group) => Number.parseInt(group, 16));
}
