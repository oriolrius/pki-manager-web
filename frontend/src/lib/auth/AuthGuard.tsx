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
import {
  hasValidManualTokensAsync,
  isOIDCEnabledAsync,
} from './config';

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

        <h1 className="text-xl font-semibold mb-2">
          Checking authentication...
        </h1>

        <p className="text-muted-foreground">
          Please wait.
        </p>
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

        <h1 className="text-xl font-semibold mb-2">
          Authentication Required
        </h1>

        <p className="text-muted-foreground">
          Redirecting to login...
        </p>
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

  // Check for previously stored tokens.
  const [hasManualTokens, setHasManualTokens] = useState(false);
  const [tokensChecked, setTokensChecked] = useState(false);
  const [isRedirecting, setIsRedirecting] = useState(false);

  // Do not start another redirect while processing the OIDC callback.
  const isCallbackRoute = window.location.pathname === '/callback';

  // Re-check stored tokens when the component mounts or auth state changes.
  useEffect(() => {
    hasValidManualTokensAsync()
      .then((hasTokens) => {
        setHasManualTokens(hasTokens);
        setTokensChecked(true);
      })
      .catch((error) => {
        console.error(
          '[AuthGuard] Failed to check stored tokens:',
          error,
        );

        setHasManualTokens(false);
        setTokensChecked(true);
      });
  }, [auth.isAuthenticated]);

  // Consider the user authenticated if the OIDC client or existing tokens
  // indicate a valid authenticated session.
  const isAuthenticated =
    auth.isAuthenticated || hasManualTokens;

  // Redirect to the OIDC provider when authentication is required.
  useEffect(() => {
    if (
      isCallbackRoute ||
      auth.isLoading ||
      !tokensChecked ||
      isAuthenticated ||
      auth.activeNavigator ||
      isRedirecting
    ) {
      return;
    }

    setIsRedirecting(true);

    // Store the current URL so the callback route can restore it after login.
    sessionStorage.setItem(
      'returnUrl',
      window.location.pathname + window.location.search,
    );

    console.log(
      '[AuthGuard] User not authenticated, redirecting to login...',
    );

    // Let oidc-client-ts discover the provider endpoints and handle PKCE.
    auth.signinRedirect().catch((error) => {
      console.error(
        '[AuthGuard] OIDC redirect failed:',
        error,
      );

      setIsRedirecting(false);
    });
  }, [
    isCallbackRoute,
    auth.isLoading,
    auth.activeNavigator,
    auth.signinRedirect,
    tokensChecked,
    isAuthenticated,
    isRedirecting,
  ]);

  // Allow the callback route to render while authentication is processed.
  if (isCallbackRoute) {
    return <>{children}</>;
  }

  // Wait for the OIDC client and stored-token check.
  if (auth.isLoading || !tokensChecked) {
    return <AuthLoading />;
  }

  // Show a loading state while redirecting to the OIDC provider.
  if (!isAuthenticated) {
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
  const [oidcEnabled, setOidcEnabled] =
    useState<boolean | null>(null);

  useEffect(() => {
    isOIDCEnabledAsync()
      .then(setOidcEnabled)
      .catch((error) => {
        console.error(
          '[AuthGuard] Failed to load OIDC configuration:',
          error,
        );

        setOidcEnabled(false);
      });
  }, []);

  // OIDC configuration is still loading.
  if (oidcEnabled === null) {
    return <AuthLoading />;
  }

  // Render without authentication when OIDC is disabled.
  if (!oidcEnabled) {
    return <>{children}</>;
  }

  return (
    <AuthGuardInner>
      {children}
    </AuthGuardInner>
  );
}
