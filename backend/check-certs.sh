#!/bin/bash

echo "=== CA 1 ==="
curl -s "http://localhost:3000/trpc/ca.getById?input=%7B%22id%22%3A%22ecce7b2c-4ade-4b01-832b-3b67039ae439%22%7D" | jq -r '.result.data.certificatePem' | openssl x509 -text -noout | grep -E "Public Key Algorithm|Public-Key:"

echo ""
echo "=== CA 2 ==="
curl -s "http://localhost:3000/trpc/ca.getById?input=%7B%22id%22%3A%223552213d-1ae6-4500-8a60-e8b02bc196f6%22%7D" | jq -r '.result.data.certificatePem' | openssl x509 -text -noout | grep -E "Public Key Algorithm|Public-Key:"

echo ""
echo "=== CA 3 ==="
curl -s "http://localhost:3000/trpc/ca.getById?input=%7B%22id%22%3A%22280245c2-6e20-4665-ad69-eeb3ff6f3838%22%7D" | jq -r '.result.data.certificatePem' | openssl x509 -text -noout | grep -E "Public Key Algorithm|Public-Key:"
