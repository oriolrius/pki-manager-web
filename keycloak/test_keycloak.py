#!/usr/bin/env -S uv run
# /// script
# requires-python = ">=3.11"
# dependencies = [
#     "httpx>=0.28",
#     "python-dotenv>=1.0",
# ]
# ///
"""
Keycloak Provisioning Validation Test

Validates that the Keycloak development environment is properly configured
and all OAuth2 flows work correctly.

Usage:
    uv run keycloak/test_keycloak.py
"""

import sys
from pathlib import Path

import httpx
from dotenv import dotenv_values


class Colors:
    """ANSI color codes for terminal output."""

    GREEN = "\033[92m"
    RED = "\033[91m"
    YELLOW = "\033[93m"
    BLUE = "\033[94m"
    BOLD = "\033[1m"
    RESET = "\033[0m"


def success(msg: str) -> None:
    print(f"{Colors.GREEN}✓{Colors.RESET} {msg}")


def error(msg: str) -> None:
    print(f"{Colors.RED}✗{Colors.RESET} {msg}")


def info(msg: str) -> None:
    print(f"{Colors.BLUE}ℹ{Colors.RESET} {msg}")


def header(msg: str) -> None:
    print(f"\n{Colors.BOLD}{msg}{Colors.RESET}")


def load_config() -> dict[str, str]:
    """Load configuration from keycloak/.env file."""
    env_path = Path(__file__).parent / ".env"
    if not env_path.exists():
        error(f"Configuration file not found: {env_path}")
        info("Create keycloak/.env from keycloak/.env.example")
        sys.exit(1)

    config = dotenv_values(env_path)

    # Provide defaults matching docker-compose.yml
    return {
        "port": config.get("KEYCLOAK_PORT", "42997"),
        "mgmt_port": config.get("KEYCLOAK_MGMT_PORT", "42998"),
        "realm": config.get("KEYCLOAK_REALM", "pki-dev"),
        "service_client_id": config.get("PKI_SERVICE_CLIENT_ID", "pki-service"),
        "service_client_secret": config.get(
            "PKI_SERVICE_CLIENT_SECRET", "pki-service-secret"
        ),
        "web_client_id": config.get("PKI_WEB_CLIENT_ID", "pki-web"),
        "web_client_secret": config.get("PKI_WEB_CLIENT_SECRET", "pki-web-secret"),
        "admin_username": "admin",
        "admin_password": "admin",
    }


def get_base_url(config: dict[str, str]) -> str:
    """Get the Keycloak base URL."""
    return f"http://localhost:{config['port']}"


def get_realm_url(config: dict[str, str]) -> str:
    """Get the realm-specific URL."""
    return f"{get_base_url(config)}/realms/{config['realm']}"


def get_mgmt_url(config: dict[str, str]) -> str:
    """Get the Keycloak management URL (for health endpoints)."""
    return f"http://localhost:{config['mgmt_port']}"


def test_health_endpoint(client: httpx.Client, config: dict[str, str]) -> bool:
    """Test Keycloak health endpoint on management port."""
    header("Testing Health Endpoint")
    url = f"{get_mgmt_url(config)}/health/ready"

    try:
        response = client.get(url, timeout=5.0)
        if response.status_code == 200:
            data = response.json()
            status = data.get("status", "unknown")
            if status == "UP":
                success(f"Health endpoint OK: {url}")
                success(f"Status: {status}")
                return True
            else:
                error(f"Health status is not UP: {status}")
                return False
        else:
            error(f"Health endpoint returned {response.status_code}")
            return False
    except httpx.ConnectError:
        error(f"Cannot connect to Keycloak at {url}")
        info("Is Keycloak running? Start with: cd keycloak && docker compose up -d")
        return False
    except httpx.TimeoutException:
        error(f"Timeout connecting to {url}")
        info("Keycloak may still be starting. Wait a moment and try again.")
        return False
    except Exception as e:
        error(f"Unexpected error: {e}")
        return False


