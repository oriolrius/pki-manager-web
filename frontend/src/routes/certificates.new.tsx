import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { trpc } from '@/lib/trpc';
import { ArrowLeft, Shuffle } from 'lucide-react';
import { useState } from 'react';

export const Route = createFileRoute('/certificates/new')({
  component: NewCertificate,
});

function NewCertificate() {
  const navigate = useNavigate();
  const utils = trpc.useUtils();
  const [formData, setFormData] = useState({
    caId: '',
    commonName: '',
    organization: '',
    organizationalUnit: '',
    country: '',
    state: '',
    locality: '',
    certificateType: 'server' as 'server' | 'client' | 'code_signing' | 'email',
    keyAlgorithm: 'RSA-2048' as 'RSA-2048' | 'RSA-4096' | 'ECDSA-P256' | 'ECDSA-P384',
    validityDays: 365,
    sanDns: [''],
    sanIp: [''],
    sanEmail: [''],
  });

  const casQuery = trpc.ca.list.useQuery({ limit: 100, offset: 0 });
  const issueMutation = trpc.certificate.issue.useMutation();

  const generateRandomData = () => {
    const randomString = Math.random().toString(36).substring(2, 8);
    const domains = ['example.com', 'test.org', 'demo.net', 'sample.io'];
    const orgs = ['Acme Corp', 'Test Inc', 'Demo LLC', 'Sample Ltd'];
    const countries = ['US', 'GB', 'DE', 'FR', 'ES', 'IT', 'CA'];
    const states = ['California', 'New York', 'Texas', 'Florida', 'Washington'];
    const cities = ['San Francisco', 'New York', 'Austin', 'Miami', 'Seattle'];

    const randomDomain = domains[Math.floor(Math.random() * domains.length)];
    const randomOrg = orgs[Math.floor(Math.random() * orgs.length)];
    const randomCountry = countries[Math.floor(Math.random() * countries.length)];
    const randomState = states[Math.floor(Math.random() * states.length)];
    const randomCity = cities[Math.floor(Math.random() * cities.length)];

    setFormData(prev => ({
      ...prev,
      commonName: formData.certificateType === 'email'
        ? `user-${randomString}@${randomDomain}`
        : formData.certificateType === 'client'
        ? `client-${randomString}`
        : `${randomString}.${randomDomain}`,
      organization: randomOrg,
      organizationalUnit: 'IT Department',
      country: randomCountry,
      state: randomState,
      locality: randomCity,
      sanDns: formData.certificateType === 'server' ? [`${randomString}.${randomDomain}`, `www.${randomString}.${randomDomain}`] : [''],
      sanEmail: formData.certificateType === 'email' ? [`user-${randomString}@${randomDomain}`] : [''],
    }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    try {
      const result = await issueMutation.mutateAsync({
        caId: formData.caId,
        subject: {
          commonName: formData.commonName,
          organization: formData.organization,
          organizationalUnit: formData.organizationalUnit || undefined,
          country: formData.country,
          state: formData.state || undefined,
          locality: formData.locality || undefined,
        },
        certificateType: formData.certificateType,
        keyAlgorithm: formData.keyAlgorithm,
        validityDays: formData.validityDays,
        sanDns: formData.sanDns.filter(s => s.trim()).length > 0 ? formData.sanDns.filter(s => s.trim()) : undefined,
        sanIp: formData.sanIp.filter(s => s.trim()).length > 0 ? formData.sanIp.filter(s => s.trim()) : undefined,
        sanEmail: formData.sanEmail.filter(s => s.trim()).length > 0 ? formData.sanEmail.filter(s => s.trim()) : undefined,
      });

      utils.certificate.list.invalidate();
      navigate({ to: `/certificates/${result.id}` });
    } catch (error: any) {
      alert(`Failed to issue certificate: ${error.message}`);
    }
  };

  const updateSanField = (type: 'sanDns' | 'sanIp' | 'sanEmail', index: number, value: string) => {
    setFormData(prev => ({
      ...prev,
      [type]: prev[type].map((v, i) => i === index ? value : v),
    }));
  };

  const addSanField = (type: 'sanDns' | 'sanIp' | 'sanEmail') => {
    setFormData(prev => ({
      ...prev,
      [type]: [...prev[type], ''],
    }));
  };

  const removeSanField = (type: 'sanDns' | 'sanIp' | 'sanEmail', index: number) => {
    setFormData(prev => ({
      ...prev,
      [type]: prev[type].filter((_, i) => i !== index),
    }));
  };

  return (
    <div className="space-y-6 max-w-4xl">
      {/* Header */}
      <div className="flex items-center justify-between">
        <button
          onClick={() => navigate({ to: '/certificates' })}
          className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to Certificates
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
          <h1 className="text-2xl font-bold">Issue New Certificate</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Create a new X.509 v3 certificate with the following extensions:
          </p>
          <ul className="text-xs text-muted-foreground mt-2 space-y-1 list-disc list-inside">
            <li>Basic Constraints (CA=false for end-entity certificates)</li>
            <li>Key Usage (digitalSignature, keyEncipherment for server/client)</li>
            <li>Extended Key Usage (serverAuth for server, clientAuth for client, codeSigning for code signing, emailProtection for email)</li>
            <li>Subject Alternative Names (DNS, IP, Email as specified)</li>
            <li>Subject Key Identifier</li>
            <li>Authority Key Identifier</li>
          </ul>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-6">
          {/* CA Selection */}
          <div>
            <label className="block text-sm font-medium mb-2">
              Certificate Authority *
            </label>
            <select
              value={formData.caId}
              onChange={(e) => setFormData(prev => ({ ...prev, caId: e.target.value }))}
              required
              className="w-full px-3 py-2 border rounded-md bg-background"
            >
              <option value="">Select a CA</option>
              {casQuery.data?.filter(ca => ca.status === 'active').map(ca => {
                const cnMatch = ca.subject.match(/CN=([^,]+)/);
                const cn = cnMatch ? cnMatch[1] : ca.subject;
                return (
                  <option key={ca.id} value={ca.id}>
                    {cn}
                  </option>
                );
              })}
            </select>
          </div>

          {/* Certificate Type */}
          <div>
            <label className="block text-sm font-medium mb-2">
              Certificate Type *
            </label>
            <select
              value={formData.certificateType}
              onChange={(e) => setFormData(prev => ({ ...prev, certificateType: e.target.value as any }))}
              className="w-full px-3 py-2 border rounded-md bg-background"
            >
              <option value="server">Server (TLS/SSL Web Server)</option>
              <option value="client">Client (User Authentication)</option>
              <option value="code_signing">Code Signing</option>
              <option value="email">Email (S/MIME)</option>
            </select>
            <p className="text-xs text-muted-foreground mt-1">
              {formData.certificateType === 'server' && 'For web servers, API endpoints, and TLS/SSL connections'}
              {formData.certificateType === 'client' && 'For client authentication and user identity. CN can be any identifier (username, ID, etc.)'}
              {formData.certificateType === 'code_signing' && 'For signing software, scripts, and executable code'}
              {formData.certificateType === 'email' && 'For email encryption and signing (S/MIME). CN should be an email address'}
            </p>
          </div>

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
                  placeholder={
                    formData.certificateType === 'server' ? 'example.com or *.example.com' :
                    formData.certificateType === 'email' ? 'user@example.com' :
                    formData.certificateType === 'client' ? 'username or client-id' :
                    'identifier'
                  }
                  className="w-full px-3 py-2 border rounded-md bg-background"
                />
                <p className="text-xs text-muted-foreground mt-1">
                  {formData.certificateType === 'server' && 'Domain name or wildcard (e.g., example.com or *.example.com)'}
                  {formData.certificateType === 'client' && 'User identifier - can be username, employee ID, or any unique identifier'}
                  {formData.certificateType === 'email' && 'Email address for S/MIME'}
                  {formData.certificateType === 'code_signing' && 'Developer or organization name'}
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
                  placeholder="IT Department"
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
                  <option value="RSA-4096">RSA 4096 (High Security)</option>
                  <option value="ECDSA-P256">ECDSA P-256 (Fast, Modern)</option>
                  <option value="ECDSA-P384">ECDSA P-384 (High Security)</option>
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium mb-2">
                  Validity Period (days) *
                </label>
                <input
                  type="number"
                  value={formData.validityDays}
                  onChange={(e) => setFormData(prev => ({ ...prev, validityDays: parseInt(e.target.value) }))}
                  required
                  min={1}
                  max={825}
                  className="w-full px-3 py-2 border rounded-md bg-background"
                />
                <p className="text-xs text-muted-foreground mt-1">Maximum 825 days (Apple/Chrome requirement)</p>
              </div>
            </div>
          </div>

          {/* Subject Alternative Names */}
          <div className="space-y-4">
            <h3 className="font-medium text-lg border-b pb-2">Subject Alternative Names (Optional)</h3>
            <p className="text-sm text-muted-foreground">
              SANs provide additional identities for the certificate. For server certificates, include all domains/IPs.
            </p>

            {/* DNS Names */}
            <div>
              <label className="block text-sm font-medium mb-2">DNS Names</label>
              {formData.sanDns.map((dns, index) => (
                <div key={index} className="flex gap-2 mb-2">
                  <input
                    type="text"
                    value={dns}
                    onChange={(e) => updateSanField('sanDns', index, e.target.value)}
                    placeholder="example.com"
                    className="flex-1 px-3 py-2 border rounded-md bg-background"
                  />
                  {formData.sanDns.length > 1 && (
                    <button
                      type="button"
                      onClick={() => removeSanField('sanDns', index)}
                      className="px-3 py-2 text-red-600 border border-red-600 rounded-md hover:bg-red-50"
                    >
                      Remove
                    </button>
                  )}
                </div>
              ))}
              <button
                type="button"
                onClick={() => addSanField('sanDns')}
                className="text-sm text-primary hover:underline"
              >
                + Add DNS Name
              </button>
            </div>

            {/* IP Addresses */}
            <div>
              <label className="block text-sm font-medium mb-2">IP Addresses</label>
              {formData.sanIp.map((ip, index) => (
                <div key={index} className="flex gap-2 mb-2">
                  <input
                    type="text"
                    value={ip}
                    onChange={(e) => updateSanField('sanIp', index, e.target.value)}
                    placeholder="192.168.1.1"
                    className="flex-1 px-3 py-2 border rounded-md bg-background"
                  />
                  {formData.sanIp.length > 1 && (
                    <button
                      type="button"
                      onClick={() => removeSanField('sanIp', index)}
                      className="px-3 py-2 text-red-600 border border-red-600 rounded-md hover:bg-red-50"
                    >
                      Remove
                    </button>
                  )}
                </div>
              ))}
              <button
                type="button"
                onClick={() => addSanField('sanIp')}
                className="text-sm text-primary hover:underline"
              >
                + Add IP Address
              </button>
            </div>

            {/* Email Addresses */}
            <div>
              <label className="block text-sm font-medium mb-2">Email Addresses</label>
              {formData.sanEmail.map((email, index) => (
                <div key={index} className="flex gap-2 mb-2">
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => updateSanField('sanEmail', index, e.target.value)}
                    placeholder="user@example.com"
                    className="flex-1 px-3 py-2 border rounded-md bg-background"
                  />
                  {formData.sanEmail.length > 1 && (
                    <button
                      type="button"
                      onClick={() => removeSanField('sanEmail', index)}
                      className="px-3 py-2 text-red-600 border border-red-600 rounded-md hover:bg-red-50"
                    >
                      Remove
                    </button>
                  )}
                </div>
              ))}
              <button
                type="button"
                onClick={() => addSanField('sanEmail')}
                className="text-sm text-primary hover:underline"
              >
                + Add Email Address
              </button>
            </div>
          </div>

          {/* Form Actions */}
          <div className="flex gap-3 justify-end pt-4 border-t">
            <button
              type="button"
              onClick={() => navigate({ to: '/certificates' })}
              className="px-6 py-2 border rounded-md hover:bg-muted"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={issueMutation.isPending}
              className="px-6 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 disabled:opacity-50"
            >
              {issueMutation.isPending ? 'Issuing Certificate...' : 'Issue Certificate'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
