/**
 * SSH-10..14 service integration — full dual-CA → host/user issuance → RBAC flow
 * against the live KMS, validated by ssh-keygen -L. Gated on KMS_AVAILABLE.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { db } from '../db/client.js';
import {
  sshCas,
  sshCertificates,
  sshHosts,
  sshIdentities,
  sshPrincipals,
  sshUserPrincipals,
  sshHostPrincipalMaps,
  sshRevocations,
  sshKrls, sshHostKrls, sshHostBlocks,
} from '../db/schema.js';
import { getKMSService } from '../kms/service.js';
import { getSshCaService } from './ssh-ca.service.js';
import { getSshHostService } from './ssh-host.service.js';
import { getSshUserService } from './ssh-user.service.js';
import { getSshPrincipalService } from './ssh-principal.service.js';

const KMS = process.env.KMS_AVAILABLE === 'true';
const ctx = { db, ipAddress: null };

async function wipe() {
  const cas = await db.select().from(sshCas);
  const kms = getKMSService();
  for (const c of cas as any[]) {
    try {
      await kms.destroyKeyPair(c.kmsKeyId, c.kmsPublicKeyId);
    } catch {
      /* best effort */
    }
  }
  for (const t of [sshHostKrls, sshHostBlocks, sshKrls, sshRevocations, sshHostPrincipalMaps, sshUserPrincipals, sshCertificates, sshHosts, sshIdentities, sshPrincipals, sshCas]) {
    await db.delete(t);
  }
}

const keygen = (args: string[]) => execFileSync('ssh-keygen', args, { stdio: 'pipe' });
const inspect = (line: string, work: string): string => {
  const p = join(work, `c-${Math.abs(line.length)}.pub`);
  writeFileSync(p, line);
  return execFileSync('ssh-keygen', ['-L', '-f', p], { encoding: 'utf8' });
};

describe.skipIf(!KMS)('SSH services integration (SSH-10..14)', () => {
  let work: string;
  let userCa: any;
  let hostCa: any;

  beforeAll(async () => {
    work = mkdtempSync(join(tmpdir(), 'ssh-svc-'));
    await wipe();
    userCa = await getSshCaService().create(ctx, { caType: 'user', label: 'Test User CA' });
    hostCa = await getSshCaService().create(ctx, { caType: 'host', label: 'Test Host CA' });
  }, 60_000);

  afterAll(async () => {
    await wipe();
    if (work) rmSync(work, { recursive: true, force: true });
  });

  it('creates a dual CA (rejecting a second active CA per type) and publishes trust anchors', async () => {
    expect(userCa.caType).toBe('user');
    expect(hostCa.caType).toBe('host');
    await expect(getSshCaService().create(ctx, { caType: 'user' })).rejects.toThrow(/already exists/i);
    const anchors = await getSshCaService().getTrustAnchors(ctx);
    expect(anchors.userCaKeys).toHaveLength(1);
    expect(anchors.hostCaKeys).toHaveLength(1);
    expect(anchors.userCaKeys[0]).toContain('ecdsa-sha2-nistp256');
  });

  it('registers a host and issues a host cert validated by ssh-keygen -L', async () => {
    keygen(['-t', 'ecdsa', '-b', '256', '-f', join(work, 'host'), '-N', '', '-q']);
    const host = await getSshHostService().register(ctx, {
      fqdn: 'server.lab.local',
      addresses: ['10.0.0.5'],
      opensshHostPubkey: readFileSync(join(work, 'host.pub'), 'utf8'),
    });
    const { cert } = await getSshHostService().issue(ctx, { hostId: host.id });
    const out = inspect(cert.certOpenssh, work);
    expect(out).toContain('host certificate');
    expect(out).toContain('server.lab.local');
    expect(out).toContain('10.0.0.5');
    expect(out).toContain(`Signing CA: ECDSA ${hostCa.fingerprintSha256}`);
  });

  it('rejects issuing a user cert from the host CA (type mismatch)', async () => {
    keygen(['-t', 'ed25519', '-f', join(work, 'u0'), '-N', '', '-q']);
    const ident = await getSshUserService().createIdentity(ctx, { subject: 'Mismatch' });
    await expect(
      getSshUserService().issue(ctx, { identityId: ident.id, caId: hostCa.id, sshPublicKey: readFileSync(join(work, 'u0.pub'), 'utf8'), principals: ['admin'] })
    ).rejects.toThrow(/not a User CA/i);
  });

  it('issues a hardened user cert (no permit-pty) with force-command + validated source-address', async () => {
    keygen(['-t', 'ed25519', '-f', join(work, 'user'), '-N', '', '-q']);
    const pub = readFileSync(join(work, 'user.pub'), 'utf8');
    const ident = await getSshUserService().createIdentity(ctx, { subject: 'Jane Jolie', email: 'jane@lab' });
    const { cert, sshClientConfig } = await getSshUserService().issue(ctx, {
      identityId: ident.id,
      sshPublicKey: pub,
      principals: ['admin'],
      extensions: ['permit-agent-forwarding'],
      forceCommand: '/usr/bin/date',
      sourceAddress: '10.0.0.0/8,192.0.2.0/24',
    });
    const out = inspect(cert.certOpenssh, work);
    expect(out).toContain('user certificate');
    expect(out).toContain('admin');
    expect(out).toContain('force-command');
    expect(out).toContain('/usr/bin/date');
    expect(out).toContain('source-address');
    expect(out).not.toContain('permit-pty');
    expect(out).toContain(`Signing CA: ECDSA ${userCa.fingerprintSha256}`);
    expect(sshClientConfig).toContain('CertificateFile');

    // malformed CIDR is rejected at issuance
    await expect(
      getSshUserService().issue(ctx, { identityId: ident.id, sshPublicKey: pub, principals: ['admin'], sourceAddress: '999.0.0.0/8' })
    ).rejects.toThrow(/CIDR/i);
  });

  it('renders auth_principals files from the RBAC catalog and tracks push drift', async () => {
    const ps = getSshPrincipalService();
    const admin = await ps.createPrincipal(ctx, { name: 'admin' });
    const dev = await ps.createPrincipal(ctx, { name: 'developer' });
    const host = (await getSshHostService().list(ctx))[0];
    await ps.mapToHost(ctx, { hostId: host.id, principalId: admin.id, localAccount: 'root' });
    await ps.mapToHost(ctx, { hostId: host.id, principalId: dev.id, localAccount: 'developer' });

    const render = await ps.render(ctx, host.id);
    expect(render.files['root']).toContain('admin');
    expect(render.files['developer']).toContain('developer');
    expect(render.directive).toContain('AuthorizedPrincipalsFile');
    expect(render.stale).toBe(true);

    await ps.markPushed(ctx, host.id);
    expect((await ps.render(ctx, host.id)).stale).toBe(false);

    // deleting an in-use principal is restricted
    await expect(ps.deletePrincipal(ctx, admin.id)).rejects.toThrow(/in use/i);
  });

  it('allocates unique monotonic per-CA serials across (re)issuance', async () => {
    const host = (await getSshHostService().list(ctx))[0];
    const a = await getSshHostService().issue(ctx, { hostId: host.id });
    const b = await getSshHostService().issue(ctx, { hostId: host.id });
    expect(a.cert.serial).not.toBe(b.cert.serial);
    expect(Number(b.cert.serial)).toBeGreaterThan(Number(a.cert.serial));
  });
});
