/**
 * Entry of `silent-renew.html`, the `silent_redirect_uri` of the OIDC settings
 * (`lib/auth/config.ts`). oidc-client-ts opens that page in a hidden iframe; this script
 * sends the authorization response URL back to the parent window, where the shared
 * `UserManager` completes the renewal.
 *
 * `signinSilentCallback` only notifies the parent (no discovery, no token request), so
 * this UserManager needs no real settings. The library comes from the application bundle,
 * so its version is the one in `package.json` (no third-party script load).
 */
import { UserManager } from 'oidc-client-ts';

export function completeSilentRenew(url: string = window.location.href): Promise<void> {
  return new UserManager({ authority: '', client_id: '', redirect_uri: '' })
    .signinSilentCallback(url)
    .catch((error: unknown) => {
      console.error('Silent renewal error:', error);
    });
}

void completeSilentRenew();
