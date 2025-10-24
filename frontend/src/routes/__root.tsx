import { createRootRoute, Outlet, Link } from '@tanstack/react-router';
import { TanStackRouterDevtools } from '@tanstack/router-devtools';
import { ThemeToggle } from '@/components/theme-toggle';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faChartLine, faShield, faCertificate, faLayerGroup } from '@fortawesome/free-solid-svg-icons';
import packageJson from '../../../package.json';

export const Route = createRootRoute({
  component: RootComponent,
});

function RootComponent() {
  return (
    <div className="min-h-screen bg-background">
      <nav className="border-b bg-card shadow-sm">
        <div className="container mx-auto px-6 py-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-8">
              <Link to="/" className="flex flex-col hover:opacity-80 transition-opacity">
                <span className="text-2xl font-bold text-primary">PKI Manager</span>
                <span className="text-xs text-gray-400 self-end">v{packageJson.version}</span>
              </Link>
              <div className="flex space-x-1">
                <Link
                  to="/"
                  className="px-3 py-2 text-sm font-medium rounded-md text-foreground/70 hover:text-foreground hover:bg-accent/50 transition-colors flex items-center gap-2"
                  activeProps={{
                    className: 'px-3 py-2 text-sm font-medium rounded-md text-primary bg-primary/10 hover:bg-primary/15 transition-colors flex items-center gap-2'
                  }}
                  activeOptions={{ exact: true }}
                >
                  <FontAwesomeIcon icon={faChartLine} className="h-4 w-4" />
                  Dashboard
                </Link>
                <Link
                  to="/cas"
                  className="px-3 py-2 text-sm font-medium rounded-md text-foreground/70 hover:text-foreground hover:bg-accent/50 transition-colors flex items-center gap-2"
                  activeProps={{
                    className: 'px-3 py-2 text-sm font-medium rounded-md text-primary bg-primary/10 hover:bg-primary/15 transition-colors flex items-center gap-2'
                  }}
                >
                  <FontAwesomeIcon icon={faShield} className="h-4 w-4" />
                  Certificate Authorities
                </Link>
                <Link
                  to="/certificates"
                  className="px-3 py-2 text-sm font-medium rounded-md text-foreground/70 hover:text-foreground hover:bg-accent/50 transition-colors flex items-center gap-2"
                  activeProps={{
                    className: 'px-3 py-2 text-sm font-medium rounded-md text-primary bg-primary/10 hover:bg-primary/15 transition-colors flex items-center gap-2'
                  }}
                >
                  <FontAwesomeIcon icon={faCertificate} className="h-4 w-4" />
                  Certificates
                </Link>
                <Link
                  to="/certificates/bulk"
                  className="px-3 py-2 text-sm font-medium rounded-md text-foreground/70 hover:text-foreground hover:bg-accent/50 transition-colors flex items-center gap-2"
                  activeProps={{
                    className: 'px-3 py-2 text-sm font-medium rounded-md text-primary bg-primary/10 hover:bg-primary/15 transition-colors flex items-center gap-2'
                  }}
                >
                  <FontAwesomeIcon icon={faLayerGroup} className="h-4 w-4" />
                  Bulk
                </Link>
              </div>
            </div>
            <ThemeToggle />
          </div>
        </div>
      </nav>
      <main className="container mx-auto px-6 py-6">
        <Outlet />
      </main>
      {import.meta.env.DEV && <TanStackRouterDevtools position="bottom-right" />}
    </div>
  );
}
