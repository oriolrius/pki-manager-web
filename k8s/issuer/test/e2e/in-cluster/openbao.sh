#!/usr/bin/env bash
# Deploy the PKI Manager test fork into this kind cluster. Never run on production.
set -euo pipefail
umask 077
repo="$(cd "$(dirname "$0")/../../../../.." && pwd)"
cluster="${KIND_CLUSTER:?}"
test "$(kubectl config current-context)" = "kind-$cluster"
k=(kubectl --context "kind-$cluster" -n pki-manager)
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
for name in openbao-test-raft openbao-test-bootstrap; do
  cat <<EOF | "${k[@]}" apply -f -
apiVersion: v1
kind: PersistentVolumeClaim
metadata: { name: $name }
spec: { accessModes: [ReadWriteOnce], resources: { requests: { storage: 1Gi } } }
EOF
done
"${k[@]}" create configmap openbao-config --from-file="$repo/openbao/config/" --dry-run=client -o yaml | "${k[@]}" apply -f -
"${k[@]}" create configmap openbao-bootstrap --from-file="$repo/openbao/scripts/bootstrap.sh" --dry-run=client -o yaml | "${k[@]}" apply -f -
"${k[@]}" create configmap openbao-policies --from-file="$repo/openbao/policies/" --dry-run=client -o yaml | "${k[@]}" apply -f -
if [[ -z "$("${k[@]}" get secret openbao-server-tls --ignore-not-found -o name)" ]]; then
  bash "$repo/openbao/scripts/dev-tls.sh" "$work"
  "${k[@]}" create secret generic openbao-server-tls --from-file="$work/ca.pem" --from-file="$work/server.pem" --from-file="$work/server-key.pem"
fi
"${k[@]}" get secret openbao-server-tls -o jsonpath='{.data.ca\.pem}' | base64 -d > "$work/ca.pem"
"${k[@]}" create configmap openbao-client-ca --from-file="$work/ca.pem" --dry-run=client -o yaml | "${k[@]}" apply -f -
"${k[@]}" apply -f "$repo/k8s/issuer/test/e2e/in-cluster/10-openbao.yaml"
"${k[@]}" rollout status deployment/openbao --timeout=180s
"${k[@]}" exec deployment/openbao -- sh /openbao/scripts/bootstrap.sh dev
"${k[@]}" exec deployment/openbao -- cat /openbao/secrets/backend-token > "$work/backend-token"
test -s "$work/backend-token"
"${k[@]}" create secret generic pki-manager-backend-token --from-file="$work/backend-token" --dry-run=client -o yaml | "${k[@]}" apply --server-side -f -
