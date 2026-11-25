# syntax=docker/dockerfile:1
FROM golang:1.27.4-alpine@sha256:70bd7ddea8b6cbe5d6943cde279d6b67feb10cc924fb9100d1d8757c1575b280 AS build
WORKDIR /src
COPY scep/go.mod scep/go.sum ./
RUN --mount=type=secret,id=proxy_ca \
    if [ -f /run/secrets/proxy_ca ]; then export SSL_CERT_FILE=/run/secrets/proxy_ca; fi; \
    go mod download
COPY scep/*.go ./
RUN CGO_ENABLED=0 go build -trimpath -ldflags='-s -w' -o /scep-server . && mkdir /data

FROM gcr.io/distroless/static-debian12:nonroot@sha256:afa5c872c891853ca7fcf1f12c3edb23f7eeef36189728842dd51042ff57f7ab
COPY --from=build --chown=10001:10001 /data /data
COPY --from=build /scep-server /usr/local/bin/scep-server
COPY LICENSE /usr/share/licenses/scep/LICENSE
COPY scep/THIRD_PARTY_NOTICES /usr/share/licenses/scep/THIRD_PARTY_NOTICES
USER 10001:10001
ENV SCEP_LISTEN=:8085 SCEP_STATE_FILE=/data/ra.json
EXPOSE 8085
ENTRYPOINT ["/usr/local/bin/scep-server"]
CMD ["serve"]
