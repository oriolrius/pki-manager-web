# PKI Manager CLI

Command-line interface for managing X.509 certificates via the PKI Manager API.

## Installation

```bash
# Using uv (recommended)
cd cli
uv sync
uv run pki --help

# Or install globally with pipx
pipx install .
pki --help
```

## Configuration

The CLI requires configuration to connect to the PKI Manager API. All settings are required and must be provided via environment variables, `.env` file, or CLI options.

### 1. Using `.env` File (Recommended)

```bash
cp .env.example .env
# Edit .env with your server URLs and credentials
```

The CLI looks for `.env` files in:
- Current working directory
- `~/.config/pki-cli/.env` (global configuration)

### 2. Environment Variables

```bash
export PKI_API_URL=https://your-pki-server.example.com/api/v1
export PKI_OIDC_URL=https://your-iam-server.example.com/realms/realm/protocol/openid-connect/token
export PKI_CLIENT_ID=your-client-id
export PKI_CLIENT_SECRET=your-client-secret
```

### 3. CLI Options

```bash
pki --api-url https://... --oidc-url https://... \
    --client-id your-id --client-secret your-secret \
    ca list
```

## Usage

### Check Configuration

```bash
pki config          # Show current configuration
pki login           # Test authentication
pki logout          # Clear cached token
pki health          # Check API health
```

### Certificate Authorities

```bash
pki ca list                                    # List all CAs
pki ca list --status active                    # Filter by status
pki ca get <CA_ID>                             # Get CA details
pki ca create --cn "My CA" --org "MyOrg"       # Create new CA
pki ca revoke <CA_ID> --reason key_compromise  # Revoke CA
pki ca delete <CA_ID> --force                  # Delete CA
```

### Certificates

```bash
pki cert list                                  # List all certificates
pki cert list --ca <CA_ID>                     # Filter by CA
pki cert list --type server --status active    # Filter by type and status
pki cert get <CERT_ID>                         # Get certificate details

# Issue a new certificate
pki cert issue --ca <CA_ID> --cn "example.com" --type server \
    --dns "www.example.com" --dns "api.example.com"

pki cert renew <CERT_ID>                       # Renew certificate
pki cert revoke <CERT_ID> --reason key_compromise  # Revoke
pki cert delete <CERT_ID> --force              # Delete

# Download certificate
pki cert download <CERT_ID>                    # Download as PEM
pki cert download <CERT_ID> -f pkcs12 -p pass  # Download as PKCS12
```

### Dashboard

```bash
pki stats                    # Show statistics
pki expiring                 # Show expiring certificates
pki search "example"         # Search CAs and certificates
```

### Output Formats

All commands support `-o json` for JSON output:

```bash
pki ca list -o json | jq '.items[].id'
```

## Examples

```bash
# Create a CA and issue a server certificate
CA_ID=$(pki ca create --cn "Internal CA" -o json | jq -r '.id')
pki cert issue --ca "$CA_ID" --cn "web.internal" --type server

# Renew expiring certificates
for id in $(pki expiring -o json | jq -r '.[].id'); do
    pki cert renew "$id"
done
```

## Environment Variables Reference

| Variable | Description | Required |
|----------|-------------|----------|
| `PKI_API_URL` | PKI Manager API URL | Yes |
| `PKI_OIDC_URL` | OIDC token endpoint | Yes |
| `PKI_CLIENT_ID` | OIDC client ID | Yes |
| `PKI_CLIENT_SECRET` | OIDC client secret | Yes |

## Security Notes

- Never commit `.env` files containing credentials
- The `.gitignore` is configured to exclude `.env` files
- Use `~/.config/pki-cli/.env` for personal credentials
- Token cache is stored in `~/.cache/pki-cli/token` with restricted permissions
