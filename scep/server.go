package main

import (
	"bytes"
	"context"
	"crypto"
	"crypto/rand"
	"crypto/rsa"
	"crypto/sha256"
	"crypto/subtle"
	"crypto/x509"
	"encoding/asn1"
	"encoding/base64"
	"errors"
	"io"
	"log/slog"
	"mime"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/smallstep/pkcs7"
	"github.com/smallstep/scep"
)

var oidMessageType = asn1.ObjectIdentifier{2, 16, 840, 1, 113733, 1, 9, 2}
var oidStatus = asn1.ObjectIdentifier{2, 16, 840, 1, 113733, 1, 9, 3}
var oidFail = asn1.ObjectIdentifier{2, 16, 840, 1, 113733, 1, 9, 4}
var oidSenderNonce = asn1.ObjectIdentifier{2, 16, 840, 1, 113733, 1, 9, 5}
var oidRecipientNonce = asn1.ObjectIdentifier{2, 16, 840, 1, 113733, 1, 9, 6}
var oidTransaction = asn1.ObjectIdentifier{2, 16, 840, 1, 113733, 1, 9, 7}

const maxMessage = 1 << 20

// A single issuing gateway serializes issuance so exact CSR retries hit the backend's
// requestUid idempotency path instead of racing a second certificate into existence.
type gateway struct {
	authorizer enrollmentAuthorizer
	issuer     issuer
	ra         *x509.Certificate
	previousRA []*x509.Certificate
	raMu       sync.RWMutex
	key        crypto.Signer
	decryptor  crypto.Decrypter
	chain      []*x509.Certificate
	challenge  [32]byte
	mu         sync.Mutex
	slots      chan struct{}
}

