/**
 * SSH tRPC router integration (SSH-17 + SSH-34). Drives the typed router via a
 * caller against the live KMS, and asserts the fail-closed guard refuses CA
 * management when OIDC is disabled without the explicit opt-in.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { appRouter } from '../router.js';
import { db } from '../../db/client.js';
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
} from '../../db/schema.js';
import { getKMSService } from '../../kms/service.js';

const KMS = process.env.KMS_AVAILABLE === 'true';

// A context shaped like the real tRPC context (no OIDC user -> unauthenticated).
const makeCtx = () => ({ req: { ip: '127.0.0.1' }, res: {}, db, user: undefined });
const caller = () => appRouter.createCaller(makeCtx() as any);

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

describe('SSH-34 fail-closed authorization (OIDC disabled)', () => {
  beforeEach(() => {
    delete process.env.ALLOW_UNAUTHENTICATED_SSH_CA;
  });
  afterEach(() => {
    delete process.env.ALLOW_UNAUTHENTICATED_SSH_CA;
  });

  it('refuses CA creation when OIDC is disabled and no opt-in is set', async () => {
    await expect(caller().ssh.ca.create({ caType: 'user' })).rejects.toThrow(/require OIDC|FORBIDDEN/i);
  });

  it('also refuses issuance reads without the opt-in', async () => {
    await expect(caller().ssh.ca.list()).rejects.toThrow(/require OIDC|FORBIDDEN/i);
  });
});

describe.skipIf(!KMS)('SSH tRPC router (with dev opt-in)', () => {
  let work: string;
  beforeAll(async () => {
    process.env.ALLOW_UNAUTHENTICATED_SSH_CA = 'true';
    work = mkdtempSync(join(tmpdir(), 'ssh-trpc-'));
    await wipe();
  }, 60_000);
  afterAll(async () => {
    await wipe();
    delete process.env.ALLOW_UNAUTHENTICATED_SSH_CA;
    if (work) rmSync(work, { recursive: true, force: true });
  });

  it('drives the full CA -> host -> user -> principal flow over tRPC', async () => {
    const c = caller();
    const userCa = await c.ssh.ca.create({ caType: 'user', label: 'tRPC User CA' });
    const hostCa = await c.ssh.ca.create({ caType: 'host', label: 'tRPC Host CA' });
    expect(userCa.caType).toBe('user');
    expect(hostCa.caType).toBe('host');

    const anchors = await c.ssh.ca.trustAnchors();
    expect(anchors.userCaKeys).toHaveLength(1);
    expect(anchors.hostCaKeys).toHaveLength(1);

    // Host register + issue
    execFileSync('ssh-keygen', ['-t', 'ecdsa', '-b', '256', '-f', join(work, 'h'), '-N', '', '-q']);
    const host = await c.ssh.host.register({ fqdn: 'node1.lab.local', addresses: ['10.1.2.3'], opensshHostPubkey: readFileSync(join(work, 'h.pub'), 'utf8') });
    const issued = await c.ssh.host.issue({ hostId: host.id });
    writeFileSync(join(work, 'h-cert.pub'), issued.cert.certOpenssh);
    const hOut = execFileSync('ssh-keygen', ['-L', '-f', join(work, 'h-cert.pub')], { encoding: 'utf8' });
    expect(hOut).toContain('host certificate');
    expect(hOut).toContain('node1.lab.local');
    expect(issued.sshdConfig).toContain('TrustedUserCAKeys');

    // User issue
    execFileSync('ssh-keygen', ['-t', 'ed25519', '-f', join(work, 'u'), '-N', '', '-q']);
    const ident = await c.ssh.user.createIdentity({ subject: 'Jane (tRPC)' });
    const ucert = await c.ssh.user.issue({ identityId: ident.id, sshPublicKey: readFileSync(join(work, 'u.pub'), 'utf8'), principals: ['admin'] });
    writeFileSync(join(work, 'u-cert.pub'), ucert.cert.certOpenssh);
    const uOut = execFileSync('ssh-keygen', ['-L', '-f', join(work, 'u-cert.pub')], { encoding: 'utf8' });
    expect(uOut).toContain('user certificate');
    expect(uOut).toContain('admin');

    // Principal RBAC
    const admin = await c.ssh.principal.create({ name: 'admin' });
    await c.ssh.principal.map({ hostId: host.id, principalId: admin.id, localAccount: 'root' });
    const render = await c.ssh.principal.render({ hostId: host.id });
    expect(render.files['root']).toContain('admin');

    // input validation surfaces as a tRPC error (bad CIDR)
    await expect(
      c.ssh.user.issue({ identityId: ident.id, sshPublicKey: readFileSync(join(work, 'u.pub'), 'utf8'), principals: ['admin'], sourceAddress: 'not-a-cidr' })
    ).rejects.toThrow();
  });
});
