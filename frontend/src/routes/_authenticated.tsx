/**
 * Protected Route Layout
 *
 * Layout route that requires authentication.
 * Unauthenticated users are redirected to OIDC provider login.
 *
 * Routes under _authenticated/ folder are protected by this layout.
 *
 * Reference: decision-009 - OIDC Authentication Implementation
 */

import { createFileRoute, Outlet, useNavigate } from '@tanstack/react-router';
import { useAuth, isOIDCEnabled } from '@/lib/auth';
import { useEffect } from 'react';

export const Route = createFileRoute('/_authenticated')({
  component: AuthenticatedLayout,
});

function AuthenticatedLayout() {
  const auth = useAuth();
  const navigate = useNavigate();

  // If OIDC is not enabled, render children without auth check
  if (!isOIDCEnabled()) {
    return <Outlet />;
  }

  // Handle authentication redirect
  useEffect(() => {
    if (!auth.isLoading && !auth.isAuthenticated) {
      // Store current path for redirect after login
      sessionStorage.setItem('returnUrl', window.location.pathname);

      // Redirect to OIDC provider login
      auth.signinRedirect();
    }
  }, [auth.isLoading, auth.isAuthenticated, auth.signinRedirect]);

  // Loading state while checking authentication
  if (auth.isLoading) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto mb-4" />
          <h1 className="text-xl font-semibold mb-2">Checking authentication...</h1>
          <p className="text-muted-foreground">Please wait.</p>
        </div>
      </div>
    );
  }

  // Not authenticated - show redirecting message
  if (!auth.isAuthenticated) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto mb-4" />
          <h1 className="text-xl font-semibold mb-2">Authentication Required</h1>
          <p className="text-muted-foreground">Redirecting to login...</p>
        </div>
      </div>
    );
  }

  // Auth error
  if (auth.error) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center">
        <div className="text-center max-w-md p-6">
          <div className="text-destructive text-5xl mb-4">⚠</div>
          <h1 className="text-xl font-semibold mb-2">Authentication Error</h1>
          <p className="text-muted-foreground mb-4">{auth.error.message}</p>
          <button
            onClick={() => navigate({ to: '/' })}
            className="px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 transition-colors"
          >
            Return Home
          </button>
        </div>
      </div>
    );
  }

  // Authenticated - render protected content
  return <Outlet />;
}
