/**
 * OIDC Callback Route
 *
 * Handles the redirect from the OIDC provider after authentication.
 * Exchanges authorization code for tokens and redirects to the original destination.
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

  useEffect(() => {
    // Once authenticated, redirect to stored return URL or home
    if (auth.isAuthenticated) {
      const returnUrl = sessionStorage.getItem('returnUrl') || '/';
      sessionStorage.removeItem('returnUrl');
      navigate({ to: returnUrl });
    }
  }, [auth.isAuthenticated, navigate]);

  // Loading state during token exchange
  if (auth.isLoading) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto mb-4" />
          <h1 className="text-xl font-semibold mb-2">Completing sign-in...</h1>
          <p className="text-muted-foreground">
            Please wait while we verify your credentials.
          </p>
        </div>
      </div>
    );
  }

  // Error state
  if (auth.error) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center">
        <div className="text-center max-w-md p-6">
          <div className="text-destructive text-5xl mb-4">⚠</div>
          <h1 className="text-xl font-semibold mb-2">Authentication Failed</h1>
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

  // Authenticated - showing redirect message
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

  // Default state - waiting for auth callback to complete
  return (
    <div className="min-h-[60vh] flex items-center justify-center">
      <div className="text-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto mb-4" />
        <h1 className="text-xl font-semibold mb-2">Processing...</h1>
        <p className="text-muted-foreground">
          Completing authentication.
        </p>
      </div>
    </div>
  );
}
