#!/bin/sh
# Entrypoint of the frontend image: writes the CSP origins for nginx, then runs the command
# (CMD: nginx -g "daemon off;").
#
# The browser calls the API (config.json apiUrl, else the API URL built into the bundle) and the
# OIDC provider (config.json oidc.authority), which can be on other origins. The CSP
# (docker/nginx/security-headers-csp.conf) allows in connect-src and frame-src every
# http(s)://host[:port] origin that is in config.json. To allow more origins, list them in
# config.json, for example "cspSources": ["https://sso.example.com"]: the web UI ignores that key.
# The pattern accepts only scheme, host and port characters, so the file cannot put other text
# into the nginx configuration.

CONFIG_FILE="/usr/share/nginx/html/config.json"
CSP_SOURCES_FILE="/etc/nginx/pki/csp-sources.conf"

BUILD_API_URL=""
if ! grep -q '"apiUrl"' "$CONFIG_FILE" 2>/dev/null; then
  BUILD_API_URL="$PKI_BUILD_API_URL"
fi

CSP_SOURCES=""
for src in $( { cat "$CONFIG_FILE" 2>/dev/null; echo " $BUILD_API_URL"; } \
  | grep -oE 'https?://[A-Za-z0-9.-]+(:[0-9]+)?' | sort -u); do
  CSP_SOURCES="$CSP_SOURCES $src"
done

# shellcheck disable=SC2016 # nginx variables, written literally
if printf 'map $host $pki_csp_sources {\n    default "%s";\n}\n' "$CSP_SOURCES" > "$CSP_SOURCES_FILE"; then
  echo "CSP connect-src/frame-src: 'self'$CSP_SOURCES"
else
  echo "Warning: cannot write $CSP_SOURCES_FILE; CSP connect-src/frame-src stay 'self' only" >&2
fi

exec "$@"
