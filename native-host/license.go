package main

import (
	"crypto/ed25519"
	"encoding/base64"
	"encoding/json"
	"errors"
	"strings"
	"time"
)

func verifyLicense(token string) (bool, error) {
	if token == "" {
		return false, errors.New("missing license token")
	}

	parts := strings.Split(token, ".")
	if len(parts) != 2 {
		return false, errors.New("malformed license token format")
	}

	payloadBytes, err := base64.RawURLEncoding.DecodeString(parts[0])
	if err != nil {
		return false, errors.New("failed to decode license claims")
	}

	sigBytes, err := base64.RawURLEncoding.DecodeString(parts[1])
	if err != nil {
		return false, errors.New("failed to decode signature")
	}

	pubKeyBytes, err := base64.StdEncoding.DecodeString(Ed25519PubKeyB64)
	if err != nil {
		// Fallback to RawStdEncoding if unpadded
		pubKeyBytes, err = base64.RawStdEncoding.DecodeString(Ed25519PubKeyB64)
	}
	if err != nil || len(pubKeyBytes) != ed25519.PublicKeySize {
		return false, errors.New("invalid public key configuration")
	}

	verified := ed25519.Verify(pubKeyBytes, []byte(parts[0]), sigBytes) ||
		ed25519.Verify(pubKeyBytes, payloadBytes, sigBytes)
	if !verified {
		return false, errors.New("cryptographic signature mismatch")
	}

	var claims LicensePayload
	if err := json.Unmarshal(payloadBytes, &claims); err != nil {
		return false, errors.New("invalid claims json")
	}

	if time.Now().Unix() >= claims.Exp {
		return false, errors.New("license or trial period has expired")
	}

	return true, nil
}
