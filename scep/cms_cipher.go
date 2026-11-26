package main

import (
	"crypto"
	"encoding/asn1"
	"errors"
	"io"
)

// The content cipher of a SCEP pkcsPKIEnvelope decides the length of the CMS
// session key that the RA key unwraps. The gateway reads it from the envelope
// after the CMS signature check and before any RA decryption request, so that it
// can refuse an unsupported cipher locally and give the backend the exact key
// length to enforce.
//
// The envelope can be BER (indefinite lengths) because the signed content is an
// OCTET STRING that the outer BER-to-DER conversion does not rewrite. This reader
// walks only the path to the algorithm OID, with bounds on depth, length and
// element count. It never decodes key material or ciphertext.

var (
	oidEnvelopedData = asn1.ObjectIdentifier{1, 2, 840, 113549, 1, 7, 3}
	oidAES128CBC     = asn1.ObjectIdentifier{2, 16, 840, 1, 101, 3, 4, 1, 2}
	oidAES256CBC     = asn1.ObjectIdentifier{2, 16, 840, 1, 101, 3, 4, 1, 42}
	oidAES128GCM     = asn1.ObjectIdentifier{2, 16, 840, 1, 101, 3, 4, 1, 6}
	oidAES256GCM     = asn1.ObjectIdentifier{2, 16, 840, 1, 101, 3, 4, 1, 46}
	oidDESEDE3CBC    = asn1.ObjectIdentifier{1, 2, 840, 113549, 3, 7}
)

var errUnsupportedContentCipher = errors.New("unsupported CMS content cipher")
var errInvalidEnvelope = errors.New("invalid CMS envelope")

const (
	berMaxDepth    = 32
	berMaxElements = 4096
	berMaxOIDBytes = 64
)

// sessionKeyLength returns the CMS session key length in bytes for a supported
// content cipher OID, or errUnsupportedContentCipher.
func sessionKeyLength(oid asn1.ObjectIdentifier) (int, error) {
	switch {
	case oid.Equal(oidAES128CBC), oid.Equal(oidAES128GCM):
		return 16, nil
	case oid.Equal(oidDESEDE3CBC):
		return 24, nil
	case oid.Equal(oidAES256CBC), oid.Equal(oidAES256GCM):
		return 32, nil
	}
	return 0, errUnsupportedContentCipher
}

// envelopeSessionKeyLength reads the content cipher of an EnvelopedData
// ContentInfo and returns the session key length it requires.
func envelopeSessionKeyLength(envelope []byte) (int, error) {
	oid, err := envelopeContentCipher(envelope)
	if err != nil {
		return 0, err
	}
	return sessionKeyLength(oid)
}

type berHeader struct {
	class, number int
	constructed   bool
	start         int // first content byte
	length        int // -1: indefinite
}

type berReader struct {
	data     []byte
	elements int
}

func (r *berReader) header(pos int) (berHeader, error) {
	r.elements++
	if r.elements > berMaxElements || pos < 0 || pos+2 > len(r.data) {
		return berHeader{}, errInvalidEnvelope
	}
	b := r.data[pos]
	h := berHeader{class: int(b >> 6), constructed: b&0x20 != 0, number: int(b & 0x1f)}
	// The path to the cipher OID uses only low tag numbers. Refuse the
	// multi-byte form instead of parsing it.
	if h.number == 0x1f {
		return berHeader{}, errInvalidEnvelope
	}
	l := r.data[pos+1]
	pos += 2
	switch {
	case l < 0x80:
		h.length = int(l)
	case l == 0x80:
		if !h.constructed {
			return berHeader{}, errInvalidEnvelope
		}
		h.length = -1
	default:
		n := int(l & 0x7f)
		if n > 4 || pos+n > len(r.data) {
			return berHeader{}, errInvalidEnvelope
		}
		for i := 0; i < n; i++ {
			h.length = h.length<<8 | int(r.data[pos+i])
		}
		pos += n
	}
	h.start = pos
	if h.length > len(r.data)-pos {
		return berHeader{}, errInvalidEnvelope
	}
	return h, nil
}

// end returns the position after the element at pos.
func (r *berReader) end(pos, depth int) (int, error) {
	if depth > berMaxDepth {
		return 0, errInvalidEnvelope
	}
	h, err := r.header(pos)
	if err != nil {
		return 0, err
	}
	if h.length >= 0 {
		return h.start + h.length, nil
	}
	next := h.start
	for {
		if next+2 <= len(r.data) && r.data[next] == 0 && r.data[next+1] == 0 {
			return next + 2, nil
		}
		if next, err = r.end(next, depth+1); err != nil {
			return 0, err
		}
	}
}

