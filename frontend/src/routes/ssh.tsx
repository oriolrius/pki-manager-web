import { createFileRoute, Outlet, Link, useMatchRoute, useNavigate } from '@tanstack/react-router';
import { trpc } from '@/lib/trpc';
import { Terminal, ShieldCheck, Server, Users, Tags, Ban } from 'lucide-react';

export const Route = createFileRoute('/ssh')({
  component: SshSection,
});

const SUB_NAV = [
  { to: '/ssh/cas', label: 'Certificate Authorities', icon: ShieldCheck },
  { to: '/ssh/hosts', label: 'Hosts', icon: Server },
  { to: '/ssh/users', label: 'Users', icon: Users },
  { to: '/ssh/principals', label: 'Principals', icon: Tags },
  { to: '/ssh/krl', label: 'KRL', icon: Ban },
] as const;

function SshSection() {
  const matchRoute = useMatchRoute();
  const navigate = useNavigate();
  const isIndex = matchRoute({ to: '/ssh', fuzzy: false });
  const casQuery = trpc.ssh.ca.list.useQuery();

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
          <Terminal className="h-5 w-5 text-primary" />
        </div>
        <div>
          <h1 className="text-2xl font-bold">SSH Certificate Manager</h1>
          <p className="text-sm text-muted-foreground">
            Issue and manage OpenSSH user &amp; host certificates, principals, and KRLs.
          </p>
        </div>
      </div>

      {/* Second-level sub-nav */}
      <div className="flex flex-wrap gap-1 border-b">
        {SUB_NAV.map(({ to, label, icon: Icon }) => (
          <Link
            key={to}
            to={to}
            className="px-3 py-2 text-sm font-medium rounded-t-md text-foreground/70 hover:text-foreground hover:bg-accent/50 transition-colors flex items-center gap-2 border-b-2 border-transparent"
            activeProps={{
              className:
                'px-3 py-2 text-sm font-medium rounded-t-md text-primary bg-primary/10 transition-colors flex items-center gap-2 border-b-2 border-primary',
            }}
          >
            <Icon className="h-4 w-4" />
            {label}
          </Link>
        ))}
      </div>

      {isIndex ? (
        <SshLanding
          casLoading={casQuery.isLoading}
          casCount={casQuery.data?.length ?? 0}
          onCreateCa={() => navigate({ to: '/ssh/cas/new' })}
        />
      ) : (
        <Outlet />
      )}
    </div>
  );
}

function SshLanding({
  casLoading,
  casCount,
  onCreateCa,
}: {
  casLoading: boolean;
  casCount: number;
  onCreateCa: () => void;
}) {
  if (casLoading) {
    return <div className="text-center py-8 text-muted-foreground">Loading...</div>;
  }

  if (casCount === 0) {
    return (
      <div className="rounded-lg border bg-card p-10 text-center space-y-4">
        <div className="mx-auto w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center">
          <ShieldCheck className="h-6 w-6 text-primary" />
        </div>
        <div>
          <h2 className="text-lg font-semibold">Create your SSH dual CA first</h2>
          <p className="text-sm text-muted-foreground mt-1 max-w-md mx-auto">
            An SSH deployment needs a <strong>User CA</strong> (signs user login certificates) and a{' '}
            <strong>Host CA</strong> (signs host certificates). Create them to start issuing certificates.
          </p>
        </div>
        <button
          onClick={onCreateCa}
          className="px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 font-medium shadow-sm"
        >
          Create SSH CA
        </button>
      </div>
    );
  }

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {SUB_NAV.map(({ to, label, icon: Icon }) => (
        <Link
          key={to}
          to={to}
          className="rounded-lg border bg-card p-5 hover:bg-muted/50 transition-colors flex items-center gap-3"
        >
          <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0">
            <Icon className="h-5 w-5 text-primary" />
          </div>
          <div>
            <div className="font-medium">{label}</div>
            <div className="text-xs text-muted-foreground">Manage SSH {label.toLowerCase()}</div>
          </div>
        </Link>
      ))}
    </div>
  );
}
