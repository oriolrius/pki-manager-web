/**
 * OIDC Callback Route
 *
 * Landing page for the redirect back from the OIDC provider. The authorization-code
 * exchange, PKCE verification, state/nonce validation and token storage are all done
 * by react-oidc-context / oidc-client-ts (AuthProvider processes the `code`/`state`
 * params); this route only shows progress or errors and then returns the user to the
 * page they originally requested.
 *
 * Reference: decision-009 - OIDC Authentication Implementation
 */

import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useAuth } from '@/lib/auth';
import { useEffect } from 'react';

export const Route = createFileRoute('/callback')({
  component: CallbackRoute,
});

function CallbackRoute() {
  const auth = useAuth();
  const navigate = useNavigate();

  // Once authenticated, redirect to the stored return URL or home
  useEffect(() => {
    if (!auth.isAuthenticated) {
      return;
    }
    const returnUrl = sessionStorage.getItem('returnUrl') || '/';
    sessionStorage.removeItem('returnUrl');
    navigate({ to: returnUrl });
  }, [auth.isAuthenticated, navigate]);

  const handleReturnHome = () => {
    sessionStorage.removeItem('returnUrl');
    navigate({ to: '/' });
  };

  if (auth.error) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center">
        <div className="text-center max-w-md p-6">
          <div className="text-destructive text-5xl mb-4">⚠</div>
          <h1 className="text-xl font-semibold mb-2">Authentication Failed</h1>
          <p className="text-muted-foreground mb-4">{auth.error.message}</p>
          <button
            type="button"
            onClick={handleReturnHome}
            className="px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 transition-colors"
          >
            Return Home
          </button>
        </div>
      </div>
    );
  }

  if (auth.isAuthenticated) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center">
        <div className="text-center">
          <div className="text-green-500 text-5xl mb-4">✓</div>
          <h1 className="text-xl font-semibold mb-2">Sign-in Successful</h1>
          <p className="text-muted-foreground">Redirecting...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-[60vh] flex items-center justify-center">
      <div className="text-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto mb-4" />
        <h1 className="text-xl font-semibold mb-2">Completing sign-in...</h1>
        <p className="text-muted-foreground">Please wait while we verify your credentials.</p>
      </div>
    </div>
  );
}
