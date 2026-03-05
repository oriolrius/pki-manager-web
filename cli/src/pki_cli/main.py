"""PKI CLI - Main entry point using OpenAPI generated client."""

from pathlib import Path
from typing import Annotated, Optional
from uuid import UUID

import httpx
import typer
from rich.console import Console
from rich.table import Table

from pki_api.pki_manager_rest_api_client.api.certificate_authorities import (
    delete_cas_id,
    get_cas,
    get_cas_id,
    post_cas,
    post_cas_id_revoke,
)
from pki_api.pki_manager_rest_api_client.api.certificates import (
    delete_certificates_id,
    get_certificates,
    get_certificates_id,
    get_certificates_id_download,
    post_certificates,
    post_certificates_id_renew,
    post_certificates_id_revoke,
)
from pki_api.pki_manager_rest_api_client.api.dashboard import (
    get_dashboard_expiring,
    get_dashboard_stats,
)
from pki_api.pki_manager_rest_api_client.api.search import get_search
from pki_api.pki_manager_rest_api_client.models import (
    GetCasStatus,
    GetCertificatesStatus,
    GetCertificatesType,
    PostCasBody,
    PostCasBodyKeyAlgorithm,
    PostCasBodySubject,
    PostCertificatesBody,
    PostCertificatesBodyCertificateType,
    PostCertificatesBodyKeyAlgorithm,
    PostCertificatesBodySubject,
    PostCertificatesIdRenewBody,
    PostCertificatesIdRevokeBody,
    PostCertificatesIdRevokeBodyReason,
    PostCasIdRevokeBody,
    PostCasIdRevokeBodyReason,
)
from pki_api.pki_manager_rest_api_client.types import UNSET

from . import __version__
from .client import get_client
from .config import configure
from .output import (
    print_ca_detail,
    print_ca_table,
    print_cert_detail,
    print_cert_table,
    print_error,
    print_expiring,
    print_json,
    print_search_results,
    print_stats,
    print_success,
)

console = Console()

# Main app
app = typer.Typer(
    name="pki",
    help="PKI Manager CLI - Manage X.509 certificates",
    no_args_is_help=True,
)

# Subcommand groups
ca_app = typer.Typer(help="Certificate Authority management")
cert_app = typer.Typer(help="Certificate management")

app.add_typer(ca_app, name="ca")
app.add_typer(cert_app, name="cert")


# Common type aliases
OutputFormat = Annotated[str, typer.Option("--output", "-o", help="Output format: table, json")]


def version_callback(value: bool) -> None:
    """Print version and exit."""
    if value:
        console.print(f"pki-cli version {__version__}")
        raise typer.Exit()


@app.callback()
def main(
    version: Annotated[
        bool,
        typer.Option("--version", "-v", callback=version_callback, is_eager=True, help="Show version"),
    ] = False,
    api_url: Annotated[
        Optional[str],
        typer.Option("--api-url", envvar="PKI_API_URL", help="PKI Manager API URL"),
    ] = None,
    oidc_url: Annotated[
        Optional[str],
        typer.Option("--oidc-url", envvar="PKI_OIDC_URL", help="OIDC token endpoint URL"),
    ] = None,
    client_id: Annotated[
        Optional[str],
        typer.Option("--client-id", envvar="PKI_CLIENT_ID", help="OIDC client ID"),
    ] = None,
    client_secret: Annotated[
        Optional[str],
        typer.Option("--client-secret", envvar="PKI_CLIENT_SECRET", help="OIDC client secret"),
    ] = None,
) -> None:
    """PKI Manager CLI - Manage X.509 certificates.

    Configuration can be provided via:
    - CLI options (--api-url, --client-id, --client-secret)
    - Environment variables (PKI_API_URL, PKI_CLIENT_ID, PKI_CLIENT_SECRET)
    - .env file in current directory or ~/.config/pki-cli/.env
    """
    # Configure settings with any CLI overrides
    configure(
        api_url=api_url,
        oidc_url=oidc_url,
        client_id=client_id,
        client_secret=client_secret,
    )


# =============================================================================
# CA Commands
# =============================================================================


