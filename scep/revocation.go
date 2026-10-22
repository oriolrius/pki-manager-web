package main

import (
	"context"
	"encoding/hex"
	"encoding/json"
	"errors"
	"log/slog"
	"os"
	"path/filepath"
	"strings"
)

// API version and payload contract follow Microsoft's IntuneRevocationClient.
const revocationService = "PkiConnectorFEService"
const revocationAPIVersion = "5019-05-05"

type revocationRequest struct {
	Context string `json:"requestContext"`
	Serial  string `json:"serialNumber"`
	Issuer  string `json:"issuerName"`
}
type revocationResult struct {
	Context   string `json:"requestContext"`
	Succeeded bool   `json:"succeeded"`
	Code      string `json:"errorCode"`
	Message   string `json:"errorMessage"`
}
type revocationJournal struct {
	AuthorityID string              `json:"authorityId"`
	Tenant      string              `json:"tenant"`
	ClientID    string              `json:"clientId"`
	Issuer      string              `json:"issuer"`
	Requests    []revocationRequest `json:"requests"`
}
type revoker interface {
	Revoke(context.Context, string) error
}

func saveJournal(path string, state revocationJournal) error {
	data, err := json.Marshal(state)
	if err != nil {
		return err
	}
	if err = os.MkdirAll(filepath.Dir(path), 0700); err != nil {
		return err
	}
	f, err := os.CreateTemp(filepath.Dir(path), ".revocations-*")
	if err != nil {
		return err
	}
	tmp := f.Name()
	defer os.Remove(tmp)
	if _, err = f.Write(data); err != nil {
		f.Close()
		return err
	}
	if err = f.Sync(); err != nil {
		f.Close()
		return err
	}
	if err = f.Close(); err != nil {
		return err
	}
	if err = os.Rename(tmp, path); err != nil {
		return err
	}
	directory, err := os.Open(filepath.Dir(path))
	if err != nil {
		return err
	}
	defer directory.Close()
	return directory.Sync()
}
func (a *intuneAuthorizer) pollRevocations(ctx context.Context, b revoker, issuer, path string) error {
	journal := revocationJournal{AuthorityID: a.authorityID, Tenant: a.tenant, ClientID: a.clientID, Issuer: issuer}
	data, err := os.ReadFile(path)
	if err == nil {
		if len(data) > 1<<20 || json.Unmarshal(data, &journal) != nil || journal.AuthorityID != a.authorityID || journal.Tenant != a.tenant || journal.ClientID != a.clientID || journal.Issuer != issuer {
			return errors.New("revocation journal belongs to another tenant or CA, or is invalid")
		}
	} else if !os.IsNotExist(err) {
		return err
	} else {
		raw, err := a.postRaw(ctx, revocationService, "CertificateAuthorityRequests/downloadRevocationRequests", revocationAPIVersion, map[string]any{"downloadParameters": map[string]any{"maxRequests": 100, "issuerName": issuer}})
		if err != nil {
			return err
		}
		var response struct {
			Value *[]revocationRequest `json:"value"`
		}
		if json.Unmarshal(raw, &response) != nil || response.Value == nil || len(*response.Value) > 100 {
			return errors.New("invalid Intune revocation response")
		}
		journal.Requests = *response.Value
		if len(journal.Requests) == 0 {
			return nil
		}
		if err = saveJournal(path, journal); err != nil {
			return err
		}
	}
	if len(journal.Requests) > 100 {
		return errors.New("invalid revocation journal batch")
	}
	results := make([]revocationResult, 0, len(journal.Requests))
	for _, request := range journal.Requests {
		result := revocationResult{Context: request.Context, Code: "None", Succeeded: true}
		if request.Context == "" || len(request.Context) > 8192 || request.Serial == "" || len(request.Serial) > 128 {
			result.Succeeded = false
			result.Code = "ParameterDataInvalidError"
			result.Message = "Invalid revocation parameters"
		} else {
			serial := strings.TrimLeft(strings.ToLower(request.Serial), "0")
			if len(serial)%2 != 0 {
				serial = "0" + serial
			}
			_, decodeErr := hex.DecodeString(serial)
			if decodeErr != nil || serial == "" || (request.Issuer != "" && request.Issuer != issuer) {
				result.Succeeded = false
				result.Code = "CertificateNotFoundError"
				result.Message = "Certificate is outside this issuing authority"
			} else if err = b.Revoke(ctx, serial); err != nil {
				result.Succeeded = false
				result.Code = "ServiceUnavailableException"
				result.Message = "Certificate revocation could not be completed"
				var status *backendStatusError
				if errors.As(err, &status) && (status.status == 403 || status.status == 404) {
					result.Code = "CertificateNotFoundError"
					result.Message = "Certificate is not owned by this service"
				}
			}
		}
		results = append(results, result)
	}
	raw, err := a.postRaw(ctx, revocationService, "CertificateAuthorityRequests/uploadRevocationResults", revocationAPIVersion, map[string]any{"results": results})
	if err != nil {
		return err
	}
	var response struct {
		Value json.RawMessage `json:"value"`
	}
	if json.Unmarshal(raw, &response) != nil {
		return errors.New("invalid Intune revocation acknowledgment")
	}
	var accepted bool
	if json.Unmarshal(response.Value, &accepted) != nil {
		var text string
		if json.Unmarshal(response.Value, &text) == nil {
			accepted = strings.EqualFold(text, "true")
		}
	}
	if !accepted {
		return errors.New("Intune did not acknowledge revocation results")
	}
	// Requests stay durable until upload is acknowledged. Replaying after a crash is
	// safe because backend revocation (including CRL publication) is idempotent.
	if err := os.Remove(path); err != nil {
		return err
	}
	slog.Info("scep.intune.revocations", "status", "acknowledged", "count", len(results))
	return nil
}
