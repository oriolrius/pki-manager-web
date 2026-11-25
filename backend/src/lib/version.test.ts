import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { APP_LICENSE, APP_VERSION } from './version.js';

function versionOf(relativePath: string): string {
  const raw = readFileSync(new URL(relativePath, import.meta.url), 'utf8');
  return (JSON.parse(raw) as { version: string }).version;
}

describe('APP_VERSION', () => {
  it('is the version in backend/package.json', () => {
    expect(APP_VERSION).toBe(versionOf('../../package.json'));
  });

  it('is the release version that Commitizen bumps (root package.json)', () => {
    expect(APP_VERSION).toBe(versionOf('../../../package.json'));
  });

  it('is a semantic version, not the old 1.0.0 placeholder', () => {
    expect(APP_VERSION).toMatch(/^\d+\.\d+\.\d+(?:[-+].+)?$/);
    expect(APP_VERSION).not.toBe('1.0.0');
  });
});

describe('APP_LICENSE', () => {
  it('matches the licence of the repository (LICENSE, root package.json)', () => {
    const license = readFileSync(new URL('../../../LICENSE', import.meta.url), 'utf8');
    expect(license).toContain('Apache License');
    expect(license).toContain('Version 2.0');
    const pkg = JSON.parse(
      readFileSync(new URL('../../../package.json', import.meta.url), 'utf8'),
    ) as { license: string };
    expect(APP_LICENSE.identifier).toBe(pkg.license);
    expect(APP_LICENSE.identifier).toBe('Apache-2.0');
  });
});
