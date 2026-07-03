/**
 * SSH-33 — end-to-end verification against a REAL sshd, proving the whole backend
 * (KMS-signed CAs -> OpenSSH cert encoder -> KRL) is byte-compatible with OpenSSH.
 * Mirrors the PoC UC1-UC9: no-TOFU host login, principal RBAC, PTY denial,
 * force-command, expiry, KRL revocation. Runs sshd non-root on a high port as the
 * current user. Gated on KMS_AVAILABLE + ssh-keygen + sshd; skips cleanly otherwise.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir, userInfo } from 'node:os';
import { join } from 'node:path';
import { db } from '../../db/client.js';
import { sshCas, sshHosts, sshIdentities, sshCertificates, sshKrls, sshHostKrls, sshHostBlocks, sshRevocations, sshHostPrincipalMaps, sshUserPrincipals, sshPrincipals, sshFleetTokens, sshIdempotency } from '../../db/schema.js';
import { getKMSService } from '../../kms/service.js';
import { getSshCaService } from '../../services/ssh-ca.service.js';
import { getSshHostService } from '../../services/ssh-host.service.js';
import { getSshUserService } from '../../services/ssh-user.service.js';
import { getSshKrlService } from '../../services/ssh-krl.service.js';
import { buildKrl } from './krl.js';

const SSHD = ['/usr/sbin/sshd', '/usr/bin/sshd', '/sbin/sshd'].find((p) => existsSync(p));
const KMS = process.env.KMS_AVAILABLE === 'true';
const RUN = KMS && !!SSHD;
const ctx = { db, ipAddress: null };
const PORT = 2240 + Math.floor((Date.now() / 1000) % 50);
const USER = userInfo().username;

async function wipe() {
  const cas = await db.select().from(sshCas);
  const kms = getKMSService();
  for (const c of cas as any[]) { try { await kms.destroyKeyPair(c.kmsKeyId, c.kmsPublicKeyId); } catch { /* */ } }
  for (const t of [sshHostKrls, sshHostBlocks, sshIdempotency, sshFleetTokens, sshKrls, sshRevocations, sshHostPrincipalMaps, sshUserPrincipals, sshCertificates, sshHosts, sshIdentities, sshPrincipals, sshCas]) {
    await db.delete(t);
  }
}

