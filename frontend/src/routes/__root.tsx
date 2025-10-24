import { createRootRoute, Outlet, Link } from '@tanstack/react-router';
import { TanStackRouterDevtools } from '@tanstack/router-devtools';
import { ThemeToggle } from '@/components/theme-toggle';

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
              <Link to="/" className="text-2xl font-bold text-primary hover:text-primary/80 transition-colors">
                PKI Manager
              </Link>
              <div className="flex space-x-1">
                <Link
                  to="/"
                  className="px-3 py-2 text-sm font-medium rounded-md text-foreground/70 hover:text-foreground hover:bg-accent/50 transition-colors"
                  activeProps={{
                    className: 'px-3 py-2 text-sm font-medium rounded-md text-primary bg-primary/10 hover:bg-primary/15 transition-colors'
                  }}
                  activeOptions={{ exact: true }}
                >
                  Dashboard
                </Link>
                <Link
                  to="/cas"
                  className="px-3 py-2 text-sm font-medium rounded-md text-foreground/70 hover:text-foreground hover:bg-accent/50 transition-colors"
                  activeProps={{
                    className: 'px-3 py-2 text-sm font-medium rounded-md text-primary bg-primary/10 hover:bg-primary/15 transition-colors'
                  }}
                >
                  Certificate Authorities
                </Link>
                <Link
                  to="/certificates"
                  className="px-3 py-2 text-sm font-medium rounded-md text-foreground/70 hover:text-foreground hover:bg-accent/50 transition-colors"
                  activeProps={{
                    className: 'px-3 py-2 text-sm font-medium rounded-md text-primary bg-primary/10 hover:bg-primary/15 transition-colors'
                  }}
                >
                  Certificates
                </Link>
                <Link
                  to="/certificates/bulk"
                  className="px-3 py-2 text-sm font-medium rounded-md text-foreground/70 hover:text-foreground hover:bg-accent/50 transition-colors"
                  activeProps={{
                    className: 'px-3 py-2 text-sm font-medium rounded-md text-primary bg-primary/10 hover:bg-primary/15 transition-colors'
                  }}
                >
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
      <TanStackRouterDevtools position="bottom-right" />
    </div>
  );
}
