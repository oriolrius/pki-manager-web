import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { trpc } from '@/lib/trpc';
import { ArrowLeft, Info } from 'lucide-react';
import { useState } from 'react';

export const Route = createFileRoute('/ssh/cas/new')({
  component: NewSshCa,
  validateSearch: (search: Record<string, unknown>): { caType?: 'user' | 'host' } => ({
    caType: search.caType === 'host' ? 'host' : search.caType === 'user' ? 'user' : undefined,
  }),
});

function NewSshCa() {
  const navigate = useNavigate();
  const utils = trpc.useUtils();
  const { caType: initialType } = Route.useSearch();

  const [caType, setCaType] = useState<'user' | 'host'>(initialType ?? 'user');
  const [label, setLabel] = useState('');

  const createMutation = trpc.ssh.ca.create.useMutation();

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    createMutation.mutate(
      { caType, label: label.trim() || undefined },
      {
        onSuccess: (ca) => {
          utils.ssh.ca.list.invalidate();
          utils.ssh.ca.trustAnchors.invalidate();
          navigate({ to: '/ssh/cas/$id', params: { id: ca.id } });
        },
        onError: (error) => {
          alert(`Failed to create SSH CA: ${error.message}`);
        },
      }
    );
  };

  return (
    <div className="space-y-6 max-w-2xl">
      <button
        onClick={() => navigate({ to: '/ssh/cas' })}
        className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to SSH CAs
      </button>

      <div className="rounded-lg border bg-card">
        <div className="p-6 border-b">
          <h1 className="text-2xl font-bold">Create SSH Certificate Authority</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Generates a non-exportable ECDSA nistp256 key in Cosmian KMS and registers it as an SSH CA.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-6">
          <div>
            <label className="block text-sm font-medium mb-2">CA Type *</label>
            <select
              value={caType}
              onChange={(e) => setCaType(e.target.value as 'user' | 'host')}
              className="w-full px-3 py-2 border rounded-md bg-background"
            >
              <option value="user">User CA — signs user login certificates</option>
              <option value="host">Host CA — signs host (server) certificates</option>
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium mb-2">Label (optional)</label>
            <input
              type="text"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              maxLength={128}
              placeholder={caType === 'user' ? 'Corp User CA' : 'Corp Host CA'}
              className="w-full px-3 py-2 border rounded-md bg-background"
            />
          </div>

          <div className="flex items-start gap-2 text-xs text-muted-foreground p-3 rounded-md bg-primary/10 border border-primary/20">
            <Info className="h-4 w-4 mt-0.5 flex-shrink-0 text-primary" />
            <span>
              SSH CAs are <strong>ECDSA nistp256 only</strong>. The private key never leaves the KMS. Only one active CA
              per type is allowed.
            </span>
          </div>

          <div className="flex gap-3 justify-end pt-4 border-t">
            <button
              type="button"
              onClick={() => navigate({ to: '/ssh/cas' })}
              className="px-6 py-2 border rounded-md hover:bg-muted"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={createMutation.isPending}
              className="px-6 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 disabled:opacity-50 font-medium shadow-sm"
            >
              {createMutation.isPending ? 'Creating...' : 'Create SSH CA'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
