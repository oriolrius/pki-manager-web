import { createFileRoute, useNavigate, Outlet, useMatchRoute } from '@tanstack/react-router';
import { trpc } from '@/lib/trpc';
import { Search, CheckCircle, XCircle, Server, User, Mail, FileCode, Award, Download, RefreshCw, Trash2, AlertCircle } from 'lucide-react';
import { useState, useEffect, useMemo } from 'react';

export const Route = createFileRoute('/certificates')({
  component: Certificates,
});

const CA_FILTER_STORAGE_KEY = 'pki-manager-ca-filter';
const STATUS_FILTER_STORAGE_KEY = 'pki-manager-status-filter';
const TYPE_FILTER_STORAGE_KEY = 'pki-manager-type-filter';

const DOWNLOAD_FORMATS = [
  { value: 'pem', label: 'PEM - Certificate only (ASCII)', requiresPassword: false, hasPrivateKey: false },
  { value: 'crt', label: 'CRT - Certificate only (ASCII)', requiresPassword: false, hasPrivateKey: false },
  { value: 'der', label: 'DER - Certificate only (Binary)', requiresPassword: false, hasPrivateKey: false },
  { value: 'cer', label: 'CER - Certificate only (Binary, Windows)', requiresPassword: false, hasPrivateKey: false },
  { value: 'pem-chain', label: 'PEM Chain - Certificate + CA Chain', requiresPassword: false, hasPrivateKey: false },
  { value: 'pem-key', label: 'PEM with Private Key - ZIP with .pem + .priv files', requiresPassword: false, hasPrivateKey: true, supportsOptionalEncryption: true },
  { value: 'pkcs7', label: 'PKCS#7 - Certificate + CA Chain', requiresPassword: false, hasPrivateKey: false },
  { value: 'p7b', label: 'P7B - Certificate + CA Chain', requiresPassword: false, hasPrivateKey: false },
  { value: 'pkcs12', label: 'PKCS#12 - Certificate + CA + Private Key', requiresPassword: false, hasPrivateKey: true, supportsOptionalEncryption: true },
  { value: 'pfx', label: 'PFX - Certificate + CA + Private Key', requiresPassword: false, hasPrivateKey: true, supportsOptionalEncryption: true },
  { value: 'p12', label: 'P12 - Certificate + CA + Private Key', requiresPassword: false, hasPrivateKey: true, supportsOptionalEncryption: true },
  { value: 'jks', label: 'JKS - Java KeyStore (converted from PKCS#12)', requiresPassword: false, hasPrivateKey: true, supportsOptionalEncryption: true },
  { value: 'all', label: 'All Formats - All formats in one ZIP', requiresPassword: false, hasPrivateKey: true, supportsOptionalEncryption: true },
] as const;

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
  const [selectedCertificates, setSelectedCertificates] = useState<Set<string>>(new Set());
  const [showConfirmDialog, setShowConfirmDialog] = useState(false);
  const [confirmAction, setConfirmAction] = useState<{
    type: 'revoke' | 'renew' | 'delete';
    callback: () => void;
  } | null>(null);
  const [showBulkDownloadDialog, setShowBulkDownloadDialog] = useState(false);
  const [bulkDownloadFormat, setBulkDownloadFormat] = useState<string>('pem');
  const [bulkDownloadPassword, setBulkDownloadPassword] = useState('');
  const [bulkEncryptPrivateKey, setBulkEncryptPrivateKey] = useState(true);
  const [showBulkPrivateKeyWarning, setShowBulkPrivateKeyWarning] = useState(false);

  const certificatesQuery = trpc.certificate.list.useQuery({
    limit: 50,
    offset: 0,
  });

  // Fetch CAs list for lookup
  const casQuery = trpc.ca.list.useQuery({});

  // Create CA lookup map
  const caLookup = useMemo(() => {
    if (!casQuery.data) return new Map();
    const map = new Map();
    casQuery.data.forEach(ca => {
      const cnMatch = ca.subject.match(/CN=([^,]+)/);
      const cn = cnMatch ? cnMatch[1] : ca.subject;
      map.set(ca.id, { id: ca.id, cn, subject: ca.subject });
    });
    return map;
  }, [casQuery.data]);

  // Bulk operation mutations
  const utils = trpc.useUtils();
  const bulkRevoke = trpc.certificate.bulkRevoke.useMutation({
    onSuccess: () => {
      utils.certificate.list.invalidate();
      setSelectedCertificates(new Set());
    },
  });
  const bulkRenew = trpc.certificate.bulkRenew.useMutation({
    onSuccess: () => {
      utils.certificate.list.invalidate();
      setSelectedCertificates(new Set());
    },
  });
  const bulkDelete = trpc.certificate.bulkDelete.useMutation({
    onSuccess: () => {
      utils.certificate.list.invalidate();
      setSelectedCertificates(new Set());
    },
  });
  const bulkDownload = trpc.certificate.bulkDownload.useQuery(
    {
      certificateIds: Array.from(selectedCertificates),
      format: bulkDownloadFormat as any,
      password: bulkDownloadPassword || undefined,
      encryptPrivateKey: bulkEncryptPrivateKey,
    },
    { enabled: false }
  );

  // Handlers for bulk operations
  const handleBulkRevoke = () => {
    setConfirmAction({
      type: 'revoke',
      callback: () => {
        bulkRevoke.mutate({
          certificateIds: Array.from(selectedCertificates),
          reason: 'unspecified',
        });
        setShowConfirmDialog(false);
      },
    });
    setShowConfirmDialog(true);
  };

  const handleBulkRenew = () => {
    setConfirmAction({
      type: 'renew',
      callback: () => {
        bulkRenew.mutate({
          certificateIds: Array.from(selectedCertificates),
          generateNewKey: true,
        });
        setShowConfirmDialog(false);
      },
    });
    setShowConfirmDialog(true);
  };

  const handleBulkDelete = () => {
    setConfirmAction({
      type: 'delete',
      callback: () => {
        bulkDelete.mutate({
          certificateIds: Array.from(selectedCertificates),
          destroyKey: true,
        });
        setShowConfirmDialog(false);
      },
    });
    setShowConfirmDialog(true);
  };

  const handleBulkDownload = () => {
    setShowBulkDownloadDialog(true);
  };

  const confirmBulkDownload = async () => {
    const selectedFormat = DOWNLOAD_FORMATS.find(f => f.value === bulkDownloadFormat);

    // Validate password only if encryption is enabled for formats with private keys
    if (selectedFormat?.hasPrivateKey && bulkEncryptPrivateKey && !bulkDownloadPassword) {
      alert('Password is required when private key encryption is enabled');
      return;
    }

    if (selectedFormat?.hasPrivateKey && bulkEncryptPrivateKey && bulkDownloadPassword.length < 8) {
      alert('Password must be at least 8 characters long');
      return;
    }

    // Show warning for private key exports
    if (selectedFormat?.hasPrivateKey && !showBulkPrivateKeyWarning) {
      setShowBulkPrivateKeyWarning(true);
      return;
    }

    try {
      const result = await bulkDownload.refetch();
      if (result.data) {
        const link = document.createElement('a');
        link.href = `data:${result.data.mimeType};base64,${result.data.data}`;
        link.download = result.data.filename;
        link.click();
      }

      // Reset dialog state
      setShowBulkDownloadDialog(false);
      setBulkDownloadFormat('pem');
      setBulkDownloadPassword('');
      setBulkEncryptPrivateKey(true);
      setShowBulkPrivateKeyWarning(false);
    } catch (error: any) {
      alert(`Failed to download certificates: ${error.message}`);
    }
  };

  const toggleSelectAll = () => {
    if (selectedCertificates.size === filteredCertificates.length) {
      setSelectedCertificates(new Set());
    } else {
      setSelectedCertificates(new Set(filteredCertificates.map(c => c.id)));
    }
  };

  const toggleSelect = (id: string) => {
    const newSelected = new Set(selectedCertificates);
    if (newSelected.has(id)) {
      newSelected.delete(id);
    } else {
      newSelected.add(id);
    }
    setSelectedCertificates(newSelected);
  };

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
    if (!certificatesQuery.data?.items || !caLookup.size) return [];

    const caMap = new Map<string, { id: string; cn: string }>();
    certificatesQuery.data.items.forEach(cert => {
      const ca = caLookup.get(cert.caId);
      if (ca && !caMap.has(ca.id)) {
        caMap.set(ca.id, { id: ca.id, cn: ca.cn });
      }
    });

    return Array.from(caMap.values()).sort((a, b) => a.cn.localeCompare(b.cn));
  }, [certificatesQuery.data, caLookup]);

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
    if (selectedCA && cert.caId !== selectedCA) {
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

    // SANs are already arrays from backend, use them directly
    const sanDns = cert.sanDns || [];
    const sanIp = cert.sanIp || [];
    const sanEmail = cert.sanEmail || [];
    const allSans = [...sanDns, ...sanIp, ...sanEmail];

    return allSans.some(san => san.toLowerCase().includes(searchLower));
  }) || [];

  return (
    <div className="space-y-4">
      <style>{`
        @keyframes filterPulse {
          0%, 100% { box-shadow: 0 0 0 0 rgba(249, 115, 22, 0.4); }
          50% { box-shadow: 0 0 0 4px rgba(249, 115, 22, 0.2); }
        }
        .filter-active {
          animation: filterPulse 3s ease-in-out infinite;
          border-radius: 0.375rem;
          background: rgba(249, 115, 22, 0.05);
        }
      `}</style>

      {/* Bulk Action Bar */}
      {selectedCertificates.size > 0 && (
        <div className="bg-primary/10 border border-primary/20 rounded-lg p-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="font-medium text-foreground">
              {selectedCertificates.size} certificate{selectedCertificates.size !== 1 ? 's' : ''} selected
            </span>
          </div>
          <div className="flex gap-2">
            <button
              onClick={handleBulkDownload}
              disabled={bulkDownload.isFetching}
              className="px-3 py-1.5 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 disabled:opacity-50 flex items-center gap-1 text-sm"
            >
              <Download className="h-4 w-4" />
              Download
            </button>
            <button
              onClick={handleBulkRenew}
              disabled={bulkRenew.isPending}
              className="px-3 py-1.5 bg-green-600 text-white rounded-md hover:bg-green-700 disabled:opacity-50 flex items-center gap-1 text-sm"
            >
              <RefreshCw className="h-4 w-4" />
              Renew
            </button>
            <button
              onClick={handleBulkRevoke}
              disabled={bulkRevoke.isPending}
              className="px-3 py-1.5 bg-orange-600 text-white rounded-md hover:bg-orange-700 disabled:opacity-50 flex items-center gap-1 text-sm"
            >
              <XCircle className="h-4 w-4" />
              Revoke
            </button>
            <button
              onClick={handleBulkDelete}
              disabled={bulkDelete.isPending}
              className="px-3 py-1.5 bg-red-600 text-white rounded-md hover:bg-red-700 disabled:opacity-50 flex items-center gap-1 text-sm"
            >
              <Trash2 className="h-4 w-4" />
              Delete
            </button>
          </div>
        </div>
      )}

      {/* Bulk Download Dialog */}
      {showBulkDownloadDialog && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-card border rounded-lg p-6 max-w-md w-full mx-4 shadow-lg">
            <h2 className="text-xl font-bold mb-4">Download {selectedCertificates.size} Certificate{selectedCertificates.size !== 1 ? 's' : ''}</h2>

            {showBulkPrivateKeyWarning ? (
              <div className="space-y-4">
                <div className="p-4 bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-md">
                  <h3 className="font-semibold text-yellow-900 dark:text-yellow-200 mb-2 flex items-center gap-2">
                    ⚠️ Security Warning
                  </h3>
                  <p className="text-sm text-yellow-800 dark:text-yellow-300">
                    This format includes <strong>private keys</strong>. Keep these files secure and never share them publicly.
                    Anyone with access to these files and the password can impersonate these certificates.
                  </p>
                </div>
                <div className="flex gap-3">
                  <button
                    onClick={() => setShowBulkPrivateKeyWarning(false)}
                    className="flex-1 px-4 py-2 border rounded-md hover:bg-muted font-medium"
                  >
                    Go Back
                  </button>
                  <button
                    onClick={confirmBulkDownload}
                    className="flex-1 px-4 py-2 bg-yellow-600 text-white rounded-md hover:bg-yellow-700 font-medium shadow-sm"
                  >
                    I Understand, Download
                  </button>
                </div>
              </div>
            ) : (
              <>
                <div className="space-y-4">
                  <div>
                    <label htmlFor="bulk-format" className="block text-sm font-medium mb-2">
                      Format
                    </label>
                    <select
                      id="bulk-format"
                      value={bulkDownloadFormat}
                      onChange={(e) => setBulkDownloadFormat(e.target.value)}
                      className="w-full px-3 py-2 border rounded-md bg-background"
                    >
                      {DOWNLOAD_FORMATS.map((format) => (
                        <option key={format.value} value={format.value}>
                          {format.label}
                        </option>
                      ))}
                    </select>
                  </div>

                  {DOWNLOAD_FORMATS.find(f => f.value === bulkDownloadFormat)?.hasPrivateKey && (
                    <div className="space-y-3">
                      <div className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          id="bulk-encryptKey"
                          checked={bulkEncryptPrivateKey}
                          onChange={(e) => setBulkEncryptPrivateKey(e.target.checked)}
                          className="w-4 h-4 rounded border-gray-300"
                        />
                        <label htmlFor="bulk-encryptKey" className="text-sm font-medium cursor-pointer">
                          Encrypt private keys with password
                        </label>
                      </div>

                      {bulkEncryptPrivateKey && (
                        <div>
                          <label htmlFor="bulk-password" className="block text-sm font-medium mb-2">
                            Password <span className="text-red-500">*</span>
                          </label>
                          <input
                            type="password"
                            id="bulk-password"
                            value={bulkDownloadPassword}
                            onChange={(e) => setBulkDownloadPassword(e.target.value)}
                            className="w-full px-3 py-2 border rounded-md bg-background"
                            placeholder="Minimum 8 characters"
                            minLength={8}
                          />
                          <p className="text-xs text-muted-foreground mt-1">
                            This password will protect the private keys
                          </p>
                        </div>
                      )}

                      {!bulkEncryptPrivateKey && (
                        <div className="p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-md">
                          <p className="text-xs text-red-800 dark:text-red-300">
                            <strong>⚠️ Warning:</strong> Private keys will be exported <strong>unencrypted</strong>. Anyone with access to these files can use the certificates.
                          </p>
                        </div>
                      )}
                    </div>
                  )}

                  {bulkDownloadFormat === 'all' && (
                    <div className="p-3 bg-purple-50 dark:bg-purple-900/20 border border-purple-200 dark:border-purple-800 rounded-md">
                      <p className="text-xs text-purple-800 dark:text-purple-300">
                        <strong>All Formats:</strong> Each certificate will be exported in all available formats and organized in separate folders within the ZIP file.
                      </p>
                    </div>
                  )}
                </div>

                <div className="flex gap-3 mt-6">
                  <button
                    onClick={() => {
                      setShowBulkDownloadDialog(false);
                      setBulkDownloadFormat('pem');
                      setBulkDownloadPassword('');
                      setBulkEncryptPrivateKey(true);
                      setShowBulkPrivateKeyWarning(false);
                    }}
                    className="flex-1 px-4 py-2 border rounded-md hover:bg-muted font-medium"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={confirmBulkDownload}
                    disabled={bulkDownload.isFetching}
                    className="flex-1 px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 font-medium shadow-sm disabled:opacity-50"
                  >
                    {bulkDownload.isFetching ? 'Downloading...' : 'Download'}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* Confirmation Dialog */}
      {showConfirmDialog && confirmAction && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 max-w-md w-full mx-4">
            <div className="flex items-start gap-3 mb-4">
              <AlertCircle className="h-6 w-6 text-orange-600 flex-shrink-0 mt-0.5" />
              <div>
                <h3 className="font-semibold text-lg mb-2">
                  Confirm Bulk {confirmAction.type.charAt(0).toUpperCase() + confirmAction.type.slice(1)}
                </h3>
                <p className="text-sm text-gray-600">
                  Are you sure you want to {confirmAction.type} {selectedCertificates.size} certificate
                  {selectedCertificates.size !== 1 ? 's' : ''}? This action cannot be undone.
                </p>
              </div>
            </div>
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => setShowConfirmDialog(false)}
                className="px-4 py-2 border rounded-md hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                onClick={confirmAction.callback}
                className="px-4 py-2 bg-red-600 text-white rounded-md hover:bg-red-700"
              >
                Confirm
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="flex items-center gap-4 flex-wrap">
        <div className={`relative flex-1 max-w-md ${searchTerm ? 'filter-active' : ''}`}>
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
          className={`px-4 py-2 border rounded-md bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-primary min-w-[180px] ${selectedCA ? 'filter-active' : ''}`}
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
          className={`px-4 py-2 border rounded-md bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-primary min-w-[140px] ${selectedStatus ? 'filter-active' : ''}`}
        >
          <option value="">All Status</option>
          <option value="active">Active</option>
          <option value="revoked">Revoked</option>
          <option value="expired">Expired</option>
        </select>
        <select
          value={selectedType}
          onChange={(e) => setSelectedType(e.target.value)}
          className={`px-4 py-2 border rounded-md bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-primary min-w-[150px] ${selectedType ? 'filter-active' : ''}`}
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
                  <th className="px-4 py-3 text-center w-12">
                    <input
                      type="checkbox"
                      checked={selectedCertificates.size === filteredCertificates.length && filteredCertificates.length > 0}
                      onChange={toggleSelectAll}
                      className="rounded border-gray-300"
                    />
                  </th>
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
                      colSpan={6}
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

                    // SANs are already parsed by backend, just use them directly
                    const sanDns = cert.sanDns || [];
                    const sanIp = cert.sanIp || [];
                    const sanEmail = cert.sanEmail || [];
                    const allSans = [...sanDns, ...sanIp, ...sanEmail];
                    const sanDisplay = allSans.length > 0
                      ? allSans.slice(0, 2).join(', ') + (allSans.length > 2 ? ` +${allSans.length - 2}` : '')
                      : 'None';

                    // Calculate expiration
                    const daysUntilExpiry = Math.ceil((new Date(cert.notAfter).getTime() - Date.now()) / (1000 * 60 * 60 * 24));
                    const isExpiringSoon = daysUntilExpiry <= 30 && daysUntilExpiry > 0;
                    const isExpired = daysUntilExpiry <= 0;

                    // Extract CA CN from lookup
                    const ca = caLookup.get(cert.caId);
                    const caCN = ca?.cn || 'Unknown';

                    // Get certificate type icon
                    const typeInfo = getCertificateTypeIcon(cert.certificateType);
                    const TypeIcon = typeInfo.icon;

                    // Status icon
                    const StatusIcon = cert.status === 'active' ? CheckCircle : XCircle;
                    const statusColor = cert.status === 'active' ? 'text-green-600' : 'text-red-600';

                    return (
                      <tr
                        key={cert.id}
                        className="hover:bg-muted/50"
                      >
                        {/* Checkbox column */}
                        <td className="px-4 py-3 text-center" onClick={(e) => e.stopPropagation()}>
                          <input
                            type="checkbox"
                            checked={selectedCertificates.has(cert.id)}
                            onChange={() => toggleSelect(cert.id)}
                            className="rounded border-gray-300"
                          />
                        </td>
                        {/* Icons column */}
                        <td className="px-4 py-3 cursor-pointer" onClick={() => navigate({ to: `/certificates/${cert.id}` })}>
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
                        <td className="px-4 py-3 cursor-pointer" onClick={() => navigate({ to: `/certificates/${cert.id}` })}>
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
                        <td className="px-4 py-3 cursor-pointer" onClick={() => navigate({ to: `/certificates/${cert.id}` })}>
                          <div className="text-sm font-medium">{commonName}</div>
                          <div className="text-xs text-muted-foreground font-mono truncate max-w-xs">{cert.subjectDn}</div>
                        </td>
                        {/* SANs column */}
                        <td className="px-4 py-3 cursor-pointer" onClick={() => navigate({ to: `/certificates/${cert.id}` })}>
                          <div className="text-xs font-mono text-muted-foreground max-w-xs truncate">
                            {sanDisplay}
                          </div>
                        </td>
                        {/* Issuing CA column */}
                        <td className="px-4 py-3 cursor-pointer">
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
