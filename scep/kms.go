package main

import (
	"bytes"
	"crypto"
	"crypto/rsa"
	"crypto/sha256"
	"crypto/x509"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
)

// kmsKey implements crypto.Signer and crypto.Decrypter without exporting a private key.
// Only public material and cryptographic operation results cross the KMS boundary.
type kmsKey struct {
	client         *http.Client
	url, token, id string
	publicID       string
	public         *rsa.PublicKey
}
type ttlv struct {
	Tag   string `json:"tag"`
	Type  string `json:"type,omitempty"`
	Value any    `json:"value"`
}

func text(tag, value string) ttlv { return ttlv{tag, "TextString", value} }
func enum(tag, value string) ttlv { return ttlv{tag, "Enumeration", value} }
func bytesField(tag string, value []byte) ttlv {
	return ttlv{tag, "ByteString", hex.EncodeToString(value)}
}
func (k *kmsKey) call(operation string, fields ...ttlv) (ttlv, error) {
	data, err := json.Marshal(ttlv{Tag: operation, Value: fields})
	if err != nil {
		return ttlv{}, err
	}
	req, err := http.NewRequest(http.MethodPost, strings.TrimRight(k.url, "/")+"/kmip/2_1", bytes.NewReader(data))
	if err != nil {
		return ttlv{}, err
	}
	req.Header.Set("Content-Type", "application/json")
	if k.token != "" {
		req.Header.Set("Authorization", "Bearer "+k.token)
	}
	resp, err := k.client.Do(req)
	if err != nil {
		return ttlv{}, errors.New("KMS unavailable")
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		return ttlv{}, fmt.Errorf("KMS %s failed (HTTP %d)", operation, resp.StatusCode)
	}
	var out ttlv
	err = json.NewDecoder(io.LimitReader(resp.Body, 4<<20)).Decode(&out)
	if err != nil {
		return ttlv{}, errors.New("invalid KMS response")
	}
	return out, nil
}
func findField(node ttlv, tag string) (any, bool) {
	if node.Tag == tag {
		return node.Value, true
	}
	children, ok := node.Value.([]any)
	if !ok {
		return nil, false
	}
	for _, child := range children {
		obj, ok := child.(map[string]any)
		if !ok {
			continue
		}
		n := ttlv{Tag: fmt.Sprint(obj["tag"]), Value: obj["value"]}
		if value, ok := findField(n, tag); ok {
			return value, true
		}
	}
	return nil, false
}
func stringField(node ttlv, tag string) (string, error) {
	v, ok := findField(node, tag)
	s, isString := v.(string)
	if !ok || !isString || s == "" {
		return "", fmt.Errorf("KMS response missing %s", tag)
	}
	return s, nil
}
func binaryField(node ttlv, tag string) ([]byte, error) {
	s, err := stringField(node, tag)
	if err != nil {
		return nil, err
	}
	return hex.DecodeString(s)
}
func (k *kmsKey) Public() crypto.PublicKey { return k.public }
func (k *kmsKey) Sign(_ io.Reader, digest []byte, opts crypto.SignerOpts) ([]byte, error) {
	if opts.HashFunc() != crypto.SHA256 || len(digest) != sha256.Size {
		return nil, errors.New("only RSA PKCS1 SHA256 signatures are supported")
	}
	if _, pss := opts.(*rsa.PSSOptions); pss {
		return nil, errors.New("RSA-PSS is not supported")
	}
	resp, err := k.call("Sign", text("UniqueIdentifier", k.id), ttlv{Tag: "CryptographicParameters", Value: []ttlv{enum("CryptographicAlgorithm", "RSA"), enum("HashingAlgorithm", "SHA256"), enum("PaddingMethod", "PKCS1v15"), enum("DigitalSignatureAlgorithm", "SHA256WithRSAEncryption")}}, bytesField("DigestedData", digest))
	if err != nil {
		return nil, err
	}
	return binaryField(resp, "SignatureData")
}
func (k *kmsKey) Decrypt(_ io.Reader, ciphertext []byte, opts crypto.DecrypterOpts) ([]byte, error) {
	if opts != nil {
		if _, ok := opts.(*rsa.PKCS1v15DecryptOptions); !ok {
			return nil, errors.New("only RSA PKCS1 encryption is supported")
		}
	}
	resp, err := k.call("Decrypt", text("UniqueIdentifier", k.id), ttlv{Tag: "CryptographicParameters", Value: []ttlv{enum("CryptographicAlgorithm", "RSA"), enum("PaddingMethod", "PKCS1v15")}}, bytesField("Data", ciphertext))
	if err != nil {
		return nil, err
	}
	return binaryField(resp, "Data")
}
func (k *kmsKey) create() error {
	attrs := []ttlv{enum("CryptographicAlgorithm", "RSA"), {Tag: "CryptographicLength", Type: "Integer", Value: 3072}}
	resp, err := k.call("CreateKeyPair", ttlv{Tag: "CommonAttributes", Value: attrs}, ttlv{Tag: "PrivateKeyAttributes", Value: []ttlv{{Tag: "CryptographicUsageMask", Type: "Integer", Value: 9}, {Tag: "Sensitive", Type: "Boolean", Value: true}}}, ttlv{Tag: "PublicKeyAttributes", Value: []ttlv{{Tag: "CryptographicUsageMask", Type: "Integer", Value: 6}}})
	if err != nil {
		return err
	}
	k.id, err = stringField(resp, "PrivateKeyUniqueIdentifier")
	if err != nil {
		return err
	}
	pubID, err := stringField(resp, "PublicKeyUniqueIdentifier")
	k.publicID = pubID
	if err != nil {
		return err
	}
	for _, id := range []string{k.id, pubID} {
		if _, err = k.call("Activate", text("UniqueIdentifier", id)); err != nil {
			return err
		}
	}
	resp, err = k.call("Get", text("UniqueIdentifier", pubID), enum("KeyFormatType", "PKCS8"), enum("KeyWrapType", "AsRegistered"))
	if err != nil {
		return err
	}
	der, err := binaryField(resp, "KeyMaterial")
	if err != nil {
		return err
	}
	pub, err := x509.ParsePKIXPublicKey(der)
	if err != nil {
		return err
	}
	var ok bool
	k.public, ok = pub.(*rsa.PublicKey)
	if !ok {
		return errors.New("KMS did not create an RSA key")
	}
	return nil
}
