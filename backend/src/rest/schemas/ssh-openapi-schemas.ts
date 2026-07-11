/**
 * OpenAPI request/response JSON schemas for the SSH & external REST routes (TASK-207).
 *
 * The SSH / external Fastify routes previously registered only `tags`+`summary`, so the
 * generated OpenAPI (@fastify/swagger) documented no requestBody and empty responses, and
 * openapi-python-client could only emit body-less stubs. These helpers attach request-body
 * and response JSON schemas — derived from the SAME Zod schemas tRPC uses (single source of
 * truth) — so REST/OpenAPI and tRPC stay aligned.
 *
 * Two hard constraints drive the shapes below:
 *  1. Fastify validates `schema.body` (ajv) BEFORE the handler. The SSH handlers already
 *     validate manually with Zod (`.strip()` semantics: extra keys allowed). So every body
 *     schema forces `additionalProperties: true` and keeps `required` exactly to the
 *     Zod-required fields, otherwise Fastify would 400 a body the handler would accept.
 *  2. Fastify `schema.response` STRIPS undeclared response properties (fast-json-stringify).
 *     The SSH/external responses are varied and complex, so responses are documented
 *     permissively — "an object" / "an array of objects" — never hand-enumerated.
 */
import { zodToJsonSchema } from 'zod-to-json-schema';
import type { ZodTypeAny } from 'zod';

/**
 * Permissive object response: documents "a JSON object" without fast-json-stringify
 * stripping any of the handler's real properties (`additionalProperties: true`).
 */
export const okObjectResponse = { type: 'object', additionalProperties: true } as const;

/** Permissive array-of-objects response for list endpoints. */
export const okArrayResponse = {
  type: 'array',
  items: { type: 'object', additionalProperties: true },
} as const;

/**
 * Standard `{ error: { code, message, details? } }` error body. Permissive
 * (`additionalProperties: true`) so no error field is ever stripped. Only attach this to
 * routes whose error responses actually use this shape (e.g. handlers with a normalising
 * setErrorHandler); routes that surface Fastify's default validation-error shape must NOT
 * declare an error response schema or fast-json-stringify would corrupt it.
 */
export const errorResponse = {
  type: 'object',
  properties: {
    error: {
      type: 'object',
      properties: {
        code: { type: 'string' },
        message: { type: 'string' },
      },
      required: ['code', 'message'],
      additionalProperties: true,
    },
  },
  required: ['error'],
  additionalProperties: true,
} as const;

/**
 * Convert a Zod object schema into a Fastify/OpenAPI request-body JSON schema.
 *
 * Uses the repo's existing zod-to-json-schema conversion (mirrors openapi-schemas.ts),
 * strips the top-level `$schema` (not valid in OpenAPI), and FORCES
 * `additionalProperties: true`. The forced override is the safety guarantee from constraint
 * (1): zod-to-json-schema emits `additionalProperties: false` for plain objects, which — as
 * a Fastify body schema — would reject any request carrying extra keys even though the
 * handler's Zod `.strip()` parse accepts them.
 */
export function zodBodySchema(schema: ZodTypeAny): Record<string, unknown> {
  // NOTE: target is `jsonSchema7`, NOT `openApi3`. Because this schema is attached to a
  // Fastify route it is compiled by ajv (draft-07+) at startup — and the `openApi3` target
  // emits the draft-04 boolean form `exclusiveMinimum: true` (from Zod `.positive()`), which
  // ajv rejects with "exclusiveMinimum must be number", failing route registration. The
  // `jsonSchema7` target emits the numeric form (`exclusiveMinimum: 0`) that ajv accepts and
  // @fastify/swagger still renders into the OpenAPI requestBody.
  const json = zodToJsonSchema(schema, {
    target: 'jsonSchema7',
    $refStrategy: 'none',
  }) as Record<string, unknown>;
  delete json.$schema;
  return { ...json, additionalProperties: true };
}
