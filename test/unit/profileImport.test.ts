import { describe, expect, it } from 'vitest';

import { originsToVisit } from '../../src/browser/profileImport.js';

describe('originsToVisit', () => {
  it('turns allowed domains into https origins', () => {
    expect(originsToVisit(['feedly.com', 'cloud.feedly.com'])).toEqual([
      'https://feedly.com',
      'https://cloud.feedly.com',
    ]);
  });

  it('skips entries that are not plain host names', () => {
    expect(originsToVisit(['feedly.com', '', 'a b', 'x/y'])).toEqual([
      'https://feedly.com',
    ]);
  });
});
