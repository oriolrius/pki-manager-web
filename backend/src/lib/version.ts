import { readFileSync } from 'node:fs';

/**
 * Release version and licence of PKI Manager, for the API documents and the
 * health endpoint.
 *
 * The version comes from `backend/package.json`, which Commitizen bumps on each
 * release (see `version_files` in `pyproject.toml`). This module is two folders
 * below `backend/` both in the source tree (`src/lib/version.ts`, run by tsx and
 * Vitest) and in the build (`dist/lib/version.js`), and the production image
 * copies `backend/package.json` next to `dist/`, so one relative path works in
 * all three cases. It is read once, when the module loads.
 */
function readPackageVersion(): string {
  try {
    const raw = readFileSync(new URL('../../package.json', import.meta.url), 'utf8');
    const version = (JSON.parse(raw) as { version?: unknown }).version;
    if (typeof version === 'string' && version.length > 0) {
      return version;
    }
  } catch {
    // Fall through: a missing or unreadable package.json must not stop the server.
  }
  return '0.0.0-unknown';
}

export const APP_VERSION: string = readPackageVersion();

/**
 * Licence of the repository (see `LICENSE`), as an OpenAPI 3.1 License Object.
 * OpenAPI 3.1 allows `identifier` (SPDX) or `url`, not both.
 */
export const APP_LICENSE = {
  name: 'Apache-2.0',
  identifier: 'Apache-2.0',
} as const;
