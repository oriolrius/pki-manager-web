# syntax=docker/dockerfile:1

################################################################################
# Base Stage - Common dependencies for pnpm-based builds
################################################################################
FROM node:22-alpine@sha256:1314fb30ec37592d5845e5a160d522c0e680972aa534549940b8d73bde88481a AS base

# Install specific pnpm version for reproducibility (patched: see security scan)
RUN corepack enable && corepack prepare pnpm@10.34.5 --activate

# Set working directory
WORKDIR /app

# Install build dependencies for better-sqlite3
RUN apk add --no-cache python3 make g++

################################################################################
# Dependencies Stage - Install production dependencies
################################################################################
FROM base AS dependencies

# Copy root package files
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./

# Copy backend package files
COPY backend/package.json ./backend/

# Copy frontend package files
COPY frontend/package.json ./frontend/

# Install dependencies (production only) with build scripts enabled for better-sqlite3
RUN pnpm config set scripts-prepend-node-path true && \
    pnpm install --frozen-lockfile --prod --shamefully-hoist && \
    cd /app/node_modules/.pnpm/better-sqlite3@*/node_modules/better-sqlite3 && \
    npm run build-release

################################################################################
# Build Backend
################################################################################
FROM base AS build-backend

# Copy root package files
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./

# Copy backend package files
COPY backend/package.json ./backend/

# Install all dependencies (including dev dependencies for build)
RUN pnpm install --frozen-lockfile

# Copy backend source
COPY backend/tsconfig.json backend/tsconfig.prod.json ./backend/
COPY backend/src/ ./backend/src/

# Build backend
WORKDIR /app/backend
RUN pnpm build

################################################################################
# Build Frontend - pnpm with the workspace lock file (same as the backend)
################################################################################
FROM base AS build-frontend

# Accept build arguments for frontend configuration
ARG VITE_API_URL=http://localhost:3000/trpc

# Workspace manifests and the one lock file (root package.json is also needed for
# the version import in frontend/src/routes/__root.tsx)
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY frontend/package.json ./frontend/
COPY backend/package.json ./backend/

# Install only the frontend and its dependencies, exactly as pnpm-lock.yaml pins them
RUN pnpm install --frozen-lockfile --filter frontend...

# Backend source (type-only imports of the tRPC router; erased by Vite)
COPY backend/src/ ./backend/src/

# Copy frontend source files
COPY frontend/src/ ./frontend/src/
COPY frontend/public/ ./frontend/public/
COPY frontend/index.html frontend/silent-renew.html ./frontend/
COPY frontend/vite.config.ts ./frontend/
COPY frontend/tsconfig.json frontend/tsconfig.app.json frontend/tsconfig.node.json ./frontend/
COPY frontend/tailwind.config.js* frontend/postcss.config.js* ./frontend/
COPY frontend/eslint.config.js* ./frontend/

# Set environment variable for Vite build
ENV VITE_API_URL=${VITE_API_URL}

WORKDIR /app/frontend
RUN pnpm run build:docker

################################################################################
# Production Backend Stage
################################################################################
FROM node:22-alpine@sha256:1314fb30ec37592d5845e5a160d522c0e680972aa534549940b8d73bde88481a AS backend

# Patch base-image OS packages (libexpat, c-ares, ...) flagged by the image scan, then
# install dumb-init for signal handling, the openssl CLI (PKCS#12 export + encrypted key
# downloads, see backend/src/crypto/pkcs12.ts) and OpenJDK for keytool (JKS generation).
# The runtime is pure `node` (see entrypoint + CMD), so pnpm is never installed here and
# the bundled npm/npx are removed — this keeps their vulnerable transitive deps
# (sigstore, tar, ...) and the corepack pnpm cache out of the shipped image.
RUN apk upgrade --no-cache && \
    apk add --no-cache dumb-init openssl openjdk17-jre-headless && \
    rm -rf /usr/local/lib/node_modules/npm /usr/local/bin/npm /usr/local/bin/npx

# Create non-root user
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001

# Set working directory
WORKDIR /app

# Copy production dependencies from dependencies stage (includes built native modules)
COPY --from=dependencies --chown=nodejs:nodejs /app/node_modules ./node_modules
COPY --from=dependencies --chown=nodejs:nodejs /app/backend/node_modules ./backend/node_modules
COPY --from=dependencies --chown=nodejs:nodejs --chmod=644 /app/package.json ./
COPY --from=dependencies --chown=nodejs:nodejs --chmod=644 /app/pnpm-workspace.yaml ./
COPY --from=dependencies --chown=nodejs:nodejs --chmod=644 /app/backend/package.json ./backend/