func newGateway(i issuer, ra *x509.Certificate, key crypto.Signer, decryptor crypto.Decrypter, chain []*x509.Certificate, challenge string) *gateway {
	return &gateway{issuer: i, ra: ra, key: key, decryptor: decryptor, chain: chain, challenge: sha256.Sum256([]byte(challenge)), slots: make(chan struct{}, 8)}
}
func (g *gateway) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	g.raMu.RLock()
	defer g.raMu.RUnlock()
	w.Header().Set("Cache-Control", "no-store")
	if time.Now().Before(g.ra.NotBefore) || !time.Now().Before(g.ra.NotAfter) || time.Now().Before(g.chain[0].NotBefore) || !time.Now().Before(g.chain[0].NotAfter) {
		http.Error(w, "CA or RA certificate expired", 503)
		return
	}
	if r.URL.Path != "/scep" {
		http.NotFound(w, r)
		return
	}
	if r.Method != http.MethodGet && r.Method != http.MethodPost {
		w.Header().Set("Allow", "GET, POST")
		http.Error(w, "method not allowed", 405)
		return
	}
	select {
	case g.slots <- struct{}{}:
		defer func() { <-g.slots }()
	default:
		http.Error(w, "busy", 503)
		return
	}
	if status, ok := g.issuer.(certificateStatus); ok {
		if err := status.Active(r.Context(), g.ra); err != nil {
			http.Error(w, "RA is not active", 503)
			return
		}
	}
	if r.Method == http.MethodPost && r.URL.Query().Get("operation") != "PKIOperation" {
		http.Error(w, "POST is only supported for PKIOperation", 400)
		return
	}
	switch r.URL.Query().Get("operation") {
	case "GetCACaps":
		w.Header().Set("Content-Type", "text/plain")
		caps := "POSTPKIOperation\r\nSHA-256\r\nAES\r\nRenewal\r\n"
		_, _ = io.WriteString(w, caps)
	case "GetCACert":
		data, err := scep.DegenerateCertificates(append([]*x509.Certificate{g.ra}, g.chain...))
		if err != nil {
			http.Error(w, "CA unavailable", 503)
			return
		}
		w.Header().Set("Content-Type", "application/x-x509-ca-ra-cert")
		_, _ = w.Write(data)
	case "PKIOperation":
		var data []byte
		var err error
		if r.Method == http.MethodPost {
			mediaType, _, mediaErr := mime.ParseMediaType(r.Header.Get("Content-Type"))
			if mediaErr != nil || !strings.EqualFold(mediaType, "application/x-pki-message") {
				http.Error(w, "expected application/x-pki-message", 415)
				return
			}
			data, err = io.ReadAll(http.MaxBytesReader(w, r.Body, maxMessage))
		} else {
			// ParseQuery turns '+' into spaces. SCEP legacy clients sometimes leave '+' unescaped.
			message := strings.ReplaceAll(r.URL.Query().Get("message"), " ", "+")
			if len(message) > base64.StdEncoding.EncodedLen(maxMessage) {
				http.Error(w, "request too large", 413)
				return
			}
			data, err = base64.StdEncoding.DecodeString(message)
		}
		if err != nil || len(data) == 0 {
			slog.Warn("scep.enroll", "status", "rejected", "reason", "invalid_body")
			http.Error(w, "invalid SCEP message", 400)
			return
		}
		reply, err := g.enroll(r.Context(), data)
		if err != nil {
			slog.Warn("scep.enroll", "status", "rejected", "reason", "invalid_message")
			http.Error(w, "invalid SCEP message or service unavailable", 400)
			return
		}
		w.Header().Set("Content-Type", "application/x-pki-message")
		_, _ = w.Write(reply)
	default:
		http.Error(w, "unsupported SCEP operation", 400)
	}
}
func (g *gateway) certRep(msg *scep.PKIMessage, signer *x509.Certificate, issued *x509.Certificate, fail scep.FailInfo) ([]byte, error) {
	var content []byte
	if issued != nil {
		bundle, err := scep.DegenerateCertificates([]*x509.Certificate{issued})
		if err != nil {
			return nil, err
		}
		content, err = pkcs7.Encrypt(bundle, []*x509.Certificate{signer})
		if err != nil {
			return nil, err
		}
	}
	sd, err := pkcs7.NewSignedData(content)
	if err != nil {
		return nil, err
	}
	sd.SetDigestAlgorithm(pkcs7.OIDDigestAlgorithmSHA256)
	nonce := make([]byte, 16)
	if _, err = rand.Read(nonce); err != nil {
		return nil, err
	}
	status := scep.SUCCESS
	if issued == nil {
		status = scep.FAILURE
	}
	attrs := []pkcs7.Attribute{{Type: oidMessageType, Value: scep.CertRep}, {Type: oidStatus, Value: status}, {Type: oidTransaction, Value: msg.TransactionID}, {Type: oidSenderNonce, Value: nonce}, {Type: oidRecipientNonce, Value: []byte(msg.SenderNonce)}}
	if issued == nil {
		attrs = append(attrs, pkcs7.Attribute{Type: oidFail, Value: fail})
	}
	if err = sd.AddSigner(g.ra, g.key, pkcs7.SignerInfoConfig{ExtraSignedAttributes: attrs}); err != nil {
		return nil, err
	}
	return sd.Finish()
}
func (g *gateway) enroll(ctx context.Context, data []byte) ([]byte, error) {
	// Bound attacker-controlled public key sizes before expensive signature checks.
	p7, err := pkcs7.Parse(data)
	if err != nil {
		return nil, err
	}
	signer := p7.GetOnlySigner()
	if signer == nil || len(p7.Certificates) != 1 {
		return nil, errors.New("invalid signer")
	}
	signerKey, rsaSigner := signer.PublicKey.(*rsa.PublicKey)
	if !rsaSigner || signerKey.N.BitLen() < 2048 || signerKey.N.BitLen() > 8192 {
		return nil, errors.New("unsupported signer key")
	}
	// smallstep verifies CMS signed attributes/message digest/signature before decryption.
	msg, err := scep.ParsePKIMessage(data)
	if err != nil {
		return nil, err
	}
	if len(msg.SenderNonce) < 16 || len(msg.SenderNonce) > 32 || len(msg.TransactionID) == 0 || len(msg.TransactionID) > 128 {
		return nil, errors.New("invalid transaction")
	}
	renewal := msg.MessageType == scep.RenewalReq || msg.MessageType == scep.UpdateReq
	if msg.MessageType != scep.PKCSReq && !renewal {
		slog.Warn("scep.enroll", "status", "rejected", "reason", "unsupported_message_type")
		return g.certRep(msg, signer, nil, scep.BadRequest)
	}
	err = msg.DecryptPKIEnvelope(g.ra, g.decryptor)
	for _, previous := range g.previousRA {
		if err == nil {
			break
		}
		if validateRA(previous, g.chain[0], g.key.Public()) != nil {
			continue
		}
		checker, ok := g.issuer.(certificateStatus)
		if !ok || checker.Active(ctx, previous) != nil {
			continue
		}
		err = msg.DecryptPKIEnvelope(previous, g.decryptor)
	}
	if err != nil {
		slog.Warn("scep.enroll", "status", "rejected", "reason", "invalid_envelope")
		return g.certRep(msg, signer, nil, scep.BadRequest)
	}
	if err = validateCSRPolicy(msg.CSR, signer, g.authorizer != nil, renewal); err != nil {
		slog.Warn("scep.enroll", "status", "rejected", "reason", "csr_policy")
		return g.certRep(msg, signer, nil, scep.BadRequest)
	}
	g.mu.Lock()
	defer g.mu.Unlock()
	if msg.ChallengePassword == "" {
		return g.certRep(msg, signer, nil, scep.BadRequest)
	}
	if g.authorizer == nil {
		candidate := sha256.Sum256([]byte(msg.ChallengePassword))
		if subtle.ConstantTimeCompare(candidate[:], g.challenge[:]) != 1 {
			slog.Warn("scep.enroll", "status", "rejected", "reason", "challenge")
			return g.certRep(msg, signer, nil, scep.BadRequest)
		}
	} else if err = g.authorizer.Validate(ctx, string(msg.TransactionID), msg.CSR); err != nil {
		slog.Warn("scep.enroll", "status", "rejected", "reason", "mdm_validation")
		return g.certRep(msg, signer, nil, scep.BadRequest)
	}
	if renewal {
		checker, ok := g.issuer.(certificateStatus)
		if !ok || signer.CheckSignatureFrom(g.chain[0]) != nil || checker.Active(ctx, signer) != nil {
			return g.certRep(msg, signer, nil, scep.BadCertID)
		}
	}
	if err = ctx.Err(); err != nil {
		return nil, err
	}
	// Revalidate the bound CA on every request, including exact-CSR retries.
	fresh, err := g.issuer.Bundle(ctx)
	if err != nil || len(fresh) == 0 || !bytes.Equal(fresh[0].Raw, g.chain[0].Raw) {
		slog.Warn("scep.enroll", "status", "rejected", "reason", "issuing_ca_unavailable")
		return g.certRep(msg, signer, nil, scep.BadRequest)
	}
	// Backend checks issuing CA state and expiry and records success/failure in audit_log.
	issued, err := g.issuer.Issue(ctx, msg.CSR)
	if err != nil {
		slog.Error("scep.enroll", "status", "failure", "reason", "issuer_unavailable")
		if g.authorizer != nil {
			_ = g.authorizer.Failure(ctx, string(msg.TransactionID), msg.CSR)
		}
		return g.certRep(msg, signer, nil, scep.BadRequest)
	}
	if !bytes.Equal(issued.RawSubjectPublicKeyInfo, msg.CSR.RawSubjectPublicKeyInfo) || !bytes.Equal(issued.RawSubject, msg.CSR.RawSubject) || issued.IsCA || issued.CheckSignatureFrom(g.chain[0]) != nil || len(issued.ExtKeyUsage) != 1 || issued.ExtKeyUsage[0] != x509.ExtKeyUsageClientAuth || len(issued.UnknownExtKeyUsage) != 0 || !issuedIdentitiesMatch(msg.CSR, issued) {
		return nil, errors.New("issuer returned an invalid certificate")
	}
	result, err := g.certRep(msg, signer, issued, "")
	if err != nil {
		if g.authorizer != nil {
			_ = g.authorizer.Failure(ctx, string(msg.TransactionID), msg.CSR)
		}
		return nil, err
	}
	if g.authorizer != nil {
		if err = g.authorizer.Success(ctx, string(msg.TransactionID), msg.CSR, issued); err != nil {
			slog.Error("scep.enroll", "status", "failure", "reason", "mdm_success_notification")
			return g.certRep(msg, signer, nil, scep.BadRequest)
		}
	}
	slog.Info("scep.enroll", "status", "success", "serial", issued.SerialNumber.Text(16))
	return result, nil
}
func validateCSR(csr *x509.CertificateRequest, signer *x509.Certificate) error {
	return validateCSRPolicy(csr, signer, false, false)
}

