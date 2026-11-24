import type { FastifyRequest } from 'fastify';

/** Header that carries an export password outside the URL (URLs end up in logs and history). */
export const EXPORT_PASSWORD_HEADER = 'x-export-password';

/** OpenAPI `headers` schema fragment for download routes. */
export const exportPasswordHeaderSchema = {
  type: 'object',
  properties: {
    'x-export-password': {
      type: 'string',
      description:
        'Export password for password-protected formats. Preferred over the deprecated `password` query parameter: a header is not recorded in browser history or in proxy/server access logs. Takes precedence over the query parameter.',
    },
  },
} as const;

export const deprecatedPasswordQueryDescription =
  'DEPRECATED: use the `X-Export-Password` header instead. A password in the URL is recorded in browser history and proxy/server logs. ';

/** Header first, then the deprecated query parameter. Empty values count as missing. */
export function resolveExportPassword(request: FastifyRequest, queryPassword?: string): string | undefined {
  const raw = request.headers[EXPORT_PASSWORD_HEADER];
  const header = Array.isArray(raw) ? raw[0] : raw;
  return header || queryPassword || undefined;
}
