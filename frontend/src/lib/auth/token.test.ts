/**
 * Tests for the manual OIDC access-token refresh path (TASK-193).
 *
 * The production login uses the hand-rolled manual token flow, whose tokens are
 * NOT managed by oidc-client-ts, so they must be refreshed on demand via the
 * stored refresh_token. These tests exercise that path (UserManager mocked to
 * hold no user, so getAccessToken() falls back to manual storage).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const STORAGE_KEY = 'oidc.user:https://iam.example/realms/pki:pki-web';
const AUTHORITY = 'https://iam.example/realms/pki';
const NOW_SECONDS = 1_000_000;

// NOTE: vi.mock is hoisted above the module's top-level consts, so the factory
// must use literals (not STORAGE_KEY / AUTHORITY) — they match the consts below.
vi.mock('./config', () => ({
  isOIDCEnabledAsync: vi.fn().mockResolvedValue(true),
  getStorageKeyAsync: vi.fn().mockResolvedValue('oidc.user:https://iam.example/realms/pki:pki-web'),
  getAuthority: vi.fn().mockResolvedValue('https://iam.example/realms/pki'),
  getClientId: vi.fn().mockResolvedValue('pki-web'),
  buildOIDCSettings: vi
    .fn()
    .mockResolvedValue({ authority: 'https://iam.example/realms/pki', client_id: 'pki-web' }),
}));

// No library-managed user -> getAccessToken() falls back to manual storage.
vi.mock('oidc-client-ts', () => ({
  UserManager: class {
    async getUser() {
      return null;
    }
  },
}));

import { getAccessToken, resetUserManager, resetTokenRefreshState } from './token';

function setStored(tokens: Record<string, unknown>) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(tokens));
}

function tokenResponse(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('getAccessToken — manual token on-demand refresh', () => {
  beforeEach(() => {
    localStorage.clear();
    resetUserManager();
    resetTokenRefreshState();
    vi.spyOn(Date, 'now').mockReturnValue(NOW_SECONDS * 1000);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns a still-valid token without hitting the token endpoint', async () => {
    setStored({ access_token: 'valid-abc', refresh_token: 'r1', expires_at: NOW_SECONDS + 600 });
    const fetchSpy = vi.spyOn(globalThis, 'fetch');

    await expect(getAccessToken()).resolves.toBe('valid-abc');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('refreshes an expired token via the refresh_token and persists the rotated tokens', async () => {
    setStored({ access_token: 'old', refresh_token: 'r1', expires_at: NOW_SECONDS - 10 });
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(
        tokenResponse({ access_token: 'new-xyz', refresh_token: 'r2', token_type: 'Bearer', expires_in: 300 })
      );

    await expect(getAccessToken()).resolves.toBe('new-xyz');

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0];
    expect(String(url)).toBe(`${AUTHORITY}/protocol/openid-connect/token`);
    const body = (init as RequestInit).body as URLSearchParams;
    expect(body.get('grant_type')).toBe('refresh_token');
    expect(body.get('refresh_token')).toBe('r1');
    expect(body.get('client_id')).toBe('pki-web');

    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY)!);
    expect(saved.access_token).toBe('new-xyz');
    expect(saved.refresh_token).toBe('r2'); // rotated
    expect(saved.expires_at).toBe(NOW_SECONDS + 300);
  });

  it('refreshes a token that is within the 60s expiry buffer (not yet expired)', async () => {
    setStored({ access_token: 'old', refresh_token: 'r1', expires_at: NOW_SECONDS + 30 });
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(tokenResponse({ access_token: 'fresh', expires_in: 300 }));

    await expect(getAccessToken()).resolves.toBe('fresh');
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('deduplicates concurrent refreshes into a single token request (single-flight)', async () => {
    setStored({ access_token: 'old', refresh_token: 'r1', expires_at: NOW_SECONDS - 10 });

    let resolveFetch!: (r: Response) => void;
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockReturnValue(new Promise<Response>((resolve) => {
        resolveFetch = resolve;
      }));

    const p1 = getAccessToken();
    const p2 = getAccessToken();
    // Let both callers reach the shared single-flight promise, then resolve.
    await Promise.resolve();
    resolveFetch(tokenResponse({ access_token: 'shared-new', refresh_token: 'r2', expires_in: 300 }));

    await expect(Promise.all([p1, p2])).resolves.toEqual(['shared-new', 'shared-new']);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('clears the stored token and returns null when the refresh_token is rejected', async () => {
    setStored({ access_token: 'old', refresh_token: 'bad', expires_at: NOW_SECONDS - 10 });
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(tokenResponse({ error: 'invalid_grant' }, 400));

    await expect(getAccessToken()).resolves.toBeNull();
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it('returns null when the token is expired and there is no refresh_token', async () => {
    setStored({ access_token: 'old', expires_at: NOW_SECONDS - 10 });
    const fetchSpy = vi.spyOn(globalThis, 'fetch');

    await expect(getAccessToken()).resolves.toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('returns null when there is no stored token at all', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    await expect(getAccessToken()).resolves.toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
