import { createFileRoute, useNavigate, Outlet, useMatchRoute } from '@tanstack/react-router';
import { trpc } from '@/lib/trpc';
import { Search, CheckCircle, XCircle, Server, User, Mail, FileCode, Award, Download, RefreshCw, Trash2, AlertCircle, Copy, Check } from 'lucide-react';
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
  { value: 'jks-keystore', label: 'JKS Keystore - Certificate + Private Key (for server identity)', requiresPassword: false, hasPrivateKey: true, supportsOptionalEncryption: true },
  { value: 'jks-truststore', label: 'JKS Truststore - CA Certificates only (for trust validation)', requiresPassword: true, hasPrivateKey: false },
  { value: 'docker-volume', label: 'Docker Volume - TAR for Docker volume import', requiresPassword: false, hasPrivateKey: true, supportsOptionalEncryption: true },
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
  const [showJksInfoPopup, setShowJksInfoPopup] = useState(false);
  const [downloadedJksFilename, setDownloadedJksFilename] = useState('');
  const [downloadedJksType, setDownloadedJksType] = useState<'keystore' | 'truststore'>('keystore');
  const [showDockerVolumeInfoPopup, setShowDockerVolumeInfoPopup] = useState(false);
  const [downloadedDockerVolumeFilename, setDownloadedDockerVolumeFilename] = useState('');
  const [showProgressDialog, setShowProgressDialog] = useState(false);
  const [progressSteps, setProgressSteps] = useState<{ step: string; status: 'pending' | 'active' | 'done' }[]>([]);
  const [progressTitle, setProgressTitle] = useState('');
  const [copiedCommand, setCopiedCommand] = useState<string | null>(null);

  // Bulk operation progress state
  const [bulkOperationProgress, setBulkOperationProgress] = useState<{
    isOpen: boolean;
    operation: 'revoke' | 'renew' | 'delete';
    title: string;
    items: Array<{
      id: string;
      label: string;
      status: 'pending' | 'processing' | 'success' | 'error';
      error?: string;
    }>;
    isComplete: boolean;
  } | null>(null);

  const copyToClipboard = async (text: string, commandId: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedCommand(commandId);
      setTimeout(() => setCopiedCommand(null), 2000);
    } catch {
      // Fallback for older browsers
      const textArea = document.createElement('textarea');
      textArea.value = text;
      document.body.appendChild(textArea);
      textArea.select();
      document.execCommand('copy');
      document.body.removeChild(textArea);
      setCopiedCommand(commandId);
      setTimeout(() => setCopiedCommand(null), 2000);
    }
  };

  // Helper function to extract CN from subjectDn
  const extractCN = (subjectDn: string): string => {
    const match = subjectDn.match(/CN=([^,]+)/);
    return match?.[1] || subjectDn;
  };

  // Helper to build progress items from selected certificates
  const buildProgressItems = (certIds: string[], certificates: typeof filteredCertificates) => {
    return certIds.map(id => {
      const cert = certificates.find(c => c.id === id);
      return {
        id,
        label: cert ? extractCN(cert.subjectDn) : id.slice(0, 8),
        status: 'pending' as const,
      };
    });
  };

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
    onSuccess: (data) => {
      // Update progress with results
      setBulkOperationProgress(prev => prev ? {
        ...prev,
        isComplete: true,
        items: prev.items.map(item => {
          const result = data.results.find(r => r.certificateId === item.id);
          return {
            ...item,
            status: result?.success ? 'success' : 'error',
            error: result?.error,
          };
        }),
      } : null);
      utils.certificate.list.invalidate();
      setSelectedCertificates(new Set());
    },
    onError: (error) => {
      setBulkOperationProgress(prev => prev ? {
        ...prev,
        isComplete: true,
        items: prev.items.map(i => ({ ...i, status: 'error' as const, error: error.message })),
      } : null);
    },
  });
  const bulkRenew = trpc.certificate.bulkRenew.useMutation({
    onSuccess: (data) => {
      // Update progress with results
      setBulkOperationProgress(prev => prev ? {
        ...prev,
        isComplete: true,
        items: prev.items.map(item => {
          const result = data.results.find(r => r.originalCertificateId === item.id);
          return {
            ...item,
            status: result?.success ? 'success' : 'error',
            error: result?.error,
          };
        }),
      } : null);
      utils.certificate.list.invalidate();
      setSelectedCertificates(new Set());
    },
    onError: (error) => {
      setBulkOperationProgress(prev => prev ? {
        ...prev,
        isComplete: true,
        items: prev.items.map(i => ({ ...i, status: 'error' as const, error: error.message })),
      } : null);
    },
  });
  const bulkDelete = trpc.certificate.bulkDelete.useMutation({
    onSuccess: (data) => {
      // Update progress with results
      setBulkOperationProgress(prev => prev ? {
        ...prev,
        isComplete: true,
        items: prev.items.map(item => {
          const result = data.results.find(r => r.certificateId === item.id);
          return {
            ...item,
            status: result?.success ? 'success' : 'error',
            error: result?.error,
          };
        }),
      } : null);
      utils.certificate.list.invalidate();
      setSelectedCertificates(new Set());
    },
    onError: (error) => {
      setBulkOperationProgress(prev => prev ? {
        ...prev,
        isComplete: true,
        items: prev.items.map(i => ({ ...i, status: 'error' as const, error: error.message })),
      } : null);
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
        setShowConfirmDialog(false);
        // Initialize progress with all items as "processing" (batch mode)
        const certIds = Array.from(selectedCertificates);
        const items = buildProgressItems(certIds, filteredCertificates);
        setBulkOperationProgress({
          isOpen: true,
          operation: 'revoke',
          title: 'Revoking Certificates',
          items: items.map(i => ({ ...i, status: 'processing' })),
          isComplete: false,
        });
        bulkRevoke.mutate({
          certificateIds: certIds,
          reason: 'unspecified',
        });
      },
    });
    setShowConfirmDialog(true);
  };

  const handleBulkRenew = () => {
    setConfirmAction({
      type: 'renew',
      callback: () => {
        setShowConfirmDialog(false);
        // Initialize progress with all items as "processing" (batch mode)
        const certIds = Array.from(selectedCertificates);
        const items = buildProgressItems(certIds, filteredCertificates);
        setBulkOperationProgress({
          isOpen: true,
          operation: 'renew',
          title: 'Renewing Certificates',
          items: items.map(i => ({ ...i, status: 'processing' })),
          isComplete: false,
        });
        bulkRenew.mutate({
          certificateIds: certIds,
          generateNewKey: true,
          revokeOriginal: true,
        });
      },
    });
    setShowConfirmDialog(true);
  };

  const handleBulkDelete = () => {
    setConfirmAction({
      type: 'delete',
      callback: () => {
        setShowConfirmDialog(false);
        // Initialize progress with all items as "processing" (batch mode)
        const certIds = Array.from(selectedCertificates);
        const items = buildProgressItems(certIds, filteredCertificates);
        setBulkOperationProgress({
          isOpen: true,
          operation: 'delete',
          title: 'Deleting Certificates',
          items: items.map(i => ({ ...i, status: 'processing' })),
          isComplete: false,
        });
        bulkDelete.mutate({
          certificateIds: certIds,
          destroyKey: true,
        });
      },
    });
    setShowConfirmDialog(true);
  };

  const handleBulkDownload = () => {
    setShowBulkDownloadDialog(true);
  };

  const confirmBulkDownload = async () => {
    const selectedFormat = DOWNLOAD_FORMATS.find(f => f.value === bulkDownloadFormat);

    // Validate password for formats that always require it (like jks-truststore)
    if (selectedFormat?.requiresPassword && !bulkDownloadPassword) {
      alert('Password is required for this format');
      return;
    }

    if (selectedFormat?.requiresPassword && bulkDownloadPassword.length < 8) {
      alert('Password must be at least 8 characters long');
      return;
    }

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

    const isJksKeystoreFormat = bulkDownloadFormat === 'jks-keystore';
    const isJksTruststoreFormat = bulkDownloadFormat === 'jks-truststore';
    const isJksFormat = isJksKeystoreFormat || isJksTruststoreFormat;
    const isDockerVolumeFormat = bulkDownloadFormat === 'docker-volume';
    const certCount = selectedCertificates.size;

    // Show progress dialog for JKS Keystore format
    if (isJksKeystoreFormat) {
      setShowBulkDownloadDialog(false);
      setShowBulkPrivateKeyWarning(false);
      setProgressTitle('Generating Java KeyStore');
      setProgressSteps([
        { step: 'Creating Java KeyStore file', status: 'active' },
        { step: `Exporting ${certCount} certificate(s) with private keys from KMS`, status: 'pending' },
        { step: 'Building keystore with keytool', status: 'pending' },
        { step: 'Preparing download', status: 'pending' },
      ]);
      setShowProgressDialog(true);
    }

    // Show progress dialog for JKS Truststore format
    if (isJksTruststoreFormat) {
      setShowBulkDownloadDialog(false);
      setShowBulkPrivateKeyWarning(false);
      setProgressTitle('Generating Java TrustStore');
      setProgressSteps([
        { step: 'Creating Java TrustStore file', status: 'active' },
        { step: 'Collecting CA certificates', status: 'pending' },
        { step: 'Adding CA certificates as trusted entries', status: 'pending' },
        { step: 'Preparing download', status: 'pending' },
      ]);
      setShowProgressDialog(true);
    }

    // Show progress dialog for Docker Volume format
    if (isDockerVolumeFormat) {
      setShowBulkDownloadDialog(false);
      setShowBulkPrivateKeyWarning(false);
      setProgressTitle('Creating Docker Volume TAR');
      setProgressSteps([
        { step: 'Creating TAR archive', status: 'active' },
        { step: `Exporting ${certCount} certificate(s) with private keys from KMS`, status: 'pending' },
        { step: 'Collecting CA certificates for chain', status: 'pending' },
        { step: 'Building Docker volume structure', status: 'pending' },
        { step: 'Preparing download', status: 'pending' },
      ]);
      setShowProgressDialog(true);
    }

    try {
      // Simulate progress updates for JKS or Docker Volume
      if (isJksFormat || isDockerVolumeFormat) {
        // Step 1 is already active
        await new Promise(r => setTimeout(r, 300));
        setProgressSteps(prev => prev.map((s, i) =>
          i === 0 ? { ...s, status: 'done' } :
          i === 1 ? { ...s, status: 'active' } : s
        ));
      }

      const result = await bulkDownload.refetch();

      if (isJksFormat || isDockerVolumeFormat) {
        // Mark remaining steps as done
        setProgressSteps(prev => prev.map(s => ({ ...s, status: 'done' as const })));
        await new Promise(r => setTimeout(r, 500));
      }

      if (result.data) {
        const link = document.createElement('a');
        link.href = `data:${result.data.mimeType};base64,${result.data.data}`;
        link.download = result.data.filename;
        link.click();

        // Store filename for info popup
        const downloadedFilename = result.data.filename;

        // Reset dialog state
        setShowProgressDialog(false);
        setBulkDownloadFormat('pem');
        setBulkDownloadPassword('');
        setBulkEncryptPrivateKey(true);

        // Show JKS info popup after download
        if (isJksKeystoreFormat) {
          setDownloadedJksFilename(downloadedFilename);
          setDownloadedJksType('keystore');
          setShowJksInfoPopup(true);
        } else if (isJksTruststoreFormat) {
          setDownloadedJksFilename(downloadedFilename);
          setDownloadedJksType('truststore');
          setShowJksInfoPopup(true);
        }

        // Show Docker Volume info popup after download
        if (isDockerVolumeFormat) {
          setDownloadedDockerVolumeFilename(downloadedFilename);
          setShowDockerVolumeInfoPopup(true);
        }
      } else {
        // Reset dialog state even if no result
        setShowProgressDialog(false);
        setShowBulkDownloadDialog(false);
        setBulkDownloadFormat('pem');
        setBulkDownloadPassword('');
        setBulkEncryptPrivateKey(true);
        setShowBulkPrivateKeyWarning(false);
      }
    } catch (error: any) {
      setShowProgressDialog(false);
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

                  {/* JKS Truststore password field (always required) */}
                  {bulkDownloadFormat === 'jks-truststore' && (
                    <div className="space-y-3">
                      <div>
                        <label htmlFor="bulk-truststore-password" className="block text-sm font-medium mb-2">
                          Truststore Password <span className="text-red-500">*</span>
                        </label>
                        <input
                          type="password"
                          id="bulk-truststore-password"
                          value={bulkDownloadPassword}
                          onChange={(e) => setBulkDownloadPassword(e.target.value)}
                          className="w-full px-3 py-2 border rounded-md bg-background"
                          placeholder="Minimum 8 characters"
                          minLength={8}
                        />
                        <p className="text-xs text-muted-foreground mt-1">
                          This password protects the JKS truststore file integrity
                        </p>
                      </div>
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

      {/* Progress Dialog (JKS / Docker Volume) */}
      {showProgressDialog && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-card border rounded-lg p-6 max-w-md w-full mx-4 shadow-lg">
            <h2 className="text-lg font-bold mb-4 flex items-center gap-2">
              <RefreshCw className="h-5 w-5 animate-spin text-primary" />
              {progressTitle}
            </h2>
            <div className="space-y-3">
              {progressSteps.map((step, index) => (
                <div key={index} className="flex items-center gap-3">
                  {step.status === 'done' ? (
                    <CheckCircle className="h-5 w-5 text-green-600 flex-shrink-0" />
                  ) : step.status === 'active' ? (
                    <div className="h-5 w-5 flex-shrink-0">
                      <div className="h-4 w-4 border-2 border-primary border-t-transparent rounded-full animate-spin" />
                    </div>
                  ) : (
                    <div className="h-5 w-5 flex-shrink-0 rounded-full border-2 border-muted" />
                  )}
                  <span className={`text-sm ${step.status === 'pending' ? 'text-muted-foreground' : step.status === 'done' ? 'text-muted-foreground' : 'text-foreground font-medium'}`}>
                    {step.step}
                  </span>
                </div>
              ))}
            </div>
            <div className="mt-6 pt-4 border-t">
              <div className="h-2 bg-muted rounded-full overflow-hidden">
                <div
                  className="h-full bg-primary transition-all duration-300"
                  style={{
                    width: `${(progressSteps.filter(s => s.status === 'done').length / progressSteps.length) * 100}%`
                  }}
                />
              </div>
              <p className="text-xs text-muted-foreground mt-2 text-center">
                {progressSteps.filter(s => s.status === 'done').length} of {progressSteps.length} steps completed
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Bulk Operation Progress Dialog */}
      {bulkOperationProgress?.isOpen && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-card border rounded-lg p-6 max-w-lg w-full mx-4 shadow-lg max-h-[80vh] flex flex-col">
            {/* Header */}
            <div className="flex items-center gap-3 mb-4">
              {!bulkOperationProgress.isComplete && (
                <RefreshCw className="h-5 w-5 animate-spin text-primary" />
              )}
              {bulkOperationProgress.isComplete && (
                <CheckCircle className="h-5 w-5 text-green-500" />
              )}
              <h3 className="text-lg font-semibold">{bulkOperationProgress.title}</h3>
            </div>

            {/* Progress Bar */}
            <div className="mb-4">
              <div className="h-2 bg-muted rounded-full overflow-hidden">
                <div
                  className="h-full bg-primary transition-all duration-300"
                  style={{
                    width: `${(bulkOperationProgress.items.filter(i =>
                      i.status === 'success' || i.status === 'error'
                    ).length / bulkOperationProgress.items.length) * 100}%`,
                  }}
                />
              </div>
              <p className="text-sm text-muted-foreground mt-1">
                {bulkOperationProgress.items.filter(i => i.status === 'success' || i.status === 'error').length} of {bulkOperationProgress.items.length} completed
              </p>
            </div>

            {/* Items List */}
            <div className="flex-1 overflow-y-auto space-y-2 mb-4 min-h-0">
              {bulkOperationProgress.items.map((item) => (
                <div
                  key={item.id}
                  className={`flex items-start gap-3 p-2 rounded-lg ${
                    item.status === 'success' ? 'bg-green-50 dark:bg-green-900/10' :
                    item.status === 'error' ? 'bg-red-50 dark:bg-red-900/10' :
                    item.status === 'processing' ? 'bg-blue-50 dark:bg-blue-900/10' :
                    'bg-muted/50'
                  }`}
                >
                  {/* Status Icon */}
                  <div className="mt-0.5">
                    {item.status === 'success' && (
                      <CheckCircle className="h-4 w-4 text-green-500" />
                    )}
                    {item.status === 'error' && (
                      <XCircle className="h-4 w-4 text-red-500" />
                    )}
                    {item.status === 'processing' && (
                      <div className="h-4 w-4 border-2 border-primary border-t-transparent rounded-full animate-spin" />
                    )}
                    {item.status === 'pending' && (
                      <div className="h-4 w-4 border-2 border-muted-foreground/30 rounded-full" />
                    )}
                  </div>
                  {/* Content */}
                  <div className="flex-1 min-w-0">
                    <p className={`text-sm truncate ${
                      item.status === 'processing' ? 'font-medium' : ''
                    }`}>
                      {item.label}
                    </p>
                    {item.error && (
                      <p className="text-xs text-red-600 dark:text-red-400 mt-0.5">
                        {item.error}
                      </p>
                    )}
                  </div>
                </div>
              ))}
            </div>

            {/* Summary & Actions */}
            {bulkOperationProgress.isComplete && (
              <div className="border-t pt-4">
                <div className="flex justify-between text-sm mb-4">
                  <span className="text-green-600 dark:text-green-400">
                    {bulkOperationProgress.items.filter(i => i.status === 'success').length} succeeded
                  </span>
                  {bulkOperationProgress.items.some(i => i.status === 'error') && (
                    <span className="text-red-600 dark:text-red-400">
                      {bulkOperationProgress.items.filter(i => i.status === 'error').length} failed
                    </span>
                  )}
                </div>
                <button
                  onClick={() => setBulkOperationProgress(null)}
                  className="w-full px-4 py-2 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90"
                >
                  Close
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* JKS Info Popup */}
      {showJksInfoPopup && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-card border rounded-lg p-6 max-w-lg w-full mx-4 shadow-lg">
            <h2 className="text-xl font-bold mb-4 flex items-center gap-2">
              <span className="text-green-600">✓</span> Java {downloadedJksType === 'keystore' ? 'KeyStore' : 'TrustStore'} Downloaded
            </h2>
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">
                Your JKS file <strong className="text-foreground">{downloadedJksFilename}</strong> has been downloaded successfully.
              </p>

              {/* Purpose explanation based on type */}
              <div className="p-3 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-md">
                <h3 className="font-semibold text-amber-900 dark:text-amber-200 mb-1">
                  {downloadedJksType === 'keystore' ? 'What is a KeyStore?' : 'What is a TrustStore?'}
                </h3>
                <p className="text-sm text-amber-800 dark:text-amber-300">
                  {downloadedJksType === 'keystore'
                    ? 'A KeyStore contains certificates with their private keys (PrivateKeyEntry). Use it when your application needs to present these certificates as its identity, such as for SSL/TLS server authentication or client certificate authentication.'
                    : 'A TrustStore contains only the CA certificates as trusted entries (TrustedCertEntry). Use it when your application needs to verify certificates signed by these CAs, such as validating client certificates or trusting a private CA.'}
                </p>
              </div>

              <div className="p-4 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-md">
                <h3 className="font-semibold text-blue-900 dark:text-blue-200 mb-2">
                  List {downloadedJksType === 'keystore' ? 'Entries' : 'Trusted Certificates'} in JKS
                </h3>
                <p className="text-sm text-blue-800 dark:text-blue-300 mb-2">
                  To view the {downloadedJksType === 'keystore' ? 'certificates and keys' : 'trusted CA certificates'} stored in your JKS file, run:
                </p>
                <div className="relative group">
                  <code className="block p-2 pr-10 bg-black/10 dark:bg-white/10 rounded text-xs font-mono overflow-x-auto whitespace-pre">
{`keytool -list -v -keystore ${downloadedJksFilename}`}
                  </code>
                  <button
                    onClick={() => copyToClipboard(`keytool -list -v -keystore ${downloadedJksFilename}`, 'list-v')}
                    className="absolute right-1 top-1 p-1.5 rounded bg-blue-200/50 dark:bg-blue-700/50 hover:bg-blue-300/70 dark:hover:bg-blue-600/70 transition-colors"
                    title="Copy to clipboard"
                  >
                    {copiedCommand === 'list-v' ? (
                      <Check className="h-3.5 w-3.5 text-green-600" />
                    ) : (
                      <Copy className="h-3.5 w-3.5 text-blue-700 dark:text-blue-300" />
                    )}
                  </button>
                </div>
                <p className="text-xs text-blue-700 dark:text-blue-400 mt-2">
                  You will be prompted for the {downloadedJksType === 'keystore' ? 'keystore' : 'truststore'} password.
                </p>
              </div>

              <div className="p-3 bg-muted/50 rounded-md">
                <h4 className="font-medium text-sm mb-2">Other Useful Commands:</h4>
                <ul className="text-xs space-y-3 text-muted-foreground">
                  <li>
                    <strong>List aliases only:</strong>
                    <div className="relative group mt-1">
                      <code className="block p-1.5 pr-10 bg-black/5 dark:bg-white/5 rounded font-mono">
                        keytool -list -keystore {downloadedJksFilename}
                      </code>
                      <button
                        onClick={() => copyToClipboard(`keytool -list -keystore ${downloadedJksFilename}`, 'list-aliases')}
                        className="absolute right-1 top-1 p-1 rounded bg-muted hover:bg-muted-foreground/20 transition-colors"
                        title="Copy to clipboard"
                      >
                        {copiedCommand === 'list-aliases' ? (
                          <Check className="h-3 w-3 text-green-600" />
                        ) : (
                          <Copy className="h-3 w-3 text-muted-foreground" />
                        )}
                      </button>
                    </div>
                  </li>
                  {downloadedJksType === 'keystore' ? (
                    <li>
                      <strong>Export certificate to file:</strong>
                      <div className="relative group mt-1">
                        <code className="block p-1.5 pr-10 bg-black/5 dark:bg-white/5 rounded font-mono">
                          keytool -exportcert -alias mykey -keystore {downloadedJksFilename} -file cert.cer
                        </code>
                        <button
                          onClick={() => copyToClipboard(`keytool -exportcert -alias mykey -keystore ${downloadedJksFilename} -file cert.cer`, 'export-cert')}
                          className="absolute right-1 top-1 p-1 rounded bg-muted hover:bg-muted-foreground/20 transition-colors"
                          title="Copy to clipboard"
                        >
                          {copiedCommand === 'export-cert' ? (
                            <Check className="h-3 w-3 text-green-600" />
                          ) : (
                            <Copy className="h-3 w-3 text-muted-foreground" />
                          )}
                        </button>
                      </div>
                    </li>
                  ) : (
                    <li>
                      <strong>Import into Java cacerts:</strong>
                      <div className="relative group mt-1">
                        <code className="block p-1.5 pr-10 bg-black/5 dark:bg-white/5 rounded font-mono">
                          keytool -importkeystore -srckeystore {downloadedJksFilename} -destkeystore $JAVA_HOME/lib/security/cacerts
                        </code>
                        <button
                          onClick={() => copyToClipboard(`keytool -importkeystore -srckeystore ${downloadedJksFilename} -destkeystore $JAVA_HOME/lib/security/cacerts`, 'import-cacerts')}
                          className="absolute right-1 top-1 p-1 rounded bg-muted hover:bg-muted-foreground/20 transition-colors"
                          title="Copy to clipboard"
                        >
                          {copiedCommand === 'import-cacerts' ? (
                            <Check className="h-3 w-3 text-green-600" />
                          ) : (
                            <Copy className="h-3 w-3 text-muted-foreground" />
                          )}
                        </button>
                      </div>
                    </li>
                  )}
                </ul>
              </div>
            </div>
            <div className="flex justify-end mt-6">
              <button
                onClick={() => {
                  setShowJksInfoPopup(false);
                  setDownloadedJksFilename('');
                }}
                className="px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 font-medium shadow-sm"
              >
                Got it
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Docker Volume Info Popup */}
      {showDockerVolumeInfoPopup && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-card border rounded-lg p-6 max-w-lg w-full mx-4 shadow-lg">
            <h2 className="text-xl font-bold mb-4 flex items-center gap-2">
              <span className="text-green-600">✓</span> Docker Volume TAR Downloaded
            </h2>
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">
                Your Docker volume file <strong className="text-foreground">{downloadedDockerVolumeFilename}</strong> has been downloaded successfully.
              </p>

              <div className="p-4 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-md">
                <h3 className="font-semibold text-blue-900 dark:text-blue-200 mb-2">
                  TAR File Structure
                </h3>
                <p className="text-sm text-blue-800 dark:text-blue-300 mb-2">
                  The TAR file contains the following structure:
                </p>
                <div className="relative group">
                  <code className="block p-2 pr-10 bg-black/10 dark:bg-white/10 rounded text-xs font-mono overflow-x-auto whitespace-pre">
{`certs/
├── {cn}-{serial}.pem    # Certificate files
├── {cn}-{serial}.key    # Private key files
└── ca-chain.pem         # All CA certificates`}
                  </code>
                </div>
              </div>

              <div className="p-4 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-md">
                <h3 className="font-semibold text-green-900 dark:text-green-200 mb-2">
                  Import into Docker Volume
                </h3>
                <p className="text-sm text-green-800 dark:text-green-300 mb-2">
                  To import the certificates into a Docker volume, run:
                </p>
                <div className="relative group">
                  <code className="block p-2 pr-10 bg-black/10 dark:bg-white/10 rounded text-xs font-mono overflow-x-auto whitespace-pre">
{`# Create the volume (if it doesn't exist)
docker volume create my-certs

# Import the TAR file into the volume
docker run --rm -v my-certs:/target \\
  -v $(pwd):/source busybox \\
  tar -xf /source/${downloadedDockerVolumeFilename} -C /target`}
                  </code>
                  <button
                    onClick={() => copyToClipboard(`docker volume create my-certs && docker run --rm -v my-certs:/target -v $(pwd):/source busybox tar -xf /source/${downloadedDockerVolumeFilename} -C /target`, 'docker-import')}
                    className="absolute right-1 top-1 p-1.5 rounded bg-green-200/50 dark:bg-green-700/50 hover:bg-green-300/70 dark:hover:bg-green-600/70 transition-colors"
                    title="Copy to clipboard"
                  >
                    {copiedCommand === 'docker-import' ? (
                      <Check className="h-3.5 w-3.5 text-green-600" />
                    ) : (
                      <Copy className="h-3.5 w-3.5 text-green-700 dark:text-green-300" />
                    )}
                  </button>
                </div>
              </div>

            </div>
            <div className="flex justify-end mt-6">
              <button
                onClick={() => {
                  setShowDockerVolumeInfoPopup(false);
                  setDownloadedDockerVolumeFilename('');
                }}
                className="px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 font-medium shadow-sm"
              >
                Got it
              </button>
            </div>
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
