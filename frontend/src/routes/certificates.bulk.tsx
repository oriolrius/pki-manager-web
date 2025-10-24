import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { trpc } from '@/lib/trpc';
import { ArrowLeft, FileText, AlertCircle, CheckCircle2, XCircle } from 'lucide-react';
import { useState } from 'react';

export const Route = createFileRoute('/certificates/bulk')({
  component: BulkCertificates,
});

interface BulkResult {
  row: number;
  success: boolean;
  certificateId?: string;
  subject?: string;
  serialNumber?: string;
  error?: string;
}

function BulkCertificates() {
  const navigate = useNavigate();
  const utils = trpc.useUtils();
  const [formData, setFormData] = useState({
    caId: '',
    defaultValidityDays: 365,
    csvData: '',
  });

  const [results, setResults] = useState<{
    successful: number;
    failed: number;
    results: BulkResult[];
  } | null>(null);

  const casQuery = trpc.ca.list.useQuery({ limit: 100, offset: 0 });
  const bulkIssueMutation = trpc.certificate.bulkIssue.useMutation();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!formData.caId) {
      alert('Please select a Certificate Authority');
      return;
    }

    if (!formData.csvData.trim()) {
      alert('Please provide CSV data');
      return;
    }

    try {
      const result = await bulkIssueMutation.mutateAsync({
        caId: formData.caId,
        defaultValidityDays: formData.defaultValidityDays,
        csvData: formData.csvData,
      });

      setResults(result);
      utils.certificate.list.invalidate();
    } catch (error: any) {
      alert(`Failed to issue certificates: ${error.message}`);
    }
  };

  const exampleCSV = `server,example.com,Acme Corp,US,example.com;www.example.com,365
client,john.doe,Acme Corp,US,,730
email,jane@example.com,Acme Corp,US,jane@example.com,365
server,api.example.com,Acme Corp,US,api.example.com;192.168.1.10,825`;

  return (
    <div className="container mx-auto p-6">
      <div className="mb-6 flex items-center gap-4">
        <button
          type="button"
          onClick={() => navigate({ to: '/certificates' })}
          className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded-md hover:bg-gray-50 dark:hover:bg-gray-700"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to Certificates
        </button>
        <h1 className="text-3xl font-bold text-gray-900 dark:text-white">Bulk Certificate Creation</h1>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Form Section */}
        <div className="bg-white dark:bg-gray-800 shadow rounded-lg p-6">
          <form onSubmit={handleSubmit} className="space-y-6">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                Certificate Authority *
              </label>
              <select
                required
                value={formData.caId}
                onChange={(e) => setFormData(prev => ({ ...prev, caId: e.target.value }))}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500 dark:bg-gray-900 dark:text-white"
                disabled={casQuery.isLoading}
              >
                <option value="">{casQuery.isLoading ? 'Loading CAs...' : 'Select a CA'}</option>
                {casQuery.data?.filter(ca => ca.status === 'active').map((ca) => {
                  // Parse subject DN to extract Common Name
                  const cnMatch = ca.subject.match(/CN=([^,]+)/);
                  const commonName = cnMatch ? cnMatch[1] : ca.subject;
                  return (
                    <option key={ca.id} value={ca.id}>
                      {commonName} ({ca.status})
                    </option>
                  );
                })}
              </select>
              <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
                Select the CA to sign all certificates
              </p>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                Default Validity (days)
              </label>
              <input
                type="number"
                min="1"
                max="825"
                value={formData.defaultValidityDays}
                onChange={(e) => setFormData(prev => ({ ...prev, defaultValidityDays: parseInt(e.target.value, 10) }))}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500 dark:bg-gray-900 dark:text-white"
              />
              <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
                Used when validity is not specified in CSV
              </p>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                CSV Data *
              </label>
              <textarea
                required
                value={formData.csvData}
                onChange={(e) => setFormData(prev => ({ ...prev, csvData: e.target.value }))}
                rows={12}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500 dark:bg-gray-900 dark:text-white font-mono text-sm"
                placeholder={exampleCSV}
              />
              <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
                Format: certificateType, CN, O, C, SANs (semicolon-separated), validityDays
              </p>
            </div>

            <button
              type="submit"
              disabled={bulkIssueMutation.isPending}
              className="w-full flex items-center justify-center gap-2 px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {bulkIssueMutation.isPending ? (
                <>Processing...</>
              ) : (
                <>
                  <FileText className="h-4 w-4" />
                  Issue Certificates
                </>
              )}
            </button>
          </form>
        </div>

        {/* Instructions and Results Section */}
        <div className="space-y-6">
          <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-6">
            <div className="flex items-start gap-3">
              <AlertCircle className="h-5 w-5 text-blue-600 dark:text-blue-400 mt-0.5" />
              <div>
                <h3 className="text-sm font-semibold text-blue-900 dark:text-blue-100 mb-2">CSV Format Guide</h3>
                <div className="text-sm text-blue-800 dark:text-blue-200 space-y-2">
                  <p><strong>Required fields:</strong></p>
                  <ul className="list-disc list-inside ml-2 space-y-1">
                    <li><strong>certificateType:</strong> server, client, code_signing, or email</li>
                    <li><strong>CN:</strong> Common Name (domain, email, or username)</li>
                    <li><strong>O:</strong> Organization name</li>
                    <li><strong>C:</strong> 2-letter country code (e.g., US, GB)</li>
                  </ul>

                  <p className="mt-3"><strong>Optional fields:</strong></p>
                  <ul className="list-disc list-inside ml-2 space-y-1">
                    <li><strong>SANs:</strong> Subject Alternative Names (semicolon-separated)</li>
                    <li><strong>validityDays:</strong> Certificate validity period (uses default if empty)</li>
                  </ul>

                  <p className="mt-3"><strong>SAN Auto-detection:</strong></p>
                  <ul className="list-disc list-inside ml-2 space-y-1">
                    <li>Contains @: Treated as email</li>
                    <li>Format X.X.X.X: Treated as IP address</li>
                    <li>Otherwise: Treated as DNS name</li>
                  </ul>

                  <p className="mt-3"><strong>Example:</strong></p>
                  <pre className="mt-2 p-2 bg-white dark:bg-gray-800 rounded text-xs overflow-x-auto">
                    {exampleCSV}
                  </pre>
                </div>
              </div>
            </div>
          </div>

          {/* Results Display */}
          {results && (
            <div className="bg-white dark:bg-gray-800 shadow rounded-lg p-6">
              <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">Results</h3>

              <div className="grid grid-cols-2 gap-4 mb-6">
                <div className="bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg p-4">
                  <div className="flex items-center gap-2">
                    <CheckCircle2 className="h-5 w-5 text-green-600 dark:text-green-400" />
                    <span className="text-sm font-medium text-green-900 dark:text-green-100">Successful</span>
                  </div>
                  <p className="text-2xl font-bold text-green-600 dark:text-green-400 mt-2">{results.successful}</p>
                </div>

                <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-4">
                  <div className="flex items-center gap-2">
                    <XCircle className="h-5 w-5 text-red-600 dark:text-red-400" />
                    <span className="text-sm font-medium text-red-900 dark:text-red-100">Failed</span>
                  </div>
                  <p className="text-2xl font-bold text-red-600 dark:text-red-400 mt-2">{results.failed}</p>
                </div>
              </div>

              <div className="space-y-2 max-h-96 overflow-y-auto">
                {results.results.map((result) => (
                  <div
                    key={result.row}
                    className={`p-3 rounded-lg border ${
                      result.success
                        ? 'bg-green-50 dark:bg-green-900/10 border-green-200 dark:border-green-800'
                        : 'bg-red-50 dark:bg-red-900/10 border-red-200 dark:border-red-800'
                    }`}
                  >
                    <div className="flex items-start gap-2">
                      {result.success ? (
                        <CheckCircle2 className="h-4 w-4 text-green-600 dark:text-green-400 mt-0.5" />
                      ) : (
                        <XCircle className="h-4 w-4 text-red-600 dark:text-red-400 mt-0.5" />
                      )}
                      <div className="flex-1 text-sm">
                        <p className="font-medium text-gray-900 dark:text-white">Row {result.row}</p>
                        {result.success ? (
                          <div className="text-gray-600 dark:text-gray-400 space-y-1">
                            <p>Subject: {result.subject}</p>
                            <p>Serial: {result.serialNumber}</p>
                            <a
                              href={`/certificates/${result.certificateId}`}
                              className="text-blue-600 dark:text-blue-400 hover:underline"
                            >
                              View Certificate
                            </a>
                          </div>
                        ) : (
                          <p className="text-red-600 dark:text-red-400">{result.error}</p>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
