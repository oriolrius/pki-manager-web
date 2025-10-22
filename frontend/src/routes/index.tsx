import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { trpc } from '../lib/trpc';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Badge } from '../components/ui/badge';
import {
  BarChart,
  Bar,
  PieChart,
  Pie,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  Cell,
} from 'recharts';

export const Route = createFileRoute('/')({
  component: Dashboard,
});

const COLORS = {
  active: '#22c55e',
  expired: '#f97316',
  revoked: '#ef4444',
  server: '#3b82f6',
  client: '#8b5cf6',
  codeSigning: '#ec4899',
  email: '#14b8a6',
};

function Dashboard() {
  const navigate = useNavigate();

  // Fetch all CAs
  const casQuery = trpc.ca.list.useQuery({
    limit: 100,
    offset: 0,
  });

  // Fetch all certificates
  const certsQuery = trpc.certificate.list.useQuery({
    limit: 100,
    offset: 0,
  });

  // Fetch expiring soon (next 30 days)
  const expiringSoonQuery = trpc.certificate.list.useQuery({
    expiryDays: 30,
    limit: 10,
    offset: 0,
  });

  // Fetch recent audit logs
  const auditQuery = trpc.audit.list.useQuery({
    limit: 10,
    offset: 0,
  });

  const isLoading = casQuery.isLoading || certsQuery.isLoading;
  const hasError = casQuery.error || certsQuery.error;

  // Calculate statistics
  const totalCAs = casQuery.data?.length || 0;
  const activeCAs = casQuery.data?.filter((ca) => ca.status === 'active').length || 0;
  const totalCerts = certsQuery.data?.items.length || 0;
  const expiringSoonCount = expiringSoonQuery.data?.items.length || 0;
  const revokedCount =
    certsQuery.data?.items.filter((cert) => cert.status === 'revoked').length || 0;

  // Certificate status distribution
  const statusData = [
    {
      name: 'Active',
      value: certsQuery.data?.items.filter((c) => c.status === 'active').length || 0,
    },
    {
      name: 'Expired',
      value: certsQuery.data?.items.filter((c) => c.status === 'expired').length || 0,
    },
    {
      name: 'Revoked',
      value: certsQuery.data?.items.filter((c) => c.status === 'revoked').length || 0,
    },
  ].filter((item) => item.value > 0);

  // Certificate type distribution
  const typeData = [
    {
      name: 'Server',
      value: certsQuery.data?.items.filter((c) => c.certificateType === 'server').length || 0,
    },
    {
      name: 'Client',
      value: certsQuery.data?.items.filter((c) => c.certificateType === 'client').length || 0,
    },
    {
      name: 'Code Signing',
      value:
        certsQuery.data?.items.filter((c) => c.certificateType === 'codeSigning').length || 0,
    },
    {
      name: 'Email',
      value: certsQuery.data?.items.filter((c) => c.certificateType === 'email').length || 0,
    },
  ].filter((item) => item.value > 0);

  // Certificates by CA
  const certsByCA = casQuery.data?.map((ca) => ({
    name: ca.subject.split('CN=')[1]?.split(',')[0] || 'Unknown',
    count: ca.certificateCount,
  })) || [];

  // Expiry timeline (next 12 months)
  const getExpiryTimeline = () => {
    const timeline = [];
    const now = new Date();
    for (let i = 0; i < 12; i++) {
      const monthDate = new Date(now.getFullYear(), now.getMonth() + i, 1);
      const monthStart = monthDate.getTime();
      const monthEnd = new Date(monthDate.getFullYear(), monthDate.getMonth() + 1, 0).getTime();

      const count =
        certsQuery.data?.items.filter((cert) => {
          const expiryDate = new Date(cert.notAfter).getTime();
          return expiryDate >= monthStart && expiryDate <= monthEnd;
        }).length || 0;

      timeline.push({
        month: monthDate.toLocaleDateString('en-US', { month: 'short', year: '2-digit' }),
        expiring: count,
      });
    }
    return timeline;
  };

  const expiryTimeline = getExpiryTimeline();

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  };

  const formatTimestamp = (timestamp: string) => {
    const date = new Date(timestamp);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMins / 60);
    const diffDays = Math.floor(diffHours / 24);

    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;
    return formatDate(timestamp);
  };

  const getActionColor = (action: string) => {
    if (action.includes('create')) return 'text-green-600';
    if (action.includes('revoke') || action.includes('delete')) return 'text-red-600';
    if (action.includes('renew') || action.includes('update')) return 'text-blue-600';
    return 'text-gray-600';
  };

  return (
    <div className="px-4 py-6 sm:px-0 space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold">Dashboard</h1>
        <p className="text-muted-foreground mt-1">
          Overview of your PKI infrastructure
        </p>
      </div>

      {/* Loading State */}
      {isLoading && (
        <div className="flex justify-center py-12">
          <p className="text-sm text-muted-foreground">Loading dashboard data...</p>
        </div>
      )}

      {/* Error State */}
      {hasError && (
        <div className="rounded-md border border-destructive bg-destructive/10 p-4">
          <p className="text-sm font-medium text-destructive">
            Error loading dashboard data
          </p>
        </div>
      )}

      {/* Dashboard Content */}
      {!isLoading && !hasError && (
        <>
          {/* Summary Cards */}
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            <Card
              className="cursor-pointer hover:bg-muted/50 transition-colors"
              onClick={() => navigate({ to: '/cas' })}
            >
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Total CAs</CardTitle>
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="2"
                  className="h-4 w-4 text-muted-foreground"
                >
                  <path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
                </svg>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{totalCAs}</div>
                <p className="text-xs text-muted-foreground">
                  {activeCAs} active
                </p>
              </CardContent>
            </Card>

            <Card className="cursor-pointer hover:bg-muted/50 transition-colors">
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Total Certificates</CardTitle>
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="2"
                  className="h-4 w-4 text-muted-foreground"
                >
                  <rect width="20" height="14" x="2" y="5" rx="2" />
                  <path d="M2 10h20" />
                </svg>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{totalCerts}</div>
                <p className="text-xs text-muted-foreground">
                  Across {totalCAs} CAs
                </p>
              </CardContent>
            </Card>

            <Card className="cursor-pointer hover:bg-muted/50 transition-colors border-orange-200 bg-orange-50/50">
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Expiring Soon</CardTitle>
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="2"
                  className="h-4 w-4 text-orange-600"
                >
                  <circle cx="12" cy="12" r="10" />
                  <polyline points="12 6 12 12 16 14" />
                </svg>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold text-orange-600">{expiringSoonCount}</div>
                <p className="text-xs text-muted-foreground">
                  Next 30 days
                </p>
              </CardContent>
            </Card>

            <Card className="cursor-pointer hover:bg-muted/50 transition-colors">
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Revoked</CardTitle>
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="2"
                  className="h-4 w-4 text-muted-foreground"
                >
                  <circle cx="12" cy="12" r="10" />
                  <path d="m15 9-6 6M9 9l6 6" />
                </svg>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{revokedCount}</div>
                <p className="text-xs text-muted-foreground">
                  Certificates
                </p>
              </CardContent>
            </Card>
          </div>

          {/* Charts Row */}
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {/* Expiry Timeline */}
            <Card className="lg:col-span-2">
              <CardHeader>
                <CardTitle>Certificate Expiry Timeline</CardTitle>
                <CardDescription>Certificates expiring in next 12 months</CardDescription>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={300}>
                  <LineChart data={expiryTimeline}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="month" />
                    <YAxis />
                    <Tooltip />
                    <Legend />
                    <Line
                      type="monotone"
                      dataKey="expiring"
                      stroke="#f97316"
                      strokeWidth={2}
                      name="Expiring Certificates"
                    />
                  </LineChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>

            {/* Certificate Status Distribution */}
            <Card>
              <CardHeader>
                <CardTitle>Certificate Status</CardTitle>
                <CardDescription>Distribution by status</CardDescription>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={300}>
                  <PieChart>
                    <Pie
                      data={statusData}
                      cx="50%"
                      cy="50%"
                      labelLine={false}
                      label={(entry) => `${entry.name}: ${entry.value}`}
                      outerRadius={80}
                      fill="#8884d8"
                      dataKey="value"
                    >
                      {statusData.map((entry, index) => (
                        <Cell
                          key={`cell-${index}`}
                          fill={
                            entry.name === 'Active'
                              ? COLORS.active
                              : entry.name === 'Expired'
                                ? COLORS.expired
                                : COLORS.revoked
                          }
                        />
                      ))}
                    </Pie>
                    <Tooltip />
                  </PieChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>

            {/* Certificate Type Distribution */}
            {typeData.length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle>Certificate Types</CardTitle>
                  <CardDescription>Distribution by type</CardDescription>
                </CardHeader>
                <CardContent>
                  <ResponsiveContainer width="100%" height={300}>
                    <PieChart>
                      <Pie
                        data={typeData}
                        cx="50%"
                        cy="50%"
                        labelLine={false}
                        label={(entry) => `${entry.name}: ${entry.value}`}
                        outerRadius={80}
                        fill="#8884d8"
                        dataKey="value"
                      >
                        {typeData.map((entry, index) => (
                          <Cell
                            key={`cell-${index}`}
                            fill={
                              entry.name === 'Server'
                                ? COLORS.server
                                : entry.name === 'Client'
                                  ? COLORS.client
                                  : entry.name === 'Code Signing'
                                    ? COLORS.codeSigning
                                    : COLORS.email
                            }
                          />
                        ))}
                      </Pie>
                      <Tooltip />
                    </PieChart>
                  </ResponsiveContainer>
                </CardContent>
              </Card>
            )}

            {/* Certificates by CA */}
            {certsByCA.length > 0 && (
              <Card className={typeData.length > 0 ? 'lg:col-span-2' : 'lg:col-span-3'}>
                <CardHeader>
                  <CardTitle>Certificates by CA</CardTitle>
                  <CardDescription>Certificate count per Certificate Authority</CardDescription>
                </CardHeader>
                <CardContent>
                  <ResponsiveContainer width="100%" height={300}>
                    <BarChart data={certsByCA}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="name" />
                      <YAxis />
                      <Tooltip />
                      <Legend />
                      <Bar dataKey="count" fill="#3b82f6" name="Certificates" />
                    </BarChart>
                  </ResponsiveContainer>
                </CardContent>
              </Card>
            )}
          </div>

          {/* Recent Activity & Expiring Soon */}
          <div className="grid gap-4 md:grid-cols-2">
            {/* Recent Activity Feed */}
            <Card>
              <CardHeader>
                <CardTitle>Recent Activity</CardTitle>
                <CardDescription>Latest operations in your PKI</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  {auditQuery.isLoading && (
                    <p className="text-sm text-muted-foreground">Loading activity...</p>
                  )}
                  {auditQuery.data?.items.slice(0, 10).map((log, index) => (
                    <div key={index} className="flex items-start gap-3 pb-3 border-b last:border-0">
                      <div className="flex-1 space-y-1">
                        <p className={`text-sm font-medium ${getActionColor(log.action)}`}>
                          {log.action}
                        </p>
                        {log.entityType && (
                          <p className="text-xs text-muted-foreground">
                            {log.entityType} • {log.userId || 'System'}
                          </p>
                        )}
                      </div>
                      <span className="text-xs text-muted-foreground whitespace-nowrap">
                        {formatTimestamp(log.timestamp)}
                      </span>
                    </div>
                  ))}
                  {auditQuery.data?.items.length === 0 && (
                    <p className="text-sm text-muted-foreground text-center py-4">
                      No recent activity
                    </p>
                  )}
                </div>
              </CardContent>
            </Card>

            {/* Expiring Soon Table */}
            <Card>
              <CardHeader>
                <CardTitle>Expiring Soon</CardTitle>
                <CardDescription>Certificates expiring in next 30 days</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {expiringSoonQuery.isLoading && (
                    <p className="text-sm text-muted-foreground">Loading...</p>
                  )}
                  {expiringSoonQuery.data?.items.slice(0, 8).map((cert) => {
                    const daysUntilExpiry = Math.ceil(
                      (new Date(cert.notAfter).getTime() - Date.now()) / (1000 * 60 * 60 * 24),
                    );
                    return (
                      <div
                        key={cert.id}
                        className="flex items-center justify-between p-3 border rounded-lg hover:bg-muted/50 transition-colors cursor-pointer"
                      >
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium truncate">
                            {cert.subjectDn.split('CN=')[1]?.split(',')[0] || 'Unknown'}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            Expires {formatDate(cert.notAfter)}
                          </p>
                        </div>
                        <Badge
                          className={
                            daysUntilExpiry <= 7
                              ? 'bg-red-100 text-red-800 hover:bg-red-100'
                              : 'bg-orange-100 text-orange-800 hover:bg-orange-100'
                          }
                        >
                          {daysUntilExpiry}d
                        </Badge>
                      </div>
                    );
                  })}
                  {expiringSoonQuery.data?.items.length === 0 && (
                    <div className="text-center py-8 border rounded-lg border-dashed">
                      <p className="text-sm text-muted-foreground">
                        No certificates expiring soon
                      </p>
                      <p className="text-xs text-muted-foreground mt-1">
                        All certificates are valid for at least 30 days
                      </p>
                    </div>
                  )}
                  {(expiringSoonQuery.data?.items.length || 0) > 0 && (
                    <Button variant="outline" className="w-full mt-2">
                      View All Expiring Certificates
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Quick Actions */}
          <Card>
            <CardHeader>
              <CardTitle>Quick Actions</CardTitle>
              <CardDescription>Common tasks to get you started</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex flex-wrap gap-2">
                <Button onClick={() => navigate({ to: '/cas' })}>
                  View Certificate Authorities
                </Button>
                <Button variant="outline">Create New CA</Button>
                <Button variant="outline">Issue Certificate</Button>
                <Button variant="outline">View All Certificates</Button>
              </div>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
