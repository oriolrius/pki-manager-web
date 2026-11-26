package main

import (
	"context"
	"crypto"
	"crypto/rsa"
	"errors"
	"io"
	"net/http"
)

// Backend resolves the RA from the bearer identity. No KMS URL, credentials,
// object IDs or algorithm overrides are present in this client.
type backendKey struct {
	backend *backend
	public  *rsa.PublicKey
	ctx     context.Context
	// sessionKeyLength is the CMS session key length (16, 24 or 32) of the
	// envelope that this request decrypts. The backend enforces it exactly.
	// Zero leaves the backend on its legacy 16/24/32 check.
	sessionKeyLength int
}

// withSessionKeyLength returns a copy of the key bound to one request's CMS
// session key length. Other copies, and the shared gateway key, do not change.
func (k *backendKey) withSessionKeyLength(n int) *backendKey {
	scoped := *k
	scoped.sessionKeyLength = n
	return &scoped
}

func (k *backendKey) context() context.Context {
	if k.ctx != nil {
		return k.ctx
	}
	return context.Background()
}
func (k *backendKey) Public() crypto.PublicKey { return k.public }
func (k *backendKey) Sign(_ io.Reader, digest []byte, opts crypto.SignerOpts) ([]byte, error) {
	if opts != crypto.SHA256 || len(digest) != 32 {
		return nil, errors.New("only RSA PKCS1 SHA-256 signatures are supported")
	}
	var result struct {
		Data []byte `json:"data"`
	}
	if err := k.backend.call(k.context(), http.MethodPost, "ra/sign", map[string][]byte{"digest": digest}, &result); err != nil {
		return nil, err
	}
	if len(result.Data) != k.public.Size() {
		return nil, errors.New("invalid backend RA signature")
	}
	return result.Data, nil
}
func (k *backendKey) Decrypt(_ io.Reader, data []byte, opts crypto.DecrypterOpts) ([]byte, error) {
	if opts != nil {
		if _, ok := opts.(*rsa.PKCS1v15DecryptOptions); !ok {
			return nil, errors.New("only RSA PKCS1 encryption is supported")
		}
	}
	if len(data) != k.public.Size() {
		return nil, errors.New("invalid RA ciphertext")
	}
	if k.sessionKeyLength != 0 && k.sessionKeyLength != 16 && k.sessionKeyLength != 24 && k.sessionKeyLength != 32 {
		return nil, errors.New("invalid CMS session key length")
	}
	input := struct {
		Data             []byte `json:"data"`
		SessionKeyLength int    `json:"sessionKeyLength,omitempty"`
	}{Data: data, SessionKeyLength: k.sessionKeyLength}
	var result struct {
		Data []byte `json:"data"`
	}
	if err := k.backend.call(k.context(), http.MethodPost, "ra/decrypt", input, &result); err != nil {
		return nil, err
	}
	if len(result.Data) != 16 && len(result.Data) != 24 && len(result.Data) != 32 {
		return nil, errors.New("invalid CMS session key")
	}
	if k.sessionKeyLength != 0 && len(result.Data) != k.sessionKeyLength {
		return nil, errors.New("invalid CMS session key")
	}
	return result.Data, nil
}
func (b *backend) raCall(ctx context.Context, op string) (state, error) {
	var saved state
	method := http.MethodPost
	var input any = struct{}{}
	if op == "state" {
		method = http.MethodGet
		input = nil
	}
	err := b.call(ctx, method, "ra/"+op, input, &saved)
	return saved, err
}
func (b *backend) RAState(ctx context.Context) (state, error)     { return b.raCall(ctx, "state") }
func (b *backend) RAProvision(ctx context.Context) (state, error) { return b.raCall(ctx, "provision") }
func (b *backend) RARenew(ctx context.Context) (state, error)     { return b.raCall(ctx, "renew") }
