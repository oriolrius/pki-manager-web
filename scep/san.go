package main

import (
	"encoding/asn1"
	"errors"
	"net"
	"net/mail"
	"net/url"
	"strings"
	"unicode"
	"unicode/utf8"
)

// Managed SAN identities are authorized by the MDM's CSR validation, never by
// local string substitution. This checks encoding and the supported identity types.
func validateSAN(der []byte) error {
	var names []asn1.RawValue
	rest, err := asn1.Unmarshal(der, &names)
	if err != nil || len(rest) != 0 || len(names) == 0 || len(names) > 32 {
		return errors.New("invalid SAN list")
	}
	for _, name := range names {
		if name.Class != asn1.ClassContextSpecific {
			return errors.New("invalid SAN class")
		}
		value := string(name.Bytes)
		switch name.Tag {
		case 1:
			address, err := mail.ParseAddress(value)
			if err != nil || address.Address != value || len(value) > 254 {
				return errors.New("invalid email SAN")
			}
		case 2:
			if len(value) == 0 || len(value) > 253 || strings.ContainsAny(value, "* /\\\x00\r\n") {
				return errors.New("invalid DNS SAN")
			}
			for _, label := range strings.Split(value, ".") {
				if len(label) == 0 || len(label) > 63 || label[0] == '-' || label[len(label)-1] == '-' {
					return errors.New("invalid DNS label")
				}
				for _, c := range label {
					if !(c >= 'a' && c <= 'z' || c >= 'A' && c <= 'Z' || c >= '0' && c <= '9' || c == '-') {
						return errors.New("invalid DNS label")
					}
				}
			}
		case 6:
			uri, err := url.Parse(value)
			if err != nil || uri.Scheme == "" || len(value) > 2048 || strings.ContainsAny(value, "\x00\r\n ") {
				return errors.New("invalid URI SAN")
			}
			if uri.Scheme != "https" && uri.Scheme != "urn" && uri.Scheme != "tag" {
				return errors.New("unsupported URI SAN")
			}
		case 7:
			if len(name.Bytes) != net.IPv4len && len(name.Bytes) != net.IPv6len {
				return errors.New("invalid IP SAN")
			}
		case 0:
			var other struct {
				OID   asn1.ObjectIdentifier
				Value asn1.RawValue
			}
			rest, err := asn1.UnmarshalWithParams(name.FullBytes, &other, "tag:0")
			if err != nil || len(rest) != 0 || other.OID.String() != "1.3.6.1.4.1.311.20.2.3" || other.Value.Class != asn1.ClassContextSpecific || other.Value.Tag != 0 {
				return errors.New("unsupported otherName SAN")
			}
			var upn asn1.RawValue
			rest, err = asn1.Unmarshal(other.Value.Bytes, &upn)
			if err != nil || len(rest) != 0 || upn.Tag != asn1.TagUTF8String || len(upn.Bytes) == 0 || len(upn.Bytes) > 254 || !utf8.Valid(upn.Bytes) {
				return errors.New("invalid UPN SAN")
			}
			for _, c := range string(upn.Bytes) {
				if unicode.IsControl(c) {
					return errors.New("invalid UPN SAN")
				}
			}
		default:
			return errors.New("unsupported SAN identity type")
		}
	}
	return nil
}
