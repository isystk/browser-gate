import { isIPv4, isIPv6 } from 'node:net';

type Cidr4 = readonly [base: string, bits: number];

const BLOCKED_IPV4_RANGES: readonly Cidr4[] = [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.88.99.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
];

const IPV6_HEXTET_COUNT = 8;
const IPV4_OCTET_COUNT = 4;

/** Returns true if the address is not a publicly routable unicast address or cannot be parsed. */
export function isBlockedIp(address: string): boolean {
  if (isIPv4(address)) return isBlockedIpv4(ipv4ToNumber(address));
  if (isIPv6(address) && !address.includes('%'))
    return isBlockedIpv6(expandIpv6(address));
  return true;
}

function ipv4ToNumber(address: string): number {
  const octets = address.split('.').map(Number);
  return octets.reduce((acc, octet) => acc * 256 + octet, 0);
}

function isBlockedIpv4(value: number): boolean {
  return BLOCKED_IPV4_RANGES.some(([base, bits]) =>
    isInRange4(value, ipv4ToNumber(base), bits),
  );
}

function isInRange4(value: number, base: number, bits: number): boolean {
  const size = 2 ** (32 - bits);
  return Math.floor(value / size) === Math.floor(base / size);
}

function embeddedIpv4(high: number, low: number): number {
  return high * 65536 + low;
}

function isBlockedIpv6(h: readonly number[]): boolean {
  const [h0 = 0, h1 = 0, h2 = 0, h3 = 0, h4 = 0, h5 = 0, h6 = 0, h7 = 0] = h;
  const firstFiveZero =
    h0 === 0 && h1 === 0 && h2 === 0 && h3 === 0 && h4 === 0;
  if (firstFiveZero && h5 === 0xffff)
    return isBlockedIpv4(embeddedIpv4(h6, h7));
  if (firstFiveZero && h5 === 0) return true;
  if (
    h0 === 0x64 &&
    h1 === 0xff9b &&
    h2 === 0 &&
    h3 === 0 &&
    h4 === 0 &&
    h5 === 0
  ) {
    return isBlockedIpv4(embeddedIpv4(h6, h7));
  }
  if (h0 === 0x64 && h1 === 0xff9b && h2 === 1) return true;
  if (h0 === 0x2002) return isBlockedIpv4(embeddedIpv4(h1, h2));
  return !isGlobalUnicast(h0, h1);
}

function isGlobalUnicast(h0: number, h1: number): boolean {
  if ((h0 & 0xe000) !== 0x2000) return false;
  if (h0 === 0x2001 && (h1 & 0xfe00) === 0) return false;
  if (h0 === 0x2001 && h1 === 0x0db8) return false;
  if (h0 === 0x3fff && (h1 & 0xf000) === 0) return false;
  return true;
}

function expandIpv6(address: string): number[] {
  const [head = '', tail] = address.split('::');
  const headParts = splitHextets(head);
  if (tail === undefined) return headParts;
  const tailParts = splitHextets(tail);
  const zeros = new Array<number>(
    IPV6_HEXTET_COUNT - headParts.length - tailParts.length,
  ).fill(0);
  return [...headParts, ...zeros, ...tailParts];
}

function splitHextets(part: string): number[] {
  if (part === '') return [];
  return part.split(':').flatMap(parseHextet);
}

function parseHextet(token: string): number[] {
  if (!token.includes('.')) return [Number.parseInt(token, 16)];
  const octets = token.split('.').map(Number);
  if (octets.length !== IPV4_OCTET_COUNT) return [];
  const [a = 0, b = 0, c = 0, d = 0] = octets;
  return [a * 256 + b, c * 256 + d];
}
