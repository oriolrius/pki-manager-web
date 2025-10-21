/**
 * KMS (Key Management System) module
 * Provides integration with Cosmian KMS for cryptographic operations
 */

export { KMSClient, type KMSClientConfig } from "./client.js";
export { KMSService, getKMSService, type KMSServiceOptions } from "./service.js";
export * from "./types.js";
