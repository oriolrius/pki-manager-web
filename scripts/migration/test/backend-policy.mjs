// Runs the v4 backend key-policy checkers on the cases of key-policy.test.ts.
// Usage: node --experimental-transform-types backend-policy.mjs <backend/src/openbao> < cases.json
// Prints one verdict per case: { ok, error }. The backend imports `./http.js`:
// the resolve hook maps a missing relative `.js` file to its `.ts` source.
import { registerHooks } from 'node:module';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

registerHooks({
  resolve(specifier, context, next) {
    try { return next(specifier, context); } catch (error) {
      if (specifier.startsWith('.') && specifier.endsWith('.js')) return next(`${specifier.slice(0, -3)}.ts`, context);
      throw error;
    }
  },
});

const dir = process.argv[2];
const load = name => import(pathToFileURL(join(dir, name)).href);
const ssh = await load('ssh-transit.ts');
const ra = await load('ra-transit.ts');
const x509 = await load('x509-transit.ts');

const verdict = c => {
  try {
    // The SSH client checks the name when it parses the row reference (parseSshKeyRef).
    if (c.purpose === 'ssh-ca') { ssh.parseSshKeyRef(`${ssh.SSH_KEY_REF_PREFIX}pki-manager-ssh:${c.name}:${c.version}`); ssh.checkSshCaKeyPolicy(c.data, c.version, { allowImported: c.allowImported }); }
    else if (c.purpose === 'scep-ra') { ra.assertKeyName(c.name); ra.checkRAKeyPolicy(c.data, c.version, { allowImported: c.allowImported }); }
    else {
      x509.assertTransitKeyName(c.name);
      const info = x509.parseTransitKey(c.data);
      const pub = info.publicKeys.get(c.version);
      if (!pub) throw new Error(`no public key for version ${c.version}`);
      x509.assertKeyMatchesType(pub, info.type);
    }
    return { ok: true };
  } catch (error) { return { ok: false, error: error.message }; }
};

const cases = JSON.parse(readFileSync(0, 'utf8'));
process.stdout.write(JSON.stringify(cases.map(verdict)));
