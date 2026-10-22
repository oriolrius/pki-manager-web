# Cosmian KMS - PKI Manager Development Environment

This directory contains the configuration needed to run Cosmian KMS (Key Management System) for the PKI Manager application using Docker Compose.

## File Structure

```
kms/
├── docker-compose.yml    # Docker Compose configuration
├── kms.toml             # KMS server configuration
├── .env                 # Environment variables
└── README.md            # This documentation
```

## Prerequisites

- Docker (version 20.10 or higher)
- Docker Compose (version 2.0 or higher)

## Configuration

### Port Configuration

The KMS server uses a custom port mapping to avoid conflicts:
- **External port**: 42998 (accessible from host)
- **Internal port**: 9998 (inside container)

This keeps all services in the 42000-43000 range as per project requirements.

### kms.toml

Main KMS configuration file (Cosmian KMS 5.24 schema), loaded via `COSMIAN_KMS_CONF`:
- `[http]` — host and port
- `[db]` — SQLite database at `/cosmian-kms/sqlite-data` (the mounted `./data`)
- `[workspace]` — working directories
- `[logging] rust_log` — log level (env vars like `RUST_LOG` are ignored in config-file mode)

The KMS **silently ignores unknown keys**. An older version of this file used
`[server]`/`[database] type/path`, so the database lived only in the container's
writable layer and recreating the container lost every key. After changing the
file, check that `./data/kms.db` grows when you create a key.

### .env

Environment variables to customize KMS behavior:
- `RUST_LOG`: Logging level (trace, debug, info, warn, error)

## Usage

### Start the service

```bash
docker-compose up -d
```

### View logs

```bash
docker-compose logs -f kms
```

### Stop the service

```bash
docker-compose down
```

### Stop and remove data

```bash
docker-compose down -v
```

## Accessing the KMS

The KMS server will be available at:

```
http://localhost:42998
```

### Health Check

To verify the service is running:

```bash
curl http://localhost:42998/health
```

## Persistent Data

KMS data (keys, configurations, etc.) is stored in the local `./data` directory. This ensures:
- Data persists between container restarts
- Easy inspection and backup of the database
- Version control friendly (database is gitignored)

### Rescuing a database left inside the container

If the container was created with the old config, the database is at
`/var/lib/cosmian-kms/cosmian-kms/sqlite-data/` inside the container. Copy it out
**before** recreating the container:

```bash
docker stop pki-manager-kms        # stop, do NOT remove
mkdir -p rescued && docker export pki-manager-kms \
  | tar -x -C rescued --strip-components=5 var/lib/cosmian-kms/cosmian-kms/sqlite-data/
sqlite3 rescued/kms.db 'pragma integrity_check'
cp rescued/kms.db* ./data/         # then: docker compose up -d
```

`docker export` also works when `docker cp` fails because a bind-mount source
no longer exists.

## Development

### Modify configuration

1. Edit the `kms.toml` file as needed
2. Restart the service:
   ```bash
   docker-compose restart kms
   ```

### Change logging level

Edit the `.env` file and change the `RUST_LOG` value:

```bash
RUST_LOG=debug
```

Then restart the service.

## Integration with PKI Manager

The backend application connects to KMS through the KMS client/service modules (`backend/src/kms/` — `client.ts` + `service.ts`). Configuration:

1. Set `KMS_URL=http://localhost:42998` in backend `.env`
2. The KMS client handles all cryptographic operations:
   - Key pair generation
   - Data signing
   - Public key retrieval
   - Key destruction

## Official Documentation

- [Cosmian KMS Documentation](https://docs.cosmian.com/)
- [Cosmian GitHub](https://github.com/Cosmian/kms)

## Troubleshooting

### Container won't start

1. Verify port 42998 is not in use:
   ```bash
   netstat -tuln | grep 42998
   ```

2. Check logs:
   ```bash
   docker-compose logs kms
   ```

### Permission issues

If you have permission issues with volumes, ensure Docker has permissions to create and write to the necessary directories.

## Security

**IMPORTANT**: This configuration is for development. For production environments:

1. Enable JWT authentication or other mechanisms
2. Configure TLS with valid certificates
3. Use a more robust database (PostgreSQL, MySQL)
4. Review and configure CORS appropriately
5. Consider network isolation and firewall rules
6. Implement key rotation policies
7. Enable audit logging