func validateCSRPolicy(csr *x509.CertificateRequest, signer *x509.Certificate, managed, renewal bool) error {
	if csr == nil {
		return errors.New("missing CSR")
	}
	if csr.Subject.CommonName == "" || len(csr.Subject.CommonName) > 128 {
		return errors.New("CSR requires a bounded common name")
	}
	pub, ok := csr.PublicKey.(*rsa.PublicKey)
	if !ok || pub.N.BitLen() < 2048 || pub.N.BitLen() > 8192 || pub.E < 65537 {
		return errors.New("RSA 2048..8192 is required")
	}
	if csr.CheckSignature() != nil {
		return errors.New("invalid CSR signature")
	}
	if !renewal && !bytes.Equal(csr.RawSubjectPublicKeyInfo, signer.RawSubjectPublicKeyInfo) {
		return errors.New("CSR and signer keys differ")
	}
	hasClientEKU := false
	seen := make(map[string]bool)
	for _, ext := range csr.Extensions {
		if seen[ext.Id.String()] {
			return errors.New("duplicate CSR extension")
		}
		seen[ext.Id.String()] = true
		switch ext.Id.String() {
		case "2.5.29.19":
			var constraints struct {
				CA      bool `asn1:"optional"`
				PathLen int  `asn1:"optional,default:-1"`
			}
			rest, err := asn1.Unmarshal(ext.Value, &constraints)
			if err != nil || len(rest) != 0 || constraints.CA || constraints.PathLen != -1 {
				return errors.New("CA constraints are not allowed")
			}
		case "2.5.29.15":
			var bits asn1.BitString
			rest, err := asn1.Unmarshal(ext.Value, &bits)
			if err != nil || len(rest) != 0 || bits.BitLength > 9 {
				return errors.New("invalid keyUsage")
			}
			for n := 1; n < bits.BitLength; n++ {
				if n != 2 && bits.At(n) != 0 {
					return errors.New("disallowed keyUsage")
				}
			}
		case "2.5.29.37":
			var usages []asn1.ObjectIdentifier
			rest, err := asn1.Unmarshal(ext.Value, &usages)
			if err != nil || len(rest) != 0 || len(usages) != 1 || usages[0].String() != "1.3.6.1.5.5.7.3.2" {
				return errors.New("only clientAuth EKU is allowed")
			}
			hasClientEKU = true
		case "2.5.29.17":
			if !managed {
				return errors.New("SANs require MDM validation")
			}
			if err := validateSAN(ext.Value); err != nil {
				return err
			}
		default:
			return errors.New("unapproved CSR extension")
		}
	}
	if !hasClientEKU {
		return errors.New("clientAuth EKU is required")
	}
	return nil
}
func validateRA(ra, ca *x509.Certificate, key crypto.PublicKey) error {
	pub, ok := ra.PublicKey.(*rsa.PublicKey)
	if !ok || pub.N.BitLen() < 2048 || ra.IsCA {
		return errors.New("RA must be an RSA leaf certificate")
	}
	if ra.KeyUsage&x509.KeyUsageDigitalSignature == 0 || ra.KeyUsage&x509.KeyUsageKeyEncipherment == 0 {
		return errors.New("RA requires digitalSignature and keyEncipherment")
	}
	if time.Now().Before(ra.NotBefore) || !time.Now().Before(ra.NotAfter) || ra.CheckSignatureFrom(ca) != nil {
		return errors.New("invalid or expired RA certificate")
	}
	der, err := x509.MarshalPKIXPublicKey(key)
	if err != nil || !bytes.Equal(der, ra.RawSubjectPublicKeyInfo) {
		return errors.New("RA key does not match certificate")
	}
	return nil
}

func issuedIdentitiesMatch(csr *x509.CertificateRequest, cert *x509.Certificate) bool {
	for _, oid := range []string{"2.5.29.17", "2.5.29.15"} {
		var requested, issued []byte
		for _, ext := range csr.Extensions {
			if ext.Id.String() == oid {
				requested = ext.Value
			}
		}
		for _, ext := range cert.Extensions {
			if ext.Id.String() == oid {
				issued = ext.Value
			}
		}
		if len(requested) > 0 && !bytes.Equal(requested, issued) {
			return false
		}
		if oid == "2.5.29.17" && len(requested) == 0 && len(issued) > 0 {
			return false
		}
	}
	return true
}
