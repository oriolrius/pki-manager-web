import { createFileRoute } from '@tanstack/react-router';
import { trpc } from '@/lib/trpc';
import { useState } from 'react';
import { Info, Archive, ArchiveRestore, Check, Pencil, X } from 'lucide-react';
import { Callout } from '@/components/ssh/Callout';
import { useToast, useConfirm } from '@/components/ui';

export const Route = createFileRoute('/ssh/zones')({
  component: SshZones,
});

const STATUS_STYLES: Record<string, string> = {
  active: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200',
  archived: 'bg-gray-100 text-gray-800 dark:bg-gray-900 dark:text-gray-200',
};

function SshZones() {
  const toast = useToast();
  const confirm = useConfirm();
  const utils = trpc.useUtils();

  const zonesQuery = trpc.ssh.zone.list.useQuery({ includeArchived: true });
  const createMutation = trpc.ssh.zone.create.useMutation();
  const updateMutation = trpc.ssh.zone.update.useMutation();
  const archiveMutation = trpc.ssh.zone.archive.useMutation();
  const unarchiveMutation = trpc.ssh.zone.unarchive.useMutation();

  const [name, setName] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [description, setDescription] = useState('');
  const [editing, setEditing] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');

  const zones = zonesQuery.data ?? [];

  const invalidate = () => {
    utils.ssh.zone.list.invalidate();
  };

  const handleCreate = (e: React.FormEvent) => {
    e.preventDefault();
    createMutation.mutate(
      { name: name.trim(), displayName: displayName.trim() || undefined, description: description.trim() || undefined },
      {
        onSuccess: () => {
          invalidate();
          setName('');
          setDisplayName('');
          setDescription('');
          toast.success('Zone created');
        },
        onError: (err) => toast.error(`Failed to create zone: ${err.message}`),
      }
    );
  };

  const saveRename = (ref: string) => {
    updateMutation.mutate(
      { ref, displayName: editValue.trim() || undefined },
      {
        onSuccess: () => {
          invalidate();
          setEditing(null);
          toast.success('Zone updated');
        },
        onError: (err) => toast.error(`Failed to update zone: ${err.message}`),
      }
    );
  };

  const toggleArchive = async (zone: { id: string; name: string; status: string }) => {
    if (zone.status === 'active') {
      const { confirmed } = await confirm({
        title: `Archive zone "${zone.name}"?`,
        description:
          'Archiving blocks new CAs, hosts, identities, principals and issuance in this zone. Existing trust material (KRLs, trust downloads) keeps being served.',
        confirmLabel: 'Archive',
        tone: 'danger',
      });
      if (!confirmed) return;
      archiveMutation.mutate(
        { ref: zone.id },
        { onSuccess: () => { invalidate(); toast.success('Zone archived'); }, onError: (e) => toast.error(e.message) }
      );
    } else {
      unarchiveMutation.mutate(
        { ref: zone.id },
        { onSuccess: () => { invalidate(); toast.success('Zone reactivated'); }, onError: (e) => toast.error(e.message) }
      );
    }
  };

  return (
    <div className="space-y-4">
      <h2 className="text-lg font-semibold">Zones</h2>

      <Callout title="Zones are trust boundaries, not labels">
        Each zone has its own User CA and Host CA. A host in a zone trusts <strong>only</strong> that zone's user CAs.
        A zone name is a URL-safe slug and is <strong>immutable</strong> once created; you can rename its display name,
        and archive it (which blocks new issuance while still serving existing trust material) instead of deleting it.
      </Callout>

      <form onSubmit={handleCreate} className="rounded-lg border bg-card p-4 grid gap-3 sm:grid-cols-4 items-end">
        <div className="sm:col-span-1">
          <label className="block text-sm font-medium mb-1">Name (slug) *</label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            placeholder="prod"
            pattern="[a-z0-9]([a-z0-9-]*[a-z0-9])?"
            title="URL-safe slug: lowercase letters, digits and dashes"
            className="w-full px-3 py-2 border rounded-md bg-background"
          />
        </div>
        <div className="sm:col-span-1">
          <label className="block text-sm font-medium mb-1">Display name</label>
          <input
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            placeholder="Production"
            className="w-full px-3 py-2 border rounded-md bg-background"
          />
        </div>
        <div className="sm:col-span-1">
          <label className="block text-sm font-medium mb-1">Description</label>
          <input
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="optional"
            className="w-full px-3 py-2 border rounded-md bg-background"
          />
        </div>
        <button
          type="submit"
          disabled={createMutation.isPending || !name.trim()}
          className="px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 font-medium shadow-sm disabled:opacity-50"
        >
          {createMutation.isPending ? 'Creating…' : 'Create zone'}
        </button>
      </form>

      <div className="flex items-start gap-2 text-xs text-muted-foreground p-3 rounded-md bg-muted/50 border">
        <Info className="h-4 w-4 mt-0.5 flex-shrink-0" />
        <span>The seeded <code className="font-mono">default</code> zone holds everything from before zones existed.</span>
      </div>

      {zonesQuery.isLoading && <div className="text-center py-8 text-muted-foreground">Loading…</div>}
      {zonesQuery.isError && <div className="text-center py-8 text-destructive">Error loading zones</div>}

      {zonesQuery.isSuccess && (
        <div className="rounded-lg border overflow-x-auto">
          <table className="w-full">
            <thead className="border-b bg-muted/50">
              <tr>
                <th className="px-4 py-3 text-left text-sm font-medium">Name</th>
                <th className="px-4 py-3 text-left text-sm font-medium">Display name</th>
                <th className="px-4 py-3 text-left text-sm font-medium">Description</th>
                <th className="px-4 py-3 text-left text-sm font-medium">Status</th>
                <th className="px-4 py-3 text-right text-sm font-medium">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {zones.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-muted-foreground">
                    No zones yet.
                  </td>
                </tr>
              ) : (
                zones.map((zone) => (
                  <tr key={zone.id} className={zone.status === 'archived' ? 'opacity-60' : ''}>
                    <td className="px-4 py-3">
                      <code className="text-xs font-mono">{zone.name}</code>
                    </td>
                    <td className="px-4 py-3 text-sm">
                      {editing === zone.id ? (
                        <div className="flex items-center gap-1">
                          <input
                            value={editValue}
                            onChange={(e) => setEditValue(e.target.value)}
                            className="px-2 py-1 border rounded bg-background text-sm w-40"
                            autoFocus
                          />
                          <button
                            onClick={() => saveRename(zone.id)}
                            className="p-1 text-green-600 hover:bg-muted rounded"
                            title="Save"
                          >
                            <Check className="h-4 w-4" />
                          </button>
                          <button onClick={() => setEditing(null)} className="p-1 text-muted-foreground hover:bg-muted rounded" title="Cancel">
                            <X className="h-4 w-4" />
                          </button>
                        </div>
                      ) : (
                        <span className="inline-flex items-center gap-1">
                          {zone.displayName}
                          <button
                            onClick={() => {
                              setEditing(zone.id);
                              setEditValue(zone.displayName);
                            }}
                            className="p-1 text-muted-foreground hover:text-foreground"
                            title="Rename display name"
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </button>
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-sm text-muted-foreground">
                      {zone.description || <span className="text-muted-foreground/60">—</span>}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-medium ${
                          STATUS_STYLES[zone.status] ?? STATUS_STYLES.archived
                        }`}
                      >
                        {zone.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button
                        onClick={() => toggleArchive(zone)}
                        className="inline-flex items-center gap-1 px-2 py-1 text-xs border rounded-md hover:bg-muted"
                      >
                        {zone.status === 'active' ? (
                          <>
                            <Archive className="h-3.5 w-3.5" /> Archive
                          </>
                        ) : (
                          <>
                            <ArchiveRestore className="h-3.5 w-3.5" /> Reactivate
                          </>
                        )}
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
