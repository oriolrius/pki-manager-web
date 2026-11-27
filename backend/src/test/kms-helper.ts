import { OpenBaoTransitClient, loadOpenBaoTransitConfig } from '../openbao/x509-transit.js';

/** Live suites use the fork supplied by the test runner. Unit tests also run offline. */
export async function isKmsAvailable(): Promise<boolean> {
  if (!process.env.OPENBAO_ADDR) {
    if (process.env.CI === 'true' || process.env.OPENBAO_TEST_REQUIRED === '1') {
      throw new Error('Live tests require the OpenBao test stack. Set OPENBAO_ADDR, OPENBAO_CACERT and OPENBAO_TOKEN_FILE.');
    }
    return false;
  }
  const client = new OpenBaoTransitClient(loadOpenBaoTransitConfig());
  const state = await client.health();
  if (!state.initialized || state.sealed || !(await client.tokenValid())) {
    throw new Error('The configured OpenBao test stack must be unsealed and accept the backend token.');
  }
  return true;
}
