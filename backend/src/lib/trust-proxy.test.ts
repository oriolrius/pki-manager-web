import Fastify from 'fastify';
import { describe, expect, it } from 'vitest';
import { parseTrustProxy } from './trust-proxy.js';

describe('parseTrustProxy', () => {
  it('is off unless configured', () => {
    expect(parseTrustProxy(undefined)).toBe(false);
    expect(parseTrustProxy('')).toBe(false);
    expect(parseTrustProxy(' false ')).toBe(false);
  });
  it('accepts IPs, CIDRs and proxy-addr keywords', () => {
    expect(parseTrustProxy('10.222.35.0/24, 172.18.0.5,uniquelocal, fd00::/8')).toEqual(['10.222.35.0/24', '172.18.0.5', 'uniquelocal', 'fd00::/8']);
  });
  it('rejects numeric hop counts', () => {
    for (const count of ['0', '2', '11']) expect(() => parseTrustProxy(count)).toThrow(/list the proxy IPs/);
  });
  it('rejects trust-everyone and malformed entries', () => {
    expect(() => parseTrustProxy('true')).toThrow(/forged/);
    for (const bad of ['10.0.0.0/33', 'fd00::/129', 'proxy.local', '10.0.0.1/24/1', '10.0.0.0/x']) {
      expect(() => parseTrustProxy(bad)).toThrow(/Invalid TRUST_PROXY entry/);
    }
  });
});

describe('req.ip with a parsed TRUST_PROXY', () => {
  async function ipSeen(trustProxy: string | undefined, remoteAddress: string, forwardedFor?: string) {
    const app = Fastify({ trustProxy: parseTrustProxy(trustProxy) });
    app.get('/ip', async (req) => ({ ip: req.ip }));
    const res = await app.inject({ url: '/ip', remoteAddress, headers: forwardedFor ? { 'x-forwarded-for': forwardedFor } : {} });
    await app.close();
    return res.json().ip as string;
  }
  it('uses the forwarded client address only when the peer is a listed proxy', async () => {
    expect(await ipSeen('10.222.35.0/24', '10.222.35.12', '203.0.113.7')).toBe('203.0.113.7');
    // A client reaching the backend directly cannot forge its address.
    expect(await ipSeen('10.222.35.0/24', '198.51.100.9', '203.0.113.7')).toBe('198.51.100.9');
    // Chain: forged first hop + real client added by the trusted proxy.
    expect(await ipSeen('10.222.35.0/24', '10.222.35.12', '1.2.3.4, 203.0.113.7')).toBe('203.0.113.7');
  });
  it('keeps the TCP peer when unset (previous behaviour)', async () => {
    expect(await ipSeen(undefined, '10.222.35.12', '203.0.113.7')).toBe('10.222.35.12');
  });
});