describe.skipIf(!RUN)('SSH-33 end-to-end against real sshd', () => {
  let work: string;
  let userCa: any;
  let sshdPid: string;

  /** Issue a user cert for a fresh key; write key + cert; return the key path. */
  async function issueUser(name: string, opts: { principals: string[]; extensions?: string[]; forceCommand?: string; validForSeconds?: number }): Promise<string> {
    const keyPath = join(work, name);
    execFileSync('ssh-keygen', ['-t', 'ed25519', '-f', keyPath, '-N', '', '-q']);
    const ident = await getSshUserService().createIdentity(ctx, { subject: `${name}@e2e` });
    const res = await getSshUserService().issue(ctx, {
      identityId: ident.id,
      caId: userCa.id,
      sshPublicKey: readFileSync(`${keyPath}.pub`, 'utf8'),
      principals: opts.principals,
      extensions: opts.extensions,
      forceCommand: opts.forceCommand,
      validForSeconds: opts.validForSeconds,
    });
    writeFileSync(`${keyPath}-cert.pub`, res.cert.certOpenssh);
    return keyPath;
  }

  function ssh(keyPath: string, cmd: string, extra: string[] = []): { code: number | null; out: string; err: string } {
    const r = spawnSync(
      'ssh',
      ['-p', String(PORT), '-F', '/dev/null',
        '-o', `UserKnownHostsFile=${join(work, 'known_hosts')}`, '-o', 'GlobalKnownHostsFile=/dev/null',
        '-o', 'StrictHostKeyChecking=yes', '-o', 'PasswordAuthentication=no', '-o', 'BatchMode=yes',
        '-o', 'IdentitiesOnly=yes', '-o', 'ConnectTimeout=5', '-i', keyPath, ...extra,
        `${USER}@127.0.0.1`, cmd],
      { encoding: 'utf8', timeout: 20000 }
    );
    return { code: r.status, out: r.stdout ?? '', err: r.stderr ?? '' };
  }

  beforeAll(async () => {
    work = mkdtempSync(join(tmpdir(), 'ssh-e2e-'));
    await wipe();

    // UC1: dual CA in KMS.
    userCa = await getSshCaService().create(ctx, { caType: 'user' });
    const hostCa = await getSshCaService().create(ctx, { caType: 'host' });

    // UC2: host key + Host-CA-signed cert via the service.
    execFileSync('ssh-keygen', ['-t', 'ed25519', '-f', join(work, 'hostkey'), '-N', '', '-q']);
    const host = await getSshHostService().register(ctx, { fqdn: 'e2e-host', addresses: ['127.0.0.1', 'localhost'], opensshHostPubkey: readFileSync(join(work, 'hostkey.pub'), 'utf8') });
    const issued = await getSshHostService().issue(ctx, { hostId: host.id });
    writeFileSync(join(work, 'hostkey-cert.pub'), issued.cert.certOpenssh);

    // Trust: User CA pub for TrustedUserCAKeys; an initial empty KRL.
    writeFileSync(join(work, 'user-ca.pub'), userCa.opensshPublicKey + '\n');
    writeFileSync(join(work, 'revoked_keys'), buildKrl({ krlVersionNumber: 0n }));
    // auth_principals: 'admin' maps to the current login user (RBAC).
    const ap = join(work, 'auth_principals');
    execFileSync('mkdir', ['-p', ap]);
    writeFileSync(join(ap, USER), 'admin\n');

    // sshd config (non-root, no privsep account needed for self-login).
    writeFileSync(join(work, 'sshd_config'), [
      `Port ${PORT}`,
      'ListenAddress 127.0.0.1',
      `HostKey ${join(work, 'hostkey')}`,
      `HostCertificate ${join(work, 'hostkey-cert.pub')}`,
      `TrustedUserCAKeys ${join(work, 'user-ca.pub')}`,
      `AuthorizedPrincipalsFile ${join(ap, '%u')}`,
      `RevokedKeys ${join(work, 'revoked_keys')}`,
      'AuthorizedKeysFile /dev/null',
      `PidFile ${join(work, 'sshd.pid')}`,
      'StrictModes no',
      'UsePAM no',
      'PasswordAuthentication no',
      'PubkeyAuthentication yes',
      'LogLevel VERBOSE',
      '',
    ].join('\n'));

    // UC3 client trust: @cert-authority for the Host CA ([host]:port form for the port).
    writeFileSync(join(work, 'known_hosts'), `@cert-authority [127.0.0.1]:${PORT},[localhost]:${PORT} ${hostCa.opensshPublicKey.trim()}\n`);

    execFileSync(SSHD!, ['-f', join(work, 'sshd_config'), '-E', join(work, 'sshd.log')]);
    await new Promise((r) => setTimeout(r, 800));
    sshdPid = readFileSync(join(work, 'sshd.pid'), 'utf8').trim();
  }, 90_000);

  afterAll(async () => {
    if (sshdPid) try { process.kill(Number(sshdPid)); } catch { /* */ }
    await wipe();
    if (work) rmSync(work, { recursive: true, force: true });
  });

  it('UC3/UC4/UC5: no-TOFU host cert + user cert auth + principal RBAC', async () => {
    // 'admin' principal is mapped to the login user -> succeeds with no authorized_keys.
    const adminKey = await issueUser('admin', { principals: ['admin'] });
    const ok = ssh(adminKey, 'echo E2E=$(whoami)');
    expect(ok.code).toBe(0);
    expect(ok.out).toContain(`E2E=${USER}`);
    // sshd accepted a CERT and logged the Key ID + serial + CA fingerprint.
    expect(readFileSync(join(work, 'sshd.log'), 'utf8')).toMatch(/Accepted publickey.*CERT.*ID admin@e2e/);

    // A cert whose principal is NOT in auth_principals is rejected.
    const noneKey = await issueUser('nope', { principals: ['intruder'] });
    expect(ssh(noneKey, 'echo nope').code).not.toBe(0);
  });

  it('UC6: hardened cert (no permit-pty) runs commands but is denied a PTY', async () => {
    const hardened = await issueUser('hardened', { principals: ['admin'], extensions: ['permit-agent-forwarding'] });
    expect(ssh(hardened, 'uname').code).toBe(0); // command exec works
    const pty = ssh(hardened, 'true', ['-tt']);
    expect(pty.err + pty.out).toMatch(/PTY allocation request failed/i);
  });

  it('UC7: force-command overrides the requested command', async () => {
    const forced = await issueUser('forced', { principals: ['admin'], forceCommand: '/bin/echo forced-command-ran' });
    const r = ssh(forced, 'echo this-should-be-ignored');
    expect(r.out).toContain('forced-command-ran');
    expect(r.out).not.toContain('this-should-be-ignored');
  });

  it('UC8: an expired certificate is rejected', async () => {
    // Issue with a 1s TTL, then wait it out.
    const shortKey = await issueUser('expired', { principals: ['admin'], validForSeconds: 1 });
    await new Promise((r) => setTimeout(r, 2500));
    const r = ssh(shortKey, 'echo nope');
    expect(r.code).not.toBe(0);
    expect(readFileSync(join(work, 'sshd.log'), 'utf8')).toMatch(/Certificate invalid: expired/i);
  });

  it('UC9: KRL revocation denies a previously-valid cert (no sshd restart)', async () => {
    const revKey = await issueUser('revoke-me', { principals: ['admin'] });
    expect(ssh(revKey, 'echo pre').code).toBe(0); // works before revocation

    // Find the issued cert id and revoke it -> build KRL -> install as RevokedKeys.
    const allCerts = (await db.select().from(sshCertificates)) as any[];
    const target = allCerts.find((c) => c.keyId === 'revoke-me@e2e');
    const krl = await getSshKrlService().revokeByCert(ctx, target.id, 'compromised');
    const latest = await getSshKrlService().getLatestRow(ctx, target.caId);
    writeFileSync(join(work, 'revoked_keys'), Buffer.from(latest.krlBlob)); // sshd re-reads per auth
    expect(krl.revokedCount).toBeGreaterThanOrEqual(1);

    const after = ssh(revKey, 'echo post');
    expect(after.code).not.toBe(0);
    expect(readFileSync(join(work, 'sshd.log'), 'utf8')).toMatch(/revoked by file/i);
  });
});
