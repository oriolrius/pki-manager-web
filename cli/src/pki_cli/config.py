"""Configuration management for PKI CLI."""

from pathlib import Path
from typing import Optional

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """PKI CLI configuration settings.

    Configuration can be set via:
    1. Environment variables (prefixed with PKI_)
    2. .env file in current directory
    3. ~/.config/pki-cli/.env file
    4. CLI options (--api-url, --client-id, --client-secret)

    Environment variables:
        PKI_API_URL: PKI Manager API base URL
        PKI_OIDC_URL: Keycloak token endpoint
        PKI_CLIENT_ID: OIDC client ID
        PKI_CLIENT_SECRET: OIDC client secret
    """

    model_config = SettingsConfigDict(
        env_prefix="PKI_",
        env_file=(".env", str(Path.home() / ".config" / "pki-cli" / ".env")),
        env_file_encoding="utf-8",
        extra="ignore",
    )

    # API Configuration
    api_url: Optional[str] = Field(
        default=None,
        description="PKI Manager API base URL (required)",
    )

    # OIDC Configuration
    oidc_url: Optional[str] = Field(
        default=None,
        description="OIDC token endpoint (required)",
    )
    client_id: Optional[str] = Field(
        default=None,
        description="OIDC client ID (required)",
    )
    client_secret: Optional[str] = Field(
        default=None,
        description="OIDC client secret (required)",
    )

    # Output Configuration
    output_format: str = Field(
        default="table",
        description="Default output format: table, json",
    )

    # Token cache
    token_cache_file: Path = Field(
        default=Path.home() / ".cache" / "pki-cli" / "token",
        description="Path to token cache file",
    )

    def validate_config(self) -> None:
        """Validate that required configuration is set."""
        missing = []
        if not self.api_url:
            missing.append("PKI_API_URL")
        if not self.oidc_url:
            missing.append("PKI_OIDC_URL")
        if not self.client_id:
            missing.append("PKI_CLIENT_ID")
        if not self.client_secret:
            missing.append("PKI_CLIENT_SECRET")

        if missing:
            raise ValueError(
                f"Missing required configuration: {', '.join(missing)}. "
                "Set them via environment variables, .env file, or CLI options."
            )


# Global settings instance (lazy initialization)
_settings: Optional[Settings] = None


def get_settings() -> Settings:
    """Get the current settings instance."""
    global _settings
    if _settings is None:
        _settings = Settings()
    return _settings


def configure(
    api_url: Optional[str] = None,
    oidc_url: Optional[str] = None,
    client_id: Optional[str] = None,
    client_secret: Optional[str] = None,
) -> Settings:
    """Configure settings with optional overrides from CLI.

    CLI options take precedence over environment variables.
    """
    global _settings

    # Start fresh from environment/files
    _settings = Settings()

    # Apply CLI overrides
    if api_url:
        _settings.api_url = api_url
    if oidc_url:
        _settings.oidc_url = oidc_url
    if client_id:
        _settings.client_id = client_id
    if client_secret:
        _settings.client_secret = client_secret

    return _settings
