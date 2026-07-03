/**
 * BLK-10 (TASK-187) — the Host-CA trust anchor serving endpoint. The composed
 * per-host KRL is signed with the Host-CA key; GET /ssh/host-ca-keys is the
 * file the Ansible role installs at HOST_CA_PATH and krl-client verifies
 * against by default. No KMS: CA rows are seeded directly.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { registerSshPublicRoutes } from './ssh-public.routes.js';
import { db } from '../../db/client.js';
import { sshCas, sshCertificates, sshKrls, sshRevocations, sshHosts, sshHostBlocks, sshHostKrls } from '../../db/schema.js';
import { HOST_CA_PATH, USER_CA_PATH } from '../../services/ssh-config.js';

async function wipe() {
  for (const t of [sshHostKrls, sshHostBlocks, sshKrls, sshRevocations, sshCertificates, sshHosts, sshCas]) {
    await db.delete(t);
  }
}

describe('BLK-10 Host-CA trust anchor endpoint', () => {
  let app: FastifyInstance;
  let work: string;
  let hostCaKey: string;
  let userCaKey: string;

  beforeAll(async () => {
    await wipe();
    work = mkdtempSync(join(tmpdir(), 'blk10-'));
    for (const n of ['caU', 'caH']) execFileSync('ssh-keygen', ['-t', 'ecdsa', '-b', '256', '-f', join(work, n), '-N', '', '-q']);
    hostCaKey = readFileSync(join(work, 'caH.pub'), 'utf8').trim();
    userCaKey = readFileSync(join(work, 'caU.pub'), 'utf8').trim();
    await db.insert(sshCas).values([
      { id: randomUUID(), caType: 'user', kmsKeyId: 'k-u', kmsPublicKeyId: 'kp-u', opensshPublicKey: userCaKey, fingerprintSha256: 'SHA256:u', status: 'active' },
      { id: randomUUID(), caType: 'host', kmsKeyId: 'k-h', kmsPublicKeyId: 'kp-h', opensshPublicKey: hostCaKey, fingerprintSha256: 'SHA256:h', status: 'active' },
    ] as any);
    app = Fastify();
    registerSshPublicRoutes(app);
    await app.ready();
  });

  afterAll(async () => {
    await app?.close();
    await wipe();
    if (work) rmSync(work, { recursive: true, force: true });
  });

  it('canonical paths: HOST_CA_PATH is distinct from USER_CA_PATH (the BLK-10 mismatch)', () => {
    expect(HOST_CA_PATH).toBe('/etc/ssh/ssh-host-ca.pub');
    expect(USER_CA_PATH).toBe('/etc/ssh/ssh-user-ca.pub');
  });

  it('GET /ssh/host-ca-keys serves the Host CA key(s) as ssh-host-ca.pub, not the User CA', async () => {
    const res = await app.inject({ method: 'GET', url: '/ssh/host-ca-keys' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-disposition']).toContain('ssh-host-ca.pub');
    expect(res.body.trim()).toBe(hostCaKey);
    expect(res.body).not.toContain(userCaKey);
  });

  it('the existing TrustedUserCAKeys endpoint is unchanged', async () => {
    const res = await app.inject({ method: 'GET', url: '/ssh/trusted-user-ca-keys' });
    expect(res.statusCode).toBe(200);
    expect(res.body.trim()).toBe(userCaKey);
  });
});
