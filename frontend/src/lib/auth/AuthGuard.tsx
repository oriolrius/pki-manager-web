/**
 * AuthGuard Component
 *
 * Enforces authentication at the application level.
 * Redirects unauthenticated users to the OIDC provider login.
 *
 * Reference: decision-009 - OIDC Authentication Implementation
 */

import { useEffect, useState, type ReactNode } from 'react';
import { useAuth } from 'react-oidc-context';
import { isOIDCEnabled, hasValidManualTokens } from './config';

interface AuthGuardProps {
  children: ReactNode;
}

/**
 * Loading spinner shown while checking authentication
 */
function AuthLoading() {
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

/**
 * Redirecting message shown while navigating to OIDC provider
 */
function AuthRedirecting() {
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

/**
 * Inner component that uses hooks - only rendered when OIDC is enabled
 */
function AuthGuardInner({ children }: AuthGuardProps) {
  const auth = useAuth();
  // Check for manually stored tokens (from our custom callback handler)
  const [hasManualTokens, setHasManualTokens] = useState(() => hasValidManualTokens());

  // Check if we're on the callback route (don't redirect during OIDC callback)
  const isCallbackRoute = window.location.pathname === '/callback';

  // Re-check manual tokens when component mounts or auth state changes
  useEffect(() => {
    setHasManualTokens(hasValidManualTokens());
  }, [auth.isAuthenticated]);

  // Consider authenticated if library says so OR we have valid manual tokens
  const isAuthenticated = auth.isAuthenticated || hasManualTokens;

  // Redirect to login if not authenticated
  useEffect(() => {
    if (!isCallbackRoute && !auth.isLoading && !isAuthenticated && !auth.activeNavigator) {
      // Store current path for redirect after login
      sessionStorage.setItem('returnUrl', window.location.pathname + window.location.search);
      console.log('[AuthGuard] User not authenticated, redirecting to login...');

      // Direct redirect to OIDC provider (signinRedirect doesn't work reliably)
      const authority = import.meta.env.VITE_OIDC_AUTHORITY;
      const clientId = import.meta.env.VITE_OIDC_CLIENT_ID;
      const redirectUri = encodeURIComponent(window.location.origin + '/callback');
      const scope = encodeURIComponent(import.meta.env.VITE_OIDC_SCOPE || 'openid profile email');
      // Generate random state and nonce (works in non-HTTPS contexts)
      const randomString = () => Math.random().toString(36).substring(2) + Date.now().toString(36);
      const state = randomString();
      const nonce = randomString();

      // Store state for validation
      sessionStorage.setItem('oidc_state', state);
      sessionStorage.setItem('oidc_nonce', nonce);

      const url = `${authority}/protocol/openid-connect/auth?client_id=${clientId}&redirect_uri=${redirectUri}&response_type=code&scope=${scope}&state=${state}&nonce=${nonce}`;
      console.log('[AuthGuard] Redirecting to:', url);
      window.location.href = url;
    }
  }, [isCallbackRoute, auth.isLoading, isAuthenticated, auth.activeNavigator]);

  // Allow callback route to render without auth check
  if (isCallbackRoute) {
    return <>{children}</>;
  }

  // Loading state
  if (auth.isLoading) {
    return <AuthLoading />;
  }

  // Not authenticated - show redirecting message
  if (!isAuthenticated) {
    return <AuthRedirecting />;
  }

  // Authenticated - render children
  return <>{children}</>;
}

/**
 * AuthGuard enforces authentication for wrapped content.
 *
 * - If OIDC is disabled, renders children without auth check
 * - If authenticated, renders children
 * - If not authenticated, redirects to OIDC login
 */
export function AuthGuard({ children }: AuthGuardProps) {
  // If OIDC is not enabled, render children without auth check
  if (!isOIDCEnabled()) {
    return <>{children}</>;
  }

  return <AuthGuardInner>{children}</AuthGuardInner>;
}
