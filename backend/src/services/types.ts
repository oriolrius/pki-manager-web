import type { db } from '../db/client.js';
// Shared types for the service layer

/**
 * Service context passed to all service methods
 * Contains database connection and optional request metadata
 */
export interface ServiceContext {
  db: typeof db;
  ipAddress?: string | null;
}
