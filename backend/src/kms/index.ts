/**
 * Key service (OpenBao Transit since decision-018). The module keeps its historical name so
 * the services and routes import it unchanged.
 */
export { KMSService, getKMSService, type KMSServiceOptions } from './service.js';
export * from './types.js';
