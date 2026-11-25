# The website (product pages + docs) as a static image. The site is built BEFORE this step
# (`npm run build` → site/dist), because the build needs the whole repository, its git history
# and the backend source. CI: .github/workflows/docs.yml. Run: the k5 stack k5-stack-pki-site.
FROM nginxinc/nginx-unprivileged:1.31.7-alpine3.24@sha256:b5047b9b76845eac124358373c6852377c52e4b05834a47647e955dd91cb8f1e

ARG REVISION=dev
LABEL org.opencontainers.image.title="pki-manager-site" \
      org.opencontainers.image.description="Website of PKI Manager: product pages and documentation" \
      org.opencontainers.image.source="https://github.com/oriolrius/pki-manager-web" \
      org.opencontainers.image.licenses="Apache-2.0" \
      org.opencontainers.image.revision="${REVISION}"

USER root
COPY server/nginx.conf /etc/nginx/conf.d/default.conf
COPY dist/ /usr/share/nginx/html/
# Files checked out with mode 0600 (umask 077) would give 403/404: make every file world-readable.
RUN sed -i "s/__REVISION__/${REVISION}/g" /etc/nginx/conf.d/default.conf \
 && chmod 0644 /etc/nginx/conf.d/default.conf \
 && chmod -R a+rX /usr/share/nginx/html \
 && nginx -t
USER 101

EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s --retries=3 CMD wget -qO /dev/null http://127.0.0.1:8080/healthz || exit 1
# No entrypoint scripts: they try to edit the config, and the file system is read-only.
ENTRYPOINT []
CMD ["nginx", "-g", "daemon off;"]
