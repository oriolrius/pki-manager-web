/** Result shapes of the key service (`service.ts`). */

/** Ids of the two key store rows of a key pair. */
export interface KeyPairIds {
  privateKeyId: string;
  publicKeyId: string;
}

/** An issued certificate. */
export interface CertificateInfo {
  certificateId: string;
  /** DER, hex. */
  certificateData: string;
  /** Present when the key pair is in the key store. */
  privateKeyId?: string;
  publicKeyId?: string;
}