@ca_app.command("list")
def ca_list(
    status: Annotated[Optional[str], typer.Option(help="Filter by status: active, revoked, expired")] = None,
    limit: Annotated[int, typer.Option(help="Max results")] = 50,
    output: OutputFormat = "table",
) -> None:
    """List all Certificate Authorities."""
    try:
        client = get_client()
        status_enum = GetCasStatus(status) if status else UNSET
        result = get_cas.sync(client=client, status=status_enum, limit=limit)

        if result is None:
            print_error("Failed to fetch CAs")
            raise typer.Exit(1)

        if output == "json":
            print_json(result.to_dict())
        else:
            items = [item.to_dict() for item in result.items]
            if items:
                print_ca_table(items)
            else:
                console.print("[dim]No CAs found[/dim]")
    except Exception as e:
        print_error(str(e))
        raise typer.Exit(1)


@ca_app.command("get")
def ca_get(
    ca_id: Annotated[str, typer.Argument(help="CA ID (UUID)")],
    output: OutputFormat = "table",
) -> None:
    """Get CA details."""
    try:
        client = get_client()
        result = get_cas_id.sync(client=client, id=ca_id)

        if result is None:
            print_error(f"CA {ca_id} not found")
            raise typer.Exit(1)

        if output == "json":
            print_json(result.to_dict())
        else:
            print_ca_detail(result.to_dict())
    except Exception as e:
        print_error(str(e))
        raise typer.Exit(1)


@ca_app.command("create")
def ca_create(
    common_name: Annotated[str, typer.Option("--cn", help="Common Name")],
    organization: Annotated[str, typer.Option("--org", "-O", help="Organization")] = "YMBIHQ",
    country: Annotated[str, typer.Option("--country", "-c", help="Country (2-letter)")] = "ES",
    state: Annotated[Optional[str], typer.Option("--state", help="State/Province")] = None,
    locality: Annotated[Optional[str], typer.Option("--locality", "-l", help="City")] = None,
    ou: Annotated[Optional[str], typer.Option("--ou", help="Organizational Unit")] = None,
    algorithm: Annotated[str, typer.Option("--algorithm", "-a", help="Key algorithm: RSA-2048, RSA-4096, ECDSA-P256, ECDSA-P384")] = "RSA-4096",
    validity: Annotated[int, typer.Option("--validity", "-v", help="Validity in days")] = 3650,
    output: OutputFormat = "table",
) -> None:
    """Create a new Certificate Authority."""
    try:
        client = get_client()

        subject = PostCasBodySubject(
            common_name=common_name,
            organization=organization,
            country=country,
            state=state if state else UNSET,
            locality=locality if locality else UNSET,
            organizational_unit=ou if ou else UNSET,
        )

        body = PostCasBody(
            subject=subject,
            key_algorithm=PostCasBodyKeyAlgorithm(algorithm),
            validity_days=validity,
        )

        result = post_cas.sync(client=client, body=body)

        if result is None:
            print_error("Failed to create CA")
            raise typer.Exit(1)

        if output == "json":
            print_json(result.to_dict())
        else:
            print_success(f"CA created: {result.id}")
            print_ca_detail(result.to_dict())
    except Exception as e:
        print_error(str(e))
        raise typer.Exit(1)


@ca_app.command("revoke")
def ca_revoke(
    ca_id: Annotated[str, typer.Argument(help="CA ID (UUID)")],
    reason: Annotated[str, typer.Option("--reason", "-r", help="Revocation reason")] = "unspecified",
    force: Annotated[bool, typer.Option("--force", "-f", help="Skip confirmation")] = False,
) -> None:
    """Revoke a Certificate Authority."""
    if not force:
        confirm = typer.confirm(f"Are you sure you want to revoke CA {ca_id}?")
        if not confirm:
            raise typer.Abort()

    try:
        client = get_client()
        body = PostCasIdRevokeBody(reason=PostCasIdRevokeBodyReason(reason))
        result = post_cas_id_revoke.sync(client=client, id=ca_id, body=body)

        if result is None:
            print_error(f"Failed to revoke CA {ca_id}")
            raise typer.Exit(1)

        print_success(f"CA {ca_id} revoked")
    except Exception as e:
        print_error(str(e))
        raise typer.Exit(1)


