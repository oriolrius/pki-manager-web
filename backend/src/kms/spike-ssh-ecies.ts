/**
 * SSH-23 spike — ECIES feasibility for the per-host encrypted KRL path
 * (decision-013). Empirically tests, against the live Cosmian KMS on nistp256:
 *   (b) locate-by-tag
 *   (c) `ec encrypt` / `ec decrypt` (ECIES) round-trip
 *   (a) register an EC keypair tagged by host_id (the host's ECIES key)
 * Skips (exit 0) when KMS_URL is unreachable. Gates SSH-15 + SSH-24.
 *
 * Run: KMS_URL=… npx tsx src/kms/spike-ssh-ecies.ts
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const KMS_URL = (process.env.KMS_URL || 'http://wsl.ymbihq.local:42998').replace(/\/$/, '');
const COSMIAN = process.env.COSMIAN_BIN || 'cosmian';
const cosmian = (args: string[]) => execFileSync(COSMIAN, ['--kms-url', KMS_URL, 'kms', ...args], { encoding: 'utf8' });

type Probe = { path: string; ok: boolean; detail: string };
const probes: Probe[] = [];
const record = (path: string, ok: boolean, detail: string) => {
  probes.push({ path, ok, detail });
  console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${path}: ${detail}`);
};

async function main(): Promise<void> {
  console.log(`SSH-23 ECIES spike → KMS_URL=${KMS_URL}\n`);
  try {
    const r = await fetch(`${KMS_URL}/version`, { signal: AbortSignal.timeout(5000) });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
  } catch (e) {
    console.log(`SKIP: KMS unreachable (${String(e)}); exiting 0.`);
    process.exit(0);
  }

  const work = mkdtempSync(join(tmpdir(), 'ssh-ecies-'));
  const hostTag = 'ssh-ecies-spike-host';
  const keyId = 'ssh-ecies-spike-host-key';
  try {
    // (a) Register a per-host ECIES keypair tagged by host_id (the KMS-resident
    //     model — retired by decision-015 in favour of local-key decryption;
    //     this spike is kept for historical reference). Private key never leaves KMS.
    try {
      cosmian(['ec', 'keys', 'create', '--curve', 'nist-p256', '--tag', hostTag, '--tag', 'host-pubkey', keyId]);
      record('(a) register per-host ECIES keypair (tagged)', true, `created ${keyId} / ${keyId}_pk tagged ${hostTag}`);
    } catch (e: any) {
      record('(a) register per-host ECIES keypair (tagged)', false, String(e).slice(0, 140));
    }

    // (b) locate-by-tag resolves exactly this host's key(s).
    try {
      const out = cosmian(['locate', '--tag', hostTag]);
      const found = out.split('\n').map((s) => s.trim()).filter(Boolean).filter((s) => s.includes(keyId));
      record('(b) locate-by-tag', found.length >= 1, `resolved ${found.length} id(s) for tag ${hostTag}`);
    } catch (e: any) {
      record('(b) locate-by-tag', false, String(e).slice(0, 140));
    }

    // (c) ECIES encrypt to the host public key, decrypt with the private key.
    try {
      const pt = join(work, 'pt.bin');
      const ct = join(work, 'ct.bin');
      const rt = join(work, 'rt.bin');
      const payload = Buffer.from(JSON.stringify({ krl: 'AAAA', valid_until: 9999999999, host_id: hostTag }));
      writeFileSync(pt, payload);
      cosmian(['ec', 'encrypt', '--key-id', `${keyId}_pk`, '-o', ct, pt]);
      cosmian(['ec', 'decrypt', '--key-id', keyId, '-o', rt, ct]);
      const ok = Buffer.compare(payload, readFileSync(rt)) === 0;
      record('(c) ECIES encrypt -> decrypt round-trip', ok, ok ? 'plaintext recovered exactly' : 'MISMATCH');
    } catch (e: any) {
      record('(c) ECIES encrypt -> decrypt round-trip', false, String(e).slice(0, 140));
    }
  } finally {
    try { cosmian(['ec', 'keys', 'destroy', '--key-id', keyId]); } catch { /* */ }
    rmSync(work, { recursive: true, force: true });
  }

  const viable = probes.filter((p) => p.path.startsWith('(b)') || p.path.startsWith('(c)')).every((p) => p.ok);
  console.log('\n=== SUMMARY ===');
  console.log(JSON.stringify(probes, null, 2));
  console.log('\n=== DECISION (decision-013) ===');
  if (viable) {
    console.log('ECIES per-host KRL distribution is VIABLE. Adopt the KMS-resident per-host');
    console.log('ECIES keypair model (tagged by host_id) — SSH-15 registers it, SSH-24 sidecar');
    console.log('encrypts the KRL payload to it; the puller decrypts via the host key id.');
  } else {
    console.log('ECIES is NOT viable here. Fall back to the bare/served public KRL (SSH-22)');
    console.log('+ short TTLs; keep SSH-15/SSH-24 deferred.');
  }
  process.exit(0);
}

main().catch((e) => { console.error('spike error:', e); process.exit(1); });
