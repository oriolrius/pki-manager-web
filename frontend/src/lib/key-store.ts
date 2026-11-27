/**
 * User-facing names of the runtime key store. One place, so that pages do not hardcode a
 * product name. Since the OpenBao cutover (decision-018, doc-012) the backend keeps private
 * keys in the OpenBao Transit secrets engine.
 */
export const KEY_STORE_NAME = 'OpenBao Transit';

/** Text for a certificate record that has no private key in PKI Manager. */
export const NO_LOCAL_KEY_NOTE =
  'None in PKI Manager: this certificate was signed from a CSR, and the requester keeps the private key.';

/**
 * True when PKI Manager holds the private key of the record. A record signed from a CSR has no
 * key reference, and the backend refuses the download formats that contain a private key.
 */
export const hasLocalPrivateKey = (record: { kmsKeyId?: string | null }): boolean =>
  typeof record.kmsKeyId === 'string' && record.kmsKeyId.length > 0;