@ca_app.command("delete")
def ca_delete(
    ca_id: Annotated[str, typer.Argument(help="CA ID (UUID)")],
    force: Annotated[bool, typer.Option("--force", "-f", help="Skip confirmation")] = False,
) -> None:
    """Delete a Certificate Authority."""
    if not force:
        confirm = typer.confirm(f"Are you sure you want to DELETE CA {ca_id}? This is irreversible!")
        if not confirm:
            raise typer.Abort()

    try:
        client = get_client()
        delete_cas_id.sync(client=client, id=ca_id)
        print_success(f"CA {ca_id} deleted")
    except Exception as e:
        print_error(str(e))
        raise typer.Exit(1)


# =============================================================================
# Certificate Commands
# =============================================================================


@cert_app.command("list")
def cert_list(
    ca_id: Annotated[Optional[str], typer.Option("--ca", help="Filter by CA ID")] = None,
    status: Annotated[Optional[str], typer.Option("--status", "-s", help="Filter by status")] = None,
    cert_type: Annotated[Optional[str], typer.Option("--type", "-t", help="Filter by type")] = None,
    limit: Annotated[int, typer.Option("--limit", "-l", help="Max results")] = 50,
    output: OutputFormat = "table",
) -> None:
    """List certificates."""
    try:
        client = get_client()
        status_enum = GetCertificatesStatus(status) if status else UNSET
        type_enum = GetCertificatesType(cert_type) if cert_type else UNSET
        ca_uuid = UUID(ca_id) if ca_id else UNSET

        result = get_certificates.sync(
            client=client,
            ca_id=ca_uuid,
            status=status_enum,
            type_=type_enum,
            limit=limit,
        )

        if result is None:
            print_error("Failed to fetch certificates")
            raise typer.Exit(1)

        if output == "json":
            print_json(result.to_dict())
        else:
            items = [item.to_dict() for item in result.items]
            if items:
                print_cert_table(items)
            else:
                console.print("[dim]No certificates found[/dim]")
    except Exception as e:
        print_error(str(e))
        raise typer.Exit(1)


@cert_app.command("get")
def cert_get(
    cert_id: Annotated[str, typer.Argument(help="Certificate ID (UUID)")],
    output: OutputFormat = "table",
) -> None:
    """Get certificate details."""
    try:
        client = get_client()
        result = get_certificates_id.sync(client=client, id=cert_id)

        if result is None:
            print_error(f"Certificate {cert_id} not found")
            raise typer.Exit(1)

        if output == "json":
            print_json(result.to_dict())
        else:
            print_cert_detail(result.to_dict())
    except Exception as e:
        print_error(str(e))
        raise typer.Exit(1)


@cert_app.command("issue")
def cert_issue(
    ca_id: Annotated[str, typer.Option("--ca", help="CA ID to issue from")],
    common_name: Annotated[str, typer.Option("--cn", help="Common Name")],
    cert_type: Annotated[str, typer.Option("--type", "-t", help="Certificate type: server, client, email, code_signing")] = "server",
    organization: Annotated[str, typer.Option("--org", "-O", help="Organization")] = "YMBIHQ",
    country: Annotated[str, typer.Option("--country", "-c", help="Country")] = "ES",
    algorithm: Annotated[str, typer.Option("--algorithm", "-a", help="Key algorithm")] = "RSA-2048",
    validity: Annotated[int, typer.Option("--validity", "-v", help="Validity in days")] = 365,
    dns: Annotated[Optional[list[str]], typer.Option("--dns", "-d", help="DNS SANs (repeatable)")] = None,
    ip: Annotated[Optional[list[str]], typer.Option("--ip", help="IP SANs (repeatable)")] = None,
    output: OutputFormat = "table",
) -> None:
    """Issue a new certificate."""
    try:
        client = get_client()

        # Build DNS names list - include CN automatically
        dns_names = list(dns) if dns else []
        if common_name not in dns_names:
            dns_names.insert(0, common_name)

        subject = PostCertificatesBodySubject(
            common_name=common_name,
            organization=organization,
            country=country,
        )

        body = PostCertificatesBody(
            ca_id=UUID(ca_id),
            certificate_type=PostCertificatesBodyCertificateType(cert_type),
            subject=subject,
            key_algorithm=PostCertificatesBodyKeyAlgorithm(algorithm),
            validity_days=validity,
            san_dns=dns_names if dns_names else UNSET,
            san_ip=list(ip) if ip else UNSET,
        )

        result = post_certificates.sync(client=client, body=body)

        if result is None:
            print_error("Failed to issue certificate")
            raise typer.Exit(1)

        if output == "json":
            print_json(result.to_dict())
        else:
            print_success(f"Certificate issued: {result.id}")
            print_cert_detail(result.to_dict())
    except Exception as e:
        print_error(str(e))
        raise typer.Exit(1)


