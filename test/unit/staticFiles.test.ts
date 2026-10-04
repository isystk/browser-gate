import { describe, expect, it } from 'vitest';

import {
  contentTypeOf,
  resolveStaticPath,
} from '../../src/login/staticFiles.js';

const ROOT = '/usr/share/novnc';

describe('resolveStaticPath', () => {
  it.each([
    ['/vnc.html', '/usr/share/novnc/vnc.html'],
    ['/app/ui.js', '/usr/share/novnc/app/ui.js'],
    ['/core/util/logging.js', '/usr/share/novnc/core/util/logging.js'],
  ])('resolves %s inside the root', (urlPath, expected) => {
    expect(resolveStaticPath(ROOT, urlPath)).toBe(expected);
  });

  it.each([
    ['/../etc/passwd'],
    ['/app/../../etc/passwd'],
    ['/%2e%2e/etc/passwd'],
    ['/app/%2E%2E/%2E%2E/etc/passwd'],
    ['/app\\..\\..\\etc\\passwd'],
    ['/vnc.html\0.png'],
    ['/%00'],
    ['//etc/passwd'],
    ['/%zz'],
    [''],
    ['/'],
  ])('rejects %j', (urlPath) => {
    expect(resolveStaticPath(ROOT, urlPath)).toBeUndefined();
  });
});

describe('contentTypeOf', () => {
  it.each([
    ['/a.html', 'text/html; charset=utf-8'],
    ['/a.js', 'text/javascript; charset=utf-8'],
    ['/a.css', 'text/css; charset=utf-8'],
    ['/a.svg', 'image/svg+xml'],
    ['/a.png', 'image/png'],
  ])('maps %s', (file, expected) => {
    expect(contentTypeOf(file)).toBe(expected);
  });

  it('returns undefined for an unknown extension so that it is not served', () => {
    expect(contentTypeOf('/a.exe')).toBeUndefined();
  });
});
