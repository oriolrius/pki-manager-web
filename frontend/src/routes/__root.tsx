import { createRootRoute, Outlet, Link, useMatchRoute, useRouterState } from '@tanstack/react-router';
import { TanStackRouterDevtools } from '@tanstack/router-devtools';
import { ThemeToggle } from '@/components/theme-toggle';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faChartLine, faShield, faCertificate, faLayerGroup, faBook, faTerminal, faServer } from '@fortawesome/free-solid-svg-icons';
import { ChevronDown, Menu, X } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import packageJson from '../../../package.json';
import { AuthProvider, AuthGuard } from '@/lib/auth';
import { UserMenu } from '@/components/UserMenu';
import { UiProvider } from '@/components/ui';

export const Route = createRootRoute({
  component: RootComponent,
});

function RootComponent() {
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const matchRoute = useMatchRoute();
  const locationSearch = useRouterState({ select: (state) => state.location.search as { zone?: unknown } });
  const isPkiActive = Boolean(matchRoute({ to: '/cas', fuzzy: true }) || matchRoute({ to: '/certificates', fuzzy: true }));
  const isOperationsActive = Boolean(matchRoute({ to: '/clusters', fuzzy: true }) || matchRoute({ to: '/api-docs', fuzzy: true }));
  const sshSearch = () => {
    const currentZone = typeof locationSearch.zone === 'string' ? locationSearch.zone : undefined;
    if (currentZone) return { zone: currentZone };
    try {
      const savedZone = localStorage.getItem('ssh.selectedZone');
      return savedZone && savedZone !== 'all' ? { zone: savedZone } : {};
    } catch {
      return {};
    }
  };

  return (
    <UiProvider>
    <AuthProvider>
      <AuthGuard>
    <div className="min-h-screen bg-background">
      <nav className="sticky top-0 z-40 border-b bg-card/95 shadow-sm backdrop-blur supports-[backdrop-filter]:bg-card/85">
        <div className="container mx-auto px-4 sm:px-6">
          <div className="flex min-h-16 items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-3 lg:gap-8">
              <Link to="/" className="flex shrink-0 items-baseline gap-2 hover:opacity-80 transition-opacity">
                <span className="text-xl font-bold text-primary sm:text-2xl">PKI Manager</span>
                <span className="hidden text-xs text-muted-foreground sm:inline">v{packageJson.version}</span>
              </Link>
              <div className="hidden items-center gap-1 md:flex">
                <Link
                  to="/"
                  className="flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium text-foreground/70 transition-colors hover:bg-accent/50 hover:text-foreground"
                  activeProps={{
                    className: 'flex items-center gap-2 rounded-md bg-primary/10 px-3 py-2 text-sm font-medium text-primary transition-colors hover:bg-primary/15'
                  }}
                  activeOptions={{ exact: true }}
                >
                  <FontAwesomeIcon icon={faChartLine} className="h-4 w-4" />
                  Dashboard
                </Link>
                <TopNavMenu label="PKI" icon={faShield} active={isPkiActive}>
                  <NavMenuLink to="/cas" icon={faShield} label="Certificate Authorities" />
                  <NavMenuLink to="/certificates" icon={faCertificate} label="Certificates" />
                  <NavMenuLink to="/certificates/bulk" icon={faLayerGroup} label="Bulk operations" />
                </TopNavMenu>
                <Link
                  to="/ssh"
                  search={sshSearch}
                  className="flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium text-foreground/70 transition-colors hover:bg-accent/50 hover:text-foreground"
                  activeProps={{
                    className: 'flex items-center gap-2 rounded-md bg-primary/10 px-3 py-2 text-sm font-medium text-primary transition-colors hover:bg-primary/15'
                  }}
                >
                  <FontAwesomeIcon icon={faTerminal} className="h-4 w-4" />
                  SSH
                </Link>
                <TopNavMenu label="Operations" icon={faServer} active={isOperationsActive}>
                  <NavMenuLink to="/clusters" icon={faServer} label="Clusters" />
                  <NavMenuLink to="/api-docs" icon={faBook} label="API documentation" />
                </TopNavMenu>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <UserMenu />
              <ThemeToggle />
              <button
                type="button"
                className="inline-flex h-9 w-9 items-center justify-center rounded-md text-foreground/70 transition-colors hover:bg-accent/50 hover:text-foreground md:hidden"
                onClick={() => setMobileNavOpen((open) => !open)}
                aria-expanded={mobileNavOpen}
                aria-label={mobileNavOpen ? 'Close navigation' : 'Open navigation'}
              >
                {mobileNavOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
              </button>
            </div>
          </div>
          {mobileNavOpen && (
            <div className="border-t py-3 md:hidden">
              <div className="grid gap-1 sm:grid-cols-2">
                <MobileNavLink to="/" icon={faChartLine} label="Dashboard" onNavigate={() => setMobileNavOpen(false)} />
                <MobileNavLink to="/cas" icon={faShield} label="Certificate Authorities" onNavigate={() => setMobileNavOpen(false)} />
                <MobileNavLink to="/certificates" icon={faCertificate} label="Certificates" onNavigate={() => setMobileNavOpen(false)} />
                <MobileNavLink to="/certificates/bulk" icon={faLayerGroup} label="Bulk operations" onNavigate={() => setMobileNavOpen(false)} />
                <MobileNavLink to="/ssh" search={sshSearch} icon={faTerminal} label="SSH certificate manager" onNavigate={() => setMobileNavOpen(false)} />
                <MobileNavLink to="/clusters" icon={faServer} label="Clusters" onNavigate={() => setMobileNavOpen(false)} />
                <MobileNavLink to="/api-docs" icon={faBook} label="API documentation" onNavigate={() => setMobileNavOpen(false)} />
              </div>
            </div>
          )}
        </div>
      </nav>
      <main className="container mx-auto px-4 py-6 sm:px-6">
        <Outlet />
      </main>
      {import.meta.env.DEV && <TanStackRouterDevtools position="bottom-right" />}
    </div>
      </AuthGuard>
    </AuthProvider>
    </UiProvider>
  );
}

function TopNavMenu({ label, icon, active, children }: { label: string; icon: typeof faShield; active: boolean; children: ReactNode }) {
  return (
    <details
      className="group relative"
      data-navigation-menu
    >
      <summary
        onClick={(event) => {
          const currentMenu = event.currentTarget.parentElement;
          document.querySelectorAll<HTMLDetailsElement>('details[data-navigation-menu]').forEach((menu) => {
            if (menu !== currentMenu) menu.open = false;
          });
        }}
        className={`flex cursor-pointer list-none items-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors hover:bg-accent/50 hover:text-foreground [&::-webkit-details-marker]:hidden ${
          active ? 'bg-primary/10 text-primary' : 'text-foreground/70'
        }`}
      >
        <FontAwesomeIcon icon={icon} className="h-4 w-4" />
        {label}
        <ChevronDown className="h-3.5 w-3.5 transition-transform group-open:rotate-180" />
      </summary>
      <div className="absolute left-0 top-full z-50 mt-2 min-w-60 rounded-md border bg-popover p-1 shadow-lg">
        {children}
      </div>
    </details>
  );
}

function NavMenuLink({ to, icon, label }: { to: '/cas' | '/certificates' | '/certificates/bulk' | '/clusters' | '/api-docs'; icon: typeof faShield; label: string }) {
  return (
    <Link
      to={to}
      className="flex items-center gap-2 rounded-sm px-3 py-2 text-sm text-foreground/80 transition-colors hover:bg-accent/50 hover:text-foreground"
      activeProps={{ className: 'flex items-center gap-2 rounded-sm bg-primary/10 px-3 py-2 text-sm text-primary' }}
      onClick={(event) => event.currentTarget.closest('details')?.removeAttribute('open')}
    >
      <FontAwesomeIcon icon={icon} className="h-4 w-4" />
      {label}
    </Link>
  );
}

function MobileNavLink({ to, search, icon, label, onNavigate }: { to: '/' | '/cas' | '/certificates' | '/certificates/bulk' | '/ssh' | '/clusters' | '/api-docs'; search?: () => { zone?: string }; icon: typeof faShield; label: string; onNavigate: () => void }) {
  return (
    <Link
      to={to}
      search={search}
      className="flex items-center gap-3 rounded-md px-3 py-2.5 text-sm font-medium text-foreground/80 transition-colors hover:bg-accent/50 hover:text-foreground"
      activeProps={{ className: 'flex items-center gap-3 rounded-md bg-primary/10 px-3 py-2.5 text-sm font-medium text-primary' }}
      onClick={onNavigate}
    >
      <FontAwesomeIcon icon={icon} className="h-4 w-4" />
      {label}
    </Link>
  );
}
