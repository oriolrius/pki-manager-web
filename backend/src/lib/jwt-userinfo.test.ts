import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { initializeOIDC, resetOIDCConfig } from './oidc.js';
import { validateToken } from './jwt.js';
const { verify } = vi.hoisted(() => ({ verify: vi.fn() }));
vi.mock('jose', async (original) => ({ ...await original<typeof import('jose')>(), jwtVerify: verify }));
let request: ReturnType<typeof vi.fn>;
beforeEach(async () => {
  resetOIDCConfig();
  verify.mockReset();
  vi.stubEnv('OIDC_ISSUER', 'https://id.example.com');
  vi.stubEnv('OIDC_AUDIENCE', 'pki-web');
  vi.stubEnv('OIDC_ROLES_SOURCE', 'userinfo');
  vi.stubEnv('OIDC_ROLES_CLAIM', 'groups');
  vi.stubEnv('OIDC_DISCOVERY_BASE_URL', '');
  request = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ issuer: 'https://id.example.com', jwks_uri: 'https://id.example.com/jwks', userinfo_endpoint: 'https://id.example.com/userinfo' })));
  vi.stubGlobal('fetch', request);
  await initializeOIDC();
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); resetOIDCConfig(); });
it('exposes UserInfo roles through shared JWT authentication', async () => {
  verify.mockResolvedValue({ payload: { sub: 'alice', aud: 'pki-web' } });
  request.mockResolvedValueOnce(new Response(JSON.stringify({ sub: 'alice', groups: ['admin'] })));
  expect(await validateToken('token')).toMatchObject({ sub: 'alice', roles: ['admin'] });
});
it('does not contact UserInfo when signature validation fails', async () => {
  verify.mockRejectedValue(new Error('signature invalid'));
  await expect(validateToken('token')).rejects.toMatchObject({ code: 'SIGNATURE_INVALID' });
  expect(request).toHaveBeenCalledTimes(1);
});
it('does not contact UserInfo for an invalid audience', async () => {
  verify.mockResolvedValue({ payload: { sub: 'alice', aud: 'other' } });
  await expect(validateToken('token')).rejects.toMatchObject({ code: 'AUDIENCE_MISMATCH' });
  expect(request).toHaveBeenCalledTimes(1);
});
it('rejects authentication on a UserInfo subject mismatch', async () => {
  verify.mockResolvedValue({ payload: { sub: 'alice', aud: 'pki-web' } });
  request.mockResolvedValueOnce(new Response(JSON.stringify({ sub: 'other', groups: ['admin'] })));
  await expect(validateToken('token')).rejects.toMatchObject({ code: 'INVALID_TOKEN' });
});
