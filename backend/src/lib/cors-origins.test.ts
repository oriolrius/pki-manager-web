import Fastify from 'fastify';
import cors from '@fastify/cors';
import { describe, expect, it } from 'vitest';
import { parseCorsOrigins } from './cors-origins.js';

describe('parseCorsOrigins', () => {
  it('allows every origin when FRONTEND_URL is unset or empty', () => {
    expect(parseCorsOrigins(undefined)).toBe(true);
    expect(parseCorsOrigins('')).toBe(true);
    expect(parseCorsOrigins('  ')).toBe(true);
  });
  it('accepts a comma-separated list of origins and normalises them', () => {
    expect(parseCorsOrigins('https://pki.example.com, http://localhost:52080/,HTTPS://PKI.example.com')).toEqual([
      'https://pki.example.com',
      'http://localhost:52080',
    ]);
  });
  it('rejects values that are not an origin', () => {
    for (const bad of ['*', 'pki.example.com', 'ftp://pki.example.com', 'https://pki.example.com/app', 'https://u:p@pki.example.com', 'https://pki.example.com/?a=1']) {
      expect(() => parseCorsOrigins(bad)).toThrow(/Invalid FRONTEND_URL entry/);
    }
  });
});

describe('CORS headers with a parsed FRONTEND_URL', () => {
  async function corsFor(frontendUrl: string | undefined, origin: string, preflight = false) {
    const app = Fastify();
    await app.register(cors, { origin: parseCorsOrigins(frontendUrl), credentials: true });
    app.get('/trpc/health', async () => ({ ok: true }));
    const res = await app.inject({
      method: preflight ? 'OPTIONS' : 'GET',
      url: '/trpc/health',
      headers: preflight
        ? { origin, 'access-control-request-method': 'POST', 'access-control-request-headers': 'authorization,content-type' }
        : { origin },
    });
    await app.close();
    return res.headers['access-control-allow-origin'];
  }

  it('reflects any origin when FRONTEND_URL is unset (previous behaviour)', async () => {
    expect(await corsFor(undefined, 'https://evil.example')).toBe('https://evil.example');
  });
  it('allows the listed web UI origin, also in a preflight (dev stack: UI :52080, API :52081)', async () => {
    expect(await corsFor('http://localhost:52080', 'http://localhost:52080')).toBe('http://localhost:52080');
    expect(await corsFor('http://localhost:52080', 'http://localhost:52080', true)).toBe('http://localhost:52080');
  });
  it('gives no CORS header to an origin that is not listed', async () => {
    expect(await corsFor('https://pki.example.com', 'https://evil.example')).toBeUndefined();
    expect(await corsFor('https://pki.example.com', 'https://evil.example', true)).toBeUndefined();
  });
});