@cert_app.command("renew")
def cert_renew(
    cert_id: Annotated[str, typer.Argument(help="Certificate ID (UUID)")],
    validity: Annotated[int, typer.Option("--validity", "-v", help="Validity in days")] = 365,
    output: OutputFormat = "table",
) -> None:
    """Renew a certificate."""
    try:
        client = get_client()
        body = PostCertificatesIdRenewBody(validity_days=validity)
        result = post_certificates_id_renew.sync(client=client, id=cert_id, body=body)

        if result is None:
            print_error(f"Failed to renew certificate {cert_id}")
            raise typer.Exit(1)

        if output == "json":
            print_json(result.to_dict())
        else:
            print_success(f"Certificate renewed: {result.id}")
            print_cert_detail(result.to_dict())
    except Exception as e:
        print_error(str(e))
        raise typer.Exit(1)


@cert_app.command("revoke")
def cert_revoke(
    cert_id: Annotated[str, typer.Argument(help="Certificate ID (UUID)")],
    reason: Annotated[str, typer.Option("--reason", "-r", help="Revocation reason")] = "unspecified",
    force: Annotated[bool, typer.Option("--force", "-f", help="Skip confirmation")] = False,
) -> None:
    """Revoke a certificate."""
    if not force:
        confirm = typer.confirm(f"Are you sure you want to revoke certificate {cert_id}?")
        if not confirm:
            raise typer.Abort()

    try:
        client = get_client()
        body = PostCertificatesIdRevokeBody(reason=PostCertificatesIdRevokeBodyReason(reason))
        result = post_certificates_id_revoke.sync(client=client, id=cert_id, body=body)

        if result is None:
            print_error(f"Failed to revoke certificate {cert_id}")
            raise typer.Exit(1)

        print_success(f"Certificate {cert_id} revoked")
    except Exception as e:
        print_error(str(e))
        raise typer.Exit(1)


@cert_app.command("delete")
def cert_delete(
    cert_id: Annotated[str, typer.Argument(help="Certificate ID (UUID)")],
    force: Annotated[bool, typer.Option("--force", "-f", help="Skip confirmation")] = False,
) -> None:
    """Delete a certificate."""
    if not force:
        confirm = typer.confirm(f"Are you sure you want to DELETE certificate {cert_id}?")
        if not confirm:
            raise typer.Abort()

    try:
        client = get_client()
        delete_certificates_id.sync(client=client, id=cert_id)
        print_success(f"Certificate {cert_id} deleted")
    except Exception as e:
        print_error(str(e))
        raise typer.Exit(1)


@cert_app.command("download")
def cert_download(
    cert_id: Annotated[str, typer.Argument(help="Certificate ID (UUID)")],
    output_file: Annotated[Path, typer.Option("--output", "-o", help="Output file path")] = Path("cert.pem"),
    format: Annotated[str, typer.Option("--format", "-f", help="Download format: pem, der, pkcs12, jks")] = "pem",
    password: Annotated[Optional[str], typer.Option("--password", "-p", help="Password for PKCS12/JKS")] = None,
) -> None:
    """Download certificate."""
    try:
        # Validate password requirement
        if format in ("pkcs12", "jks") and not password:
            print_error(f"Password required for {format} format")
            raise typer.Exit(1)

        client = get_client()
        result = get_certificates_id_download.sync_detailed(
            client=client,
            id=cert_id,
            format_=format,
            password=password if password else UNSET,
        )

        if result.status_code != 200:
            print_error(f"Failed to download certificate: {result.status_code}")
            raise typer.Exit(1)

        # Adjust filename extension
        if output_file == Path("cert.pem"):
            ext = format if format != "pkcs12" else "p12"
            output_file = Path(f"cert.{ext}")

        output_file.write_bytes(result.content)
        print_success(f"Certificate saved to {output_file}")
    except Exception as e:
        print_error(str(e))
        raise typer.Exit(1)


# =============================================================================
# Dashboard Commands
# =============================================================================


