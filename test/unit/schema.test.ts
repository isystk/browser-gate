import { describe, expect, it } from 'vitest';

import { parseFetchRequest } from '../../src/fetch/schema.js';
import { AppError } from '../../src/lib/errors.js';

function invalid(input: unknown): void {
  try {
    parseFetchRequest(input);
  } catch (error) {
    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).code).toBe('INVALID_REQUEST');
    return;
  }
  expect.unreachable('expected INVALID_REQUEST');
}

const BASE = { url: 'https://example.com/' };

describe('parseFetchRequest', () => {
  it('accepts a minimal request and a fully specified one', () => {
    expect(parseFetchRequest(BASE).url).toBe(BASE.url);
    const full = parseFetchRequest({
      ...BASE,
      outputs: ['html', 'text', 'screenshot'],
      extract: { title: 'h1', body: 'article p' },
      steps: [
        { wait_for: 'article' },
        { click: '.more' },
        { scroll: 'bottom' },
      ],
      proxy: {
        server: 'http://proxy.example.net:8000',
        username: 'u',
        password: 'p',
      },
      timeout_ms: 30000,
      full_page: true,
    });
    expect(full.steps).toHaveLength(3);
  });

  it.each([null, 'str', 1, [], {}, { url: 5 }, { url: '' }])(
    'rejects a malformed body %j',
    (input) => {
      invalid(input);
    },
  );

  it('rejects unknown top-level fields', () => {
    invalid({ ...BASE, script: 'alert(1)' });
  });

  it.each([
    [{ outputs: ['pdf'] }],
    [{ outputs: 'html' }],
    [{ timeout_ms: 0 }],
    [{ timeout_ms: 999999 }],
    [{ timeout_ms: 1.5 }],
    [{ profile: '../etc/passwd' }],
    [{ profile: 'UPPER' }],
    [{ profile: '' }],
    [{ full_page: 'yes' }],
  ])('rejects invalid option %j', (extra) => {
    invalid({ ...BASE, ...extra });
  });

  it.each([
    [{ evaluate: 'document.cookie' }],
    [{ goto: 'http://127.0.0.1' }],
    [{ click: '.a', wait_for: '.b' }],
    [{ scroll: 'middle' }],
    [{ scroll: 100 }],
    [{ click: '' }],
    [{ click: 5 }],
    [{ click: 'xpath=//a' }],
    [{ click: 'text=Accept' }],
    [{ click: 'a >> nth=0' }],
    [{ wait_for: 'x'.repeat(501) }],
    [{}],
    ['click'],
  ])('rejects a disallowed step %j', (step) => {
    invalid({ ...BASE, steps: [step] });
  });

  it('rejects more than the maximum number of steps', () => {
    invalid({
      ...BASE,
      steps: Array.from({ length: 21 }, () => ({ scroll: 'bottom' })),
    });
  });

  it.each([
    [{ 'bad name': 'h1' }],
    [{ ok: 'xpath=//a' }],
    [{ ok: 5 }],
    [{ '': 'h1' }],
  ])('rejects invalid extract %j', (extract) => {
    invalid({ ...BASE, extract });
  });

  it('rejects too many extract entries', () => {
    const extract = Object.fromEntries(
      Array.from({ length: 21 }, (_, i) => [`k${i}`, 'p']),
    );
    invalid({ ...BASE, extract });
  });

  it.each([
    [{ server: 'http://p:8000', extra: 1 }],
    [{ server: '' }],
    [{ username: 'u' }],
    [{ server: 'http://p', password: 5 }],
  ])('rejects invalid proxy %j', (proxy) => {
    invalid({ ...BASE, proxy });
  });

  it('rejects empty outputs without extract', () => {
    invalid({ ...BASE, outputs: [] });
  });

  it('does not echo submitted values in the error message', () => {
    try {
      parseFetchRequest({
        ...BASE,
        steps: [{ click: 'xpath=//SECRET-MARKER' }],
      });
    } catch (error) {
      expect((error as AppError).message).not.toContain('SECRET-MARKER');
    }
  });
});
