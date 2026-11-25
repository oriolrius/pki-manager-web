# Go >= 1.26.10 carries the crypto/x509 fix for the compromised eMudhra intermediates (#9).
FROM golang:1.26.11@sha256:6e59e17a20f13c102e49d82dffab66d41cffe6c266b225d82794328aea859ab5 AS builder
WORKDIR /workspace
COPY go.mod go.sum* ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 GOOS=linux go build -trimpath -ldflags="-s -w" -o /out/manager .

FROM gcr.io/distroless/static-debian12:nonroot@sha256:afa5c872c891853ca7fcf1f12c3edb23f7eeef36189728842dd51042ff57f7ab
WORKDIR /
COPY --from=builder /out/manager /manager
# distroless static-debian12 still ships ca-certificates 20250419~deb12u1, which trusts the
# compromised eMudhra roots (#9). Use the builder's patched Debian trixie bundle
# (20250419+deb13u1) for the system-roots fallback used when an Issuer has no caBundle.
COPY --from=builder /etc/ssl/certs/ca-certificates.crt /etc/ssl/certs/ca-certificates.crt
USER 65532:65532
ENTRYPOINT ["/manager"]
