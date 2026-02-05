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
import { useEffect, useState } from 'react';

export const Route = createFileRoute('/callback')({
  component: CallbackRoute,
});

interface TokenResponse {
  access_token: string;
  id_token: string;
  refresh_token?: string;
  token_type: string;
  expires_in: number;
}

async function exchangeCodeForTokens(code: string): Promise<TokenResponse> {
  const authority = import.meta.env.VITE_OIDC_AUTHORITY;
  const clientId = import.meta.env.VITE_OIDC_CLIENT_ID;
  const redirectUri = window.location.origin + '/callback';

  const response = await fetch(`${authority}/protocol/openid-connect/token`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: clientId,
      code,
      redirect_uri: redirectUri,
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Token exchange failed: ${error}`);
  }

  return response.json();
}

function CallbackRoute() {
  const auth = useAuth();
  const navigate = useNavigate();
  const [manualError, setManualError] = useState<string | null>(null);
  const [manualLoading, setManualLoading] = useState(false);

  // Handle manual token exchange if library's callback fails
  useEffect(() => {
    // If there's an error from the library (state mismatch), try manual exchange
    if (auth.error?.message?.includes('state')) {
      const params = new URLSearchParams(window.location.search);
      const code = params.get('code');
      const storedState = sessionStorage.getItem('oidc_state');
      const returnedState = params.get('state');

      // Verify our custom state if present
      if (storedState && returnedState && storedState === returnedState && code) {
        console.log('[Callback] Library state failed, attempting manual token exchange...');
        setManualLoading(true);

        exchangeCodeForTokens(code)
          .then((tokens) => {
            console.log('[Callback] Manual token exchange successful');
            // Store tokens in localStorage for the app to use
            const storageKey = `oidc.user:${import.meta.env.VITE_OIDC_AUTHORITY}:${import.meta.env.VITE_OIDC_CLIENT_ID}`;
            localStorage.setItem(storageKey, JSON.stringify({
              access_token: tokens.access_token,
              id_token: tokens.id_token,
              refresh_token: tokens.refresh_token,
              token_type: tokens.token_type,
              expires_at: Math.floor(Date.now() / 1000) + tokens.expires_in,
            }));

            // Clean up
            sessionStorage.removeItem('oidc_state');
            sessionStorage.removeItem('oidc_nonce');

            // Redirect to return URL
            const returnUrl = sessionStorage.getItem('returnUrl') || '/';
            sessionStorage.removeItem('returnUrl');
            window.location.href = returnUrl;
          })
          .catch((err) => {
            console.error('[Callback] Manual token exchange failed:', err);
            setManualError(err.message);
            setManualLoading(false);
          });
      }
    }
  }, [auth.error]);

  useEffect(() => {
    // Once authenticated via library, redirect to stored return URL or home
    if (auth.isAuthenticated) {
      const returnUrl = sessionStorage.getItem('returnUrl') || '/';
      sessionStorage.removeItem('returnUrl');
      navigate({ to: returnUrl });
    }
  }, [auth.isAuthenticated, navigate]);

  // Manual exchange loading
  if (manualLoading) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto mb-4" />
          <h1 className="text-xl font-semibold mb-2">Completing sign-in...</h1>
          <p className="text-muted-foreground">Exchanging credentials...</p>
        </div>
      </div>
    );
  }

  // Manual exchange error
  if (manualError) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center">
        <div className="text-center max-w-md p-6">
          <div className="text-destructive text-5xl mb-4">⚠</div>
          <h1 className="text-xl font-semibold mb-2">Authentication Failed</h1>
          <p className="text-muted-foreground mb-4">{manualError}</p>
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

  // Error state from library (will trigger manual exchange if state-related)
  if (auth.error && !auth.error.message?.includes('state')) {
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
