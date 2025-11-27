#!/bin/sh
# Frontend entrypoint - replaces __API_URL__ placeholder with runtime value

CONFIG_FILE="/usr/share/nginx/html/config.json"
TMP_CONFIG="/tmp/config.json"

# Replace placeholder with actual API URL (from environment variable)
if [ -n "$VITE_API_URL" ]; then
  echo "Setting API URL to: $VITE_API_URL"
  # Use temp file approach to avoid sed -i permission issues
  sed "s|__API_URL__|$VITE_API_URL|g" "$CONFIG_FILE" > "$TMP_CONFIG"
  cat "$TMP_CONFIG" > "$CONFIG_FILE"
  rm -f "$TMP_CONFIG"
else
  echo "Warning: VITE_API_URL not set, using build-time default"
fi

# Start nginx
exec nginx -g "daemon off;"