// expect reads the header at pos and checks its tag.
func (r *berReader) expect(pos, class, number int, constructed bool) (berHeader, error) {
	h, err := r.header(pos)
	if err != nil {
		return berHeader{}, err
	}
	if h.class != class || h.number != number || h.constructed != constructed {
		return berHeader{}, errInvalidEnvelope
	}
	return h, nil
}

func (r *berReader) oid(pos int) (asn1.ObjectIdentifier, int, error) {
	h, err := r.expect(pos, 0, 6, false)
	if err != nil {
		return nil, 0, err
	}
	if h.length < 1 || h.length > berMaxOIDBytes {
		return nil, 0, errInvalidEnvelope
	}
	der := append([]byte{0x06, byte(h.length)}, r.data[h.start:h.start+h.length]...)
	var oid asn1.ObjectIdentifier
	if rest, err := asn1.Unmarshal(der, &oid); err != nil || len(rest) != 0 {
		return nil, 0, errInvalidEnvelope
	}
	return oid, h.start + h.length, nil
}

// envelopeContentCipher returns
// ContentInfo.content.encryptedContentInfo.contentEncryptionAlgorithm.algorithm
// (RFC 5652 sections 3 and 6.1).
func envelopeContentCipher(envelope []byte) (asn1.ObjectIdentifier, error) {
	r := &berReader{data: envelope}
	const universal, contextClass = 0, 2
	// ContentInfo ::= SEQUENCE { contentType, [0] EXPLICIT content }
	info, err := r.expect(0, universal, 16, true)
	if err != nil {
		return nil, err
	}
	contentType, pos, err := r.oid(info.start)
	if err != nil {
		return nil, err
	}
	if !contentType.Equal(oidEnvelopedData) {
		return nil, errInvalidEnvelope
	}
	explicit, err := r.expect(pos, contextClass, 0, true)
	if err != nil {
		return nil, err
	}
	// EnvelopedData ::= SEQUENCE { version, originatorInfo [0] OPTIONAL,
	//   recipientInfos SET, encryptedContentInfo, ... }
	enveloped, err := r.expect(explicit.start, universal, 16, true)
	if err != nil {
		return nil, err
	}
	pos = enveloped.start
	if _, err = r.expect(pos, universal, 2, false); err != nil {
		return nil, err
	}
	if pos, err = r.end(pos, 0); err != nil {
		return nil, err
	}
	if h, err := r.header(pos); err == nil && h.class == contextClass && h.number == 0 {
		if pos, err = r.end(pos, 0); err != nil {
			return nil, err
		}
	}
	if _, err = r.expect(pos, universal, 17, true); err != nil {
		return nil, err
	}
	if pos, err = r.end(pos, 0); err != nil {
		return nil, err
	}
	// EncryptedContentInfo ::= SEQUENCE { contentType,
	//   contentEncryptionAlgorithm AlgorithmIdentifier, [0] encryptedContent OPTIONAL }
	eci, err := r.expect(pos, universal, 16, true)
	if err != nil {
		return nil, err
	}
	if _, pos, err = r.oid(eci.start); err != nil {
		return nil, err
	}
	algorithm, err := r.expect(pos, universal, 16, true)
	if err != nil {
		return nil, err
	}
	cipher, _, err := r.oid(algorithm.start)
	if err != nil {
		return nil, err
	}
	return cipher, nil
}

// errDecode is the one error that a CMS or SCEP library decode failure gives,
// whatever its cause, including a panic inside the library.
var errDecode = errors.New("invalid SCEP message")

// decodeSafely runs one library decode step. A panic becomes errDecode, so a
// malformed message gets the same response as any other rejected message.
func decodeSafely(step func() error) (err error) {
	defer func() {
		if recover() != nil {
			err = errDecode
		}
	}()
	return step()
}

// sessionDecrypter binds the session key length of one envelope to the RA
// decryptor. A backend key sends the length to the backend, which enforces it.
// Any other decryptor (a local key in tests) gets the same exact-length check here.
func sessionDecrypter(d crypto.Decrypter, length int) crypto.Decrypter {
	if k, ok := d.(*backendKey); ok {
		return k.withSessionKeyLength(length)
	}
	return &lengthCheckedDecrypter{Decrypter: d, length: length}
}

type lengthCheckedDecrypter struct {
	crypto.Decrypter
	length int
}

func (d *lengthCheckedDecrypter) Decrypt(rand io.Reader, data []byte, opts crypto.DecrypterOpts) ([]byte, error) {
	plain, err := d.Decrypter.Decrypt(rand, data, opts)
	if err != nil {
		return nil, err
	}
	if len(plain) != d.length {
		return nil, errors.New("invalid CMS session key")
	}
	return plain, nil
}
