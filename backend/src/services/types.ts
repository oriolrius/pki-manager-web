// Shared types for the service layer

/**
 * Service context passed to all service methods
 * Contains database connection and optional request metadata
 */
export interface ServiceContext {
  db: any;
  ipAddress?: string | null;
}
