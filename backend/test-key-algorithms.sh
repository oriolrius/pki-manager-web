#!/bin/bash

# Test script to verify different key algorithms work correctly with KMS

echo "=== Testing Key Algorithm Fix ==="
echo ""

# Test 1: Create RSA-2048 CA
echo "Test 1: Creating CA with RSA-2048..."
RESPONSE_RSA_2048=$(curl -s -X POST "http://localhost:3000/trpc/ca.create" \
  -H "Content-Type: application/json" \
  -d '{
    "subject": {
      "commonName": "Test RSA-2048 CA",
      "organization": "Test Org",
      "country": "US"
    },
    "validityYears": 10,
    "keyAlgorithm": "RSA-2048"
  }')

if echo "$RESPONSE_RSA_2048" | grep -q "error"; then
  echo "❌ FAILED: $RESPONSE_RSA_2048"
else
  CA_ID_RSA_2048=$(echo "$RESPONSE_RSA_2048" | jq -r '.result.data.id')
  echo "✓ Created CA: $CA_ID_RSA_2048"

  # Verify key algorithm
  sleep 2
  CERT_RSA_2048=$(curl -s "http://localhost:3000/trpc/ca.getById?input=%7B%22id%22%3A%22${CA_ID_RSA_2048}%22%7D" | jq -r '.result.data.certificatePem')
  KEY_ALG_RSA_2048=$(echo "$CERT_RSA_2048" | openssl x509 -text -noout | grep "Public Key Algorithm" | awk '{print $4}')
  KEY_SIZE_RSA_2048=$(echo "$CERT_RSA_2048" | openssl x509 -text -noout | grep "Public-Key:" | grep -oP '\d+')

  if [ "$KEY_SIZE_RSA_2048" = "2048" ]; then
    echo "✓ Verified: RSA-$KEY_SIZE_RSA_2048"
  else
    echo "❌ Expected RSA-2048, got $KEY_ALG_RSA_2048-$KEY_SIZE_RSA_2048"
  fi
fi

echo ""

# Test 2: Create ECDSA-P256 CA
echo "Test 2: Creating CA with ECDSA-P256..."
RESPONSE_ECDSA_256=$(curl -s -X POST "http://localhost:3000/trpc/ca.create" \
  -H "Content-Type: application/json" \
  -d '{
    "subject": {
      "commonName": "Test ECDSA-P256 CA",
      "organization": "Test Org",
      "country": "US"
    },
    "validityYears": 10,
    "keyAlgorithm": "ECDSA-P256"
  }')

if echo "$RESPONSE_ECDSA_256" | grep -q "error"; then
  echo "❌ FAILED: $RESPONSE_ECDSA_256"
else
  CA_ID_ECDSA_256=$(echo "$RESPONSE_ECDSA_256" | jq -r '.result.data.id')
  echo "✓ Created CA: $CA_ID_ECDSA_256"

  # Verify key algorithm
  sleep 2
  CERT_ECDSA_256=$(curl -s "http://localhost:3000/trpc/ca.getById?input=%7B%22id%22%3A%22${CA_ID_ECDSA_256}%22%7D" | jq -r '.result.data.certificatePem')
  KEY_ALG_ECDSA_256=$(echo "$CERT_ECDSA_256" | openssl x509 -text -noout | grep "Public Key Algorithm")

  if echo "$KEY_ALG_ECDSA_256" | grep -q "id-ecPublicKey"; then
    echo "✓ Verified: ECDSA (elliptic curve)"
    echo "$CERT_ECDSA_256" | openssl x509 -text -noout | grep -A2 "Public Key Algorithm"
  else
    echo "❌ Expected ECDSA, got $KEY_ALG_ECDSA_256"
  fi
fi

echo ""

# Test 3: Create ECDSA-P384 CA
echo "Test 3: Creating CA with ECDSA-P384..."
RESPONSE_ECDSA_384=$(curl -s -X POST "http://localhost:3000/trpc/ca.create" \
  -H "Content-Type: application/json" \
  -d '{
    "subject": {
      "commonName": "Test ECDSA-P384 CA",
      "organization": "Test Org",
      "country": "US"
    },
    "validityYears": 10,
    "keyAlgorithm": "ECDSA-P384"
  }')

if echo "$RESPONSE_ECDSA_384" | grep -q "error"; then
  echo "❌ FAILED: $RESPONSE_ECDSA_384"
else
  CA_ID_ECDSA_384=$(echo "$RESPONSE_ECDSA_384" | jq -r '.result.data.id')
  echo "✓ Created CA: $CA_ID_ECDSA_384"

  # Verify key algorithm
  sleep 2
  CERT_ECDSA_384=$(curl -s "http://localhost:3000/trpc/ca.getById?input=%7B%22id%22%3A%22${CA_ID_ECDSA_384}%22%7D" | jq -r '.result.data.certificatePem')
  KEY_ALG_ECDSA_384=$(echo "$CERT_ECDSA_384" | openssl x509 -text -noout | grep "Public Key Algorithm")

  if echo "$KEY_ALG_ECDSA_384" | grep -q "id-ecPublicKey"; then
    echo "✓ Verified: ECDSA (elliptic curve)"
    echo "$CERT_ECDSA_384" | openssl x509 -text -noout | grep -A2 "Public Key Algorithm"
  else
    echo "❌ Expected ECDSA, got $KEY_ALG_ECDSA_384"
  fi
fi

echo ""
echo "=== Test Complete ==="
