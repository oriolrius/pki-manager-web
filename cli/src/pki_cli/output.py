"""Output formatting for PKI CLI."""

import json
from datetime import datetime
from typing import Any

from rich.console import Console
from rich.panel import Panel
from rich.table import Table

console = Console()


def format_date(dt: datetime | str | None) -> str:
    """Format a datetime for display."""
    if dt is None:
        return "-"
    if isinstance(dt, str):
        dt = datetime.fromisoformat(dt.replace("Z", "+00:00"))
    return dt.strftime("%Y-%m-%d %H:%M")


def format_status(status: str) -> str:
    """Format status with color."""
    colors = {
        "active": "[green]active[/green]",
        "revoked": "[red]revoked[/red]",
        "expired": "[yellow]expired[/yellow]",
    }
    return colors.get(status.lower(), status)


def extract_cn(subject: str) -> str:
    """Extract Common Name from subject DN."""
    for part in subject.split(","):
        part = part.strip()
        if part.startswith("CN="):
            return part[3:]
    return subject[:40]


def print_json(data: Any) -> None:
    """Print data as formatted JSON."""
    console.print_json(json.dumps(data, default=str, indent=2))


def print_ca_table(cas: list[dict]) -> None:
    """Print CAs as a table."""
    table = Table(title="Certificate Authorities")
    table.add_column("ID", style="dim", max_width=36)
    table.add_column("Common Name", style="cyan")
    table.add_column("Algorithm", style="magenta")
    table.add_column("Status")
    table.add_column("Certs", justify="right")
    table.add_column("Expires", style="yellow")

    for ca in cas:
        table.add_row(
            ca["id"],
            extract_cn(ca["subject"]),
            ca["keyAlgorithm"],
            format_status(ca["status"]),
            str(ca.get("certificateCount", 0)),
            format_date(ca.get("notAfter")),
        )

    console.print(table)


def print_ca_detail(ca: dict) -> None:
    """Print CA details."""
    table = Table(show_header=False, box=None)
    table.add_column("Field", style="bold cyan")
    table.add_column("Value")

    table.add_row("ID", ca["id"])
    table.add_row("Subject", ca["subject"])
    table.add_row("Serial Number", ca.get("serialNumber", "-"))
    table.add_row("Key Algorithm", ca["keyAlgorithm"])
    table.add_row("Status", format_status(ca["status"]))
    table.add_row("Valid From", format_date(ca.get("notBefore")))
    table.add_row("Valid Until", format_date(ca.get("notAfter")))
    table.add_row("Certificates", str(ca.get("certificateCount", 0)))
    table.add_row("Created", format_date(ca.get("createdAt")))

    console.print(Panel(table, title="Certificate Authority", border_style="blue"))


def print_cert_table(certs: list[dict]) -> None:
    """Print certificates as a table."""
    table = Table(title="Certificates")
    table.add_column("ID", style="dim", max_width=36)
    table.add_column("Common Name", style="cyan")
    table.add_column("Type", style="magenta")
    table.add_column("Status")
    table.add_column("Expires", style="yellow")

    for cert in certs:
        table.add_row(
            cert["id"],
            extract_cn(cert["subject"]),
            cert.get("type", "-"),
            format_status(cert["status"]),
            format_date(cert.get("notAfter")),
        )

    console.print(table)


def print_cert_detail(cert: dict) -> None:
    """Print certificate details."""
    table = Table(show_header=False, box=None)
    table.add_column("Field", style="bold cyan")
    table.add_column("Value")

    table.add_row("ID", cert["id"])
    table.add_row("CA ID", cert.get("caId", "-"))
    table.add_row("Type", cert.get("type", "-"))
    table.add_row("Subject", cert["subject"])
    table.add_row("Serial Number", cert.get("serialNumber", "-"))
    table.add_row("Key Algorithm", cert.get("keyAlgorithm", "-"))
    table.add_row("Status", format_status(cert["status"]))
    table.add_row("Valid From", format_date(cert.get("notBefore")))
    table.add_row("Valid Until", format_date(cert.get("notAfter")))
    table.add_row("Created", format_date(cert.get("createdAt")))

    if cert.get("revokedAt"):
        table.add_row("Revoked At", format_date(cert.get("revokedAt")))
        table.add_row("Revocation Reason", cert.get("revocationReason", "-"))

    console.print(Panel(table, title="Certificate", border_style="green"))


