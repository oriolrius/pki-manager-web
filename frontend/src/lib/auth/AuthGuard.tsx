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
import { isOIDCEnabledAsync, hasValidManualTokensAsync } from './config';

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
  const [hasManualTokens, setHasManualTokens] = useState(false);
  const [tokensChecked, setTokensChecked] = useState(false);
  const [isRedirecting, setIsRedirecting] = useState(false);

  // Check if we're on the callback route (don't redirect during OIDC callback)
  const isCallbackRoute = window.location.pathname === '/callback';

  // Re-check manual tokens when component mounts or auth state changes
  useEffect(() => {
    hasValidManualTokensAsync().then((hasTokens) => {
      setHasManualTokens(hasTokens);
      setTokensChecked(true);
    });
  }, [auth.isAuthenticated]);

  // Consider authenticated if library says so OR we have valid manual tokens
  const isAuthenticated = auth.isAuthenticated || hasManualTokens;

  // Redirect to login if not authenticated (wait for token check to complete)
  useEffect(() => {
    if (!isCallbackRoute && !auth.isLoading && tokensChecked && !isAuthenticated && !auth.activeNavigator && !isRedirecting) {
      setIsRedirecting(true);

      // Store current path for redirect after login
      sessionStorage.setItem('returnUrl', window.location.pathname + window.location.search);
      console.log('[AuthGuard] User not authenticated, redirecting to login...');

      // Fetch OIDC config asynchronously (supports runtime config.json)
      auth.signinRedirect().catch((error) => {
        console.error('[AuthGuard] OIDC redirect failed:', error);
        setIsRedirecting(false);
      });
      
    }
  }, [isCallbackRoute, auth.isLoading, tokensChecked, isAuthenticated, auth.activeNavigator, isRedirecting]);

  // Allow callback route to render without auth check
  if (isCallbackRoute) {
    return <>{children}</>;
  }

  // Loading state (waiting for auth library or token check)
  if (auth.isLoading || !tokensChecked) {
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
  const [oidcEnabled, setOidcEnabled] = useState<boolean | null>(null);

  useEffect(() => {
    isOIDCEnabledAsync().then(setOidcEnabled);
  }, []);

  // Still checking if OIDC is enabled
  if (oidcEnabled === null) {
    return <AuthLoading />;
  }

  // If OIDC is not enabled, render children without auth check
  if (!oidcEnabled) {
    return <>{children}</>;
  }

  return <AuthGuardInner>{children}</AuthGuardInner>;
}
