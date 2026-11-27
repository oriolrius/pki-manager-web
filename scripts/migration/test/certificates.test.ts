import assert from 'node:assert/strict';
import { rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { exportCertificateBundle, loadCertificateBundle } from '../lib/certificates.ts';
import { buildManifest } from '../lib/inventory.ts';
import { FakeCosmian, tempDir, v3Database } from './helpers.ts';

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
