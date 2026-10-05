import { describe, expect, it } from 'vitest';

import { egressPolicyFromEnv } from '../../src/config/egressEnv.js';
import { resolveAllowedAddresses } from '../../src/security/egressProxy.js';
import { DEFAULT_EGRESS_POLICY } from '../../src/security/urlGuard.js';

const V4_A = '93.184.216.34';
const V4_B = '93.184.216.35';
const V6 = '2606:2800:220:1:248:1893:25c8:1946';
const TARGET = { host: 'example.com', port: 443 };

function resolveTo(...addresses: string[]): () => Promise<string[]> {
  return async () => addresses;
}

describe('resolveAllowedAddresses address order', () => {
  const preferV4 = { ...DEFAULT_EGRESS_POLICY, preferIpv4: true };

  it('keeps the resolver order by default', async () => {
    const result = await resolveAllowedAddresses(
      TARGET,
      DEFAULT_EGRESS_POLICY,
      resolveTo(V6, V4_A),
    );

    expect(result).toEqual([V6, V4_A]);
  });

  it('puts IPv4 addresses first when IPv4 is preferred, keeping the order within each family', async () => {
    const result = await resolveAllowedAddresses(
      TARGET,
      preferV4,
      resolveTo(V6, V4_A, V4_B),
    );

    expect(result).toEqual([V4_A, V4_B, V6]);
  });

  it('uses IPv6 when the destination has no IPv4 address', async () => {
    const result = await resolveAllowedAddresses(
      TARGET,
      preferV4,
      resolveTo(V6),
    );

    expect(result).toEqual([V6]);
  });

  it('returns IPv4 only destinations unchanged', async () => {
    const result = await resolveAllowedAddresses(
      TARGET,
      preferV4,
      resolveTo(V4_A),
    );

    expect(result).toEqual([V4_A]);
  });

  it('still rejects an internal address even when IPv4 is preferred', async () => {
    await expect(
      resolveAllowedAddresses(TARGET, preferV4, resolveTo(V6, '10.0.0.1')),
    ).rejects.toMatchObject({ code: 'BLOCKED_URL' });
  });
});

describe('egressPolicyFromEnv', () => {
  it('is the default policy when EGRESS_PREFER_IPV4 is unset or empty', () => {
    expect(egressPolicyFromEnv({})).toEqual(DEFAULT_EGRESS_POLICY);
    expect(egressPolicyFromEnv({ EGRESS_PREFER_IPV4: '' })).toEqual(
      DEFAULT_EGRESS_POLICY,
    );
  });

  it.each(['1', 'true'])(
    'prefers IPv4 when EGRESS_PREFER_IPV4 is %s',
    (value) => {
      expect(
        egressPolicyFromEnv({ EGRESS_PREFER_IPV4: value }).preferIpv4,
      ).toBe(true);
    },
  );

  it.each(['0', 'false'])(
    'keeps the default when EGRESS_PREFER_IPV4 is %s',
    (value) => {
      expect(
        egressPolicyFromEnv({ EGRESS_PREFER_IPV4: value }).preferIpv4,
      ).toBeFalsy();
    },
  );

  it('rejects an unknown value', () => {
    expect(() => egressPolicyFromEnv({ EGRESS_PREFER_IPV4: 'yes' })).toThrow(
      'EGRESS_PREFER_IPV4',
    );
  });
});
