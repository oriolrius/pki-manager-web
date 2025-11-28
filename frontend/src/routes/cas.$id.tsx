import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { trpc } from '@/lib/trpc';
import { getApiUrl } from '@/lib/config';
import { ArrowLeft, XCircle, Trash2, Calendar, Key, Database, Award, Link, Check, Copy } from 'lucide-react';
import { useState } from 'react';

export const Route = createFileRoute('/cas/$id')({
  component: CADetail,
  // Force component to remount when id changes
  pendingComponent: () => (
    <div className="text-center py-8 text-muted-foreground">
      Loading CA details...
    </div>
  ),
});

const REVOCATION_REASONS = [
  { value: 'unspecified', label: 'Unspecified' },
  { value: 'keyCompromise', label: 'Key Compromise' },
  { value: 'caCompromise', label: 'CA Compromise' },
  { value: 'affiliationChanged', label: 'Affiliation Changed' },
  { value: 'superseded', label: 'Superseded' },
  { value: 'cessationOfOperation', label: 'Cessation of Operation' },
  { value: 'certificateHold', label: 'Certificate Hold' },
  { value: 'privilegeWithdrawn', label: 'Privilege Withdrawn' },
] as const;

function CADetail() {
  const { id } = Route.useParams();
  const navigate = useNavigate();
  // Disable retries for CONFLICT errors (KMS inconsistency) - they won't resolve with retries
  const caQuery = trpc.ca.getById.useQuery({ id }, {
    retry: (failureCount, error) => {
      // Don't retry CONFLICT errors - they indicate data inconsistency, not transient failures
      if (error.data?.code === 'CONFLICT' || error.data?.code === 'NOT_FOUND') {
        return false;
      }
      // For other errors, retry up to 3 times (default behavior)
      return failureCount < 3;
    },
  });
  const utils = trpc.useUtils();
  const [showRevokeDialog, setShowRevokeDialog] = useState(false);
  const [showForceDeleteDialog, setShowForceDeleteDialog] = useState(false);
  const [showSuccessDialog, setShowSuccessDialog] = useState(false);
  const [successMessage, setSuccessMessage] = useState('');
  const [forceDeleteError, setForceDeleteError] = useState<string | null>(null);
  const [selectedReason, setSelectedReason] = useState<string>('unspecified');
  const [revokeDetails, setRevokeDetails] = useState('');
  const [linkCopied, setLinkCopied] = useState(false);
  const [selectedFormat, setSelectedFormat] = useState<'pem' | 'crt' | 'der' | 'cer'>('pem');

  const revokeMutation = trpc.ca.revoke.useMutation();
  const deleteMutation = trpc.ca.delete.useMutation();

  // Get backend base URL from runtime config
  const apiBaseUrl = getApiUrl().replace('/trpc', '');

  // Certificate download URLs for all formats
  const downloadUrls = {
    pem: `${apiBaseUrl}/cas/${id}.pem`,
    crt: `${apiBaseUrl}/cas/${id}.crt`,
    der: `${apiBaseUrl}/cas/${id}.der`,
    cer: `${apiBaseUrl}/cas/${id}.cer`,
  };

  const downloadUrl = downloadUrls[selectedFormat];

  const handleRevoke = () => {
    setShowRevokeDialog(true);
  };

  const confirmRevoke = () => {
    revokeMutation.mutate(
      { id, reason: selectedReason as any, details: revokeDetails || undefined },
      {
        onSuccess: () => {
          caQuery.refetch();
          utils.ca.list.invalidate();
          utils.certificate.list.invalidate(); // CA revocation cascades to all certificates
          setShowRevokeDialog(false);
          setSelectedReason('unspecified');
          setRevokeDetails('');
          alert('CA revoked successfully');
        },
        onError: (error) => {
          alert(`Failed to revoke CA: ${error.message}`);
        },
      }
    );
  };

  const handleDelete = () => {
    if (confirm('Are you sure you want to delete this CA? This action cannot be undone and will affect all issued certificates.')) {
      deleteMutation.mutate(
        { id },
        {
          onSuccess: () => {
            utils.ca.list.invalidate();
            alert('CA deleted successfully');
            navigate({ to: '/cas' });
          },
          onError: (error) => {
            alert(`Failed to delete CA: ${error.message}`);
          },
        }
      );
    }
  };

  const handleCopyPermalink = async () => {
    try {
      await navigator.clipboard.writeText(downloadUrl);
      setLinkCopied(true);
      setTimeout(() => setLinkCopied(false), 2000);
    } catch (error) {
      console.error('Failed to copy link:', error);
      alert('Failed to copy link to clipboard');
    }
  };

  if (caQuery.isLoading) {
    return (
      <div className="text-center py-8 text-muted-foreground">
        Loading CA details...
      </div>
    );
  }

  if (caQuery.isError) {
    // KMS inconsistency is now properly returned as CONFLICT (HTTP 409) from the backend
    // IMPORTANT: Check CONFLICT first, before NOT_FOUND, because error message may contain "not found"
    const isKmsInconsistency = caQuery.error.data?.code === 'CONFLICT';
    const isNotFound = !isKmsInconsistency && (
      caQuery.error.data?.code === 'NOT_FOUND' ||
      caQuery.error.message.toLowerCase().includes('not found')
    );

    if (isKmsInconsistency) {
      // Extract metadata from error cause (sent by backend)
      const errorCause = caQuery.error.data?.cause as {
        type?: string;
        caId?: string;
        kmsCertificateId?: string;
        subjectDn?: string;
        serialNumber?: string;
      } | undefined;

      const handleForceDelete = () => {
        setShowForceDeleteDialog(true);
      };

      const confirmForceDelete = () => {
        setForceDeleteError(null);
        deleteMutation.mutate(
          { id, forceDelete: true },
          {
            onSuccess: () => {
              utils.ca.list.invalidate();
              setShowForceDeleteDialog(false);
              setSuccessMessage('CA record removed from database successfully');
              setShowSuccessDialog(true);
            },
            onError: (error) => {
              setForceDeleteError(error.message);
            },
          }
        );
      };

      return (
        <div className="max-w-2xl mx-auto py-12 space-y-6">
          {/* Success Dialog */}
          {showSuccessDialog && (
            <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
              <div className="bg-card border rounded-lg p-6 max-w-md w-full mx-4 shadow-lg">
                <div className="flex items-center gap-3 mb-4">
                  <div className="flex-shrink-0 w-10 h-10 bg-green-100 dark:bg-green-900/30 rounded-full flex items-center justify-center">
                    <svg className="w-6 h-6 text-green-600 dark:text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                  </div>
                  <h2 className="text-xl font-bold text-green-700 dark:text-green-400">Success</h2>
                </div>
                <p className="text-sm text-muted-foreground mb-6">
                  {successMessage}
                </p>
                <button
                  onClick={() => {
                    setShowSuccessDialog(false);
                    navigate({ to: '/cas' });
                  }}
                  className="w-full px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 font-medium"
                >
                  Go to Certificate Authorities
                </button>
              </div>
            </div>
          )}

          {/* Force Delete Confirmation Dialog */}
          {showForceDeleteDialog && (
            <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
              <div className="bg-card border rounded-lg p-6 max-w-md w-full mx-4 shadow-lg">
                <h2 className="text-xl font-bold mb-4 text-destructive">Remove CA from Database</h2>
                <div className="space-y-4">
                  <p className="text-sm text-muted-foreground">
                    This will permanently remove the CA record from the database.
                    The certificate data in KMS (if any) will not be affected.
                  </p>
                  <div className="bg-orange-50 dark:bg-orange-900/20 border border-orange-200 dark:border-orange-800 rounded-md p-3">
                    <p className="text-sm font-medium text-orange-800 dark:text-orange-200">
                      Warning: This action cannot be undone.
                    </p>
                  </div>
                  <div className="text-sm">
                    <span className="text-muted-foreground">CA ID:</span>
                    <code className="ml-2 text-xs bg-muted px-2 py-0.5 rounded">{id}</code>
                  </div>
                  {forceDeleteError && (
                    <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-md p-3">
                      <p className="text-sm text-red-800 dark:text-red-300">
                        <strong>Error:</strong> {forceDeleteError}
                      </p>
                    </div>
                  )}
                </div>
                <div className="flex gap-3 mt-6">
                  <button
                    onClick={() => setShowForceDeleteDialog(false)}
                    disabled={deleteMutation.isPending}
                    className="flex-1 px-4 py-2 border rounded-md hover:bg-muted font-medium disabled:opacity-50"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={confirmForceDelete}
                    disabled={deleteMutation.isPending}
                    className="flex-1 px-4 py-2 bg-red-600 text-white rounded-md hover:bg-red-700 font-medium shadow-sm disabled:opacity-50"
                  >
                    {deleteMutation.isPending ? 'Removing...' : 'Remove from Database'}
                  </button>
                </div>
              </div>
            </div>
          )}

          <div className="text-center space-y-2">
            <div className="text-5xl text-orange-500">409</div>
            <h2 className="text-xl font-semibold text-destructive">CA Not Found in KMS</h2>
          </div>

          <div className="bg-orange-50 dark:bg-orange-900/20 border border-orange-200 dark:border-orange-800 rounded-lg p-4 space-y-3">
            <p className="text-sm">
              <strong>Problem:</strong> This CA exists in the application database but its certificate
              could not be retrieved from the Key Management System (KMS).
            </p>
            <p className="text-sm text-muted-foreground">
              This can happen when:
            </p>
            <ul className="text-sm text-muted-foreground list-disc list-inside space-y-1">
              <li>The certificate was deleted directly from the KMS</li>
              <li>The KMS database was restored from a backup without the certificate</li>
              <li>There was a partial failure during CA creation</li>
              <li>The KMS is temporarily unavailable</li>
            </ul>
          </div>

          <div className="bg-muted/50 rounded-lg p-4 space-y-3">
            <h3 className="text-sm font-semibold">Record Details (from Database)</h3>
            <div className="grid grid-cols-1 gap-2 text-sm">
              <div>
                <span className="text-muted-foreground">CA ID:</span>
                <code className="ml-2 text-xs bg-muted px-2 py-0.5 rounded">{id}</code>
              </div>
              {errorCause?.subjectDn && (
                <div>
                  <span className="text-muted-foreground">Subject DN:</span>
                  <code className="ml-2 text-xs bg-muted px-2 py-0.5 rounded break-all">{errorCause.subjectDn}</code>
                </div>
              )}
              {errorCause?.serialNumber && (
                <div>
                  <span className="text-muted-foreground">Serial Number:</span>
                  <code className="ml-2 text-xs bg-muted px-2 py-0.5 rounded">{errorCause.serialNumber}</code>
                </div>
              )}
              {errorCause?.kmsCertificateId && (
                <div>
                  <span className="text-muted-foreground">KMS Certificate ID:</span>
                  <code className="ml-2 text-xs bg-muted px-2 py-0.5 rounded break-all">{errorCause.kmsCertificateId}</code>
                </div>
              )}
            </div>
            <div className="pt-2 border-t border-muted">
              <p className="text-xs text-muted-foreground">
                <strong>KMS Error:</strong> {caQuery.error.message}
              </p>
            </div>
          </div>

          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            <button
              onClick={() => navigate({ to: '/cas' })}
              className="inline-flex items-center justify-center gap-2 px-4 py-2 border rounded-md hover:bg-muted font-medium"
            >
              <ArrowLeft className="h-4 w-4" />
              Back to CAs
            </button>
            <button
              onClick={() => caQuery.refetch()}
              className="inline-flex items-center justify-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 font-medium"
            >
              Retry
            </button>
            <button
              onClick={handleForceDelete}
              disabled={deleteMutation.isPending}
              className="inline-flex items-center justify-center gap-2 px-4 py-2 bg-red-600 text-white rounded-md hover:bg-red-700 font-medium disabled:opacity-50"
            >
              <Trash2 className="h-4 w-4" />
              {deleteMutation.isPending ? 'Removing...' : 'Remove from Database'}
            </button>
          </div>
        </div>
      );
    }

    if (isNotFound) {
      return (
        <div className="text-center py-12 space-y-4">
          <div className="text-6xl">404</div>
          <h2 className="text-xl font-semibold">Certificate Authority Not Found</h2>
          <p className="text-muted-foreground max-w-md mx-auto">
            The CA you're looking for doesn't exist or may have been deleted.
          </p>
          <button
            onClick={() => navigate({ to: '/cas' })}
            className="inline-flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 font-medium"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to Certificate Authorities
          </button>
        </div>
      );
    }

    return (
      <div className="text-center py-12 space-y-4">
        <div className="text-destructive text-lg font-semibold">Error Loading CA</div>
        <p className="text-muted-foreground max-w-md mx-auto">
          {caQuery.error.message}
        </p>
        <button
          onClick={() => navigate({ to: '/cas' })}
          className="inline-flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 font-medium"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to Certificate Authorities
        </button>
      </div>
    );
  }

  const ca = caQuery.data;

  // Extract CN from Subject DN
  const cnMatch = ca.subjectDn.match(/CN=([^,]+)/);
  const commonName = cnMatch ? cnMatch[1] : ca.subjectDn;

  // Calculate days until expiration
  const daysUntilExpiry = Math.ceil((new Date(ca.notAfter).getTime() - Date.now()) / (1000 * 60 * 60 * 24));
  const isExpiringSoon = daysUntilExpiry <= 30 && daysUntilExpiry > 0;
  const isExpired = daysUntilExpiry <= 0;

  return (
    <div key={id} className="space-y-4">
      {/* Revocation Dialog */}
      {showRevokeDialog && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-card border rounded-lg p-6 max-w-md w-full mx-4 shadow-lg">
            <h2 className="text-xl font-bold mb-4">Revoke Certificate Authority</h2>
            <div className="space-y-4">
              <div>
                <label htmlFor="reason" className="block text-sm font-medium mb-2">
                  Revocation Reason
                </label>
                <select
                  id="reason"
                  value={selectedReason}
                  onChange={(e) => setSelectedReason(e.target.value)}
                  className="w-full px-3 py-2 border rounded-md bg-background"
                >
                  {REVOCATION_REASONS.map((reason) => (
                    <option key={reason.value} value={reason.value}>
                      {reason.label}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label htmlFor="details" className="block text-sm font-medium mb-2">
                  Additional Details (Optional)
                </label>
                <textarea
                  id="details"
                  value={revokeDetails}
                  onChange={(e) => setRevokeDetails(e.target.value)}
                  className="w-full px-3 py-2 border rounded-md bg-background"
                  rows={3}
                  maxLength={500}
                  placeholder="Provide additional context for the revocation..."
                />
                <p className="text-xs text-muted-foreground mt-1">
                  {revokeDetails.length}/500 characters
                </p>
              </div>
            </div>
            <div className="flex gap-3 mt-6">
              <button
                onClick={() => {
                  setShowRevokeDialog(false);
                  setSelectedReason('unspecified');
                  setRevokeDetails('');
                }}
                disabled={revokeMutation.isPending}
                className="flex-1 px-4 py-2 border rounded-md hover:bg-muted font-medium disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={confirmRevoke}
                disabled={revokeMutation.isPending}
                className="flex-1 px-4 py-2 bg-red-600 text-white rounded-md hover:bg-red-700 font-medium shadow-sm disabled:opacity-50"
              >
                {revokeMutation.isPending ? 'Revoking...' : 'Revoke CA'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Header */}
      <div className="flex items-center justify-between">
        <button
          onClick={() => navigate({ to: '/cas' })}
          className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground cursor-pointer"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to Certificate Authorities
        </button>

        <div className="flex gap-2">
          <select
            value={selectedFormat}
            onChange={(e) => setSelectedFormat(e.target.value as any)}
            className="px-3 py-1.5 text-sm border rounded-md bg-background"
          >
            <option value="pem">PEM - Text format</option>
            <option value="crt">CRT - Text certificate</option>
            <option value="der">DER - Binary compact</option>
            <option value="cer">CER - Windows compatible</option>
          </select>

          <button
            onClick={handleCopyPermalink}
            className="flex items-center gap-2 px-3 py-1.5 text-sm bg-primary text-primary-foreground rounded-md hover:bg-primary/90 font-medium shadow-sm"
          >
            {linkCopied ? (
              <>
                <Check className="h-4 w-4" />
                Copied!
              </>
            ) : (
              <>
                <Link className="h-4 w-4" />
                Copy Link
              </>
            )}
          </button>

          {ca.status === 'active' && (
            <button
              onClick={handleRevoke}
              disabled={revokeMutation.isPending}
              className="flex items-center gap-2 px-3 py-1.5 text-sm bg-orange-600 text-white rounded-md hover:bg-orange-700 font-medium shadow-sm disabled:opacity-50"
            >
              <XCircle className="h-4 w-4" />
              Revoke
            </button>
          )}

          <button
            onClick={handleDelete}
            disabled={deleteMutation.isPending}
            className="flex items-center gap-2 px-3 py-1.5 text-sm bg-red-600 text-white rounded-md hover:bg-red-700 font-medium shadow-sm disabled:opacity-50"
          >
            <Trash2 className="h-4 w-4" />
            Delete
          </button>
        </div>
      </div>

      {/* Primary Information Card */}
      <div className="rounded-lg border bg-card">
        <div className="p-4 border-b bg-muted/30">
          <div className="flex items-start justify-between">
            <div className="flex-1">
              <h1 className="text-2xl font-bold mb-1">{commonName}</h1>
              <p className="text-sm text-muted-foreground font-mono">{ca.subjectDn}</p>
            </div>
            <div className="flex gap-2">
              <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium ${
                ca.status === 'active'
                  ? 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200'
                  : ca.status === 'revoked'
                    ? 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200'
                    : 'bg-gray-100 text-gray-800 dark:bg-gray-900 dark:text-gray-200'
              }`}>
                {ca.status.toUpperCase()}
              </span>
              <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium bg-primary/10 text-primary">
                Certificate Authority
              </span>
            </div>
          </div>
        </div>

        <div className="p-4 space-y-4">
          {/* Validity Period - Prominent */}
          <div className="flex items-start gap-3 p-3 bg-muted/50 rounded-md">
            <Calendar className="h-5 w-5 text-primary mt-0.5" />
            <div className="flex-1">
              <h3 className="text-sm font-semibold mb-2">Validity Period</h3>
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <span className="text-muted-foreground">Valid From:</span>
                  <p className="font-medium">{new Date(ca.notBefore).toLocaleDateString()}</p>
                </div>
                <div>
                  <span className="text-muted-foreground">Valid Until:</span>
                  <p className="font-medium">{new Date(ca.notAfter).toLocaleDateString()}</p>
                </div>
              </div>
              {ca.status === 'active' && (
                <div className="mt-2">
                  <span className={`text-xs font-medium ${
                    isExpired ? 'text-red-600' : isExpiringSoon ? 'text-orange-600' : 'text-green-600'
                  }`}>
                    {isExpired ? '⚠ Expired' : isExpiringSoon ? `⚠ Expires in ${daysUntilExpiry} days` : `✓ Valid for ${daysUntilExpiry} days`}
                  </span>
                </div>
              )}
            </div>
          </div>

          {/* Certificate Type - Prominent */}
          <div className="flex items-start gap-3 p-3 bg-muted/50 rounded-md">
            <Award className="h-5 w-5 text-primary mt-0.5" />
            <div className="flex-1">
              <h3 className="text-sm font-semibold mb-2">Certificate Type</h3>
              <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
                <div>
                  <span className="text-muted-foreground text-xs">Type:</span>
                  <p className="font-medium">Self-Signed Root CA</p>
                </div>
                <div>
                  <span className="text-muted-foreground text-xs">Issuer:</span>
                  <p className="font-mono text-xs">{ca.subjectDn}</p>
                </div>
              </div>
              <p className="text-xs text-muted-foreground mt-2">This CA signs its own certificate (root of trust)</p>
            </div>
          </div>

          {/* Technical Details */}
          <div className="flex items-start gap-3 p-3 bg-muted/50 rounded-md">
            <Key className="h-5 w-5 text-primary mt-0.5" />
            <div className="flex-1">
              <h3 className="text-sm font-semibold mb-2">Technical Details</h3>
              <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                <div>
                  <span className="text-muted-foreground text-xs">Standard:</span>
                  <p className="font-mono">X.509 v3</p>
                </div>
                <div>
                  <span className="text-muted-foreground text-xs">Key Algorithm:</span>
                  <p className="font-mono">{ca.keyAlgorithm}</p>
                </div>
                <div>
                  <span className="text-muted-foreground text-xs">Serial Number:</span>
                  <p className="font-mono text-xs">{ca.serialNumber}</p>
                </div>
                <div>
                  <span className="text-muted-foreground text-xs">CA ID:</span>
                  <p className="font-mono text-xs truncate" title={ca.id}>{ca.id}</p>
                </div>
              </div>
            </div>
          </div>

          {/* KMS Storage Information */}
          <div className="flex items-start gap-3 p-3 bg-muted/50 rounded-md">
            <Database className="h-5 w-5 text-primary mt-0.5" />
            <div className="flex-1">
              <h3 className="text-sm font-semibold mb-2">Storage Location</h3>
              <div className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
                {/* Left column: Certificate Download URLs */}
                <div>
                  <span className="text-muted-foreground text-xs block mb-1">Certificate Download URLs:</span>
                  <div className="space-y-1">
                    {Object.entries(downloadUrls).map(([format, url]) => (
                      <div key={format} className="flex items-center gap-2">
                        <span className="text-xs font-semibold text-muted-foreground uppercase w-8">
                          {format}:
                        </span>
                        <a
                          href={url}
                          className="font-mono text-xs text-primary hover:underline break-all flex-1"
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          {url}
                        </a>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Right column: KMS Provider */}
                <div>
                  <span className="text-muted-foreground text-xs">KMS Provider:</span>
                  <p className="font-mono">Cosmian KMS</p>
                  {ca.kmsKeyId && (
                    <div className="mt-3">
                      <span className="text-muted-foreground text-xs">KMS Key ID:</span>
                      <p className="font-mono text-xs break-all">{ca.kmsKeyId}</p>
                    </div>
                  )}
                </div>

                {/* Bottom row: Created and Last Modified */}
                <div>
                  <span className="text-muted-foreground text-xs">Created:</span>
                  <p>{new Date(ca.createdAt).toLocaleString()}</p>
                </div>
                <div>
                  <span className="text-muted-foreground text-xs">Last Modified:</span>
                  <p>{new Date(ca.updatedAt).toLocaleString()}</p>
                </div>
              </div>
            </div>
          </div>

          {/* Revocation Information */}
          {ca.status === 'revoked' && ca.revocationDate && (
            <div className="flex items-start gap-3 p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-md">
              <XCircle className="h-5 w-5 text-red-600 mt-0.5" />
              <div className="flex-1">
                <h3 className="text-sm font-semibold text-red-900 dark:text-red-200 mb-2">Revocation Information</h3>
                <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
                  <div>
                    <span className="text-red-700 dark:text-red-300 text-xs">Date:</span>
                    <p className="font-medium">{new Date(ca.revocationDate).toLocaleString()}</p>
                  </div>
                  <div>
                    <span className="text-red-700 dark:text-red-300 text-xs">Reason:</span>
                    <p className="font-medium">{ca.revocationReason || 'Not specified'}</p>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Certificate PEM - Collapsible */}
      <details className="rounded-lg border bg-card">
        <summary className="p-3 cursor-pointer hover:bg-muted/50 font-medium text-sm">
          Certificate PEM (Click to expand)
        </summary>
        <div className="px-3 pb-3">
          <pre className="p-3 bg-muted rounded-md text-xs font-mono overflow-x-auto">
            {ca.certificatePem}
          </pre>
        </div>
      </details>
    </div>
  );
}
