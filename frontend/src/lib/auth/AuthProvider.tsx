/**
 * AuthProvider Component
 *
 * Wraps the application with react-oidc-context for authentication.
 * Handles OIDC configuration loading and provides auth context to children.
 *
 * Reference: decision-009 - OIDC Authentication Implementation
 */

import { useState, useEffect, type ReactNode } from 'react';
import { AuthProvider as OIDCAuthProvider } from 'react-oidc-context';
import type { UserManagerSettings } from 'oidc-client-ts';
import { buildOIDCSettings, isOIDCEnabled } from './config';

interface AuthProviderProps {
  children: ReactNode;
}

/**
 * Loading state while OIDC configuration is being fetched
 */
function AuthLoading() {
  return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="text-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto mb-4" />
        <p className="text-muted-foreground">Initializing authentication...</p>
      </div>
    </div>
  );
}

/**
 * Error state when OIDC configuration fails
 */
function AuthError({ message }: { message: string }) {
  return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="text-center max-w-md p-6">
        <div className="text-destructive text-4xl mb-4">⚠</div>
        <h1 className="text-xl font-semibold mb-2">Authentication Error</h1>
        <p className="text-muted-foreground">{message}</p>
      </div>
    </div>
  );
}

/**
 * AuthProvider component that handles OIDC configuration and context
 *
 * If OIDC is not configured (VITE_OIDC_AUTHORITY not set), renders children
 * without authentication wrapper, allowing the app to run in unauthenticated mode.
 */
export function AuthProvider({ children }: AuthProviderProps) {
  const [settings, setSettings] = useState<UserManagerSettings | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function loadSettings() {
      // If OIDC is not enabled, skip loading settings
      if (!isOIDCEnabled()) {
        setLoading(false);
        return;
      }

      try {
        const oidcSettings = await buildOIDCSettings();
        setSettings(oidcSettings);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load OIDC configuration');
      } finally {
        setLoading(false);
      }
    }

    loadSettings();
  }, []);

  // Show loading state while fetching configuration
  if (loading) {
    return <AuthLoading />;
  }

  // Show error if configuration failed
  if (error) {
    return <AuthError message={error} />;
  }

  // If OIDC is not enabled, render children without auth wrapper
  if (!settings) {
    return <>{children}</>;
  }

  /**
   * Handle sign-in callback - clean up URL after redirect
   * This removes the authorization code from the URL to prevent issues
   * with page refresh and browser history.
   */
  const onSigninCallback = () => {
    // Remove OIDC callback parameters from URL
    window.history.replaceState({}, document.title, window.location.pathname);
  };

  // Wrap with OIDC provider
  return (
    <OIDCAuthProvider
      {...settings}
      onSigninCallback={onSigninCallback}
    >
      {children}
    </OIDCAuthProvider>
  );
}
