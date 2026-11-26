# Cosmian KMS for v3 recovery

Use this container only with a v3 backend, for example to inspect a restored v3 backup on an isolated host. The OpenBao edition uses the [OpenBao configuration](../docs/operations/openbao.md) and [development stack](../docs/development/setup.md).

## Files

```
kms/
├── docker-compose.yml    # Cosmian KMS, pinned version
├── kms.toml              # KMS server configuration
└── data/                 # the KMS database: your development keys (gitignored)
```

## Configuration

The host port is **42998**; the KMS listens on 9998 inside the container.

`kms.toml` is the configuration (Cosmian KMS 5.28 schema, matching the pinned image). The
container loads it through `COSMIAN_KMS_CONF`:

- `[http]`: host and port
- `[db]`: SQLite database at `/cosmian-kms/sqlite-data` (the mounted `./data`)
- `[workspace]`: working directories
- `[logging] rust_log`: log level. In this mode the `RUST_LOG` environment variable is ignored:
  change the level here.

The KMS **silently ignores unknown keys**. An older version of this file used
`[server]`/`[database] type/path`, so the database lived only in the container's
writable layer and recreating the container lost every key. After changing the
file, check that `./data/kms.db` grows when you create a key.

## Usage

```bash
docker compose up -d       # start the v3 KMS on the recovery host
docker compose logs -f kms
docker compose restart kms # after a change to kms.toml
docker compose down        # stop and remove the container; the keys stay in ./data
```

Check that it answers:

```bash
curl http://localhost:42998/health
curl http://localhost:42998/version
```

`./data` holds every development key. `docker compose down -v` does not delete it, because it is
a folder on the host and not a Docker volume. Delete the folder content only when you want to lose
all development CAs.

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

## How PKI Manager uses it

The v3 backend talks to Cosmian for key pair
generation, certificate signing, signing for SSH, public key retrieval and key destruction.
[How it works](../docs/how-it-works.md) says where each key lives.

## Troubleshooting

- **The container does not start**: check that port 42998 is free (`ss -ltn | grep 42998`) and read
  `docker compose logs kms`.
- **The KMS rejects its arguments**: the Compose file must set `COSMIAN_KMS_CONF`. Without it,
  current images find the configuration file and also add default arguments, and then stop.

## Security

This setup is for development: no authentication and plain HTTP on a host port. Keep the recovery instance on an isolated host. See
[Docker deployment](../docs/operations/deployment.md).

- [Cosmian KMS documentation](https://docs.cosmian.com/)
- [Cosmian KMS on GitHub](https://github.com/Cosmian/kms)
