/**
 * URL search params of the certificate list (/certificates).
 *
 * The list state lives in the URL, so a filtered page can be bookmarked, shared and
 * restored with the browser back button. The server does the filtering, the sorting
 * and the paging (`certificate.list`); this module only maps the URL to that input.
 */

export const CERTIFICATE_PAGE_SIZES = [25, 50, 100] as const;
export const DEFAULT_CERTIFICATE_PAGE_SIZE = 50;

export const CERTIFICATE_STATUS_FILTERS = ['active', 'revoked', 'expired'] as const;
export const CERTIFICATE_TYPES = ['server', 'client', 'dual', 'email', 'code_signing'] as const;
export const CERTIFICATE_SORTS = ['createdAt', 'notAfter', 'subjectDn'] as const;

export const CERTIFICATE_TYPE_LABELS: Record<(typeof CERTIFICATE_TYPES)[number], string> = {
  server: 'Server',
  client: 'Client',
  dual: 'Dual (mTLS)',
  email: 'Email (S/MIME)',
  code_signing: 'Code signing',
};

export interface CertificateListSearch {
  q?: string;
  ca?: string;
  status?: (typeof CERTIFICATE_STATUS_FILTERS)[number];
  type?: (typeof CERTIFICATE_TYPES)[number];
  sort?: (typeof CERTIFICATE_SORTS)[number];
  order?: 'asc' | 'desc';
  page?: number;
  size?: (typeof CERTIFICATE_PAGE_SIZES)[number];
}

function oneOf<T extends string | number>(values: readonly T[], value: unknown): T | undefined {
  return values.includes(value as T) ? (value as T) : undefined;
}

/** TanStack Router `validateSearch`: unknown or invalid values are dropped (defaults apply). */
export function validateCertificateListSearch(search: Record<string, unknown>): CertificateListSearch {
  const page = Number(search.page);
  return {
    q: typeof search.q === 'string' && search.q.trim() ? search.q : undefined,
    ca: typeof search.ca === 'string' && search.ca ? search.ca : undefined,
    status: oneOf(CERTIFICATE_STATUS_FILTERS, search.status),
    type: oneOf(CERTIFICATE_TYPES, search.type),
    sort: oneOf(CERTIFICATE_SORTS, search.sort),
    order: oneOf(['asc', 'desc'] as const, search.order),
    page: Number.isInteger(page) && page > 1 ? page : undefined,
    size: oneOf(CERTIFICATE_PAGE_SIZES, Number(search.size)),
  };
}

/** Map the URL state to the `certificate.list` input. */
export function certificateListInput(search: CertificateListSearch) {
  const limit = search.size ?? DEFAULT_CERTIFICATE_PAGE_SIZE;
  const page = search.page ?? 1;
  return {
    search: search.q?.trim() || undefined,
    caId: search.ca,
    // "Expired" in the UI = not revoked, and past notAfter. The stored status of a
    // certificate stays "active" when it expires; expiryStatus is computed by the server.
    status: search.status === 'expired' ? ('active' as const) : search.status,
    expiryStatus: search.status === 'expired' ? ('expired' as const) : undefined,
    certificateType: search.type,
    sortBy: search.sort ?? 'createdAt',
    sortOrder: search.order ?? 'desc',
    limit,
    offset: (page - 1) * limit,
  };
}
