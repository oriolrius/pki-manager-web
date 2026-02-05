/**
 * UserMenu Component
 *
 * Displays authentication controls in the navigation bar:
 * - Login button when unauthenticated
 * - User info with logout/account links when authenticated
 *
 * Uses OIDC provider redirects - no custom login UI.
 *
 * Reference: decision-009 - OIDC Authentication Implementation
 */

import { useAuth, isOIDCEnabled, hasValidManualTokens, getStorageKey } from '@/lib/auth';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import {
  faUser,
  faSignInAlt,
  faSignOutAlt,
  faUserCog,
  faChevronDown,
} from '@fortawesome/free-solid-svg-icons';
import { useState, useRef, useEffect } from 'react';

/**
 * Gets user info from manually stored tokens
 */
function getManualUserInfo(): { name?: string; email?: string } | null {
  try {
    const storageKey = getStorageKey();
    const stored = localStorage.getItem(storageKey);
    if (!stored) return null;

    const data = JSON.parse(stored);
    if (!data.id_token) return null;

    // Decode JWT payload (id_token contains user claims)
    const payload = data.id_token.split('.')[1];
    const decoded = JSON.parse(atob(payload));

    return {
      name: decoded.name || decoded.preferred_username,
      email: decoded.email,
    };
  } catch {
    return null;
  }
}

/**
 * Gets the account management URL for the OIDC provider
 */
function getAccountUrl(): string | null {
  const authority = import.meta.env.VITE_OIDC_AUTHORITY;
  if (!authority) return null;

  // For Keycloak, account page is at /account
  // Other providers may have different URLs
  return `${authority}/account`;
}

export function UserMenu() {
  const auth = useAuth();
  const [isOpen, setIsOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // Check for manual tokens
  const [hasManualTokens, setHasManualTokens] = useState(() => hasValidManualTokens());
  const [manualUserInfo, setManualUserInfo] = useState(() => getManualUserInfo());

  // If OIDC is not enabled, don't render anything
  if (!isOIDCEnabled()) {
    return null;
  }

  // Re-check manual tokens when auth state changes
  useEffect(() => {
    setHasManualTokens(hasValidManualTokens());
    setManualUserInfo(getManualUserInfo());
  }, [auth.isAuthenticated]);

  // Close menu when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Handle login - redirect to OIDC provider
  const handleLogin = () => {
    // Store current path for redirect after login
    sessionStorage.setItem('returnUrl', window.location.pathname);

    // Use manual redirect (signinRedirect doesn't work reliably in non-HTTPS)
    const authority = import.meta.env.VITE_OIDC_AUTHORITY;
    const clientId = import.meta.env.VITE_OIDC_CLIENT_ID;
    const redirectUri = encodeURIComponent(window.location.origin + '/callback');
    const scope = encodeURIComponent(import.meta.env.VITE_OIDC_SCOPE || 'openid profile email');
    const randomString = () => Math.random().toString(36).substring(2) + Date.now().toString(36);
    const state = randomString();
    const nonce = randomString();

    sessionStorage.setItem('oidc_state', state);
    sessionStorage.setItem('oidc_nonce', nonce);

    const url = `${authority}/protocol/openid-connect/auth?client_id=${clientId}&redirect_uri=${redirectUri}&response_type=code&scope=${scope}&state=${state}&nonce=${nonce}`;
    window.location.href = url;
  };

  // Handle logout - clear tokens and redirect to OIDC provider logout
  const handleLogout = () => {
    // Clear manual tokens
    const storageKey = getStorageKey();
    localStorage.removeItem(storageKey);
    sessionStorage.removeItem('oidc_state');
    sessionStorage.removeItem('oidc_nonce');
    sessionStorage.removeItem('returnUrl');

    // Redirect to Keycloak logout
    const authority = import.meta.env.VITE_OIDC_AUTHORITY;
    const redirectUri = encodeURIComponent(window.location.origin);
    const logoutUrl = `${authority}/protocol/openid-connect/logout?post_logout_redirect_uri=${redirectUri}&client_id=${import.meta.env.VITE_OIDC_CLIENT_ID}`;
    window.location.href = logoutUrl;
  };

  // Consider authenticated if library says so OR we have valid manual tokens
  const isAuthenticated = auth.isAuthenticated || hasManualTokens;

  // Loading state
  if (auth.isLoading) {
    return (
      <div className="flex items-center gap-2 px-3 py-2 text-muted-foreground">
        <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-current" />
      </div>
    );
  }

  // Not authenticated - show login button
  if (!isAuthenticated) {
    return (
      <button
        onClick={handleLogin}
        className="flex items-center gap-2 px-3 py-2 text-sm font-medium rounded-md text-foreground/70 hover:text-foreground hover:bg-accent/50 transition-colors"
      >
        <FontAwesomeIcon icon={faSignInAlt} className="h-4 w-4" />
        Login
      </button>
    );
  }

  // Authenticated - show user menu
  // Use library user info if available, otherwise use manual token info
  const user = auth.user;
  const displayName = user?.profile?.name || user?.profile?.preferred_username || user?.profile?.email || manualUserInfo?.name || 'User';
  const email = user?.profile?.email || manualUserInfo?.email;
  const accountUrl = getAccountUrl();

  return (
    <div className="relative" ref={menuRef}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-2 px-3 py-2 text-sm font-medium rounded-md text-foreground/70 hover:text-foreground hover:bg-accent/50 transition-colors"
      >
        <FontAwesomeIcon icon={faUser} className="h-4 w-4" />
        <span className="max-w-[150px] truncate">{displayName}</span>
        <FontAwesomeIcon
          icon={faChevronDown}
          className={`h-3 w-3 transition-transform ${isOpen ? 'rotate-180' : ''}`}
        />
      </button>

      {isOpen && (
        <div className="absolute right-0 mt-2 w-56 rounded-md shadow-lg bg-card border border-border z-50">
          <div className="p-3 border-b border-border">
            <p className="text-sm font-medium truncate">{displayName}</p>
            {email && (
              <p className="text-xs text-muted-foreground truncate">{email}</p>
            )}
          </div>

          <div className="py-1">
            {accountUrl && (
              <a
                href={accountUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-2 px-4 py-2 text-sm text-foreground/70 hover:text-foreground hover:bg-accent/50 transition-colors"
                onClick={() => setIsOpen(false)}
              >
                <FontAwesomeIcon icon={faUserCog} className="h-4 w-4" />
                Account Settings
              </a>
            )}

            <button
              onClick={() => {
                setIsOpen(false);
                handleLogout();
              }}
              className="flex items-center gap-2 w-full px-4 py-2 text-sm text-foreground/70 hover:text-foreground hover:bg-accent/50 transition-colors"
            >
              <FontAwesomeIcon icon={faSignOutAlt} className="h-4 w-4" />
              Logout
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