# Copy built backend
COPY --from=build-backend --chown=nodejs:nodejs /app/backend/dist ./backend/dist

# Copy database migrations (SQL files not copied by TypeScript)
COPY --from=build-backend --chown=nodejs:nodejs --chmod=u=rwX,go=rX /app/backend/src/db/migrations ./backend/dist/db/migrations

# Copy entrypoint script
COPY --chown=nodejs:nodejs --chmod=755 docker/docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh

# Create data directory with proper permissions
RUN mkdir -p /app/backend/data && \
    chown -R nodejs:nodejs /app/backend/data

# Switch to non-root user
USER nodejs

# Set environment variables with production defaults.
# NODE_OPTIONS=--use-openssl-ca makes Node verify outbound TLS (KMS, OIDC discovery/JWKS)
# against the OS store (/etc/ssl/certs, kept current by the `apk upgrade` above) instead of
# the root store compiled into the Node binary, so a root/intermediate distrust (e.g. the
# eMudhra compromise, #9) lands on the next image rebuild without waiting for a Node release.
ENV NODE_ENV=production \
    NODE_OPTIONS=--use-openssl-ca \
    PORT=3000 \
    HOST=0.0.0.0 \
    DATABASE_PATH=/app/backend/data/pki.db

# Expose port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
    CMD node -e "require('http').get('http://localhost:3000/health', (r) => {process.exit(r.statusCode === 200 ? 0 : 1)})"

# Use dumb-init to handle signals properly
ENTRYPOINT ["dumb-init", "--", "/usr/local/bin/docker-entrypoint.sh"]

# Start the application
CMD ["node", "backend/dist/server.js"]

################################################################################
# Production Frontend Stage
################################################################################
FROM nginx:alpine@sha256:7fc0fb4af7bf006aeb31aea88069976060f8f0a0a86b667126742cc17f4e31ae AS frontend

# Patch base-image OS packages (libexpat, c-ares, ...) flagged by the image scan
RUN apk upgrade --no-cache

# Create non-root user
RUN addgroup -g 1001 -S nginx-user && \
    adduser -S nginx-user -u 1001

# Copy built frontend
COPY --from=build-frontend --chown=nginx-user:nginx-user /app/frontend/dist /usr/share/nginx/html

# The API URL built into the bundle. With no apiUrl in config.json the bundle calls it, so
# csp-sources.sh allows its origin in the CSP connect-src.
ARG VITE_API_URL=http://localhost:3000/trpc
ENV PKI_BUILD_API_URL=${VITE_API_URL}

# Copy unified nginx configuration and the security-header includes. --chmod: a checkout made
# with umask 077 has mode 600 files, which the non-root nginx cannot read.
COPY --chmod=644 docker/nginx.conf /etc/nginx/nginx.conf
# Make the folder first: a COPY --chmod that creates it gives the folder mode 644 too.
RUN mkdir -m 755 /etc/nginx/pki
COPY --chmod=644 docker/nginx/security-headers.conf docker/nginx/security-headers-csp.conf /etc/nginx/pki/
# csp-sources.sh rewrites csp-sources.conf at start (the CSP origins), so nginx-user owns it.
COPY --chmod=644 --chown=nginx-user:nginx-user docker/nginx/csp-sources.conf /etc/nginx/pki/csp-sources.conf
COPY --chmod=755 docker/nginx/csp-sources.sh /usr/local/bin/csp-sources.sh

# Create necessary directories and set permissions
RUN mkdir -p /var/cache/nginx/client_temp \
             /var/cache/nginx/proxy_temp \
             /var/cache/nginx/fastcgi_temp \
             /var/cache/nginx/uwsgi_temp \
             /var/cache/nginx/scgi_temp && \
    chown -R nginx-user:nginx-user /var/cache/nginx && \
    chown -R nginx-user:nginx-user /var/log/nginx && \
    chown -R nginx-user:nginx-user /etc/nginx/conf.d && \
    touch /var/run/nginx.pid && \
    chown -R nginx-user:nginx-user /var/run/nginx.pid && \
    chown nginx-user:nginx-user /usr/share/nginx/html/config.json

USER nginx-user

# Expose port
EXPOSE 8080

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=10s --retries=3 \
    CMD wget --quiet --tries=1 --spider http://127.0.0.1:8080/health || exit 1

# Runtime settings of the web UI come only from /usr/share/nginx/html/config.json
# (mount your own file: apiUrl, oidc). The image ships "{}": the build-time defaults apply.
# csp-sources.sh reads the CSP origins from that file, then starts nginx.
ENTRYPOINT ["/usr/local/bin/csp-sources.sh"]
CMD ["nginx", "-g", "daemon off;"]