def test_openid_configuration(client: httpx.Client, config: dict[str, str]) -> bool:
    """Test OpenID Connect discovery endpoint."""
    header("Testing OpenID Configuration")
    url = f"{get_realm_url(config)}/.well-known/openid-configuration"

    try:
        response = client.get(url, timeout=10.0)
        if response.status_code != 200:
            error(f"OpenID configuration returned {response.status_code}")
            return False

        data = response.json()

        # Verify required fields
        required_fields = [
            "issuer",
            "authorization_endpoint",
            "token_endpoint",
            "jwks_uri",
            "userinfo_endpoint",
        ]

        missing = [f for f in required_fields if f not in data]
        if missing:
            error(f"Missing required fields: {', '.join(missing)}")
            return False

        success(f"OpenID configuration OK: {url}")
        success(f"Issuer: {data['issuer']}")
        success(f"Token endpoint: {data['token_endpoint']}")
        return True

    except httpx.HTTPError as e:
        error(f"HTTP error: {e}")
        return False
    except ValueError as e:
        error(f"Invalid JSON response: {e}")
        return False


def test_jwks_endpoint(client: httpx.Client, config: dict[str, str]) -> bool:
    """Test JWKS (JSON Web Key Set) endpoint."""
    header("Testing JWKS Endpoint")
    url = f"{get_realm_url(config)}/protocol/openid-connect/certs"

    try:
        response = client.get(url, timeout=10.0)
        if response.status_code != 200:
            error(f"JWKS endpoint returned {response.status_code}")
            return False

        data = response.json()

        if "keys" not in data:
            error("JWKS response missing 'keys' field")
            return False

        keys = data["keys"]
        if not keys:
            error("JWKS contains no signing keys")
            return False

        success(f"JWKS endpoint OK: {url}")
        success(f"Found {len(keys)} signing key(s)")

        # Show key info
        for key in keys:
            kid = key.get("kid", "unknown")
            alg = key.get("alg", "unknown")
            use = key.get("use", "unknown")
            info(f"  Key: kid={kid[:8]}..., alg={alg}, use={use}")

        return True

    except httpx.HTTPError as e:
        error(f"HTTP error: {e}")
        return False
    except ValueError as e:
        error(f"Invalid JSON response: {e}")
        return False


def test_client_credentials_flow(client: httpx.Client, config: dict[str, str]) -> bool:
    """Test OAuth2 Client Credentials flow with pki-service client."""
    header("Testing Client Credentials Flow (pki-service)")
    url = f"{get_realm_url(config)}/protocol/openid-connect/token"

    try:
        response = client.post(
            url,
            data={
                "grant_type": "client_credentials",
                "client_id": config["service_client_id"],
                "client_secret": config["service_client_secret"],
            },
            timeout=10.0,
        )

        if response.status_code != 200:
            error(f"Token request failed with status {response.status_code}")
            try:
                err_data = response.json()
                error(
                    f"Error: {err_data.get('error')}: {err_data.get('error_description')}"
                )
            except ValueError:
                error(f"Response: {response.text}")
            info("Check that pki-service client is configured with serviceAccountsEnabled=true")
            return False

        data = response.json()

        # Verify token response
        if "access_token" not in data:
            error("Token response missing 'access_token'")
            return False

        success(f"Client Credentials flow OK")
        success(f"Token type: {data.get('token_type', 'unknown')}")
        success(f"Expires in: {data.get('expires_in', 'unknown')} seconds")

        # Validate token claims (service accounts have sub in access token)
        access_token = data["access_token"]
        return validate_token_claims(access_token, config, require_sub=True)

    except httpx.HTTPError as e:
        error(f"HTTP error: {e}")
        return False


def test_password_grant_flow(client: httpx.Client, config: dict[str, str]) -> bool:
    """Test OAuth2 Password Grant flow with test user."""
    header("Testing Password Grant Flow (admin user)")
    url = f"{get_realm_url(config)}/protocol/openid-connect/token"

    try:
        response = client.post(
            url,
            data={
                "grant_type": "password",
                "client_id": config["web_client_id"],
                "client_secret": config["web_client_secret"],
                "username": config["admin_username"],
                "password": config["admin_password"],
                "scope": "openid profile email",
            },
            timeout=10.0,
        )

        if response.status_code != 200:
            error(f"Token request failed with status {response.status_code}")
            try:
                err_data = response.json()
                error(
                    f"Error: {err_data.get('error')}: {err_data.get('error_description')}"
                )
            except ValueError:
                error(f"Response: {response.text}")
            info("Check that pki-web client has directAccessGrantsEnabled=true")
            info("Check that admin user exists with password 'admin'")
            return False

        data = response.json()

        # Verify token response
        if "access_token" not in data:
            error("Token response missing 'access_token'")
            return False

        success(f"Password Grant flow OK")
        success(f"Token type: {data.get('token_type', 'unknown')}")
        success(f"Expires in: {data.get('expires_in', 'unknown')} seconds")

        if "refresh_token" in data:
            success("Refresh token received")

        # Validate access token claims
        access_token = data["access_token"]
        access_ok = validate_token_claims(access_token, config, require_sub=False)

        # For password grant with openid scope, also validate id_token
        if "id_token" in data:
            info("Validating id_token...")
            id_ok = validate_token_claims(data["id_token"], config, require_sub=True)
            return access_ok and id_ok

        return access_ok

    except httpx.HTTPError as e:
        error(f"HTTP error: {e}")
        return False


