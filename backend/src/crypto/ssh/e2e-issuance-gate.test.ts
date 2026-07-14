/**
 * BLK-13 E2E (TASK-190) — the flag-gated issuance gate closes the two windows
 * pure per-host KRLs leave open, BY CONSTRUCTION: a post-block cert carries
 * only host-scoped principals excluding the blocked host, so even a host that
 * NEVER pulls a KRL (empty RevokedKeys throughout) denies it, while a
 * non-blocked host accepts the same cert. Uses render()'s dual-form
 * auth_principals lines. Gated on KMS_AVAILABLE + sshd.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir, userInfo } from 'node:os';
import { join } from 'node:path';
import { db } from '../../db/client.js';
import { sshCas, sshHosts, sshIdentities, sshCertificates, sshKrls, sshHostKrls, sshHostBlocks, sshRevocations, sshHostPrincipalMaps, sshUserPrincipals, sshPrincipals, sshFleetTokens, sshIdempotency } from '../../db/schema.js';
import { getKMSService } from '../../kms/service.js';
import { getSshCaService } from '../../services/ssh-ca.service.js';
import { getSshHostService } from '../../services/ssh-host.service.js';
import { getSshUserService } from '../../services/ssh-user.service.js';
import { getSshPrincipalService } from '../../services/ssh-principal.service.js';
import { getSshBlockService } from '../../services/ssh-block.service.js';
import { buildKrl } from './krl.js';

const SSHD = ['/usr/sbin/sshd', '/usr/bin/sshd', '/sbin/sshd'].find((p) => existsSync(p));
const KMS = process.env.KMS_AVAILABLE === 'true';
const RUN = KMS && !!SSHD;
const ctx = { db, ipAddress: null };
const USER = userInfo().username;
const PORT_Y = 2440 + Math.floor((Date.now() / 1000) % 40);
const PORT_Z = PORT_Y + 41;

async function wipe() {
  const cas = await db.select().from(sshCas);
  const kms = getKMSService();
  for (const c of cas as any[]) { try { await kms.destroyKeyPair(c.kmsKeyId, c.kmsPublicKeyId); } catch { /* */ } }
  for (const t of [sshHostKrls, sshHostBlocks, sshIdempotency, sshFleetTokens, sshKrls, sshRevocations, sshHostPrincipalMaps, sshUserPrincipals, sshCertificates, sshHosts, sshIdentities, sshPrincipals, sshCas]) {
    await db.delete(t);
  }
}

