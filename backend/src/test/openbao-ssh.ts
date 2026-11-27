/**
 * Live-test gate for the SSH CA key store (decision-018): the OpenBao fork with
 * the SSH Transit mount. Set OPENBAO_ADDR, OPENBAO_CACERT, OPENBAO_TOKEN_FILE
 * (and OPENBAO_SSH_MOUNT when it is not `pki-manager-ssh`); see
 * docs/development/testing.md. Without them the live SSH suites skip.
 */
import { getOpenBaoSshTransit } from '../openbao/ssh-transit.js';

let available: Promise<boolean> | undefined;

/** True when the SSH mount answers with the configured token (a missing probe key reads as 404). */
export function isOpenBaoSshAvailable(): Promise<boolean> {
  available ??= (async () => {
    if (!process.env.OPENBAO_ADDR || !process.env.OPENBAO_TOKEN_FILE) return false;
    try {
      const transit = getOpenBaoSshTransit();
      await transit.readKey({ mount: transit.mount, name: 'ssh-ca-availability-probe', version: 1 });
      return true;
    } catch {
      return false;
    }
  })();
  return available;
}
