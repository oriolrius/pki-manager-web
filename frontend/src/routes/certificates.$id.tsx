import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { trpc } from '@/lib/trpc';
import { ArrowLeft, Download, RotateCcw, XCircle, Trash2, Calendar, Shield, Key, Database, Award } from 'lucide-react';
import { useState } from 'react';

export const Route = createFileRoute('/certificates/$id')({
  component: CertificateDetail,
  // Force component to remount when id changes
  pendingComponent: () => (
    <div className="text-center py-8 text-muted-foreground">
      Loading certificate details...
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

function CertificateDetail() {
  const { id } = Route.useParams();
  const navigate = useNavigate();
  const certQuery = trpc.certificate.getById.useQuery({ id });
  const utils = trpc.useUtils();
  const [showRevokeDialog, setShowRevokeDialog] = useState(false);
  const [selectedReason, setSelectedReason] = useState<string>('unspecified');
  const [revokeDetails, setRevokeDetails] = useState('');

  const renewMutation = trpc.certificate.renew.useMutation();
  const revokeMutation = trpc.certificate.revoke.useMutation();
  const deleteMutation = trpc.certificate.delete.useMutation();

  const handleDownload = async () => {
    try {
      const result = await utils.certificate.download.fetch({ id, format: 'pem' });

      // Create download link
      const blob = new Blob([result.data], { type: result.mimeType });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = result.filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } catch (error: any) {
      alert(`Failed to download certificate: ${error.message}`);
    }
  };

  const handleRenew = async () => {
    if (confirm('Are you sure you want to renew this certificate? This will create a new certificate with the same details.')) {
      try {
        const data = await renewMutation.mutateAsync({ id, generateNewKey: false });
        await certQuery.refetch();
        utils.certificate.list.invalidate();
        alert(`Certificate renewed successfully. New ID: ${data.id}`);
        navigate({ to: `/certificates/${data.id}` });
      } catch (error: any) {
        alert(`Failed to renew certificate: ${error.message}`);
      }
    }
  };

  const handleRevoke = () => {
    setShowRevokeDialog(true);
  };

  const confirmRevoke = () => {
    revokeMutation.mutate(
      { id, reason: selectedReason as any, details: revokeDetails || undefined },
      {
        onSuccess: () => {
          certQuery.refetch();
          utils.certificate.list.invalidate();
          setShowRevokeDialog(false);
          setSelectedReason('unspecified');
          setRevokeDetails('');
          alert('Certificate revoked successfully');
        },
        onError: (error) => {
          alert(`Failed to revoke certificate: ${error.message}`);
        },
      }
    );
  };

  const handleDelete = () => {
    if (confirm('Are you sure you want to delete this certificate? This action cannot be undone.')) {
      deleteMutation.mutate(
        { id },
        {
          onSuccess: () => {
            utils.certificate.list.invalidate();
            alert('Certificate deleted successfully');
            navigate({ to: '/certificates' });
          },
          onError: (error) => {
            alert(`Failed to delete certificate: ${error.message}`);
          },
        }
      );
    }
  };

  if (certQuery.isLoading) {
    return (
      <div className="text-center py-8 text-muted-foreground">
        Loading certificate details...
      </div>
    );
  }

  if (certQuery.isError) {
    return (
      <div className="text-center py-8 text-destructive">
        Error loading certificate: {certQuery.error.message}
      </div>
    );
  }

  const cert = certQuery.data;

  // Extract CN from Subject DN
  const cnMatch = cert.subjectDn.match(/CN=([^,]+)/);
  const commonName = cnMatch ? cnMatch[1] : cert.subjectDn;

  // Calculate days until expiration
  const daysUntilExpiry = Math.ceil((new Date(cert.notAfter).getTime() - Date.now()) / (1000 * 60 * 60 * 24));
  const isExpiringSoon = daysUntilExpiry <= 30 && daysUntilExpiry > 0;
  const isExpired = daysUntilExpiry <= 0;

  return (
    <div key={id} className="space-y-4">
      {/* Revocation Dialog */}
      {showRevokeDialog && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-card border rounded-lg p-6 max-w-md w-full mx-4 shadow-lg">
            <h2 className="text-xl font-bold mb-4">Revoke Certificate</h2>
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
                {revokeMutation.isPending ? 'Revoking...' : 'Revoke Certificate'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Header */}
      <div className="flex items-center justify-between">
        <button
          onClick={() => navigate({ to: '/certificates' })}
          className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to Certificates
        </button>

        <div className="flex gap-2">
          <button
            onClick={handleDownload}
            className="flex items-center gap-2 px-3 py-1.5 text-sm bg-primary text-primary-foreground rounded-md hover:bg-primary/90 font-medium shadow-sm disabled:opacity-50"
          >
            <Download className="h-4 w-4" />
            Download
          </button>

          {cert.status === 'active' && (
            <>
              <button
                onClick={handleRenew}
                disabled={renewMutation.isPending}
                className="flex items-center gap-2 px-3 py-1.5 text-sm bg-blue-600 text-white rounded-md hover:bg-blue-700 font-medium shadow-sm disabled:opacity-50"
              >
                <RotateCcw className="h-4 w-4" />
                Renew
              </button>

              <button
                onClick={handleRevoke}
                disabled={revokeMutation.isPending}
                className="flex items-center gap-2 px-3 py-1.5 text-sm bg-orange-600 text-white rounded-md hover:bg-orange-700 font-medium shadow-sm disabled:opacity-50"
              >
                <XCircle className="h-4 w-4" />
                Revoke
              </button>
            </>
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
              <p className="text-sm text-muted-foreground font-mono">{cert.subjectDn}</p>
            </div>
            <div className="flex gap-2">
              <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium ${
                cert.status === 'active'
                  ? 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200'
                  : cert.status === 'revoked'
                    ? 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200'
                    : 'bg-gray-100 text-gray-800 dark:bg-gray-900 dark:text-gray-200'
              }`}>
                {cert.status.toUpperCase()}
              </span>
              <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200">
                {cert.certificateType}
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
                  <p className="font-medium">{new Date(cert.notBefore).toLocaleDateString()}</p>
                </div>
                <div>
                  <span className="text-muted-foreground">Valid Until:</span>
                  <p className="font-medium">{new Date(cert.notAfter).toLocaleDateString()}</p>
                </div>
              </div>
              {cert.status === 'active' && (
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

          {/* Subject Alternative Names - Prominent */}
          <div className="flex items-start gap-3 p-3 bg-muted/50 rounded-md">
            <Shield className="h-5 w-5 text-primary mt-0.5" />
            <div className="flex-1">
              <h3 className="text-sm font-semibold mb-2">Subject Alternative Names (SAN)</h3>
              {!cert.sanDns?.length && !cert.sanIp?.length && !cert.sanEmail?.length ? (
                <p className="text-sm text-muted-foreground">None</p>
              ) : (
                <div className="space-y-2">
                  {cert.sanDns && cert.sanDns.length > 0 && (
                    <div>
                      <span className="text-xs text-muted-foreground">DNS:</span>
                      <div className="flex flex-wrap gap-1.5 mt-1">
                        {cert.sanDns.map((dns, idx) => (
                          <span key={idx} className="inline-flex items-center px-2 py-0.5 rounded text-xs font-mono bg-background border">
                            {dns}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                  {cert.sanIp && cert.sanIp.length > 0 && (
                    <div>
                      <span className="text-xs text-muted-foreground">IP:</span>
                      <div className="flex flex-wrap gap-1.5 mt-1">
                        {cert.sanIp.map((ip, idx) => (
                          <span key={idx} className="inline-flex items-center px-2 py-0.5 rounded text-xs font-mono bg-background border">
                            {ip}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                  {cert.sanEmail && cert.sanEmail.length > 0 && (
                    <div>
                      <span className="text-xs text-muted-foreground">Email:</span>
                      <div className="flex flex-wrap gap-1.5 mt-1">
                        {cert.sanEmail.map((email, idx) => (
                          <span key={idx} className="inline-flex items-center px-2 py-0.5 rounded text-xs font-mono bg-background border">
                            {email}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Issuing CA - Prominent */}
          <div
            className="flex items-start gap-3 p-3 bg-muted/50 rounded-md cursor-pointer hover:bg-muted/70 transition-colors"
            onClick={() => navigate({ to: `/cas/${cert.issuingCA.id}` })}
            role="button"
            tabIndex={0}
          >
            <Award className="h-5 w-5 text-primary mt-0.5" />
            <div className="flex-1">
              <h3 className="text-sm font-semibold mb-2">Issued By (Certificate Authority)</h3>
              <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
                <div>
                  <span className="text-muted-foreground text-xs">CA Subject:</span>
                  <p className="font-mono text-xs">{cert.issuingCA.subjectDn}</p>
                </div>
                <div>
                  <span className="text-muted-foreground text-xs">CA Serial Number:</span>
                  <p className="font-mono text-xs">{cert.issuingCA.serialNumber}</p>
                </div>
              </div>
              <p className="text-xs text-primary mt-2">Click to view CA details →</p>
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
                  <span className="text-muted-foreground text-xs">Serial Number:</span>
                  <p className="font-mono text-xs">{cert.serialNumber}</p>
                </div>
                <div>
                  <span className="text-muted-foreground text-xs">Certificate ID:</span>
                  <p className="font-mono text-xs truncate" title={cert.id}>{cert.id}</p>
                </div>
                <div>
                  <span className="text-muted-foreground text-xs">CA ID:</span>
                  <p className="font-mono text-xs truncate" title={cert.caId}>{cert.caId}</p>
                </div>
              </div>
            </div>
          </div>

          {/* KMS Storage Information */}
          <div className="flex items-start gap-3 p-3 bg-muted/50 rounded-md">
            <Database className="h-5 w-5 text-primary mt-0.5" />
            <div className="flex-1">
              <h3 className="text-sm font-semibold mb-2">Storage Location</h3>
              <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm">
                <div>
                  <span className="text-muted-foreground text-xs">KMS Provider:</span>
                  <p className="font-mono">Cosmian KMS</p>
                </div>
                {cert.kmsKeyId && (
                  <div className="col-span-2">
                    <span className="text-muted-foreground text-xs">KMS Key ID:</span>
                    <p className="font-mono text-xs break-all">{cert.kmsKeyId}</p>
                  </div>
                )}
                <div>
                  <span className="text-muted-foreground text-xs">Created:</span>
                  <p>{new Date(cert.createdAt).toLocaleString()}</p>
                </div>
                <div>
                  <span className="text-muted-foreground text-xs">Last Modified:</span>
                  <p>{new Date(cert.updatedAt).toLocaleString()}</p>
                </div>
              </div>
            </div>
          </div>

          {/* Revocation Information */}
          {cert.status === 'revoked' && cert.revocationDate && (
            <div className="flex items-start gap-3 p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-md">
              <XCircle className="h-5 w-5 text-red-600 mt-0.5" />
              <div className="flex-1">
                <h3 className="text-sm font-semibold text-red-900 dark:text-red-200 mb-2">Revocation Information</h3>
                <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
                  <div>
                    <span className="text-red-700 dark:text-red-300 text-xs">Date:</span>
                    <p className="font-medium">{new Date(cert.revocationDate).toLocaleString()}</p>
                  </div>
                  <div>
                    <span className="text-red-700 dark:text-red-300 text-xs">Reason:</span>
                    <p className="font-medium">{cert.revocationReason || 'Not specified'}</p>
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
            {cert.certificatePem}
          </pre>
        </div>
      </details>
    </div>
  );
}
