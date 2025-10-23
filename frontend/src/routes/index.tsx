import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { trpc } from '@/lib/trpc';
import { AlertCircle } from 'lucide-react';

export const Route = createFileRoute('/')({
  component: Dashboard,
});

function Dashboard() {
  const navigate = useNavigate();
  const statsQuery = trpc.dashboard.stats.useQuery();
  const expiringQuery = trpc.dashboard.expiringSoon.useQuery({ limit: 5 });

  return (
    <div className="space-y-6">
      {/* Stats Cards */}
      <div className="grid gap-4 md:grid-cols-4">
        <div className="rounded-lg border bg-card p-6">
          <h3 className="text-sm font-medium text-muted-foreground">
            Total CAs
          </h3>
          <p className="text-2xl font-bold mt-2">
            {statsQuery.isLoading ? (
              <span className="text-muted-foreground">...</span>
            ) : statsQuery.isError ? (
              <span className="text-destructive">Error</span>
            ) : (
              statsQuery.data.totalCAs
            )}
          </p>
          {statsQuery.data && (
            <p className="text-xs text-muted-foreground mt-1">
              {statsQuery.data.activeCAs} active
            </p>
          )}
        </div>

        <div className="rounded-lg border bg-card p-6">
          <h3 className="text-sm font-medium text-muted-foreground">
            Active CAs
          </h3>
          <p className="text-2xl font-bold mt-2 text-primary">
            {statsQuery.isLoading ? (
              <span className="text-muted-foreground">...</span>
            ) : statsQuery.isError ? (
              <span className="text-destructive">Error</span>
            ) : (
              statsQuery.data.activeCAs
            )}
          </p>
          <p className="text-xs text-muted-foreground mt-1">
            Currently valid
          </p>
        </div>

        <div className="rounded-lg border bg-card p-6">
          <h3 className="text-sm font-medium text-muted-foreground">
            Total Certificates
          </h3>
          <p className="text-2xl font-bold mt-2">
            {statsQuery.isLoading ? (
              <span className="text-muted-foreground">...</span>
            ) : statsQuery.isError ? (
              <span className="text-destructive">Error</span>
            ) : (
              statsQuery.data.totalCertificates
            )}
          </p>
          {statsQuery.data && (
            <p className="text-xs text-muted-foreground mt-1">
              {statsQuery.data.activeCertificates} active
            </p>
          )}
        </div>

        <div className="rounded-lg border bg-card p-6">
          <h3 className="text-sm font-medium text-muted-foreground">
            Active Certificates
          </h3>
          <p className="text-2xl font-bold mt-2 text-primary">
            {statsQuery.isLoading ? (
              <span className="text-muted-foreground">...</span>
            ) : statsQuery.isError ? (
              <span className="text-destructive">Error</span>
            ) : (
              statsQuery.data.activeCertificates
            )}
          </p>
          <p className="text-xs text-muted-foreground mt-1">
            Currently valid
          </p>
        </div>
      </div>

      {/* Expiring Soon Table */}
      <div className="rounded-lg border bg-card">
        <div className="p-6 border-b">
          <div className="flex items-center gap-2">
            <AlertCircle className="h-5 w-5 text-primary" />
            <h2 className="text-lg font-semibold">Expiring Soon</h2>
          </div>
          <p className="text-sm text-muted-foreground mt-1">
            Next 5 certificates or CAs that will expire
          </p>
        </div>

        <div className="overflow-x-auto">
          {expiringQuery.isLoading ? (
            <div className="p-8 text-center text-muted-foreground">
              Loading...
            </div>
          ) : expiringQuery.isError ? (
            <div className="p-8 text-center text-destructive">
              Error loading expiring items
            </div>
          ) : expiringQuery.data.length === 0 ? (
            <div className="p-8 text-center text-muted-foreground">
              No items expiring soon
            </div>
          ) : (
            <table className="w-full">
              <thead className="border-b bg-muted/50">
                <tr>
                  <th className="px-4 py-3 text-left text-sm font-medium">Type</th>
                  <th className="px-4 py-3 text-left text-sm font-medium">Common Name</th>
                  <th className="px-4 py-3 text-left text-sm font-medium">Subject Alternative Names</th>
                  <th className="px-4 py-3 text-left text-sm font-medium">Expires</th>
                  <th className="px-4 py-3 text-left text-sm font-medium">Days Left</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {expiringQuery.data.map((item) => {
                  const linkTo = item.type === 'CA'
                    ? `/cas/${item.id}`
                    : `/certificates/${item.id}`;

                  return (
                    <tr
                      key={item.id}
                      className="hover:bg-muted/50 cursor-pointer"
                      onClick={() => navigate({ to: linkTo })}
                    >
                      <td className="px-4 py-3">
                        <span
                          className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-medium ${
                            item.type === 'CA'
                              ? 'bg-primary/10 text-primary'
                              : item.type === 'Server'
                              ? 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200'
                              : item.type === 'Client'
                              ? 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200'
                              : item.type === 'Code Signing'
                              ? 'bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200'
                              : item.type === 'Email (S/MIME)'
                              ? 'bg-cyan-100 text-cyan-800 dark:bg-cyan-900 dark:text-cyan-200'
                              : 'bg-gray-100 text-gray-800 dark:bg-gray-900 dark:text-gray-200'
                          }`}
                        >
                          {item.type}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-sm font-medium">{item.cn}</td>
                      <td className="px-4 py-3 text-sm text-muted-foreground font-mono text-xs">
                        {item.san}
                      </td>
                      <td className="px-4 py-3 text-sm text-muted-foreground">
                        {new Date(item.notAfter).toLocaleDateString()}
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-medium ${
                            item.daysRemaining <= 7
                              ? 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200'
                              : item.daysRemaining <= 30
                                ? 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200'
                                : 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200'
                          }`}
                        >
                          {item.daysRemaining} days
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
