# Go >= 1.26.10 carries the crypto/x509 fix for the compromised eMudhra intermediates (#9).
FROM golang:1.26.10 AS builder
WORKDIR /workspace
COPY go.mod go.sum* ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 GOOS=linux go build -trimpath -ldflags="-s -w" -o /out/manager .

FROM gcr.io/distroless/static-debian12:nonroot
WORKDIR /
COPY --from=builder /out/manager /manager
# distroless static-debian12 still ships ca-certificates 20250419~deb12u1, which trusts the
# compromised eMudhra roots (#9). Use the builder's patched Debian trixie bundle
# (20250419+deb13u1) for the system-roots fallback used when an Issuer has no caBundle.
COPY --from=builder /etc/ssl/certs/ca-certificates.crt /etc/ssl/certs/ca-certificates.crt
USER 65532:65532
ENTRYPOINT ["/manager"]
