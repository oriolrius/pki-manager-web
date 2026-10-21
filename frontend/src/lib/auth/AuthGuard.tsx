/**
 * AuthGuard Component
 *
 * Enforces authentication at the application root level.
 * Redirects unauthenticated users to the OIDC provider login.
 *
 * Reference: decision-009 - OIDC Authentication Implementation
 */

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useAuth } from 'react-oidc-context';
import { isOIDCEnabledAsync } from './config';

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
 * Redirecting message shown while navigating to the OIDC provider
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
 * Inner component that uses authentication hooks.
 * Only rendered when OIDC is enabled.
 */
function AuthGuardInner({ children }: AuthGuardProps) {
  const auth = useAuth();
  // A ref, not state: StrictMode runs effects twice before a state update lands, which
  // fired two signinRedirect() calls (two auth requests racing on the login page).
  const redirectStarted = useRef(false);

  // Do not start another redirect while processing the OIDC callback.
  const isCallbackRoute = window.location.pathname === '/callback';

  // Redirect to the OIDC provider when authentication is required.
  useEffect(() => {
    if (
      isCallbackRoute ||
      auth.isLoading ||
      auth.isAuthenticated ||
      auth.activeNavigator ||
      redirectStarted.current
    ) {
      return;
    }

    redirectStarted.current = true;

    // Store the current URL so the callback route can restore it after login.
    sessionStorage.setItem('returnUrl', window.location.pathname + window.location.search);
    console.log('[AuthGuard] User not authenticated, redirecting to login...');

    // Let oidc-client-ts discover the provider endpoints and handle PKCE.
    auth.signinRedirect().catch((error) => {
      console.error('[AuthGuard] OIDC redirect failed:', error);
      redirectStarted.current = false;
    });
  }, [
    isCallbackRoute,
    auth.isLoading,
    auth.isAuthenticated,
    auth.activeNavigator,
    auth.signinRedirect,
  ]);

  // Allow the callback route to render while authentication is processed.
  if (isCallbackRoute) {
    return <>{children}</>;
  }

  if (auth.isLoading) {
    return <AuthLoading />;
  }

  if (!auth.isAuthenticated) {
    return <AuthRedirecting />;
  }

  return <>{children}</>;
}

/**
 * Enforces authentication for wrapped content.
 *
 * - If OIDC is disabled, renders children without an authentication check.
 * - If authenticated, renders children.
 * - If unauthenticated, redirects to the OIDC provider.
 */
export function AuthGuard({ children }: AuthGuardProps) {
  const [oidcEnabled, setOidcEnabled] = useState<boolean | null>(null);

  useEffect(() => {
    // No catch on purpose: falling back to "OIDC disabled" on an error would render the
    // app unauthenticated (fail-open). isOIDCEnabledAsync already treats a missing
    // config.json as "use build-time settings".
    isOIDCEnabledAsync().then(setOidcEnabled);
  }, []);

  // OIDC configuration is still loading.
  if (oidcEnabled === null) {
    return <AuthLoading />;
  }

  // Render without authentication when OIDC is disabled.
  if (!oidcEnabled) {
    return <>{children}</>;
  }

  return <AuthGuardInner>{children}</AuthGuardInner>;
}
