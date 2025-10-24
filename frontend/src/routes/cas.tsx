import { createFileRoute, useNavigate, Outlet, useMatchRoute } from '@tanstack/react-router';
import { trpc } from '@/lib/trpc';

export const Route = createFileRoute('/cas')({
  component: CertificateAuthorities,
});

function CertificateAuthorities() {
  const navigate = useNavigate();
  const matchRoute = useMatchRoute();
  const isDetailPage = matchRoute({ to: '/cas/$id', fuzzy: false });

  const casQuery = trpc.ca.list.useQuery({
    limit: 50,
    offset: 0,
  });

  // If we're on a detail page, only show the outlet
  if (isDetailPage) {
    return <Outlet />;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-end">
        <button
          onClick={() => navigate({ to: '/cas/new' })}
          className="px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 font-medium shadow-sm"
        >
          Create CA
        </button>
      </div>

      {casQuery.isLoading && (
        <div className="text-center py-8 text-muted-foreground">
          Loading...
        </div>
      )}

      {casQuery.isError && (
        <div className="text-center py-8 text-destructive">
          Error loading certificate authorities
        </div>
      )}

      {casQuery.isSuccess && casQuery.data && (
        <div className="rounded-lg border">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="border-b bg-muted/50">
                <tr>
                  <th className="px-4 py-3 text-left text-sm font-medium">
                    Common Name (CN)
                  </th>
                  <th className="px-4 py-3 text-left text-sm font-medium">
                    Key Algorithm
                  </th>
                  <th className="px-4 py-3 text-left text-sm font-medium">
                    Certificates Issued
                  </th>
                  <th className="px-4 py-3 text-left text-sm font-medium">
                    Status
                  </th>
                  <th className="px-4 py-3 text-left text-sm font-medium">
                    Expiration
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {casQuery.data.length === 0 ? (
                  <tr>
                    <td
                      colSpan={5}
                      className="px-4 py-8 text-center text-muted-foreground"
                    >
                      No certificate authorities found
                    </td>
                  </tr>
                ) : (
                  casQuery.data.map((ca) => {
                    // Extract CN from Subject
                    const cnMatch = ca.subject.match(/CN=([^,]+)/);
                    const commonName = cnMatch ? cnMatch[1] : ca.subject;

                    // Calculate expiration
                    const daysUntilExpiry = Math.ceil((new Date(ca.notAfter).getTime() - Date.now()) / (1000 * 60 * 60 * 24));
                    const isExpiringSoon = daysUntilExpiry <= 30 && daysUntilExpiry > 0;
                    const isExpired = daysUntilExpiry <= 0;

                    return (
                      <tr
                        key={ca.id}
                        className="hover:bg-muted/50 cursor-pointer"
                        onClick={() => navigate({ to: `/cas/${ca.id}` })}
                      >
                        <td className="px-4 py-3">
                          <div className="text-sm font-medium">{commonName}</div>
                          <div className="text-xs text-muted-foreground font-mono truncate max-w-xs">{ca.subject}</div>
                        </td>
                        <td className="px-4 py-3">
                          {ca.keyAlgorithm ? (
                            <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium font-mono bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200">
                              {ca.keyAlgorithm}
                            </span>
                          ) : (
                            <span className="text-xs text-muted-foreground">N/A</span>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <div className="text-sm font-medium">{ca.certificateCount}</div>
                          <div className="text-xs text-muted-foreground">certificates</div>
                        </td>
                        <td className="px-4 py-3">
                          <span
                            className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-medium ${
                              ca.status === 'active'
                                ? 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200'
                                : ca.status === 'revoked'
                                  ? 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200'
                                  : 'bg-gray-100 text-gray-800 dark:bg-gray-900 dark:text-gray-200'
                            }`}
                          >
                            {ca.status}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <div className="text-sm">{new Date(ca.notAfter).toLocaleDateString()}</div>
                          {ca.status === 'active' && (
                            <div className={`text-xs font-medium ${
                              isExpired ? 'text-red-600' : isExpiringSoon ? 'text-orange-600' : 'text-green-600'
                            }`}>
                              {isExpired ? 'Expired' : isExpiringSoon ? `${daysUntilExpiry} days left` : `${daysUntilExpiry} days`}
                            </div>
                          )}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
