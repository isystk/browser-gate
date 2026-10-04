import { describe, expect, it } from 'vitest';

import type { StorageStateLike } from '../../src/profile/cookieFilter.js';
import {
  describeCookies,
  describeOrigins,
} from '../../src/profile/stateDiagnostics.js';

const SECRET = 'SECRET-VALUE-123';

function cookie(
  overrides: Partial<StorageStateLike['cookies'][number]> = {},
): StorageStateLike['cookies'][number] {
  return {
    name: 'session',
    value: SECRET,
    domain: '.example.com',
    path: '/',
    expires: 1_800_000_000,
    httpOnly: true,
    secure: true,
    sameSite: 'None',
    ...overrides,
  };
}

describe('describeCookies', () => {
  it('reports domain, name and attributes of a persistent cookie', () => {
    expect(describeCookies([cookie()])).toEqual([
      {
        domain: '.example.com',
        name: 'session',
        secure: true,
        http_only: true,
        same_site: 'None',
        has_expires: true,
      },
    ]);
  });

  it('reports a session cookie as having no expiry', () => {
    expect(describeCookies([cookie({ expires: -1 })])[0]?.has_expires).toBe(
      false,
    );
  });

  it('never includes cookie values', () => {
    expect(JSON.stringify(describeCookies([cookie()]))).not.toContain(SECRET);
  });
});

describe('describeOrigins', () => {
  it('reports only key counts of localStorage and database counts of IndexedDB', () => {
    const origins: StorageStateLike['origins'] = [
      {
        origin: 'https://example.com',
        localStorage: [
          { name: 'a', value: SECRET },
          { name: 'b', value: SECRET },
        ],
        indexedDB: [{ name: 'db', stores: [{ records: [{ value: SECRET }] }] }],
      },
      { origin: 'https://other.example.com', localStorage: [] },
    ];

    const described = describeOrigins(origins);

    expect(described).toEqual([
      {
        origin: 'https://example.com',
        local_storage_keys: 2,
        indexeddb_databases: 1,
      },
      {
        origin: 'https://other.example.com',
        local_storage_keys: 0,
        indexeddb_databases: 0,
      },
    ]);
    expect(JSON.stringify(described)).not.toContain(SECRET);
  });
});
