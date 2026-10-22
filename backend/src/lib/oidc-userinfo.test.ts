import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { initializeOIDC, resetOIDCConfig, resolveRoles } from './oidc.js';
const issuer = 'https://id.example.com';
const discovery = { issuer, jwks_uri: `${issuer}/jwks`, userinfo_endpoint: `${issuer}/userinfo` };
let request: ReturnType<typeof vi.fn>;
beforeEach(() => {
  resetOIDCConfig();
  vi.stubEnv('OIDC_ISSUER', issuer);
  vi.stubEnv('OIDC_AUDIENCE', 'pki-web');
  vi.stubEnv('OIDC_ROLES_CLAIM', 'groups');
  vi.stubEnv('OIDC_ROLES_SOURCE', 'userinfo');
  vi.stubEnv('OIDC_DISCOVERY_BASE_URL', '');
  request = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify(discovery)));
  vi.stubGlobal('fetch', request);
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); resetOIDCConfig(); });
it('loads groups and observes removal on the next request', async () => {
  await initializeOIDC();
  request.mockResolvedValueOnce(new Response(JSON.stringify({ sub: 'alice', groups: ['admin'] })));
  expect(await resolveRoles('token', { sub: 'alice' })).toEqual(['admin']);
  expect(request).toHaveBeenLastCalledWith(discovery.userinfo_endpoint, expect.objectContaining({ headers: { Authorization: 'Bearer token' }, redirect: 'error', signal: expect.any(AbortSignal) }));
  request.mockResolvedValueOnce(new Response(JSON.stringify({ sub: 'alice', groups: [] })));
  expect(await resolveRoles('token', { sub: 'alice', groups: ['admin'] })).toEqual([]);
});
it.each([{ sub: 'other', groups: ['admin'] }, { groups: ['admin'] }, null, []])('rejects invalid identity %j', async (claims) => {
  await initializeOIDC();
  request.mockResolvedValueOnce(new Response(JSON.stringify(claims)));
  await expect(resolveRoles('token', { sub: 'alice' })).rejects.toThrow('subject');
});
it('fails closed on HTTP, network and JSON errors without using token roles', async () => {
  await initializeOIDC();
  request.mockResolvedValueOnce(new Response('', { status: 401 }));
  await expect(resolveRoles('token', { sub: 'alice', groups: ['admin'] })).rejects.toThrow();
  request.mockRejectedValueOnce(new Error('timeout'));
  await expect(resolveRoles('token', { sub: 'alice' })).rejects.toThrow();
  request.mockResolvedValueOnce(new Response('invalid'));
  await expect(resolveRoles('token', { sub: 'alice' })).rejects.toThrow();
});
it('requires the token subject before making a request', async () => {
  await initializeOIDC();
  await expect(resolveRoles('token', {})).rejects.toThrow('subject');
  expect(request).toHaveBeenCalledTimes(1);
});
it.each([{}, { groups: 'admin' }])('grants no roles for absent or malformed groups %j', async (claims) => {
  await initializeOIDC();
  request.mockResolvedValueOnce(new Response(JSON.stringify({ sub: 'alice', ...claims })));
  expect(await resolveRoles('token', { sub: 'alice' })).toEqual([]);
});
it('uses token roles by default without UserInfo', async () => {
  vi.stubEnv('OIDC_ROLES_SOURCE', '');
  await initializeOIDC();
  expect(await resolveRoles('token', { groups: ['admin'] })).toEqual(['admin']);
  expect(request).toHaveBeenCalledTimes(1);
});
it.each([undefined, 'https://other.example.com/userinfo', 'http://id.example.com/userinfo'])('rejects unsafe endpoints %s', async (endpoint) => {
  request.mockReset().mockResolvedValueOnce(new Response(JSON.stringify({ ...discovery, userinfo_endpoint: endpoint })));
  await expect(initializeOIDC()).rejects.toThrow();
});
it('rejects invalid configuration', async () => {
  vi.stubEnv('OIDC_ROLES_SOURCE', 'typo');
  await expect(initializeOIDC()).rejects.toThrow('OIDC_ROLES_SOURCE');
});