describe.skipIf(!RUN)('BLK-13 issuance gate vs real sshd (never-pulling blocked host)', () => {
  let work: string;
  let userCa: any;
  let hostCa: any;
  let hostY: any;
  let hostZ: any;
  let alice: any;
  const pids: string[] = [];

  function ssh(port: number, keyPath: string, cmd: string): number | null {
    return spawnSync(
      'ssh',
      ['-p', String(port), '-F', '/dev/null',
        '-o', `UserKnownHostsFile=${join(work, 'known_hosts')}`, '-o', 'GlobalKnownHostsFile=/dev/null',
        '-o', 'StrictHostKeyChecking=yes', '-o', 'PasswordAuthentication=no', '-o', 'BatchMode=yes',
        '-o', 'IdentitiesOnly=yes', '-o', 'ConnectTimeout=5', '-i', keyPath,
        `${USER}@127.0.0.1`, cmd],
      { encoding: 'utf8', timeout: 20000 }
    ).status;
  }

  /** Register host + map the role, then start sshd with render()'s dual-form
   * auth_principals and an EMPTY RevokedKeys that is never refreshed. */
  async function startSshd(name: string, port: number, principalId: string): Promise<any> {
    const dir = join(work, name);
    mkdirSync(dir, { recursive: true });
    execFileSync('ssh-keygen', ['-t', 'ecdsa', '-b', '256', '-f', join(dir, 'hostkey'), '-N', '', '-q']);
    const host = await getSshHostService().register(ctx, { fqdn: `${name}.e2e`, addresses: ['127.0.0.1'], opensshHostPubkey: readFileSync(join(dir, 'hostkey.pub'), 'utf8') });
    await getSshPrincipalService().mapToHost(ctx, { hostId: host.id, principalId, localAccount: USER });
    const issued = await getSshHostService().issue(ctx, { hostId: host.id });
    writeFileSync(join(dir, 'hostkey-cert.pub'), issued.cert.certOpenssh);
    writeFileSync(join(dir, 'user-ca.pub'), userCa.opensshPublicKey + '\n');
    writeFileSync(join(dir, 'revoked_keys'), buildKrl({ krlVersionNumber: 0n }));

    const ap = join(dir, 'auth_principals');
    mkdirSync(ap, { recursive: true });
    const rendered = await getSshPrincipalService().render(ctx, host.id);
    expect(rendered.files[USER]).toContain(`admin@${name}.e2e`); // dual-form lines in place
    writeFileSync(join(ap, USER), rendered.files[USER]);

    writeFileSync(join(dir, 'sshd_config'), [
      `Port ${port}`,
      'ListenAddress 127.0.0.1',
      `HostKey ${join(dir, 'hostkey')}`,
      `HostCertificate ${join(dir, 'hostkey-cert.pub')}`,
      `TrustedUserCAKeys ${join(dir, 'user-ca.pub')}`,
      `AuthorizedPrincipalsFile ${join(ap, '%u')}`,
      `RevokedKeys ${join(dir, 'revoked_keys')}`,
      'AuthorizedKeysFile /dev/null',
      `PidFile ${join(dir, 'sshd.pid')}`,
      'StrictModes no',
      'UsePAM no',
      'PasswordAuthentication no',
      'PubkeyAuthentication yes',
      'LogLevel VERBOSE',
      '',
    ].join('\n'));
    execFileSync(SSHD!, ['-f', join(dir, 'sshd_config'), '-E', join(dir, 'sshd.log')]);
    await new Promise((r) => setTimeout(r, 800));
    pids.push(readFileSync(join(dir, 'sshd.pid'), 'utf8').trim());
    return host;
  }

  beforeAll(async () => {
    work = mkdtempSync(join(tmpdir(), 'blk13-e2e-'));
    await wipe();
    process.env.SSH_BLOCK_ISSUANCE_GATE = 'true';
    userCa = await getSshCaService().create(ctx, { caType: 'user' });
    hostCa = await getSshCaService().create(ctx, { caType: 'host' });
    alice = await getSshUserService().createIdentity(ctx, { subject: 'alice@e2e' });

    const role = await getSshPrincipalService().createPrincipal(ctx, { name: 'admin' });
    hostY = await startSshd('yg', PORT_Y, role.id);
    hostZ = await startSshd('zg', PORT_Z, role.id);

    writeFileSync(
      join(work, 'known_hosts'),
      `@cert-authority [127.0.0.1]:${PORT_Y},[127.0.0.1]:${PORT_Z} ${hostCa.opensshPublicKey.trim()}\n`
    );
  }, 180_000);

  afterAll(async () => {
    for (const pid of pids) { try { process.kill(Number(pid)); } catch { /* */ } }
    delete process.env.SSH_BLOCK_ISSUANCE_GATE;
    await wipe();
    if (work) rmSync(work, { recursive: true, force: true });
  });

  it('a post-block cert is denied on the blocked host DESPITE an empty, never-refreshed KRL — and works elsewhere', async () => {
    await getSshBlockService().block(ctx, { hostId: hostY.id, identityId: alice.id, reason: 'gate e2e' });

    const keyPath = join(work, 'alice-post-block');
    execFileSync('ssh-keygen', ['-t', 'ed25519', '-f', keyPath, '-N', '', '-q']);
    const res = await getSshUserService().issue(ctx, {
      identityId: alice.id,
      caId: userCa.id,
      sshPublicKey: readFileSync(`${keyPath}.pub`, 'utf8'),
      principals: ['admin'],
    });
    writeFileSync(`${keyPath}-cert.pub`, res.cert.certOpenssh);

    // The cert was BORN narrowed: scoped to the allowed host only.
    const certs = await getSshUserService().listCertificates(ctx, alice.id);
    const principals = certs.find((c: any) => c.id === res.cert.id)!.principals;
    expect(principals).toEqual([`admin@${hostZ.fqdn}`]);

    // Blocked host Y: RevokedKeys is STILL the empty KRL (never pulled) — the
    // deny comes purely from principal narrowing. Allowed host Z: accepted.
    expect(ssh(PORT_Y, keyPath, 'echo blocked')).not.toBe(0);
    expect(ssh(PORT_Z, keyPath, 'echo allowed')).toBe(0);
  });
});
