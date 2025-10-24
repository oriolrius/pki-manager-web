import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { trpc } from '@/lib/trpc';
import { ArrowLeft, Shuffle } from 'lucide-react';
import { useState } from 'react';

export const Route = createFileRoute('/cas/new')({
  component: NewCA,
});

function NewCA() {
  const navigate = useNavigate();
  const utils = trpc.useUtils();
  const [formData, setFormData] = useState({
    commonName: '',
    organization: '',
    organizationalUnit: '',
    country: '',
    state: '',
    locality: '',
    keyAlgorithm: 'RSA-4096' as 'RSA-2048' | 'RSA-4096',
    validityYears: 20,
  });

  const createMutation = trpc.ca.create.useMutation();

  const generateRandomData = () => {
    const randomString = Math.random().toString(36).substring(2, 8);
    const orgs = ['Acme Corp', 'Test Inc', 'Demo LLC', 'Sample Ltd', 'Enterprise CA', 'Trust Services'];
    const countries = ['US', 'GB', 'DE', 'FR', 'ES', 'IT', 'CA'];
    const states = ['California', 'New York', 'Texas', 'Florida', 'Washington'];
    const cities = ['San Francisco', 'New York', 'Austin', 'Miami', 'Seattle'];

    const randomOrg = orgs[Math.floor(Math.random() * orgs.length)];
    const randomCountry = countries[Math.floor(Math.random() * countries.length)];
    const randomState = states[Math.floor(Math.random() * states.length)];
    const randomCity = cities[Math.floor(Math.random() * cities.length)];

    setFormData(prev => ({
      ...prev,
      commonName: `${randomOrg} Root CA ${randomString.toUpperCase()}`,
      organization: randomOrg,
      organizationalUnit: 'PKI Division',
      country: randomCountry,
      state: randomState,
      locality: randomCity,
    }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    try {
      const result = await createMutation.mutateAsync({
        subject: {
          commonName: formData.commonName,
          organization: formData.organization,
          organizationalUnit: formData.organizationalUnit || undefined,
          country: formData.country,
          state: formData.state || undefined,
          locality: formData.locality || undefined,
        },
        keyAlgorithm: formData.keyAlgorithm,
        validityYears: formData.validityYears,
      });

      utils.ca.list.invalidate();
      navigate({ to: `/cas/${result.id}` });
    } catch (error: any) {
      alert(`Failed to create CA: ${error.message}`);
    }
  };

  return (
    <div className="space-y-6 max-w-4xl">
      {/* Header */}
      <div className="flex items-center justify-between">
        <button
          onClick={() => navigate({ to: '/cas' })}
          className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to Certificate Authorities
        </button>
        <button
          type="button"
          onClick={generateRandomData}
          className="flex items-center gap-2 px-4 py-2 border rounded-md hover:bg-muted"
        >
          <Shuffle className="h-4 w-4" />
          Generate Sample Data
        </button>
      </div>

      <div className="rounded-lg border bg-card">
        <div className="p-6 border-b">
          <h1 className="text-2xl font-bold">Create New Root Certificate Authority</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Create a self-signed root CA with the following characteristics:
          </p>
          <ul className="text-xs text-muted-foreground mt-2 space-y-1 list-disc list-inside">
            <li>X.509 v3 self-signed certificate</li>
            <li>Basic Constraints: CA=true, pathlen=unlimited</li>
            <li>Key Usage: keyCertSign, cRLSign, digitalSignature</li>
            <li>Private key stored securely in Cosmian KMS</li>
            <li>Subject DN equals Issuer DN (self-signed)</li>
          </ul>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-6">
          {/* Subject Information */}
          <div className="space-y-4">
            <h3 className="font-medium text-lg border-b pb-2">Subject Information</h3>
            <div className="grid grid-cols-2 gap-4">
              <div className="col-span-2">
                <label className="block text-sm font-medium mb-2">
                  Common Name (CN) *
                </label>
                <input
                  type="text"
                  value={formData.commonName}
                  onChange={(e) => setFormData(prev => ({ ...prev, commonName: e.target.value }))}
                  required
                  maxLength={64}
                  placeholder="Acme Corp Root CA"
                  className="w-full px-3 py-2 border rounded-md bg-background"
                />
                <p className="text-xs text-muted-foreground mt-1">
                  The name of your Certificate Authority (e.g., "Company Name Root CA")
                </p>
              </div>

              <div>
                <label className="block text-sm font-medium mb-2">
                  Organization (O) *
                </label>
                <input
                  type="text"
                  value={formData.organization}
                  onChange={(e) => setFormData(prev => ({ ...prev, organization: e.target.value }))}
                  required
                  maxLength={64}
                  placeholder="Acme Corporation"
                  className="w-full px-3 py-2 border rounded-md bg-background"
                />
              </div>

              <div>
                <label className="block text-sm font-medium mb-2">
                  Organizational Unit (OU)
                </label>
                <input
                  type="text"
                  value={formData.organizationalUnit}
                  onChange={(e) => setFormData(prev => ({ ...prev, organizationalUnit: e.target.value }))}
                  maxLength={64}
                  placeholder="PKI Division"
                  className="w-full px-3 py-2 border rounded-md bg-background"
                />
              </div>

              <div>
                <label className="block text-sm font-medium mb-2">
                  Country (C) *
                </label>
                <input
                  type="text"
                  value={formData.country}
                  onChange={(e) => setFormData(prev => ({ ...prev, country: e.target.value.toUpperCase() }))}
                  required
                  maxLength={2}
                  placeholder="US"
                  className="w-full px-3 py-2 border rounded-md bg-background"
                />
                <p className="text-xs text-muted-foreground mt-1">2-letter ISO country code</p>
              </div>

              <div>
                <label className="block text-sm font-medium mb-2">
                  State/Province (ST)
                </label>
                <input
                  type="text"
                  value={formData.state}
                  onChange={(e) => setFormData(prev => ({ ...prev, state: e.target.value }))}
                  maxLength={128}
                  placeholder="California"
                  className="w-full px-3 py-2 border rounded-md bg-background"
                />
              </div>

              <div>
                <label className="block text-sm font-medium mb-2">
                  Locality/City (L)
                </label>
                <input
                  type="text"
                  value={formData.locality}
                  onChange={(e) => setFormData(prev => ({ ...prev, locality: e.target.value }))}
                  maxLength={128}
                  placeholder="San Francisco"
                  className="w-full px-3 py-2 border rounded-md bg-background"
                />
              </div>
            </div>
          </div>

          {/* Technical Parameters */}
          <div className="space-y-4">
            <h3 className="font-medium text-lg border-b pb-2">Technical Parameters</h3>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium mb-2">
                  Key Algorithm
                </label>
                <select
                  value={formData.keyAlgorithm}
                  onChange={(e) => setFormData(prev => ({ ...prev, keyAlgorithm: e.target.value as any }))}
                  className="w-full px-3 py-2 border rounded-md bg-background"
                >
                  <option value="RSA-2048">RSA 2048 (Standard)</option>
                  <option value="RSA-4096">RSA 4096 (Recommended for CAs)</option>
                </select>
                <p className="text-xs text-muted-foreground mt-1">
                  RSA-4096 is recommended for root CAs. ECDSA not supported by KMS.
                </p>
              </div>

              <div>
                <label className="block text-sm font-medium mb-2">
                  Validity Period (years) *
                </label>
                <input
                  type="number"
                  value={formData.validityYears}
                  onChange={(e) => setFormData(prev => ({ ...prev, validityYears: parseInt(e.target.value) }))}
                  required
                  min={1}
                  max={30}
                  className="w-full px-3 py-2 border rounded-md bg-background"
                />
                <p className="text-xs text-muted-foreground mt-1">
                  1-30 years (default 20). Root CAs typically have long validity periods (10-30 years)
                </p>
              </div>
            </div>
          </div>

          {/* Information Box */}
          <div className="p-4 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-md">
            <h4 className="font-medium text-sm text-blue-900 dark:text-blue-200 mb-2">What happens when you create a CA?</h4>
            <ul className="text-xs text-blue-700 dark:text-blue-300 space-y-1 list-disc list-inside">
              <li>A new key pair is generated and stored securely in Cosmian KMS</li>
              <li>A self-signed X.509 v3 certificate is created with CA=true</li>
              <li>The certificate is configured to sign other certificates and CRLs</li>
              <li>The CA becomes available for issuing end-entity certificates</li>
              <li>Both certificate and metadata are stored in the local database</li>
            </ul>
          </div>

          {/* Form Actions */}
          <div className="flex gap-3 justify-end pt-4 border-t">
            <button
              type="button"
              onClick={() => navigate({ to: '/cas' })}
              className="px-6 py-2 border rounded-md hover:bg-muted"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={createMutation.isPending}
              className="px-6 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 disabled:opacity-50"
            >
              {createMutation.isPending ? 'Creating CA...' : 'Create Certificate Authority'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
