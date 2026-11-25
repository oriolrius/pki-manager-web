import { isIP } from 'node:net';

// proxy-addr keywords accepted by Fastify's trustProxy list.
const KEYWORDS = new Set(['loopback', 'linklocal', 'uniquelocal']);

/**
 * Parses TRUST_PROXY into Fastify's `trustProxy` option, which decides whether
 * `req.ip` (audit rows, rate limits) comes from X-Forwarded-For.
 *
 * - unset, empty or `false`: proxy headers are ignored; `req.ip` is the TCP peer.
 * - comma-separated IPs/CIDRs (or `loopback`/`linklocal`/`uniquelocal`): only
 *   these peers may set the client address. Recommended.
 *
 * `true` (trust everyone) is rejected: anyone reaching the port could forge
 * `req.ip`. Invalid values throw so a typo cannot silently disable the setting.
 */
export function parseTrustProxy(raw: string | undefined): false | string[] {
  const value = raw?.trim() ?? '';
  if (value === '' || value === 'false') return false;
  if (/^\d+$/.test(value)) {
    throw new Error('TRUST_PROXY hop counts cannot identify trusted peers; list the proxy IPs/CIDRs instead');
  }
  if (value === 'true') {
    throw new Error('TRUST_PROXY=true would trust a forged X-Forwarded-For from anyone; list the proxy IPs/CIDRs instead');
  }
  const entries = value.split(',').map((entry) => entry.trim()).filter(Boolean);
  for (const entry of entries) {
    if (KEYWORDS.has(entry)) continue;
    const [address, prefix, extra] = entry.split('/');
    const family = isIP(address);
    const maxPrefix = family === 4 ? 32 : 128;
    const validPrefix = prefix === undefined || (/^\d+$/.test(prefix) && Number(prefix) <= maxPrefix);
    if (!family || extra !== undefined || !validPrefix) {
      throw new Error(`Invalid TRUST_PROXY entry "${entry}": expected an IP, a CIDR or loopback/linklocal/uniquelocal`);
    }
  }
  return entries;
}
