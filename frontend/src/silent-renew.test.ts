import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';

const signinSilentCallback = vi.fn(() => Promise.resolve());
vi.mock('oidc-client-ts', () => ({
  UserManager: vi.fn(function UserManager() {
    return { signinSilentCallback };
  }),
}));

const frontendRoot = path.resolve(__dirname, '..');

function htmlFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return htmlFiles(full);
    return name.endsWith('.html') ? [full] : [];
  });
}

describe('silent-renew page (issue #50)', () => {
  it('hands the iframe URL to the bundled oidc-client-ts', async () => {
    const { completeSilentRenew } = await import('./silent-renew');
    signinSilentCallback.mockClear();
    await completeSilentRenew('http://localhost/silent-renew.html?code=c&state=s');
    expect(signinSilentCallback).toHaveBeenCalledWith(
      'http://localhost/silent-renew.html?code=c&state=s',
    );
  });

  it('is a build entry served at /silent-renew.html (the silent_redirect_uri)', () => {
    const html = readFileSync(path.join(frontendRoot, 'silent-renew.html'), 'utf8');
    expect(html).toContain('<script type="module" src="/src/silent-renew.ts"></script>');
    const viteConfig = readFileSync(path.join(frontendRoot, 'vite.config.ts'), 'utf8');
    expect(viteConfig).toMatch(/'silent-renew':\s*path\.resolve\(__dirname, 'silent-renew\.html'\)/);
    const authConfig = readFileSync(path.join(frontendRoot, 'src/lib/auth/config.ts'), 'utf8');
    expect(authConfig).toContain('silent_redirect_uri: `${origin}/silent-renew.html`');
  });

  it('no HTML page of the web UI loads a script from another origin or inline', () => {
    const pages = [
      path.join(frontendRoot, 'index.html'),
      path.join(frontendRoot, 'silent-renew.html'),
      ...htmlFiles(path.join(frontendRoot, 'public')),
    ];
    for (const page of pages) {
      const html = readFileSync(page, 'utf8');
      const scripts = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)];
      for (const [, attrs, body] of scripts) {
        const src = /\bsrc\s*=\s*["']([^"']+)["']/i.exec(attrs)?.[1];
        expect(src, `${page}: script without src (inline)`).toBeDefined();
        expect(body.trim(), `${page}: inline script body`).toBe('');
        expect(src!.startsWith('/') && !src!.startsWith('//'), `${page}: ${src}`).toBe(true);
      }
    }
  });
});
