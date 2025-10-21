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

Main KMS configuration file. Includes:
- Server configuration (host and port)
- SQLite database for development
- Logging level
- Optional settings for authentication, TLS, and CORS (commented by default)

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

The backend application connects to KMS through the KMS client service (`backend/src/services/kms.ts`). Configuration:

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
