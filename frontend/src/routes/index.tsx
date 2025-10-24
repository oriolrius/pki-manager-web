import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { trpc } from '@/lib/trpc';
import { AlertCircle, Lock, Server, Home, Zap, Shield } from 'lucide-react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faShield, faShieldHalved, faCertificate, faFileContract } from '@fortawesome/free-solid-svg-icons';

export const Route = createFileRoute('/')({
  component: Dashboard,
});

function Dashboard() {
  const navigate = useNavigate();
  const statsQuery = trpc.dashboard.stats.useQuery();
  const expiringQuery = trpc.dashboard.expiringSoon.useQuery({ limit: 5 });

  return (
    <div className="space-y-6">
      {/* Purpose Banner */}
      <div className="relative rounded-xl border border-primary/30 bg-gradient-to-br from-primary/10 via-primary/5 to-background overflow-hidden">
        <div className="absolute inset-0 bg-grid-white/5 [mask-image:linear-gradient(0deg,transparent,black)]" />
        <div className="relative p-8">
          <div className="flex items-center gap-8">
            <div className="flex-shrink-0">
              <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-primary to-primary/60 flex items-center justify-center shadow-lg shadow-primary/25">
                <Lock className="h-10 w-10 text-primary-foreground" />
              </div>
            </div>
            <div className="flex-1">
              <h2 className="text-2xl font-bold bg-gradient-to-r from-foreground to-foreground/70 bg-clip-text text-transparent mb-2">
                Own Your Security Infrastructure
              </h2>
              <p className="text-sm text-muted-foreground leading-relaxed mb-5 max-w-3xl">
                Effortlessly manage your Private Key Infrastructure (PKI) and issue SSL/TLS certificates without relying on external authorities.
                Perfect for enterprises, home labs, and development environments that demand full control.
              </p>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <div className="flex items-center gap-3 p-3 rounded-lg bg-background/50 border border-border/50">
                  <div className="flex-shrink-0 w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center">
                    <Shield className="h-4 w-4 text-primary" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="font-semibold text-sm leading-tight">Full Control</div>
                    <div className="text-xs text-muted-foreground leading-tight">Own your cert lifecycle</div>
                  </div>
                </div>
                <div className="flex items-center gap-3 p-3 rounded-lg bg-background/50 border border-border/50">
                  <div className="flex-shrink-0 w-9 h-9 rounded-lg bg-blue-500/10 flex items-center justify-center">
                    <Server className="h-4 w-4 text-blue-500" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="font-semibold text-sm leading-tight">Enterprise Ready</div>
                    <div className="text-xs text-muted-foreground leading-tight">Secure your infrastructure</div>
                  </div>
                </div>
                <div className="flex items-center gap-3 p-3 rounded-lg bg-background/50 border border-border/50">
                  <div className="flex-shrink-0 w-9 h-9 rounded-lg bg-green-500/10 flex items-center justify-center">
                    <Zap className="h-4 w-4 text-green-500" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="font-semibold text-sm leading-tight">Zero Dependencies</div>
                    <div className="text-xs text-muted-foreground leading-tight">No external CAs needed</div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Stats Cards - Compact Design */}
      <div className="grid gap-3 md:grid-cols-4">
        <div className="rounded-lg border bg-card px-3 py-2">
          <div className="flex items-center gap-3">
            <FontAwesomeIcon icon={faShield} className="h-5 w-5 text-muted-foreground/50" />
            <div className="flex-1">
              <div className="flex items-baseline gap-2">
                <span className="text-xl font-bold">
                  {statsQuery.isLoading ? '...' : statsQuery.isError ? 'Err' : statsQuery.data.totalCAs}
                </span>
                <span className="text-xs text-muted-foreground">Total CAs</span>
              </div>
              {statsQuery.data && (
                <p className="text-xs text-muted-foreground">{statsQuery.data.activeCAs} active</p>
              )}
            </div>
          </div>
        </div>

        <div className="rounded-lg border bg-card px-3 py-2">
          <div className="flex items-center gap-3">
            <FontAwesomeIcon icon={faShieldHalved} className="h-5 w-5 text-primary/70" />
            <div className="flex-1">
              <div className="flex items-baseline gap-2">
                <span className="text-xl font-bold text-primary">
                  {statsQuery.isLoading ? '...' : statsQuery.isError ? 'Err' : statsQuery.data.activeCAs}
                </span>
                <span className="text-xs text-muted-foreground">Active CAs</span>
              </div>
              <p className="text-xs text-muted-foreground">Currently valid</p>
            </div>
          </div>
        </div>

        <div className="rounded-lg border bg-card px-3 py-2">
          <div className="flex items-center gap-3">
            <FontAwesomeIcon icon={faCertificate} className="h-5 w-5 text-muted-foreground/50" />
            <div className="flex-1">
              <div className="flex items-baseline gap-2">
                <span className="text-xl font-bold">
                  {statsQuery.isLoading ? '...' : statsQuery.isError ? 'Err' : statsQuery.data.totalCertificates}
                </span>
                <span className="text-xs text-muted-foreground">Total Certs</span>
              </div>
              {statsQuery.data && (
                <p className="text-xs text-muted-foreground">{statsQuery.data.activeCertificates} active</p>
              )}
            </div>
          </div>
        </div>

        <div className="rounded-lg border bg-card px-3 py-2">
          <div className="flex items-center gap-3">
            <FontAwesomeIcon icon={faFileContract} className="h-5 w-5 text-primary/70" />
            <div className="flex-1">
              <div className="flex items-baseline gap-2">
                <span className="text-xl font-bold text-primary">
                  {statsQuery.isLoading ? '...' : statsQuery.isError ? 'Err' : statsQuery.data.activeCertificates}
                </span>
                <span className="text-xs text-muted-foreground">Active Certs</span>
              </div>
              <p className="text-xs text-muted-foreground">Currently valid</p>
            </div>
          </div>
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
