---
id: TASK-207
title: Emit request/response JSON schemas for the SSH & external OpenAPI routes
status: Done
assignee:
  - '@claude'
created_date: '2026-07-11 16:47'
updated_date: '2026-07-11 17:19'
labels:
  - bug
  - api
  - openapi
milestone: API bugs
dependencies: []
ordinal: 34014
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The /api/v1/ssh/* and /api/v1/external/* Fastify routes register schemas with only tags+summary, so the generated OpenAPI (@fastify/swagger) has no requestBody and empty responses. As a result openapi-python-client can only build body-less requests with no typed models (discovered while updating pki-manager-cli). Attach the existing Zod schemas (trpc/ssh-schemas.ts and the inline bodies in external.routes.ts / ssh-external.routes.ts) to each route schema.body / schema.response via zod-to-json-schema, mirroring the X.509 routes, so REST/OpenAPI and tRPC stay a single source of truth.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Published openapi.json documents a request-body schema for every POST under /ssh/* and /external/* (e.g. POST /ssh/cas, /ssh/hosts, /ssh/hosts/issue, /ssh/users/issue, /ssh/tokens, /ssh/blocks, /external/sign, /external/revoke, /external/ssh/sign-host, /external/ssh/sign-user)
- [x] #2 Published openapi.json documents a 200 response schema for those SSH and external routes
- [x] #3 A client generated with openapi-python-client exposes typed body= parameters and return models for those endpoints (no body-less stubs)
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Add helper backend/src/rest/schemas/ssh-openapi-schemas.ts: zodBodySchema() (zod-to-json-schema, jsonSchema7 target, additionalProperties:true) + permissive okObject/okArray/error response schemas.
2. Attach body+response schemas to every POST/GET in ssh.routes.ts (Zod-derived bodies), external.routes.ts (hand-written /sign,/revoke bodies) and ssh-external.routes.ts (sign-host/sign-user/register-host-pubkey/krl); binary krl endpoints get no response schema.
3. Guard the two Fastify hazards: bodies additionalProperties:true so ajv never 400s valid input; responses permissive so fast-json-stringify never strips fields; match response type (object vs array) to real service return types.
4. Add Vitest ssh-openapi.test.ts proving requestBody+200 present, no response stripping, valid body not rejected.
5. Run test + strict typecheck; verify openapi-python-client emits typed body+return models.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Attached request-body + response JSON schemas to the SSH & external REST routes so @fastify/swagger documents requestBody and 200 responses (previously tags+summary only).

Files changed:
- backend/src/rest/schemas/ssh-openapi-schemas.ts (NEW): zodBodySchema() converts a Zod schema via zod-to-json-schema (target jsonSchema7 — NOT openApi3, which emits ajv-incompatible boolean exclusiveMinimum from Zod .positive() and breaks route registration) and forces additionalProperties:true; plus permissive okObjectResponse / okArrayResponse / errorResponse.
- backend/src/rest/routes/ssh.routes.ts: postSchema/listSchema/objectSchema builders; every POST gets a Zod-derived body + object 200; GETs get array/object 200 matched to actual service return types; binary krl.bin left unschema'd.
- backend/src/rest/routes/external.routes.ts: hand-written body schemas for /sign (required csrPem,requestUid) and /revoke (required serialNumber); 200 object responses; /ca-bundle also declares its explicit 404.
- backend/src/rest/routes/ssh-external.routes.ts: Zod bodies for sign-host/sign-user, permissive bodies for register-host-pubkey/krl; 200 object responses except /krl (binary envelope -> no response schema).
- backend/src/rest/routes/ssh-openapi.test.ts (NEW): asserts requestBody+200 for key POSTs, no response stripping, and that a valid body (with extra keys + format:email) is not rejected.

Hazards handled: (1) bodies use additionalProperties:true + required = exactly the Zod-required fields so Fastify ajv never 400s a body the handler accepts; (2) responses are permissive and type-matched so fast-json-stringify never strips/corrupts real fields; error responses only declared where the route emits the {error:{code,message}} shape.

Tests: cd backend && DATABASE_PATH=/tmp/pki-t207.db npx vitest run src/rest/routes/ssh-openapi.test.ts --reporter=basic -> PASS (25) FAIL (0). Strict typecheck (./node_modules/.bin/tsc --noEmit -p tsconfig.json) -> 0 errors.

AC#3 verified: uvx openapi-python-client generate against the produced spec emits 22 typed request-body models + typed sync(body=..., ) signatures and Response200 return models for these endpoints (e.g. PostExternalSshSignHostBody{fqdn:str, openssh_host_pubkey:str, ...}, PostExternalSignBody{csr_pem:str, request_uid:str, certificate_type enum, ...}) — no body-less stubs.
<!-- SECTION:NOTES:END -->
