# Keycloak for development

A Keycloak container with a ready realm, for local development of PKI Manager. `just dev` starts it
when `backend/.env` has `OIDC_ISSUER=http://localhost:42997/...`.

For a production Keycloak, read [Keycloak setup](../docs/operations/keycloak.md). For how PKI Manager
uses OIDC and all its variables, read [OIDC login](../docs/operations/oidc.md).

## Files

```
keycloak/
├── docker-compose.yml    # Keycloak 26 in dev mode, with realm import
├── pki-dev-realm.json    # the development realm
├── test_keycloak.py      # checks the realm and the OAuth2 flows
└── data/                 # Keycloak data (gitignored)
```

## The realm `pki-dev`

| What | Value |
|---|---|
| Roles | `admin`, `user` |
| Users (password = user name) | `admin` (role `admin`), `user` (role `user`) |
| Client `pki-web` | Public client with PKCE (S256) for the web UI. No client secret. Redirect URIs `http://localhost:52080/*` and `http://localhost:8080/*` |
| Client `pki-service` | Confidential client for scripts (client credentials). Secret `pki-service-secret` |
| Access token lifetime | 300 seconds |

## Ports and variables

| Port on the host | In the container | Use |
|---|---|---|
| 42997 | 8080 | Keycloak and its admin console (`admin` / `admin`) |
| 42999 | 9000 | Keycloak management port |

The Compose file reads these optional variables from the environment: `KEYCLOAK_PORT`,
`KEYCLOAK_MGMT_PORT`, `KC_BOOTSTRAP_ADMIN_USERNAME` and `KC_BOOTSTRAP_ADMIN_PASSWORD`.

## Usage

```bash
docker compose up -d            # start (just dev does this for you)
docker compose logs -f keycloak
docker compose down             # stop and remove the container; the data stays in ./data
rm -rf data/*                   # start again from the realm file
```

Check that it answers:

```bash
curl -s http://localhost:42997/realms/pki-dev/.well-known/openid-configuration | head -c 120
uv run keycloak/test_keycloak.py     # from the repository root: all flows
```

### Endpoints

- **Authorization**: `http://localhost:42997/realms/pki-dev/protocol/openid-connect/auth`
- **Token**: `http://localhost:42997/realms/pki-dev/protocol/openid-connect/token`
- **UserInfo**: `http://localhost:42997/realms/pki-dev/protocol/openid-connect/userinfo`
- **JWKS**: `http://localhost:42997/realms/pki-dev/protocol/openid-connect/certs`
- **Discovery**: `http://localhost:42997/realms/pki-dev/.well-known/openid-configuration`

### A token for a script

```bash
curl -X POST http://localhost:42997/realms/pki-dev/protocol/openid-connect/token \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "grant_type=client_credentials" \
  -d "client_id=pki-service" \
  -d "client_secret=pki-service-secret"
```

## Troubleshooting

- **The container does not start**: check that port 42997 is free (`ss -ltn | grep 42997`) and read
  `docker compose logs keycloak`.
- **The realm is not there, or is old**: Keycloak imports the realm file only when the realm does
  not exist yet. To load the file again, stop the container, run `rm -rf data/*` and start it.
- **The backend refuses tokens**: the issuer in `backend/.env` (`OIDC_ISSUER`) must be exactly the
  issuer in the token, `http://localhost:42997/realms/pki-dev`.

## Security

This setup is for development only: default passwords, a known client secret, HTTP and the
development mode of Keycloak. Do not expose it.
