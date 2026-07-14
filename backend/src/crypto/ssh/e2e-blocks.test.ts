/**
 * BLK-11 (TASK-188) — decision-016 end-to-end: the composed per-host KRL
 * against a REAL sshd (block matrix, composition coverage, reissue-regen,
 * unblock symmetry) AND the REAL krl-client validation logic (lineage-switch
 * anti-rollback, unsigned rejection) fed by the live serving endpoint.
 * Extends the SSH-33 harness; gated on KMS_AVAILABLE + sshd (+ go for the
 * client part) with clean skips.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { execFileSync, spawnSync, spawn } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, writeFileSync, readFileSync, copyFileSync, rmSync } from 'node:fs';
import { tmpdir, userInfo } from 'node:os';
import { join, resolve } from 'node:path';
import { eq } from 'drizzle-orm';
import { db } from '../../db/client.js';
import { sshCas, sshHosts, sshIdentities, sshCertificates, sshKrls, sshHostKrls, sshHostBlocks, sshRevocations, sshHostPrincipalMaps, sshUserPrincipals, sshPrincipals, sshFleetTokens, sshIdempotency } from '../../db/schema.js';
import { getKMSService } from '../../kms/service.js';
import { getSshCaService } from '../../services/ssh-ca.service.js';
import { getSshHostService } from '../../services/ssh-host.service.js';
import { getSshUserService } from '../../services/ssh-user.service.js';
import { getSshKrlService } from '../../services/ssh-krl.service.js';
import { getSshHostKrlService } from '../../services/ssh-host-krl.service.js';
import { getSshBlockService } from '../../services/ssh-block.service.js';
import { registerSshExternalRoutes } from '../../rest/routes/ssh-external.routes.js';
import { decodeKrl } from '../../test/krl-decode.js';
import { parseSshPublicKey } from './pubkey.js';
import { buildKrl } from './krl.js';

const SSHD = ['/usr/sbin/sshd', '/usr/bin/sshd', '/sbin/sshd'].find((p) => existsSync(p));
const KMS = process.env.KMS_AVAILABLE === 'true';
const GO = spawnSync('go', ['version'], { encoding: 'utf8' }).status === 0;
const RUN = KMS && !!SSHD;
const ctx = { db, ipAddress: null };
const USER = userInfo().username;
const PORT_Y = 2340 + Math.floor((Date.now() / 1000) % 40);
const PORT_Z = PORT_Y + 41;

async function wipe() {
  const cas = await db.select().from(sshCas);
  const kms = getKMSService();
  for (const c of cas as any[]) { try { await kms.destroyKeyPair(c.kmsKeyId, c.kmsPublicKeyId); } catch { /* */ } }
  for (const t of [sshHostKrls, sshHostBlocks, sshIdempotency, sshFleetTokens, sshKrls, sshRevocations, sshHostPrincipalMaps, sshUserPrincipals, sshCertificates, sshHosts, sshIdentities, sshPrincipals, sshCas]) {
    await db.delete(t);
  }
}

