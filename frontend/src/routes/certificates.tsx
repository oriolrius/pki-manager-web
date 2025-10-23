import { createFileRoute, useNavigate, Outlet, useMatchRoute } from '@tanstack/react-router';
import { trpc } from '@/lib/trpc';
import { Search, CheckCircle, XCircle, Server, User, Mail, FileCode, Award } from 'lucide-react';
import { useState, useEffect, useMemo } from 'react';

export const Route = createFileRoute('/certificates')({
  component: Certificates,
});

const CA_FILTER_STORAGE_KEY = 'pki-manager-ca-filter';
const STATUS_FILTER_STORAGE_KEY = 'pki-manager-status-filter';
const TYPE_FILTER_STORAGE_KEY = 'pki-manager-type-filter';

// Helper function to get certificate type icon
function getCertificateTypeIcon(type: string) {
  switch (type.toLowerCase()) {
    case 'server':
      return { icon: Server, label: 'Server Certificate' };
    case 'client':
      return { icon: User, label: 'Client Certificate' };
    case 'email (s/mime)':
    case 'email':
      return { icon: Mail, label: 'Email Certificate (S/MIME)' };
    case 'code signing':
      return { icon: FileCode, label: 'Code Signing Certificate' };
    default:
      return { icon: Award, label: type };
  }
}

