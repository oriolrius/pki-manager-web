/**
 * Startup checks for the OpenBao SSH CA and SCEP RA key stores (decision-018).
 *
 * - Invalid settings stop the backend when OpenBao is in use (a binding or a CA
 *   references it, or `OPENBAO_ADDR` is set). The SCEP RA credential
 *   (`OPENBAO_RA_TOKEN_FILE`) is optional: when it is absent, X.509 and SSH work
 *   and RA operations answer 503.
 * - Legacy Cosmian SSH CAs and RA bindings do not stop the backend: their key
 *   operations are refused (`409 …_MIGRATION_REQUIRED`) until the migration
 *   moves their keys. The count is logged so the operator sees it at once.
 */
import { eq, like, ne, notLike } from 'drizzle-orm';
import type { db as database } from '../db/client.js';
import { integrationRAs, sshCas } from '../db/schema.js';
import { checkOpenBaoRAConfig } from './ra-transit.js';
import { SSH_KEY_REF_PREFIX, checkOpenBaoSshConfig } from './ssh-transit.js';

/** A database from before a migration has no such table/column: it has no OpenBao use. */
async function count<T>(query: () => Promise<T[]>, keep: (row: T) => boolean = () => true): Promise<number> {
  try { return (await query()).filter(keep).length; } catch (error) {
    if (/no such (table|column)/.test(String(error))) return 0;
    throw error;
  }
}

export async function checkOpenBaoKeyStores(db: typeof database, log: (line: string) => void = console.log): Promise<void> {
  const raOpenBao = await count(() => db.select({ id: integrationRAs.integrationId }).from(integrationRAs).where(eq(integrationRAs.keyProvider, 'openbao')));
  // A row the backend inserted but never gave a key has the column default; it is not legacy.
  const raLegacy = await count(
    () => db.select({ keyId: integrationRAs.keyId, publicKeyId: integrationRAs.publicKeyId, pem: integrationRAs.certificatePem })
      .from(integrationRAs).where(ne(integrationRAs.keyProvider, 'openbao')),
    r => Boolean(r.keyId || r.publicKeyId || r.pem),
  );
  const sshOpenBao = await count(() => db.select({ id: sshCas.id }).from(sshCas).where(like(sshCas.kmsKeyId, `${SSH_KEY_REF_PREFIX}%`)));
  const sshLegacy = await count(() => db.select({ id: sshCas.id }).from(sshCas).where(notLike(sshCas.kmsKeyId, `${SSH_KEY_REF_PREFIX}%`)));
  const { raCredential } = checkOpenBaoRAConfig();
  checkOpenBaoSshConfig(sshOpenBao);
  if (raOpenBao || sshOpenBao) log(`OpenBao keys: ${sshOpenBao} SSH CA(s), ${raOpenBao} SCEP RA binding(s)`);
  if (raOpenBao && !raCredential) {
    log(`WARNING: ${raOpenBao} SCEP RA binding(s) use OpenBao, but OPENBAO_RA_TOKEN_FILE (the pki-manager-ra credential) is not set; RA operations answer 503 until it is`);
  }
  if (raLegacy || sshLegacy) {
    log(`WARNING: ${sshLegacy} SSH CA(s) and ${raLegacy} SCEP RA binding(s) still reference Cosmian KMS keys; their key operations are refused until the OpenBao key migration moves them`);
  }
}
