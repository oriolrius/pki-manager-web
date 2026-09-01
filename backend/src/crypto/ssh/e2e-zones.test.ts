/**
 * ZONE-12 (decision-017) — two-zone isolation, end-to-end against a REAL sshd.
 * Proves the trust boundary at the wire level: a user cert from zone A is
 * REJECTED by a host in zone B (and accepted from B), a host's composed KRL
 * signature verifies only against its own zone's Host CA, and the same FQDN in
 * two zones yields two independently-certified hosts. Gated on KMS + sshd.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir, userInfo } from 'node:os';
import { join } from 'node:path';
import { eq, ne } from 'drizzle-orm';
import { db } from '../../db/client.js';
import {
  zones, sshCas, sshHosts, sshIdentities, sshCertificates, sshKrls, sshHostKrls,
  sshHostBlocks, sshRevocations, sshHostPrincipalMaps, sshUserPrincipals, sshPrincipals,
  sshFleetTokens, sshIdempotency,
} from '../../db/schema.js';
import { getKMSService } from '../../kms/service.js';
import { getSshZoneService } from '../../services/ssh-zone.service.js';
import { getSshCaService } from '../../services/ssh-ca.service.js';
import { getSshHostService } from '../../services/ssh-host.service.js';
import { getSshUserService } from '../../services/ssh-user.service.js';
import { getSshHostKrlService } from '../../services/ssh-host-krl.service.js';
import { buildKrl } from './krl.js';

const SSHD = ['/usr/sbin/sshd', '/usr/bin/sshd', '/sbin/sshd'].find((p) => existsSync(p));
const KMS = process.env.KMS_AVAILABLE === 'true';
const RUN = KMS && !!SSHD;
const ctx = { db, ipAddress: null };
const PORT = 2340 + Math.floor((Date.now() / 1000) % 50);
const USER = userInfo().username;

async function wipe() {
  const cas = await db.select().from(sshCas);
  const kms = getKMSService();
  for (const c of cas as any[]) { try { await kms.destroyKeyPair(c.kmsKeyId, c.kmsPublicKeyId); } catch { /* */ } }
  for (const t of [sshHostKrls, sshHostBlocks, sshIdempotency, sshFleetTokens, sshKrls, sshRevocations, sshHostPrincipalMaps, sshUserPrincipals, sshCertificates, sshHosts, sshIdentities, sshPrincipals, sshCas]) {
    await db.delete(t);
  }
  await db.delete(zones).where(ne(zones.name, 'default'));
}

