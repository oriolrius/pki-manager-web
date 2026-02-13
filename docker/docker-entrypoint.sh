#!/bin/sh
set -e

echo "Starting PKI Manager Backend..."

# Run database migrations
echo "Running database migrations..."
node /app/backend/dist/db/migrate.js

# Start the server
echo "Starting server..."
exec "$@"
