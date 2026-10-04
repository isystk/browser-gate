import { describe, expect, it } from 'vitest';

import { AppError } from '../../src/lib/errors.js';
import { isBlockedIp } from '../../src/security/ipGuard.js';
import {
  DEFAULT_EGRESS_POLICY,
  assertHostPortAllowed,
  assertProxyAllowed,
  parseTargetUrl,
} from '../../src/security/urlGuard.js';

const BLOCKED_IPV4 = [
  '0.0.0.0',
  '10.0.0.1',
  '10.255.255.255',
  '100.64.0.1',
  '127.0.0.1',
  '127.255.255.254',
  '169.254.169.254',
  '169.254.0.1',
  '172.16.0.1',
  '172.31.255.255',
  '192.0.0.1',
  '192.0.2.1',
  '192.168.0.1',
  '198.18.0.1',
  '198.51.100.1',
  '203.0.113.1',
  '224.0.0.1',
  '240.0.0.1',
  '255.255.255.255',
];

const PUBLIC_IPV4 = [
  '8.8.8.8',
  '1.1.1.1',
  '93.184.216.34',
  '172.15.255.255',
  '172.32.0.1',
  '100.128.0.1',
];

const BLOCKED_IPV6 = [
  '::',
  '::1',
  'fe80::1',
  'fc00::1',
  'fd12:3456::1',
  'fec0::1',
  'ff02::1',
  '::ffff:127.0.0.1',
  '::ffff:7f00:1',
  '::ffff:a9fe:a9fe',
  '::ffff:10.0.0.1',
  '::127.0.0.1',
  '64:ff9b::7f00:1',
  '64:ff9b::a9fe:a9fe',
  '2002:7f00:1::',
  '2002:a9fe:a9fe::1',
  '2001:db8::1',
  '2001::1',
  '100::1',
];

const PUBLIC_IPV6 = [
  '2606:4700:4700::1111',
  '2001:4860:4860::8888',
  '::ffff:8.8.8.8',
  '64:ff9b::808:808',
];

describe('isBlockedIp', () => {
  it.each(BLOCKED_IPV4)('blocks IPv4 %s', (address) => {
    expect(isBlockedIp(address)).toBe(true);
  });

  it.each(PUBLIC_IPV4)('allows public IPv4 %s', (address) => {
    expect(isBlockedIp(address)).toBe(false);
  });

  it.each(BLOCKED_IPV6)('blocks IPv6 %s', (address) => {
    expect(isBlockedIp(address)).toBe(true);
  });

  it.each(PUBLIC_IPV6)('allows public IPv6 %s', (address) => {
    expect(isBlockedIp(address)).toBe(false);
  });

  it.each([
    '',
    'example.com',
    '1.2.3',
    '1.2.3.4.5',
    '999.1.1.1',
    'fe80::1%eth0',
    '1::2::3',
  ])('blocks unparsable address "%s"', (address) => {
    expect(isBlockedIp(address)).toBe(true);
  });
});

function blockedCodeOf(url: string): string | undefined {
  try {
    parseTargetUrl(url, DEFAULT_EGRESS_POLICY);
    return undefined;
  } catch (error) {
    return error instanceof AppError ? error.code : 'NOT_APP_ERROR';
  }
}

describe('parseTargetUrl', () => {
  it.each([
    'file:///etc/passwd',
    'chrome://settings',
    'data:text/html,<h1>x</h1>',
    'ftp://example.com/',
    'javascript:alert(1)',
    'about:blank',
    'blob:https://example.com/uuid',
    'ws://example.com/',
  ])('blocks scheme of %s', (url) => {
    expect(blockedCodeOf(url)).toBe('BLOCKED_URL');
  });

  it.each([
    'http://169.254.169.254/latest/meta-data/',
    'http://169.254.169.254:80/computeMetadata/v1/',
    'http://127.0.0.1/',
    'http://localhost/',
    'http://LOCALHOST./',
    'http://foo.localhost/',
    'http://metadata.google.internal/',
    'http://service.internal/',
    'http://10.0.0.1/',
    'http://172.16.0.1/',
    'http://192.168.1.1/',
    'https://[::1]/',
    'https://[fe80::1]/',
    'https://[::ffff:127.0.0.1]/',
    'https://[::ffff:169.254.169.254]/',
  ])('blocks internal destination %s', (url) => {
    expect(blockedCodeOf(url)).toBe('BLOCKED_URL');
  });

  it.each([
    'http://2130706433/',
    'http://0x7f000001/',
    'http://0177.0.0.1/',
    'http://127.1/',
    'http://0/',
    'http://2852039166/',
  ])('blocks obfuscated IPv4 form %s', (url) => {
    expect(blockedCodeOf(url)).toBe('BLOCKED_URL');
  });

  it.each([
    'http://example.com:22/',
    'http://example.com:8080/',
    'https://example.com:6379/',
    'http://example.com:0/',
  ])('blocks non-standard port %s', (url) => {
    expect(blockedCodeOf(url)).toBe('BLOCKED_URL');
  });

  it('blocks URLs with embedded credentials', () => {
    expect(blockedCodeOf('http://user:pass@example.com/')).toBe('BLOCKED_URL');
  });

  it.each(['', 'not a url', '//example.com', 'example.com'])(
    'rejects unparsable URL "%s" as INVALID_REQUEST',
    (url) => {
      expect(blockedCodeOf(url)).toBe('INVALID_REQUEST');
    },
  );

  it.each([
    'http://example.com/',
    'https://example.com/path?q=1#frag',
    'http://example.com:80/',
    'https://example.com:443/',
    'https://sub.example.co.jp/',
    'http://93.184.216.34/',
    'https://[2606:4700:4700::1111]/',
  ])('allows public destination %s', (url) => {
    expect(blockedCodeOf(url)).toBeUndefined();
  });
});

describe('assertHostPortAllowed', () => {
  const policy = {
    allowedPorts: DEFAULT_EGRESS_POLICY.allowedPorts,
    exemptTargets: ['127.0.0.1:4000'],
  };

  it('allows an exempted host and port pair', () => {
    expect(() =>
      assertHostPortAllowed('127.0.0.1', 4000, policy),
    ).not.toThrow();
  });

  it('keeps blocking the same host on other ports', () => {
    expect(() => assertHostPortAllowed('127.0.0.1', 4001, policy)).toThrow(
      AppError,
    );
  });

  it('does not exempt anything with the default policy', () => {
    expect(() =>
      assertHostPortAllowed('127.0.0.1', 80, DEFAULT_EGRESS_POLICY),
    ).toThrow(AppError);
  });
});

describe('assertProxyAllowed', () => {
  const policy = {
    allowedPorts: DEFAULT_EGRESS_POLICY.allowedPorts,
    exemptTargets: ['127.0.0.1:3128'],
  };

  it.each([
    '127.0.0.1',
    '169.254.169.254',
    '10.0.0.5',
    'localhost',
    'metadata.google.internal',
    '::1',
  ])('blocks proxy host %s', (host) => {
    expect(() => assertProxyAllowed(host, 8000, DEFAULT_EGRESS_POLICY)).toThrow(
      AppError,
    );
  });

  it('allows a public proxy on a non-standard port', () => {
    expect(() =>
      assertProxyAllowed('proxy.example.net', 8000, DEFAULT_EGRESS_POLICY),
    ).not.toThrow();
  });

  it('allows an exempted proxy address only on the exempted port', () => {
    expect(() => assertProxyAllowed('127.0.0.1', 3128, policy)).not.toThrow();
    expect(() => assertProxyAllowed('127.0.0.1', 3129, policy)).toThrow(
      AppError,
    );
  });
});