describe.skipIf(!RUN)('ZONE-12 two-zone isolation against real sshd', () => {
  let work: string;
  let sshdPid: string;
  let prodUserCa: any, prodHostCa: any, stagingHostCa: any;
  let prodHost: any;

  async function issueUser(zone: string, name: string, principals: string[]): Promise<string> {
    const keyPath = join(work, `${zone}-${name}`);
    execFileSync('ssh-keygen', ['-t', 'ed25519', '-f', keyPath, '-N', '', '-q']);
    const ident = await getSshUserService().createIdentity(ctx, { subject: `${name}@${zone}`, zone });
    const res = await getSshUserService().issue(ctx, {
      identityId: ident.id,
      sshPublicKey: readFileSync(`${keyPath}.pub`, 'utf8'),
      principals,
    });
    writeFileSync(`${keyPath}-cert.pub`, res.cert.certOpenssh);
    return keyPath;
  }

  function ssh(keyPath: string, cmd: string): { code: number | null; out: string; err: string } {
    const r = spawnSync(
      'ssh',
      ['-p', String(PORT), '-F', '/dev/null',
        '-o', `UserKnownHostsFile=${join(work, 'known_hosts')}`, '-o', 'GlobalKnownHostsFile=/dev/null',
        '-o', 'StrictHostKeyChecking=yes', '-o', 'PasswordAuthentication=no', '-o', 'BatchMode=yes',
        '-o', 'IdentitiesOnly=yes', '-o', 'ConnectTimeout=5', '-i', keyPath,
        `${USER}@127.0.0.1`, cmd],
      { encoding: 'utf8', timeout: 20000 }
    );
    return { code: r.status, out: r.stdout ?? '', err: r.stderr ?? '' };
  }

  beforeAll(async () => {
    work = mkdtempSync(join(tmpdir(), 'ssh-zone-e2e-'));
    await wipe();
    await getSshZoneService().create(ctx, { name: 'prod', displayName: 'Prod' });
    await getSshZoneService().create(ctx, { name: 'staging', displayName: 'Staging' });
    prodUserCa = await getSshCaService().create(ctx, { caType: 'user', zone: 'prod' });
    prodHostCa = await getSshCaService().create(ctx, { caType: 'host', zone: 'prod' });
    await getSshCaService().create(ctx, { caType: 'user', zone: 'staging' }); // staging user CA (used implicitly by issueUser('staging'))
    stagingHostCa = await getSshCaService().create(ctx, { caType: 'host', zone: 'staging' });

    // A prod host with a prod-signed host cert.
    execFileSync('ssh-keygen', ['-t', 'ecdsa', '-b', '256', '-f', join(work, 'hostkey'), '-N', '', '-q']);
    prodHost = await getSshHostService().register(ctx, {
      fqdn: 'e2e-host', addresses: ['127.0.0.1', 'localhost'],
      opensshHostPubkey: readFileSync(join(work, 'hostkey.pub'), 'utf8'), zone: 'prod',
    });
    const issued = await getSshHostService().issue(ctx, { hostId: prodHost.id });
    writeFileSync(join(work, 'hostkey-cert.pub'), issued.cert.certOpenssh);

    // sshd trusts ONLY prod's user CA (the zone boundary made concrete).
    writeFileSync(join(work, 'user-ca.pub'), prodUserCa.opensshPublicKey + '\n');
    writeFileSync(join(work, 'revoked_keys'), buildKrl({ krlVersionNumber: 0n }));
    const ap = join(work, 'auth_principals');
    execFileSync('mkdir', ['-p', ap]);
    writeFileSync(join(ap, USER), 'admin\n');
    writeFileSync(join(work, 'sshd_config'), [
      `Port ${PORT}`, 'ListenAddress 127.0.0.1',
      `HostKey ${join(work, 'hostkey')}`, `HostCertificate ${join(work, 'hostkey-cert.pub')}`,
      `TrustedUserCAKeys ${join(work, 'user-ca.pub')}`,
      `AuthorizedPrincipalsFile ${join(ap, '%u')}`, `RevokedKeys ${join(work, 'revoked_keys')}`,
      'AuthorizedKeysFile /dev/null', `PidFile ${join(work, 'sshd.pid')}`,
      'StrictModes no', 'UsePAM no', 'PasswordAuthentication no', 'PubkeyAuthentication yes', 'LogLevel VERBOSE', '',
    ].join('\n'));
    writeFileSync(join(work, 'known_hosts'), `@cert-authority [127.0.0.1]:${PORT},[localhost]:${PORT} ${prodHostCa.opensshPublicKey.trim()}\n`);

    execFileSync(SSHD!, ['-f', join(work, 'sshd_config'), '-E', join(work, 'sshd.log')]);
    await new Promise((r) => setTimeout(r, 800));
    sshdPid = readFileSync(join(work, 'sshd.pid'), 'utf8').trim();
  }, 120_000);

  afterAll(async () => {
    if (sshdPid) try { process.kill(Number(sshdPid)); } catch { /* */ }
    await wipe();
    if (work) rmSync(work, { recursive: true, force: true });
  });

  it('AC#2: a user cert issued IN the host\'s zone is accepted', async () => {
    const k = await issueUser('prod', 'alice', ['admin']);
    const r = ssh(k, 'echo OK=$(whoami)');
    expect(r.code).toBe(0);
    expect(r.out).toContain(`OK=${USER}`);
  });

  it('AC#1: a user cert issued in ANOTHER zone is rejected by the host', async () => {
    // Same principal, same login user — the ONLY difference is the signing zone.
    const k = await issueUser('staging', 'alice', ['admin']);
    const r = ssh(k, 'echo SHOULD_NOT_RUN');
    expect(r.code).not.toBe(0); // login denied — the staging CA is not trusted here
    expect(r.out).not.toContain('SHOULD_NOT_RUN');
    // and sshd never ACCEPTED the staging-signed cert (it did for prod's alice).
    expect(readFileSync(join(work, 'sshd.log'), 'utf8')).not.toMatch(/Accepted publickey.*ID alice@staging/);
  });

  it('AC#4: the composed host KRL signature verifies ONLY against its own zone Host CA', async () => {
    await getSshHostKrlService().generate(ctx, prodHost.id);
    const row = await getSshHostKrlService().getLatestRow(ctx, prodHost.id);
    expect(row?.caSignature).toBeTruthy();
    const kms = getKMSService();
    const blob = Buffer.from(row.krlBlob);
    const sig = Buffer.from(row.caSignature);
    // SshCaDto omits KMS key ids — fetch the rows for kmsPublicKeyId.
    const prodCaRow = (await db.select().from(sshCas).where(eq(sshCas.id, prodHostCa.id)).limit(1))[0] as any;
    const stagingCaRow = (await db.select().from(sshCas).where(eq(sshCas.id, stagingHostCa.id)).limit(1))[0] as any;
    expect(await kms.signatureVerify(prodCaRow.kmsPublicKeyId, blob, sig)).toBe(true);
    // Verifying prod's signature against staging's Host CA key must NOT succeed.
    // The KMS may return false OR reject the mismatched request — both mean "does
    // not verify against the other zone's CA".
    const otherZoneVerify = await kms
      .signatureVerify(stagingCaRow.kmsPublicKeyId, blob, sig)
      .catch(() => false);
    expect(otherZoneVerify).toBe(false);
  });

  it('AC#5: the same FQDN in two zones yields two independently-certified hosts', async () => {
    execFileSync('ssh-keygen', ['-t', 'ecdsa', '-b', '256', '-f', join(work, 'dupA'), '-N', '', '-q']);
    execFileSync('ssh-keygen', ['-t', 'ecdsa', '-b', '256', '-f', join(work, 'dupB'), '-N', '', '-q']);
    const hA = await getSshHostService().register(ctx, { fqdn: 'dup.example', addresses: [], opensshHostPubkey: readFileSync(join(work, 'dupA.pub'), 'utf8'), zone: 'prod' });
    const hB = await getSshHostService().register(ctx, { fqdn: 'dup.example', addresses: [], opensshHostPubkey: readFileSync(join(work, 'dupB.pub'), 'utf8'), zone: 'staging' });
    const cA = await getSshHostService().issue(ctx, { hostId: hA.id });
    const cB = await getSshHostService().issue(ctx, { hostId: hB.id });
    writeFileSync(join(work, 'dupA-cert.pub'), cA.cert.certOpenssh);
    writeFileSync(join(work, 'dupB-cert.pub'), cB.cert.certOpenssh);
    const inspect = (p: string) => execFileSync('ssh-keygen', ['-L', '-f', p], { encoding: 'utf8' });
    // Each cert is signed by its OWN zone's Host CA (distinct fingerprints).
    expect(inspect(join(work, 'dupA-cert.pub'))).toContain(prodHostCa.fingerprintSha256);
    expect(inspect(join(work, 'dupB-cert.pub'))).toContain(stagingHostCa.fingerprintSha256);
    expect(prodHostCa.fingerprintSha256).not.toBe(stagingHostCa.fingerprintSha256);
    // Envelopes are encrypted to each host's own key by construction (host.opensshHostPubkey),
    // so only the matching host can decrypt — the ECIES round-trip itself is covered by ecies.test.ts.
  });
});
