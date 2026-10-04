import { describe, expect, it } from 'vitest';

import { createLogger, sanitizeUrlForLog } from '../../src/lib/logger.js';

const SECRET_KEY = 'bg_ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789abcdefg';

function capture(): { lines: string[]; write: (line: string) => void } {
  const lines: string[] = [];
  return { lines, write: (line) => lines.push(line) };
}

describe('logger', () => {
  it('redacts values of sensitive keys at any depth', () => {
    const sink = capture();
    createLogger(sink.write).info('fetch', {
      authorization: `Bearer ${SECRET_KEY}`,
      proxy: {
        server: 'http://p:8000',
        username: 'proxyuser9',
        password: 'hunter2',
      },
      nested: {
        cookie: 'sid=abc',
        html: '<html>secret page</html>',
        text: 'secret text',
        screenshot: 'iVBOR...',
      },
      status: 200,
    });

    const output = sink.lines.join('\n');
    for (const secret of [
      SECRET_KEY,
      'hunter2',
      'proxyuser9',
      'sid=abc',
      'secret page',
      'secret text',
      'iVBOR',
    ]) {
      expect(output).not.toContain(secret);
    }
    expect(JSON.parse(output)).toMatchObject({ event: 'fetch', status: 200 });
  });

  it('scrubs API keys and bearer tokens embedded in free text', () => {
    const sink = capture();
    createLogger(sink.write).error('failure', {
      detail: `bad header Bearer ${SECRET_KEY} and ${SECRET_KEY}`,
    });

    expect(sink.lines.join('\n')).not.toContain(SECRET_KEY);
  });

  it('scrubs proxy credentials embedded in URLs inside free text', () => {
    const sink = capture();
    createLogger(sink.write).warn('proxy', {
      detail: 'failed http://user:hunter2@proxy.example.net:8000',
    });

    expect(sink.lines.join('\n')).not.toContain('hunter2');
  });

  it('writes one JSON line per call with level and event', () => {
    const sink = capture();
    createLogger(sink.write).info('hello', { n: 1 });

    expect(sink.lines).toHaveLength(1);
    expect(JSON.parse(sink.lines[0] ?? '')).toMatchObject({
      level: 'info',
      event: 'hello',
      n: 1,
    });
  });
});

describe('sanitizeUrlForLog', () => {
  it.each([
    ['https://example.com/a/b?token=secret#frag', 'https://example.com/a/b'],
    ['https://user:pw@example.com/a', 'https://example.com/a'],
    ['not a url', '[invalid-url]'],
  ])('reduces %s to %s', (input, expected) => {
    expect(sanitizeUrlForLog(input)).toBe(expected);
  });
});