describe.skipIf(!RUN)('BLK-11 composed-KRL block matrix vs real sshd', () => {
  let work: string;
  let userCa: any;
  let hostCa: any;
  let hostY: any;
  let hostZ: any;
  let alice: any;
  let aliceKey: string;
  const pids: string[] = [];

  async function issueFor(identityId: string, keyPath: string): Promise<any> {
    const res = await getSshUserService().issue(ctx, {
      identityId,
      caId: userCa.id,
      sshPublicKey: readFileSync(`${keyPath}.pub`, 'utf8'),
      principals: ['admin'],
    });
    writeFileSync(`${keyPath}-cert.pub`, res.cert.certOpenssh);
    return res;
  }

  function ssh(port: number, keyPath: string, cmd: string): { code: number | null; out: string; err: string } {
    const r = spawnSync(
      'ssh',
      ['-p', String(port), '-F', '/dev/null',
        '-o', `UserKnownHostsFile=${join(work, 'known_hosts')}`, '-o', 'GlobalKnownHostsFile=/dev/null',
        '-o', 'StrictHostKeyChecking=yes', '-o', 'PasswordAuthentication=no', '-o', 'BatchMode=yes',
        '-o', 'IdentitiesOnly=yes', '-o', 'ConnectTimeout=5', '-i', keyPath,
        `${USER}@127.0.0.1`, cmd],
      { encoding: 'utf8', timeout: 20000 }
    );
    return { code: r.status, out: r.stdout ?? '', err: r.stderr ?? '' };
  }

  /** Install a host's freshest composed KRL as its sshd RevokedKeys. */
  async function installComposed(host: any, dir: string): Promise<any> {
    const row = await getSshHostKrlService().getLatestRow(ctx, host.id);
    writeFileSync(join(dir, 'revoked_keys'), Buffer.from(row.krlBlob));
    return row;
  }

  async function startSshd(name: string, port: number, opts: { authorizedKeys?: string } = {}): Promise<{ dir: string; host: any }> {
    const dir = join(work, name);
    mkdirSync(dir, { recursive: true });
    execFileSync('ssh-keygen', ['-t', 'ecdsa', '-b', '256', '-f', join(dir, 'hostkey'), '-N', '', '-q']);
    const host = await getSshHostService().register(ctx, { fqdn: `${name}.e2e`, addresses: ['127.0.0.1'], opensshHostPubkey: readFileSync(join(dir, 'hostkey.pub'), 'utf8') });
    const issued = await getSshHostService().issue(ctx, { hostId: host.id });
    writeFileSync(join(dir, 'hostkey-cert.pub'), issued.cert.certOpenssh);
    writeFileSync(join(dir, 'user-ca.pub'), userCa.opensshPublicKey + '\n');
    writeFileSync(join(dir, 'revoked_keys'), buildKrl({ krlVersionNumber: 0n }));
    const ap = join(dir, 'auth_principals');
    mkdirSync(ap, { recursive: true });
    writeFileSync(join(ap, USER), 'admin\n');
    if (opts.authorizedKeys) writeFileSync(join(dir, `ak_${USER}`), opts.authorizedKeys);
    writeFileSync(join(dir, 'sshd_config'), [
      `Port ${port}`,
      'ListenAddress 127.0.0.1',
      `HostKey ${join(dir, 'hostkey')}`,
      `HostCertificate ${join(dir, 'hostkey-cert.pub')}`,
      `TrustedUserCAKeys ${join(dir, 'user-ca.pub')}`,
      `AuthorizedPrincipalsFile ${join(ap, '%u')}`,
      `RevokedKeys ${join(dir, 'revoked_keys')}`,
      `AuthorizedKeysFile ${opts.authorizedKeys ? join(dir, 'ak_%u') : '/dev/null'}`,
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
    return { dir, host };
  }

  beforeAll(async () => {
    work = mkdtempSync(join(tmpdir(), 'blk11-'));
    await wipe();
    userCa = await getSshCaService().create(ctx, { caType: 'user' });
    hostCa = await getSshCaService().create(ctx, { caType: 'host' });

    // alice's key BEFORE the sshds so Y can hold it in authorized_keys (the
    // raw-key denial half of the fingerprint entry).
    aliceKey = join(work, 'alice');
    execFileSync('ssh-keygen', ['-t', 'ed25519', '-f', aliceKey, '-N', '', '-q']);
    alice = await getSshUserService().createIdentity(ctx, { subject: 'alice@e2e' });
    await issueFor(alice.id, aliceKey);

    const y = await startSshd('y', PORT_Y, { authorizedKeys: readFileSync(`${aliceKey}.pub`, 'utf8') });
    const z = await startSshd('z', PORT_Z);
    hostY = { ...y.host, dir: y.dir };
    hostZ = { ...z.host, dir: z.dir };

    writeFileSync(
      join(work, 'known_hosts'),
      `@cert-authority [127.0.0.1]:${PORT_Y},[127.0.0.1]:${PORT_Z} ${hostCa.opensshPublicKey.trim()}\n`
    );
  }, 180_000);

  afterAll(async () => {
    for (const pid of pids) { try { process.kill(Number(pid)); } catch { /* */ } }
    await wipe();
    if (work) rmSync(work, { recursive: true, force: true });
  });

  it('scenarios 1+2: blocked-on-Y denies cert AND raw key; Z accepts the same cert at the same instant', async () => {
    expect(ssh(PORT_Y, aliceKey, 'echo pre').code).toBe(0); // sanity: works before the block

    const res = await getSshBlockService().block(ctx, { hostId: hostY.id, identityId: alice.id, reason: 'e2e' });
    expect(res.krl?.blockCount).toBe(1);
    await installComposed(hostY, hostY.dir);
    await getSshHostKrlService().generate(ctx, hostZ.id);
    await installComposed(hostZ, hostZ.dir);

    // Y: the CERT is denied (serial entry) ...
    expect(ssh(PORT_Y, aliceKey, 'echo blocked').code).not.toBe(0);
    // ... and the RAW key too (fingerprint entry kills the authorized_keys path).
    const rawKey = join(work, 'alice-raw');
    copyFileSync(aliceKey, rawKey);
    copyFileSync(`${aliceKey}.pub`, `${rawKey}.pub`);
    execFileSync('chmod', ['600', rawKey]);
    expect(ssh(PORT_Y, rawKey, 'echo raw').code).not.toBe(0);
    expect(readFileSync(join(hostY.dir, 'sshd.log'), 'utf8')).toMatch(/revoked by file/i);

    // Z, same instant: untouched.
    expect(ssh(PORT_Z, aliceKey, 'echo allowed-on-z').code).toBe(0);
  });

  it('scenario 3: composition keeps the host-CA set (req #2) and denies a revoked-but-UNBLOCKED user cert (bonus fix)', async () => {
    // Revoked host cert: a dummy host's cert, revoked, must survive composition.
    const wDir = join(work, 'w');
    mkdirSync(wDir, { recursive: true });
    execFileSync('ssh-keygen', ['-t', 'ecdsa', '-b', '256', '-f', join(wDir, 'hostkey'), '-N', '', '-q']);
    const w = await getSshHostService().register(ctx, { fqdn: 'w.e2e', addresses: [], opensshHostPubkey: readFileSync(join(wDir, 'hostkey.pub'), 'utf8') });
    const wIssued = await getSshHostService().issue(ctx, { hostId: w.id });
    writeFileSync(join(wDir, 'hostkey-cert.pub'), wIssued.cert.certOpenssh);
    await getSshKrlService().revokeByCert(ctx, wIssued.cert.id, 'w decommissioned');

    // Revoked (NOT blocked) user: victor.
    const victorKey = join(work, 'victor');
    execFileSync('ssh-keygen', ['-t', 'ed25519', '-f', victorKey, '-N', '', '-q']);
    const victor = await getSshUserService().createIdentity(ctx, { subject: 'victor@e2e' });
    const vIssued = await issueFor(victor.id, victorKey);
    expect(ssh(PORT_Z, victorKey, 'echo pre').code).toBe(0);
    await getSshKrlService().revokeByCert(ctx, vIssued.cert.id, 'compromised');

    await getSshHostKrlService().generate(ctx, hostZ.id);
    const row = await installComposed(hostZ, hostZ.dir);

    // Decode the SERVED blob: both union members present, grouped per CA.
    const decoded = decodeKrl(Buffer.from(row.krlBlob));
    const hostCaHex = parseSshPublicKey(hostCa.opensshPublicKey).blob.toString('hex');
    const userCaHex = parseSshPublicKey(userCa.opensshPublicKey).blob.toString('hex');
    expect(decoded.serialsByCaHex.get(hostCaHex)).toContain(BigInt(wIssued.cert.serial));
    expect(decoded.serialsByCaHex.get(userCaHex)).toContain(BigInt(vIssued.cert.serial));

    // ssh-keygen -Q cross-check + the real thing: victor is denied on Z via the
    // per-host KRL (pre-BLK-06 the ECIES path never carried user revocations).
    const q = spawnSync('ssh-keygen', ['-Q', '-f', join(hostZ.dir, 'revoked_keys'), join(wDir, 'hostkey-cert.pub')], { encoding: 'utf8' });
    expect(q.status !== 0 && /REVOKED/i.test(q.stdout + q.stderr)).toBe(true);
    expect(ssh(PORT_Z, victorKey, 'echo post').code).not.toBe(0);
  });

  it('scenario 5: a cert reissued to the blocked identity is denied on Y after the async regen', async () => {
    const freshKey = join(work, 'alice-fresh');
    execFileSync('ssh-keygen', ['-t', 'ed25519', '-f', freshKey, '-N', '', '-q']);
    const before = await getSshHostKrlService().getLatestRow(ctx, hostY.id);
    await issueFor(alice.id, freshKey); // triggers the BLK-05 issuance hook (async fire-and-forget)
    await vi.waitFor(async () => {
      const row = await getSshHostKrlService().getLatestRow(ctx, hostY.id);
      expect(row.krlNumber).toBeGreaterThan(before.krlNumber);
    }, { timeout: 15_000, interval: 200 });
    await installComposed(hostY, hostY.dir);
    expect(ssh(PORT_Y, freshKey, 'echo reissued').code).not.toBe(0);
    // Still fine on Z.
    expect(ssh(PORT_Z, freshKey, 'echo z-ok').code).toBe(0);
  });

  it('scenario 6: unblock is symmetric — lift, regen, alice is accepted on Y again', async () => {
    const res = await getSshBlockService().unblock(ctx, { hostId: hostY.id, identityId: alice.id });
    expect(res.krl?.blockCount).toBe(0);
    await installComposed(hostY, hostY.dir);
    expect(ssh(PORT_Y, aliceKey, 'echo restored').code).toBe(0);
  });
});

describe.skipIf(!(KMS && GO))('BLK-11 lineage-switch anti-rollback vs the REAL krl-client', () => {
  let work: string;
  let app: FastifyInstance;
  let baseUrl: string;
  let hostCa: any;
  let binPath: string;
  let keyPath: string;
  let caPubPath: string;
  let krlPath: string;
  let stateDir: string;
  const FQDN = 'x.e2e';

  // spawn (NOT spawnSync): the serving Fastify runs in THIS process, so a
  // synchronous wait would block the event loop and deadlock the client.
  function runClient(extra: string[] = []): Promise<{ code: number | null; out: string }> {
    return new Promise((resolvep) => {
      const child = spawn(
        binPath,
        ['--server-url', baseUrl, '--host-id', FQDN, '--host-key', keyPath, '--ca-pubkey', caPubPath,
          '--krl-file', krlPath, '--state-dir', stateDir, '--log-format', 'text', ...extra],
        { timeout: 30000 }
      );
      let out = '';
      child.stdout.on('data', (d) => (out += d));
      child.stderr.on('data', (d) => (out += d));
      child.on('close', (code) => resolvep({ code, out }));
    });
  }

  beforeAll(async () => {
    work = mkdtempSync(join(tmpdir(), 'blk11-client-'));
    await wipe();
    process.env.SSH_ECIES_ENABLED = 'true';
    delete process.env.SSH_HOST_KRL_SERVE;

    // Real binary — the point of this suite is the CLIENT's acceptance logic.
    binPath = join(work, 'krl-client');
    execFileSync('go', ['build', '-o', binPath, '.'], { cwd: resolve(process.cwd(), '../krl-client'), stdio: 'pipe' });

    await getSshCaService().create(ctx, { caType: 'user' });
    hostCa = await getSshCaService().create(ctx, { caType: 'host' });
    caPubPath = join(work, 'ssh-host-ca.pub'); // what BLK-10 ships to /etc/ssh/ssh-host-ca.pub
    writeFileSync(caPubPath, hostCa.opensshPublicKey.trim() + '\n');

    // The host's own P-256 key IS the ECIES key (decision-015 local decrypt).
    keyPath = join(work, 'ssh_host_ecdsa_key');
    execFileSync('ssh-keygen', ['-t', 'ecdsa', '-b', '256', '-f', keyPath, '-N', '', '-q']);
    await getSshHostService().register(ctx, { fqdn: FQDN, addresses: ['127.0.0.1'], opensshHostPubkey: readFileSync(`${keyPath}.pub`, 'utf8') });

    krlPath = join(work, 'revoked_keys');
    stateDir = join(work, 'state');

    app = Fastify();
    registerSshExternalRoutes(app);
    await app.listen({ port: 0, host: '127.0.0.1' });
    const addr = app.server.address() as { port: number };
    baseUrl = `http://127.0.0.1:${addr.port}`;
  }, 240_000);

  afterAll(async () => {
    await app?.close();
    await wipe();
    delete process.env.SSH_ECIES_ENABLED;
    delete process.env.SSH_HOST_KRL_SERVE;
    if (work) rmSync(work, { recursive: true, force: true });
  });

  it('scenario 4: per-CA install at N → first per-host (> N) accepted → stale lower number rejected → regenerated per-CA accepted → unsigned rejected without --allow-unsigned', async () => {
    // (a) Pre-cutover: the host installs a per-CA KRL at number N.
    process.env.SSH_HOST_KRL_SERVE = 'false';
    const perCa = await getSshKrlService().generate(ctx, hostCa.id);
    let r = await runClient();
    expect(r.code, r.out).toBe(0);
    const installedA = readFileSync(krlPath);
    expect(decodeKrl(installedA).headerNumber).toBe(BigInt(perCa.krlNumber));

    // (b) Cutover: a block creates the first per-host row — globally seeded, so
    // its signed header number exceeds N and the client accepts it.
    delete process.env.SSH_HOST_KRL_SERVE;
    const ident = await getSshUserService().createIdentity(ctx, { subject: 'blocked@x' });
    const host = (await db.select().from(sshHosts).where(eq(sshHosts.fqdn, FQDN)))[0] as any;
    const blocked = await getSshBlockService().block(ctx, { hostId: host.id, identityId: ident.id, reason: 'lineage-switch' });
    expect(blocked.krl!.krlNumber).toBeGreaterThan(perCa.krlNumber);
    r = await runClient();
    expect(r.code, r.out).toBe(0);
    const installedB = readFileSync(krlPath);
    expect(decodeKrl(installedB).headerNumber).toBe(BigInt(blocked.krl!.krlNumber));

    // (c) Naive switch-back: serving the OLD per-CA row (lower signed header
    // number) — the REAL client rejects it as rollback and keeps last-good.
    process.env.SSH_HOST_KRL_SERVE = 'false';
    r = await runClient();
    expect(r.code, r.out).toBe(8); // exitcodes.Version — anti-rollback
    expect(readFileSync(krlPath).equals(installedB)).toBe(true); // last-good kept

    // (d) Correct switch-back: regenerate the per-CA lineage — the global
    // allocator gives it a higher number and the client accepts.
    const perCa2 = await getSshKrlService().generate(ctx, hostCa.id);
    expect(perCa2.krlNumber).toBeGreaterThan(blocked.krl!.krlNumber);
    r = await runClient();
    expect(r.code, r.out).toBe(0);
    expect(decodeKrl(readFileSync(krlPath)).headerNumber).toBe(BigInt(perCa2.krlNumber));

    // (e) Unsigned per-host row (KMS signing failed): rejected without
    // --allow-unsigned (fail-stale), installed with it.
    delete process.env.SSH_HOST_KRL_SERVE;
    await getSshBlockService().unblock(ctx, { hostId: host.id, identityId: ident.id }); // forces a NEW per-host row
    const latest = await getSshHostKrlService().getLatestRow(ctx, host.id);
    expect(latest.krlNumber).toBeGreaterThan(perCa2.krlNumber);
    await db.update(sshHostKrls).set({ caSignature: null }).where(eq(sshHostKrls.id, latest.id));
    r = await runClient();
    expect(r.code, r.out).toBe(4); // exitcodes.Verify — unsigned rejected
    expect(decodeKrl(readFileSync(krlPath)).headerNumber).toBe(BigInt(perCa2.krlNumber)); // last-good kept
    r = await runClient(['--allow-unsigned']);
    expect(r.code, r.out).toBe(0);
    expect(decodeKrl(readFileSync(krlPath)).headerNumber).toBe(BigInt(latest.krlNumber));
  }, 120_000);
});