function Certificates() {
  const navigate = useNavigate();
  const matchRoute = useMatchRoute();
  const isDetailPage = matchRoute({ to: '/certificates/$id', fuzzy: false });
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedCA, setSelectedCA] = useState<string>('');
  const [selectedStatus, setSelectedStatus] = useState<string>('');
  const [selectedType, setSelectedType] = useState<string>('');

  const certificatesQuery = trpc.certificate.list.useQuery({
    limit: 50,
    offset: 0,
  });

  // Load filters from localStorage on mount
  useEffect(() => {
    const storedCA = localStorage.getItem(CA_FILTER_STORAGE_KEY);
    const storedStatus = localStorage.getItem(STATUS_FILTER_STORAGE_KEY);
    const storedType = localStorage.getItem(TYPE_FILTER_STORAGE_KEY);

    if (storedCA) setSelectedCA(storedCA);
    if (storedStatus) setSelectedStatus(storedStatus);
    if (storedType) setSelectedType(storedType);
  }, []);

  // Save CA filter to localStorage when it changes
  useEffect(() => {
    if (selectedCA) {
      localStorage.setItem(CA_FILTER_STORAGE_KEY, selectedCA);
    } else {
      localStorage.removeItem(CA_FILTER_STORAGE_KEY);
    }
  }, [selectedCA]);

  // Save status filter to localStorage when it changes
  useEffect(() => {
    if (selectedStatus) {
      localStorage.setItem(STATUS_FILTER_STORAGE_KEY, selectedStatus);
    } else {
      localStorage.removeItem(STATUS_FILTER_STORAGE_KEY);
    }
  }, [selectedStatus]);

  // Save type filter to localStorage when it changes
  useEffect(() => {
    if (selectedType) {
      localStorage.setItem(TYPE_FILTER_STORAGE_KEY, selectedType);
    } else {
      localStorage.removeItem(TYPE_FILTER_STORAGE_KEY);
    }
  }, [selectedType]);

  // Extract unique CAs from certificates
  const uniqueCAs = useMemo(() => {
    if (!certificatesQuery.data?.items) return [];

    const caMap = new Map<string, { id: string; cn: string }>();
    certificatesQuery.data.items.forEach(cert => {
      if (cert.issuingCA && !caMap.has(cert.issuingCA.id)) {
        const cnMatch = cert.issuingCA.subjectDn.match(/CN=([^,]+)/);
        const cn = cnMatch ? cnMatch[1] : cert.issuingCA.subjectDn;
        caMap.set(cert.issuingCA.id, { id: cert.issuingCA.id, cn });
      }
    });

    return Array.from(caMap.values()).sort((a, b) => a.cn.localeCompare(b.cn));
  }, [certificatesQuery.data]);

  // Extract unique certificate types
  const uniqueTypes = useMemo(() => {
    if (!certificatesQuery.data?.items) return [];

    const types = new Set<string>();
    certificatesQuery.data.items.forEach(cert => {
      types.add(cert.certificateType);
    });

    return Array.from(types).sort();
  }, [certificatesQuery.data]);

  // If we're on a detail page, only show the outlet
  if (isDetailPage) {
    return <Outlet />;
  }

  // Filter certificates by CN, SAN, CA, status, and type
  const filteredCertificates = certificatesQuery.data?.items.filter((cert) => {
    // Filter by CA if selected
    if (selectedCA && cert.issuingCA?.id !== selectedCA) {
      return false;
    }

    // Filter by status if selected
    if (selectedStatus) {
      if (selectedStatus === 'expired') {
        const isExpired = new Date(cert.notAfter).getTime() < Date.now();
        if (!isExpired || cert.status !== 'active') {
          return false;
        }
      } else if (cert.status !== selectedStatus) {
        return false;
      }
    }

    // Filter by type if selected
    if (selectedType && cert.certificateType !== selectedType) {
      return false;
    }

    // Filter by search term (CN or SAN)
    if (!searchTerm) return true;

    const searchLower = searchTerm.toLowerCase();

    // Extract CN from Subject DN
    const cnMatch = cert.subjectDn.match(/CN=([^,]+)/);
    const commonName = cnMatch ? cnMatch[1] : cert.subjectDn;

    // Check if CN matches
    if (commonName.toLowerCase().includes(searchLower)) {
      return true;
    }

    // Parse and check SANs
    const sanDns = cert.sanDns ? JSON.parse(cert.sanDns) : [];
    const sanIp = cert.sanIp ? JSON.parse(cert.sanIp) : [];
    const sanEmail = cert.sanEmail ? JSON.parse(cert.sanEmail) : [];
    const allSans = [...sanDns, ...sanIp, ...sanEmail];

    return allSans.some(san => san.toLowerCase().includes(searchLower));
  }) || [];

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-4 flex-wrap">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <input
            type="text"
            placeholder="Filter by CN or SAN..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-10 pr-4 py-2 border rounded-md bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary"
          />
        </div>
        <select
          value={selectedCA}
          onChange={(e) => setSelectedCA(e.target.value)}
          className="px-4 py-2 border rounded-md bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-primary min-w-[180px]"
        >
          <option value="">All CAs</option>
          {uniqueCAs.map(ca => (
            <option key={ca.id} value={ca.id}>
              {ca.cn}
            </option>
          ))}
        </select>
        <select
          value={selectedStatus}
          onChange={(e) => setSelectedStatus(e.target.value)}
          className="px-4 py-2 border rounded-md bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-primary min-w-[140px]"
        >
          <option value="">All Status</option>
          <option value="active">Active</option>
          <option value="revoked">Revoked</option>
          <option value="expired">Expired</option>
        </select>
        <select
          value={selectedType}
          onChange={(e) => setSelectedType(e.target.value)}
          className="px-4 py-2 border rounded-md bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-primary min-w-[150px]"
        >
          <option value="">All Types</option>
          {uniqueTypes.map(type => (
            <option key={type} value={type}>
              {type}
            </option>
          ))}
        </select>
        <button
          onClick={() => navigate({ to: '/certificates/new' })}
          className="px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 font-medium shadow-sm whitespace-nowrap"
        >
          Issue Certificate
        </button>
      </div>

      {certificatesQuery.isLoading && (
        <div className="text-center py-8 text-muted-foreground">
          Loading...
        </div>
      )}

      {certificatesQuery.isError && (
        <div className="text-center py-8 text-destructive">
          Error loading certificates
        </div>
      )}

      {certificatesQuery.isSuccess && certificatesQuery.data && (
        <div className="rounded-lg border">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="border-b bg-muted/50">
                <tr>
                  <th className="px-4 py-3 text-center text-sm font-medium w-20">
                    {/* Icons column */}
                  </th>
                  <th className="px-4 py-3 text-left text-sm font-medium">
                    Expiration
                  </th>
                  <th className="px-4 py-3 text-left text-sm font-medium">
                    Common Name (CN)
                  </th>
                  <th className="px-4 py-3 text-left text-sm font-medium">
                    Subject Alternative Names
                  </th>
                  <th className="px-4 py-3 text-left text-sm font-medium">
                    Issuing CA
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {filteredCertificates.length === 0 ? (
                  <tr>
                    <td
                      colSpan={5}
                      className="px-4 py-8 text-center text-muted-foreground"
                    >
                      {searchTerm || selectedCA || selectedStatus || selectedType ? 'No certificates match your filters' : 'No certificates found'}
                    </td>
                  </tr>
                ) : (
                  filteredCertificates.map((cert) => {
                    // Extract CN from Subject DN
                    const cnMatch = cert.subjectDn.match(/CN=([^,]+)/);
                    const commonName = cnMatch ? cnMatch[1] : cert.subjectDn;

                    // Parse SANs
                    const sanDns = cert.sanDns ? JSON.parse(cert.sanDns) : [];
                    const sanIp = cert.sanIp ? JSON.parse(cert.sanIp) : [];
                    const sanEmail = cert.sanEmail ? JSON.parse(cert.sanEmail) : [];
                    const allSans = [...sanDns, ...sanIp, ...sanEmail];
                    const sanDisplay = allSans.length > 0
                      ? allSans.slice(0, 2).join(', ') + (allSans.length > 2 ? ` +${allSans.length - 2}` : '')
                      : 'None';

                    // Calculate expiration
                    const daysUntilExpiry = Math.ceil((new Date(cert.notAfter).getTime() - Date.now()) / (1000 * 60 * 60 * 24));
                    const isExpiringSoon = daysUntilExpiry <= 30 && daysUntilExpiry > 0;
                    const isExpired = daysUntilExpiry <= 0;

                    // Extract CA CN
                    const caCnMatch = cert.issuingCA?.subjectDn.match(/CN=([^,]+)/);
                    const caCN = caCnMatch ? caCnMatch[1] : cert.issuingCA?.subjectDn || 'Unknown';

                    // Get certificate type icon
                    const typeInfo = getCertificateTypeIcon(cert.certificateType);
                    const TypeIcon = typeInfo.icon;

                    // Status icon
                    const StatusIcon = cert.status === 'active' ? CheckCircle : XCircle;
                    const statusColor = cert.status === 'active' ? 'text-green-600' : 'text-red-600';

                    return (
                      <tr
                        key={cert.id}
                        className="hover:bg-muted/50 cursor-pointer"
                        onClick={() => navigate({ to: `/certificates/${cert.id}` })}
                      >
                        {/* Icons column */}
                        <td className="px-4 py-3">
                          <div className="flex items-center justify-center gap-2">
                            <span title={cert.status === 'active' ? 'Active' : 'Revoked'}>
                              <StatusIcon
                                className={`h-4 w-4 ${statusColor}`}
                              />
                            </span>
                            <span title={typeInfo.label}>
                              <TypeIcon
                                className="h-4 w-4 text-muted-foreground"
                              />
                            </span>
                          </div>
                        </td>
                        {/* Expiration column */}
                        <td className="px-4 py-3">
                          <div className="text-sm">{new Date(cert.notAfter).toLocaleDateString()}</div>
                          {cert.status === 'active' && (
                            <div className={`text-xs font-medium ${
                              isExpired ? 'text-red-600' : isExpiringSoon ? 'text-orange-600' : 'text-green-600'
                            }`}>
                              {isExpired ? 'Expired' : isExpiringSoon ? `${daysUntilExpiry} days left` : `${daysUntilExpiry} days`}
                            </div>
                          )}
                        </td>
                        {/* Common Name column */}
                        <td className="px-4 py-3">
                          <div className="text-sm font-medium">{commonName}</div>
                          <div className="text-xs text-muted-foreground font-mono truncate max-w-xs">{cert.subjectDn}</div>
                        </td>
                        {/* SANs column */}
                        <td className="px-4 py-3">
                          <div className="text-xs font-mono text-muted-foreground max-w-xs truncate">
                            {sanDisplay}
                          </div>
                        </td>
                        {/* Issuing CA column */}
                        <td className="px-4 py-3">
                          <div
                            className="text-xs font-medium text-primary hover:underline max-w-xs truncate"
                            onClick={(e) => {
                              e.stopPropagation();
                              navigate({ to: `/cas/${cert.issuingCA?.id}` });
                            }}
                          >
                            {caCN}
                          </div>
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
