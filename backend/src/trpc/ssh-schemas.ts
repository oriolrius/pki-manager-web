/**
 * SSH Certificate Manager Zod schemas (SSH-16) — the single source of truth for
 * tRPC input validation AND OpenAPI (via zod-to-json-schema). Mirrors trpc/schemas.ts.
 */
import { z } from 'zod';
import { validateCidrList, isValidPrincipalName, isValidHostId } from '../services/ssh-config.js';

export const sshCaTypeSchema = z.enum(['user', 'host']);

export const sshExtensionSchema = z.enum([
  'permit-X11-forwarding',
  'permit-agent-forwarding',
  'permit-port-forwarding',
  'permit-pty',
  'permit-user-rc',
]);

// key_id is logged verbatim by sshd — printable, control-char-free.
const keyIdSchema = z.string().min(1).max(255).regex(/^[\x20-\x7e]+$/, 'key_id must be printable ASCII without control characters');
const principalNameSchema = z.string().refine(isValidPrincipalName, 'invalid principal name (use letters/digits/._@-)');
// Max validity ~10 years (leap-slack) — accommodates the long-lived UI presets
// (+5y/+10y). Note: short TTLs remain the primary revocation mechanism.
const ttlSecondsSchema = z.number().int().positive().max(10 * 366 * 24 * 3600);
const serialSchema = z.string().regex(/^\d+$/, 'serial must be a non-negative integer string');

// A zone reference is an id OR a URL-safe slug; resolveZone() disambiguates and
// fails closed when omitted while several zones exist (decision-017 A1). Optional
// on every create/issuance path so single-zone installs stay untouched.
export const zoneRefSchema = z.string().min(1).max(63);
export const zoneSlugSchema = z
  .string()
  .min(1)
  .max(63)
  .regex(/^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/, 'zone name must be a URL-safe slug (a-z, 0-9, dashes)');

export const createZoneSchema = z.object({
  name: zoneSlugSchema,
  displayName: z.string().max(128).optional(),
  description: z.string().max(512).optional(),
});
export const updateZoneSchema = z.object({
  ref: zoneRefSchema,
  displayName: z.string().max(128).optional(),
  description: z.string().max(512).optional(),
});
export const zoneRefInputSchema = z.object({ ref: zoneRefSchema });
export const listZonesSchema = z.object({ includeArchived: z.boolean().optional() }).optional();

// Optional zone filter for every SSH list procedure.
export const zoneFilterSchema = z.object({ zoneId: z.string().min(1).optional() }).optional();

export const createSshCaSchema = z.object({
  caType: sshCaTypeSchema,
  label: z.string().max(128).optional(),
  zone: zoneRefSchema.optional(),
});

export const importSshCaSchema = z.object({
  caType: sshCaTypeSchema,
  label: z.string().max(128).optional(),
  kmsKeyId: z.string().min(1),
  kmsPublicKeyId: z.string().min(1),
  zone: zoneRefSchema.optional(),
});

export const sshCaIdSchema = z.object({ id: z.string().min(1) });

export const registerHostSchema = z.object({
  fqdn: z.string().refine(isValidHostId, 'invalid fqdn'),
  displayName: z.string().max(128).optional(),
  addresses: z.array(z.string().min(1)).default([]),
  opensshHostPubkey: z.string().min(1),
  zone: zoneRefSchema.optional(),
});

export const issueHostCertSchema = z.object({
  hostId: z.string().min(1),
  caId: z.string().min(1).optional(),
  validForSeconds: ttlSecondsSchema.optional(),
  keyId: keyIdSchema.optional(),
  serial: serialSchema.optional(),
});

export const hostIdSchema = z.object({ id: z.string().min(1) });

export const createIdentitySchema = z.object({
  subject: z.string().min(1).max(255),
  email: z.string().email().optional(),
  externalSubject: z.string().max(255).optional(),
  zone: zoneRefSchema.optional(),
});

export const issueUserCertSchema = z.object({
  identityId: z.string().min(1),
  caId: z.string().min(1).optional(),
  sshPublicKey: z.string().min(1),
  principals: z.array(principalNameSchema).min(1, 'at least one principal (role) is required'),
  extensions: z.array(sshExtensionSchema).optional(),
  forceCommand: z.string().max(1024).optional(),
  sourceAddress: z
    .string()
    .max(512)
    .optional()
    .refine((v) => v === undefined || validateCidrList(v).ok, 'source-address must be one or more valid CIDRs'),
  validForSeconds: ttlSecondsSchema.optional(),
  keyId: keyIdSchema.optional(),
  enforceEntitlement: z.boolean().optional(),
});

export const identityIdSchema = z.object({ id: z.string().min(1) });

export const createPrincipalSchema = z.object({
  name: principalNameSchema,
  description: z.string().max(256).optional(),
  zone: zoneRefSchema.optional(),
});

export const grantPrincipalSchema = z.object({
  identityId: z.string().min(1),
  principalId: z.string().min(1),
});

export const sshTokenOpSchema = z.enum(['sign-host', 'sign-user', 'register-host-pubkey', 'get-principals']);

export const mintTokenSchema = z.object({
  name: z.string().min(1).max(128),
  userCaId: z.string().optional(),
  hostCaId: z.string().optional(),
  opSet: z.array(sshTokenOpSchema).min(1),
  zone: zoneRefSchema.optional(),
});

export const mapPrincipalSchema = z.object({
  hostId: z.string().min(1),
  principalId: z.string().min(1),
  localAccount: principalNameSchema,
});

export const revokeSshCertSchema = z.object({
  certId: z.string().min(1),
  reason: z.string().max(256).optional(),
});

export const renderPrincipalsSchema = z.object({ hostId: z.string().min(1) });

// BLK-08 (decision-016): per-host user access blocks.
export const blockHostSchema = z.object({
  hostId: z.string().min(1),
  identityId: z.string().min(1),
  reason: z.string().max(512).optional(),
});

export const unblockHostSchema = z.object({
  hostId: z.string().min(1),
  identityId: z.string().min(1),
});
