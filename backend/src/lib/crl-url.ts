/**
 * CRL Distribution Point (CDP) URL helper.
 *
 * The base is configured via the CRL_DISTRIBUTION_URL env var (e.g. http://crl.example.com/crl).
 * The per-CA CRL is served at `<base>/<caId>.crl` by the public GET /crl/:caId.crl endpoint.
 * Returns undefined when CRL_DISTRIBUTION_URL is unset, so issuance simply omits the CDP.
 */
export function crlDistributionUrl(caId: string): string | undefined {
  const base = process.env.CRL_DISTRIBUTION_URL?.trim();
  if (!base) return undefined;
  return `${base.replace(/\/+$/, '')}/${caId}.crl`;
}
