import { createPublicKey, generateKeyPairSync } from 'node:crypto';
import assert from 'node:assert/strict';
import { rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { exportCertificateBundle, loadCertificateBundle } from '../lib/certificates.ts';
import { buildManifest } from '../lib/inventory.ts';
import { approvalTemplate } from '../lib/policy.ts';
import { backupTo, openReadOnly } from '../lib/sqlite.ts';
import { DEFAULT_PROFILE } from '../lib/target-db.ts';
import { apply, liveTarget } from '../lib/transfer.ts';
import { documentDigest, sha256Hex } from '../lib/util.ts';
import { FakeCosmian, FakeTransit, migrateToV4, sshLine, tempDir, v3Database } from './helpers.ts';

test('offline migration reads the bundle produced by an inventory with no KMS certificates', async t => {
  const dir = tempDir();
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const sourcePath = join(dir, 'source.db');
  const db = v3Database(sourcePath);
  const kms = new FakeCosmian();
  try {
    const manifest = await buildManifest({ sourcePath, db, kms });
    const { pem, count } = await exportCertificateBundle(manifest, kms);
    assert.equal(count, 0);
    const file = join(dir, 'certificates.pem');
    writeFileSync(file, pem);
    assert.equal(loadCertificateBundle(file).size, 0);
  } finally {
    db.close();
  }
});

test('an SSH-only v3 installation applies wrapped material with an empty certificate bundle', async t => {
  const dir = tempDir();
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const sourcePath = join(dir, 'source.db');
  const db = v3Database(sourcePath);
  const kms = new FakeCosmian();
  const key = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const { privateKeyId, publicKeyId } = kms.addKeyPair({ key, sensitive: true });
  const { line, fp } = sshLine(key.publicKey);
  try {
    db.prepare(`INSERT INTO ssh_cas (id, zone_id, ca_type, kms_key_id, kms_public_key_id,
      openssh_public_key, fingerprint_sha256, status) VALUES ('ssh-only','default','user',?,?,?,?, 'active')`)
      .run(privateKeyId, publicKeyId, line, fp);
  } finally {
    db.close();
  }

  const targetPath = join(dir, 'target.db');
  await backupTo(sourcePath, targetPath);
  migrateToV4(targetPath);
  const source = openReadOnly(sourcePath);
  const manifest = await buildManifest({ sourcePath, db: source, kms }).finally(() => source.close());
  const store = new FakeTransit();
  const addr = 'https://openbao.test:8200';
  const approval = approvalTemplate(manifest, await liveTarget(store, addr, manifest));
  approval.approvedBy = 'ssh-test';
  approval.approvedAt = new Date().toISOString();
  approval.keys[privateKeyId].acknowledgeSensitive = true;
  const wrappingKey = createPublicKey(await store.wrappingKeyPem()).export({ format: 'der', type: 'spki' });
  const wrappingId = await kms.registerWrappingKey(wrappingKey);
  const wrapped = await kms.wrappedGet(privateKeyId, wrappingId);
  await kms.removeWrappingKey(wrappingId);
  writeFileSync(join(dir, 'ssh.wrapped'), wrapped);
  approval.material = { [privateKeyId]: { file: 'ssh.wrapped', sha256: sha256Hex(wrapped) } };
  const certificatesFile = join(dir, 'certificates.pem');
  const { pem, count } = await exportCertificateBundle(manifest, kms);
  assert.equal(count, 0);
  writeFileSync(certificatesFile, pem);
  const result = await apply({
    sourceDbPath: sourcePath, targetDbPath: targetPath, manifest, approval, materialDir: dir,
    certificatesFile, store, addr, profile: DEFAULT_PROFILE, runDir: join(dir, 'run'),
    confirm: documentDigest(manifest).slice(0, 16), actor: 'ssh-test',
  });
  assert.equal(result.imported, 1);
  const dbAfter = openReadOnly(targetPath);
  try {
    const row = dbAfter.prepare("SELECT kms_key_id, fingerprint_sha256 FROM ssh_cas WHERE id = 'ssh-only'").get()!;
    assert.match(String(row.kms_key_id), /^openbao-transit:pki-manager-ssh:.+:1$/);
    assert.equal(row.fingerprint_sha256, fp);
  } finally {
    dbAfter.close();
  }
});
