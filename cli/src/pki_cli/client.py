"""PKI Manager API client wrapper with OIDC authentication."""

import json
import sys
import time
from pathlib import Path
from typing import Optional

import httpx

from pki_api.pki_manager_rest_api_client import AuthenticatedClient

from .config import Settings, get_settings


class TokenManager:
    """Manages OIDC token acquisition and caching."""

    def __init__(self, settings: Settings):
        self.settings = settings
        self.cache_file = settings.token_cache_file

    def _get_cached_token(self) -> Optional[str]:
        """Get cached token if still valid."""
        if not self.cache_file.exists():
            return None

        try:
            data = json.loads(self.cache_file.read_text())
            # Check if token expires in more than 30 seconds
            if data.get("expires_at", 0) > time.time() + 30:
                return data.get("access_token")
        except (json.JSONDecodeError, KeyError):
            pass

        return None

    def _cache_token(self, token: str, expires_in: int) -> None:
        """Cache the token to disk."""
        self.cache_file.parent.mkdir(parents=True, exist_ok=True)
        data = {
            "access_token": token,
            "expires_at": time.time() + expires_in,
        }
        self.cache_file.write_text(json.dumps(data))
        self.cache_file.chmod(0o600)

    def clear_cache(self) -> None:
        """Clear the cached token."""
        if self.cache_file.exists():
            self.cache_file.unlink()

    def get_token(self) -> str:
        """Get a valid access token, using cache if available."""
        # Validate configuration is complete
        self.settings.validate_config()

        # Try cache first
        cached = self._get_cached_token()
        if cached:
            return cached

        # Fetch new token via client credentials flow
        with httpx.Client() as client:
            response = client.post(
                self.settings.oidc_url,
                data={
                    "grant_type": "client_credentials",
                    "client_id": self.settings.client_id,
                    "client_secret": self.settings.client_secret,
                },
            )

            if response.status_code != 200:
                raise RuntimeError(f"Failed to get token: {response.status_code} - {response.text}")

            data = response.json()

        token = data["access_token"]
        expires_in = data.get("expires_in", 300)

        # Cache for future use
        self._cache_token(token, expires_in)

        return token


class PKIClientWrapper:
    """Wrapper that creates authenticated clients for API calls."""

    def __init__(self, settings: Optional[Settings] = None):
        self.settings = settings or get_settings()
        self.token_manager = TokenManager(self.settings)

    def get_client(self) -> AuthenticatedClient:
        """Get an authenticated client instance."""
        token = self.token_manager.get_token()
        return AuthenticatedClient(
            base_url=self.settings.api_url,
            token=token,
            raise_on_unexpected_status=True,
        )

    def refresh_token(self) -> AuthenticatedClient:
        """Clear cache and get a fresh token."""
        self.token_manager.clear_cache()
        return self.get_client()


# Global wrapper instance
_wrapper: Optional[PKIClientWrapper] = None


def get_wrapper() -> PKIClientWrapper:
    """Get or create the global client wrapper."""
    global _wrapper
    if _wrapper is None:
        _wrapper = PKIClientWrapper()
    return _wrapper


def get_client() -> AuthenticatedClient:
    """Get an authenticated client for API calls."""
    return get_wrapper().get_client()
