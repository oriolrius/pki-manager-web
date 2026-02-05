# Keycloak - PKI Manager Development Environment

This directory contains the configuration needed to run Keycloak Identity Server for the PKI Manager application using Docker Compose.

## File Structure

```
keycloak/
├── docker-compose.yml    # Docker Compose configuration
├── dev-realm.json        # Development realm configuration
├── .env                  # Environment variables
├── data/                 # Persistent data (gitignored)
└── README.md             # This documentation
```

## Prerequisites

- Docker (version 20.10 or higher)
- Docker Compose (version 2.0 or higher)

## Configuration

### Port Configuration

The Keycloak server uses a custom port mapping in the 42000-43000 range per project requirements:
- **External port**: 42997 (accessible from host)
- **Internal port**: 8080 (inside container)

### dev-realm.json

Pre-configured development realm with:
- **Realm name**: `pki-dev`
- **Roles**: `admin`, `user`
- **Clients**:
  - `pki-service` - OAuth2 Client Credentials flow (machine-to-machine)
  - `pki-web` - Confidential client for web application
- **Test users** (password = username):
  - `admin` - has `admin` role
  - `user` - has `user` role

### .env

Environment variables to customize Keycloak behavior:
- `KEYCLOAK_PORT`: External port (default: 42997)
- `KC_BOOTSTRAP_ADMIN_USERNAME`: Admin console username (default: admin)
- `KC_BOOTSTRAP_ADMIN_PASSWORD`: Admin console password (default: admin)

### Client Credentials

| Client | Type | Client ID | Client Secret |
|--------|------|-----------|---------------|
| pki-service | Client Credentials | `pki-service` | `pki-service-secret` |
| pki-web | Confidential | `pki-web` | `pki-web-secret` |

## Usage

### Start the service

```bash
docker-compose up -d
```

### View logs

```bash
docker-compose logs -f keycloak
```

### Stop the service

```bash
docker-compose down
```

### Stop and remove data

```bash
docker-compose down -v
rm -rf data/*
```

## Accessing Keycloak

### Admin Console

Access the Keycloak admin console at:

```
http://localhost:42997
```

Login with the bootstrap admin credentials (default: admin/admin).

### Health Check

To verify the service is running:

```bash
curl http://localhost:42997/health/ready
```

## Development Realm

After starting Keycloak, the `pki-dev` realm is automatically imported with pre-configured clients and users.

### Test User Login

Use these credentials to test authentication:

| Username | Password | Role |
|----------|----------|------|
| admin | admin | admin |
| user | user | user |

### OAuth2 Endpoints

- **Authorization**: `http://localhost:42997/realms/pki-dev/protocol/openid-connect/auth`
- **Token**: `http://localhost:42997/realms/pki-dev/protocol/openid-connect/token`
- **UserInfo**: `http://localhost:42997/realms/pki-dev/protocol/openid-connect/userinfo`
- **JWKS**: `http://localhost:42997/realms/pki-dev/protocol/openid-connect/certs`
- **Discovery**: `http://localhost:42997/realms/pki-dev/.well-known/openid-configuration`

### Client Credentials Flow (pki-service)

Get a token using client credentials:

```bash
curl -X POST http://localhost:42997/realms/pki-dev/protocol/openid-connect/token \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "grant_type=client_credentials" \
  -d "client_id=pki-service" \
  -d "client_secret=pki-service-secret"
```

### Authorization Code Flow (pki-web)

For web application authentication, use the `pki-web` client with redirect URIs:
- `http://localhost:5173/*` (Vite dev server)
- `http://localhost:8080/*` (Production frontend)

## Persistent Data

Keycloak data is stored in the local `./data` directory. This ensures:
- Data persists between container restarts
- Easy inspection and backup
- Version control friendly (data is gitignored)

## Integration with PKI Manager

### Frontend Configuration

Configure the frontend to use Keycloak for authentication:

```typescript
// Example: keycloak-js configuration
const keycloak = new Keycloak({
  url: 'http://localhost:42997',
  realm: 'pki-dev',
  clientId: 'pki-web'
});
```

### Backend Configuration

The backend validates JWT tokens issued by Keycloak:

1. Set `KEYCLOAK_URL=http://localhost:42997` in backend `.env`
2. Set `KEYCLOAK_REALM=pki-dev`
3. The JWT validation middleware verifies tokens using Keycloak's JWKS endpoint

### Backend Service Account

For machine-to-machine communication, use the `pki-service` client:

```typescript
// Example: Client Credentials flow
const tokenResponse = await fetch(
  'http://localhost:42997/realms/pki-dev/protocol/openid-connect/token',
  {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: 'pki-service',
      client_secret: 'pki-service-secret'
    })
  }
);
```

## Official Documentation

- [Keycloak Documentation](https://www.keycloak.org/documentation)
- [Keycloak Docker Image](https://quay.io/repository/keycloak/keycloak)
- [Keycloak GitHub](https://github.com/keycloak/keycloak)

## Troubleshooting

### Container won't start

1. Verify port 42997 is not in use:
   ```bash
   netstat -tuln | grep 42997
   ```

2. Check logs:
   ```bash
   docker-compose logs keycloak
   ```

### Realm not imported

1. Ensure `dev-realm.json` exists and is valid JSON
2. Check container logs for import errors
3. Try removing data and restarting:
   ```bash
   docker-compose down
   rm -rf data/*
   docker-compose up -d
   ```

### Token validation fails

1. Verify Keycloak is running and healthy
2. Check the realm name matches your configuration
3. Ensure the client ID is correct
4. Verify the token hasn't expired

## Security

**IMPORTANT**: This configuration is for development only. For production:

1. Change all default passwords and client secrets
2. Enable HTTPS with valid certificates
3. Configure proper CORS settings
4. Use a production database (PostgreSQL recommended)
5. Enable audit logging
6. Configure proper session timeouts
7. Review and restrict redirect URIs
