import { afterEach, expect, it, vi } from 'vitest';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.resetModules();
});

it('uses the build-time API URL if the runtime file contains a non-string URL', async () => {
  vi.stubEnv('VITE_API_URL', 'https://pki.example/trpc');
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ apiUrl: 42 })));
  const { loadConfig } = await import('./config');
  expect(await loadConfig()).toEqual({ apiUrl: 'https://pki.example/trpc' });
});