def print_stats(stats: dict) -> None:
    """Print dashboard statistics."""
    table = Table(title="PKI Dashboard Statistics")
    table.add_column("Metric", style="cyan")
    table.add_column("Value", justify="right", style="bold")

    table.add_row("Total CAs", str(stats.get("totalCas", 0)))
    table.add_row("Active CAs", str(stats.get("activeCas", 0)))
    table.add_row("Total Certificates", str(stats.get("totalCertificates", 0)))
    table.add_row("Active Certificates", str(stats.get("activeCertificates", 0)))
    table.add_row("Revoked Certificates", str(stats.get("revokedCertificates", 0)))
    table.add_row("Expired Certificates", str(stats.get("expiredCertificates", 0)))
    table.add_row("Expiring Soon", f"[yellow]{stats.get('expiringSoon', 0)}[/yellow]")

    console.print(table)


def print_expiring(items: list[dict]) -> None:
    """Print expiring items."""
    table = Table(title="Expiring Certificates")
    table.add_column("ID", style="dim", max_width=36)
    table.add_column("Type", style="magenta")
    table.add_column("Common Name", style="cyan")
    table.add_column("Expires", style="yellow")
    table.add_column("Days Left", justify="right")

    for item in items:
        days = item.get("daysRemaining", 0)
        days_style = "red" if days <= 7 else "yellow" if days <= 30 else "green"
        table.add_row(
            item.get("id", "-"),
            item.get("type", "-"),
            item.get("cn", "-"),
            format_date(item.get("notAfter")),
            f"[{days_style}]{days}[/{days_style}]",
        )

    console.print(table)


def print_search_results(data: dict) -> None:
    """Print search results."""
    results = data.get("results", {})
    cas = results.get("cas", [])
    certs = results.get("certificates", [])
    domains = results.get("domains", [])

    total = len(cas) + len(certs) + len(domains)
    if total == 0:
        console.print("[dim]No results found[/dim]")
        return

    if cas:
        table = Table(title="Certificate Authorities")
        table.add_column("ID", style="dim", max_width=36)
        table.add_column("Title", style="cyan")
        table.add_column("Subtitle", style="dim")
        table.add_column("Status")

        for item in cas:
            table.add_row(
                item.get("id", "-"),
                item.get("title", "-"),
                item.get("subtitle", "-"),
                format_status(item.get("status", "-")),
            )
        console.print(table)

    if certs:
        table = Table(title="Certificates")
        table.add_column("ID", style="dim", max_width=36)
        table.add_column("Title", style="cyan")
        table.add_column("Subtitle", style="dim")
        table.add_column("Status")

        for item in certs:
            table.add_row(
                item.get("id", "-"),
                item.get("title", "-"),
                item.get("subtitle", "-"),
                format_status(item.get("status", "-")),
            )
        console.print(table)

    if domains:
        table = Table(title="Domains")
        table.add_column("Domain", style="cyan")
        table.add_column("Certificate ID", style="dim", max_width=36)

        for item in domains:
            table.add_row(
                item.get("domain", "-"),
                item.get("certificateId", "-"),
            )
        console.print(table)


def print_success(message: str) -> None:
    """Print a success message."""
    console.print(f"[green]✓[/green] {message}")


def print_error(message: str) -> None:
    """Print an error message."""
    console.print(f"[red]✗[/red] {message}", style="red")


def print_warning(message: str) -> None:
    """Print a warning message."""
    console.print(f"[yellow]⚠[/yellow] {message}", style="yellow")
