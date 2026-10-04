import { describe, expect, it } from 'vitest';

import { findRequestViolation } from '../../src/security/requestFilter.js';
import { DEFAULT_EGRESS_POLICY } from '../../src/security/urlGuard.js';

describe('findRequestViolation', () => {
  it.each([
    'file:///etc/passwd',
    'ftp://example.com/',
    'chrome://settings',
    'http://127.0.0.1/',
    'http://169.254.169.254/computeMetadata/v1/',
    'https://example.com:8443/',
    'ws://127.0.0.1/socket',
    'wss://10.0.0.1/socket',
    'http://[::1]/',
  ])('reports a violation for %s', (url) => {
    expect(findRequestViolation(url, DEFAULT_EGRESS_POLICY)).toBeTypeOf(
      'string',
    );
  });

  it.each([
    'https://example.com/a.js',
    'http://example.com/',
    'wss://example.com/socket',
    'data:image/png;base64,AAAA',
    'blob:https://example.com/1',
    'about:blank',
  ])('lets %s proceed', (url) => {
    expect(findRequestViolation(url, DEFAULT_EGRESS_POLICY)).toBeUndefined();
  });
});
