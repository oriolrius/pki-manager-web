/**
 * Tests for getAccessToken() on-demand renewal (TASK-193, reworked for PR #7).
 *
 * Tokens are owned by the single oidc-client-ts UserManager. When the access token is
 * expired or about to expire, getAccessToken() renews it through the library
 * (`signinSilent`, single-flight) instead of a hand-rolled token-endpoint call.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const STORAGE_KEY = 'oidc.user:https://iam.example/realms/pki:pki-web';

// NOTE: vi.mock is hoisted above the module's top-level consts, so factories must use
// literals or vi.hoisted values.
const mgr = vi.hoisted(() => ({
  getUser: vi.fn(),
  signinSilent: vi.fn(),
  constructed: 0,
}));

vi.mock('./config', () => ({
  isOIDCEnabledAsync: vi.fn().mockResolvedValue(true),
  getAuthority: vi.fn().mockResolvedValue('https://iam.example/realms/pki'),
  getClientId: vi.fn().mockResolvedValue('pki-web'),
  buildOIDCSettings: vi
    .fn()
    .mockResolvedValue({ authority: 'https://iam.example/realms/pki', client_id: 'pki-web' }),
}));

vi.mock('oidc-client-ts', () => ({
  UserManager: class {
    constructor() {
      mgr.constructed += 1;
    }
    getUser() {
      return mgr.getUser();
    }
    signinSilent() {
      return mgr.signinSilent();
    }
  },
}));

import { getAccessToken, getUserManager, resetUserManager, resetTokenRefreshState } from './token';

function user(accessToken: string, expiresIn: number | undefined) {
  return { access_token: accessToken, expires_in: expiresIn };
}

describe('getAccessToken — library-managed renewal', () => {
  beforeEach(() => {
    localStorage.clear();
    resetUserManager();
    resetTokenRefreshState();
    mgr.getUser.mockReset();
    mgr.signinSilent.mockReset();
    mgr.constructed = 0;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns a still-valid token without renewing', async () => {
    mgr.getUser.mockResolvedValue(user('valid-abc', 600));

    await expect(getAccessToken()).resolves.toBe('valid-abc');
    expect(mgr.signinSilent).not.toHaveBeenCalled();
  });

  it('returns null when there is no signed-in user', async () => {
    mgr.getUser.mockResolvedValue(null);

    await expect(getAccessToken()).resolves.toBeNull();
    expect(mgr.signinSilent).not.toHaveBeenCalled();
  });

  it('renews a token within the 60s expiry buffer and returns the new one', async () => {
    mgr.getUser.mockResolvedValue(user('old', 30));
    mgr.signinSilent.mockResolvedValue(user('renewed', 300));

    await expect(getAccessToken()).resolves.toBe('renewed');
    expect(mgr.signinSilent).toHaveBeenCalledTimes(1);
  });

  it('renews an already-expired token', async () => {
    mgr.getUser.mockResolvedValue(user('expired', -5));
    mgr.signinSilent.mockResolvedValue(user('renewed', 300));

    await expect(getAccessToken()).resolves.toBe('renewed');
  });

  it('deduplicates concurrent renewals into a single signinSilent call (single-flight)', async () => {
    mgr.getUser.mockResolvedValue(user('old', 10));
    let resolve!: (u: unknown) => void;
    mgr.signinSilent.mockReturnValue(new Promise((r) => (resolve = r)));

    const calls = Promise.all([getAccessToken(), getAccessToken(), getAccessToken()]);
    await vi.waitFor(() => expect(mgr.signinSilent).toHaveBeenCalled());
    resolve(user('renewed', 300));

    await expect(calls).resolves.toEqual(['renewed', 'renewed', 'renewed']);
    expect(mgr.signinSilent).toHaveBeenCalledTimes(1);
  });

  it('returns null when renewal fails (session ended at the provider)', async () => {
    mgr.getUser.mockResolvedValue(user('old', 10));
    mgr.signinSilent.mockRejectedValue(new Error('login_required'));
    vi.spyOn(console, 'warn').mockImplementation(() => {});

    await expect(getAccessToken()).resolves.toBeNull();
  });

  it('shares one UserManager between all callers', async () => {
    mgr.getUser.mockResolvedValue(user('valid', 600));

    const [a, b] = await Promise.all([getUserManager(), getUserManager()]);
    await getAccessToken();

    expect(a).toBe(b);
    expect(mgr.constructed).toBe(1);
  });
});

describe('legacy manual-token cleanup', () => {
  beforeEach(() => {
    localStorage.clear();
    resetUserManager();
  });

  it('removes a pre-library token blob (no profile) under the library key', async () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ access_token: 'legacy', expires_at: 1 }));

    await getUserManager();

    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it('keeps a library-managed user', async () => {
    const libraryUser = JSON.stringify({ access_token: 'lib', profile: { sub: 'u1' } });
    localStorage.setItem(STORAGE_KEY, libraryUser);

    await getUserManager();

    expect(localStorage.getItem(STORAGE_KEY)).toBe(libraryUser);
  });
});
