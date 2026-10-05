import {
  DEFAULT_EGRESS_POLICY,
  type EgressPolicy,
} from '../security/urlGuard.js';

/**
 * Builds the egress policy from environment variables.
 * EGRESS_PREFER_IPV4=1|true tries IPv4 addresses before IPv6 ones (the default keeps the resolver order).
 */
export function egressPolicyFromEnv(
  source: NodeJS.ProcessEnv = process.env,
): EgressPolicy {
  const raw = source.EGRESS_PREFER_IPV4?.trim().toLowerCase();
  if (raw === undefined || raw === '' || raw === '0' || raw === 'false') {
    return DEFAULT_EGRESS_POLICY;
  }
  if (raw === '1' || raw === 'true') {
    return { ...DEFAULT_EGRESS_POLICY, preferIpv4: true };
  }
  throw new Error('EGRESS_PREFER_IPV4 must be 1, true, 0, false or empty');
}
