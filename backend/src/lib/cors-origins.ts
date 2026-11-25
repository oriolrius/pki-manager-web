/**
 * Parses FRONTEND_URL into the `origin` option of @fastify/cors: the browser
 * origins that may call the API from another origin (the web UI when it is not
 * served on the API's own origin).
 *
 * - unset or empty: every origin is allowed (`true`), the behaviour before
 *   FRONTEND_URL had an effect. Keep it only when no browser on another origin
 *   is a concern, or when the UI and the API share one origin.
 * - comma-separated origins (`https://pki.example.com,http://localhost:8080`):
 *   only these origins get CORS headers. Recommended.
 *
 * CORS only controls which browser pages can read the responses; it does not
 * replace authentication. Requests without an `Origin` header (CLI, scripts,
 * the Kubernetes issuer, the SCEP gateway) are not affected.
 *
 * Invalid entries throw, so a typo cannot silently allow or block the UI.
 */
export function parseCorsOrigins(raw: string | undefined): true | string[] {
  const value = raw?.trim() ?? '';
  if (value === '') return true;
  const entries = value.split(',').map((entry) => entry.trim()).filter(Boolean);
  return [...new Set(entries.map(toOrigin))];
}

function toOrigin(entry: string): string {
  const invalid = () =>
    new Error(`Invalid FRONTEND_URL entry "${entry}": expected an origin such as https://pki.example.com`);
  let url: URL;
  try {
    url = new URL(entry);
  } catch {
    throw invalid();
  }
  const isHttp = url.protocol === 'http:' || url.protocol === 'https:';
  const onlyOrigin = (url.pathname === '/' || url.pathname === '') && !url.search && !url.hash;
  if (!isHttp || !onlyOrigin || url.username || url.password) throw invalid();
  return url.origin;
}