@app.command("stats")
def stats(output: OutputFormat = "table") -> None:
    """Show dashboard statistics."""
    try:
        client = get_client()
        result = get_dashboard_stats.sync(client=client)

        if result is None:
            print_error("Failed to fetch statistics")
            raise typer.Exit(1)

        if output == "json":
            print_json(result.to_dict())
        else:
            print_stats(result.to_dict())
    except Exception as e:
        print_error(str(e))
        raise typer.Exit(1)


@app.command("expiring")
def expiring(
    limit: Annotated[int, typer.Option("--limit", "-l", help="Max results")] = 5,
    output: OutputFormat = "table",
) -> None:
    """Show expiring certificates."""
    try:
        client = get_client()
        result = get_dashboard_expiring.sync(client=client, limit=limit)

        if result is None:
            print_error("Failed to fetch expiring certificates")
            raise typer.Exit(1)

        # Result is a list directly
        if isinstance(result, list):
            items = [item.to_dict() for item in result]
        else:
            items = []

        if output == "json":
            print_json(items)
        else:
            if items:
                print_expiring(items)
            else:
                console.print("[green]No certificates expiring soon[/green]")
    except Exception as e:
        print_error(str(e))
        raise typer.Exit(1)


@app.command("search")
def search(
    query: Annotated[str, typer.Argument(help="Search query")],
    limit: Annotated[int, typer.Option("--limit", "-l", help="Max results")] = 50,
    output: OutputFormat = "table",
) -> None:
    """Search CAs and certificates."""
    try:
        client = get_client()
        result = get_search.sync(client=client, query=query, limit=limit)

        if result is None:
            print_error("Failed to search")
            raise typer.Exit(1)

        if output == "json":
            print_json(result.to_dict())
        else:
            print_search_results(result.to_dict())
    except Exception as e:
        print_error(str(e))
        raise typer.Exit(1)


@app.command("health")
def health() -> None:
    """Check API health status."""
    try:
        from .config import get_settings

        settings = get_settings()
        # Extract base URL from API URL (remove /api/v1)
        base_url = settings.api_url.replace("/api/v1", "")
        with httpx.Client() as http_client:
            response = http_client.get(f"{base_url}/health")
            result = response.json()
            print_json(result)
            print_success("API is healthy")
    except Exception as e:
        print_error(f"API health check failed: {e}")
        raise typer.Exit(1)


@app.command("config")
def show_config() -> None:
    """Show current configuration (credentials are masked)."""
    from .config import get_settings

    settings = get_settings()

    table = Table(title="PKI CLI Configuration", show_header=False)
    table.add_column("Setting", style="cyan")
    table.add_column("Value")

    table.add_row("API URL", settings.api_url or "[red]Not set[/red]")
    table.add_row("OIDC URL", settings.oidc_url or "[red]Not set[/red]")
    table.add_row("Client ID", settings.client_id or "[red]Not set[/red]")
    table.add_row(
        "Client Secret",
        f"{settings.client_secret[:4]}****" if settings.client_secret else "[red]Not set[/red]",
    )
    table.add_row("Token Cache", str(settings.token_cache_file))

    console.print(table)

    # Check if configuration is complete
    missing = []
    if not settings.api_url:
        missing.append("PKI_API_URL")
    if not settings.oidc_url:
        missing.append("PKI_OIDC_URL")
    if not settings.client_id:
        missing.append("PKI_CLIENT_ID")
    if not settings.client_secret:
        missing.append("PKI_CLIENT_SECRET")

    if missing:
        console.print(f"\n[yellow]Warning: Missing configuration: {', '.join(missing)}[/yellow]")
        console.print("Set them via environment variables, .env file, or CLI options.")


@app.command("login")
def login() -> None:
    """Test authentication and cache token."""
    try:
        from .client import get_wrapper

        wrapper = get_wrapper()
        wrapper.token_manager.clear_cache()  # Clear any cached token
        wrapper.token_manager.get_token()  # Try to get a fresh token
        print_success("Authentication successful! Token cached.")
    except ValueError as e:
        print_error(str(e))
        raise typer.Exit(1)
    except Exception as e:
        print_error(f"Authentication failed: {e}")
        raise typer.Exit(1)


@app.command("logout")
def logout() -> None:
    """Clear cached authentication token."""
    from .client import get_wrapper

    wrapper = get_wrapper()
    wrapper.token_manager.clear_cache()
    print_success("Token cache cleared.")


if __name__ == "__main__":
    app()