def validate_token_claims(
    token: str, config: dict[str, str], require_sub: bool = True
) -> bool:
    """Validate JWT token claims (without cryptographic verification)."""
    import base64
    import json

    try:
        # JWT is header.payload.signature - we want the payload
        parts = token.split(".")
        if len(parts) != 3:
            error("Invalid JWT format")
            return False

        # Decode payload (add padding if needed)
        payload = parts[1]
        payload += "=" * (4 - len(payload) % 4)
        decoded = base64.urlsafe_b64decode(payload)
        claims = json.loads(decoded)

        # Check required claims (sub is optional in Keycloak 26 access tokens)
        required_claims = ["iss", "exp"]
        if require_sub:
            required_claims.append("sub")
        missing = [c for c in required_claims if c not in claims]
        if missing:
            error(f"Token missing required claims: {', '.join(missing)}")
            return False

        # Verify issuer matches our realm
        expected_issuer = get_realm_url(config)
        if claims["iss"] != expected_issuer:
            error(f"Unexpected issuer: {claims['iss']}")
            info(f"Expected: {expected_issuer}")
            return False

        success("Token claims validated:")
        info(f"  iss: {claims['iss']}")
        if "sub" in claims:
            info(f"  sub: {claims['sub']}")
        if "azp" in claims:
            info(f"  azp: {claims['azp']}")
        if "preferred_username" in claims:
            info(f"  preferred_username: {claims['preferred_username']}")
        if "realm_access" in claims:
            roles = claims["realm_access"].get("roles", [])
            info(f"  roles: {', '.join(roles)}")

        return True

    except Exception as e:
        error(f"Failed to decode token: {e}")
        return False


def main() -> int:
    """Run all Keycloak validation tests."""
    print(f"{Colors.BOLD}{'=' * 60}{Colors.RESET}")
    print(f"{Colors.BOLD}Keycloak Provisioning Validation{Colors.RESET}")
    print(f"{Colors.BOLD}{'=' * 60}{Colors.RESET}")

    # Load configuration
    config = load_config()
    base_url = get_base_url(config)
    info(f"Keycloak URL: {base_url}")
    info(f"Realm: {config['realm']}")

    # Create HTTP client
    client = httpx.Client()
    results: dict[str, bool] = {}

    try:
        # Test 1: Health endpoint (must pass to continue)
        results["health"] = test_health_endpoint(client, config)
        if not results["health"]:
            error("\nKeycloak is not available. Skipping remaining tests.")
            return 1

        # Test 2: OpenID Configuration
        results["openid_config"] = test_openid_configuration(client, config)

        # Test 3: JWKS Endpoint
        results["jwks"] = test_jwks_endpoint(client, config)

        # Test 4: Client Credentials Flow
        results["client_credentials"] = test_client_credentials_flow(client, config)

        # Test 5: Password Grant Flow
        results["password_grant"] = test_password_grant_flow(client, config)

    finally:
        client.close()

    # Summary
    header("Summary")
    passed = sum(1 for v in results.values() if v)
    total = len(results)

    for test_name, passed_test in results.items():
        status = f"{Colors.GREEN}PASS{Colors.RESET}" if passed_test else f"{Colors.RED}FAIL{Colors.RESET}"
        print(f"  {test_name}: {status}")

    print()
    if passed == total:
        success(f"All {total} tests passed!")
        return 0
    else:
        error(f"{total - passed} of {total} tests failed")
        return 1


if __name__ == "__main__":
    sys.exit(main())
