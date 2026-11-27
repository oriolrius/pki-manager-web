#!/usr/bin/env bash
# Called by run.sh with API pointing to a disposable candidate.
set -euo pipefail
umask 077
repo="$(cd "$(dirname "$0")/../.." && pwd)"
: "${RUN_TAG:?}" "${OUT:?}" "${WORK:?}" "${API:?}"
source "$repo/tests/acceptance/lib.sh"

protocol="${1:?use scep or kubernetes}"
temp="$(mktemp -d "$OUT/$protocol.XXXXXXXX")"
token="$temp/token"
cleanup() {
  local status=$? delay
  if [[ -n "${gateway_pid:-}" ]]; then kill "$gateway_pid" 2>/dev/null || true; wait "$gateway_pid" 2>/dev/null || true; fi
  rm -f "$token" "$temp/stale-token" "$temp/stale-ra.json" "$temp/challenge" "$temp/tls.json" "$temp/response"
  if [[ -n "${created_cluster:-}" ]]; then
    # Docker can return a timeout while the kind node is still stopping.
    for delay in 0 2 5; do
      sleep "$delay"
      if kind delete cluster --name "$created_cluster" --kubeconfig "$KUBECONFIG"; then break; fi
      if [[ "$delay" == 5 ]]; then status=1; fi
    done
  fi
  rm -f "$temp/kubeconfig"
  exit "$status"
}
trap cleanup EXIT
# Keep token responses out of the shared assertion body and logs.
BODY_FILE="$temp/response"
register() {
  ca="$(create_ca "Protocol $protocol $RUN_TAG" RSA-2048)"
  trpc_mutation integration.register "$(jq -cn --arg id "$ca" --arg k "$protocol" --arg n "$RUN_TAG" '{caId:$id,kind:$k,name:($k+"-"+$n)}')"
  jq -jer '.token | select(length > 0)' "$BODY_FILE" > "$token"
  rm "$BODY_FILE"
}

case "$protocol" in
  scep)
    cd "$repo/scep"
    if [[ -z "${SCEP_TEST_SERVER_URL:-}" ]]; then
      register
      node -e "process.stdout.write(require('node:crypto').randomBytes(32).toString('hex'))" > "$temp/challenge"
      # Choose a loopback port for this process. A bind conflict fails the run.
      port="${SCEP_TEST_PORT:-$(node -e "const s=require('net').createServer();s.listen(0,'127.0.0.1',()=>{console.log(s.address().port);s.close()})")}"
      export SCEP_AUTH_MODE=shared SCEP_AUTO_PROVISION=true SCEP_STATE_FILE="$temp/ra.json"
      export SCEP_LISTEN="127.0.0.1:$port" SCEP_BACKEND_URL="$API" SCEP_BACKEND_TOKEN_FILE="$token" SCEP_CHALLENGE_FILE="$temp/challenge"
      go build -o "$temp/gateway" .
      "$temp/gateway" >"$temp/gateway.log" 2>&1 &
      gateway_pid=$!
      export SCEP_TEST_SERVER_URL="http://$SCEP_LISTEN/scep" SCEP_TEST_BACKEND_URL="$API" SCEP_TEST_TOKEN_FILE="$token" SCEP_TEST_CHALLENGE_FILE="$temp/challenge"
      for _ in $(seq 1 45); do
        kill -0 "$gateway_pid" || { cat "$temp/gateway.log"; exit 1; }
        if curl -fsS "$SCEP_TEST_SERVER_URL?operation=GetCACert" -o /dev/null 2>/dev/null; then break; fi
        sleep 1
      done
    fi
    : "${SCEP_TEST_BACKEND_URL:?}" "${SCEP_TEST_TOKEN_FILE:?}" "${SCEP_TEST_CHALLENGE_FILE:?}"
    if [[ -n "${gateway_pid:-}" ]]; then
      # Fixture for TestLiveEnrollmentStaleRA: a second SCEP integration on the SAME CA gets its
      # own RA key. Its RA certificate is a real RA certificate of this CA whose key the gateway
      # under test does not hold, as a client sees after an RA key replacement. The fixture
      # integration is revoked before the tests; its token never leaves $temp.
      trpc_mutation integration.register "$(jq -cn --arg id "$ca" --arg n "$RUN_TAG" '{caId:$id,kind:"scep",name:("scep-stale-ra-"+$n)}')" \
        || { echo "FAIL stale RA fixture: register a second SCEP integration on the CA (HTTP $STATUS)"; exit 1; }
      stale_id="$(jq -er '.id | select(length > 0)' "$BODY_FILE")"
      jq -jer '.token | select(length > 0)' "$BODY_FILE" > "$temp/stale-token"
      rm "$BODY_FILE"
      env -i PATH="$PATH" SCEP_BACKEND_URL="$API" SCEP_BACKEND_TOKEN_FILE="$temp/stale-token" SCEP_STATE_FILE="$temp/stale-ra.json" \
        "$temp/gateway" provision >"$temp/stale-provision.log" 2>&1 || { echo "FAIL stale RA fixture: provisioning failed"; tail -5 "$temp/stale-provision.log"; exit 1; }
      jq -er '.certificatePem | select(length > 0)' "$temp/stale-ra.json" > "$temp/stale-ra.pem"
      rm -f "$temp/stale-ra.json" "$temp/stale-token"
      jq -er '.certificatePem | select(length > 0)' "$temp/ra.json" > "$temp/ra.pem"
      openssl verify -x509_strict -purpose any -CAfile "$WORK/ca-$ca.pem" "$temp/stale-ra.pem" >/dev/null \
        || { echo "FAIL stale RA fixture: not issued by the CA under test"; exit 1; }
      [[ "$(openssl x509 -in "$temp/stale-ra.pem" -noout -issuer)" == "$(openssl x509 -in "$temp/ra.pem" -noout -issuer)" ]] \
        || { echo "FAIL stale RA fixture: other issuer than the gateway RA"; exit 1; }
      ! cmp -s <(openssl x509 -in "$temp/stale-ra.pem" -pubkey -noout) <(openssl x509 -in "$temp/ra.pem" -pubkey -noout) \
        || { echo "FAIL stale RA fixture: same key as the gateway RA"; exit 1; }
      trpc_mutation integration.revoke "$(jq -cn --arg id "$stale_id" '{id:$id}')" || { echo "FAIL stale RA fixture: revoke of the fixture integration"; exit 1; }
      rm -f "$BODY_FILE"
      export SCEP_TEST_STALE_RA_FILE="$temp/stale-ra.pem"
    fi
    : "${SCEP_TEST_STALE_RA_FILE:?an external SCEP_TEST_SERVER_URL needs SCEP_TEST_STALE_RA_FILE}"
    required='["TestLiveEnrollment","TestLiveManagedProfileWithKMS","TestLiveBackendRABoundary","TestLiveEnrollmentStaleRA","TestLiveEnrollmentAndRenewal","TestLiveEnrollmentAndRenewal/AES-128-CBC","TestLiveEnrollmentAndRenewal/AES-256-CBC","TestLiveEnrollmentAndRenewal/AES-128-GCM","TestLiveEnrollmentAndRenewal/AES-256-GCM"]'
    rc=0
    go test -json -count=1 -run '^TestLive' . > "$temp/tests.jsonl" 2> "$temp/tests.err" || rc=$?
    # Every named test must pass; no test may fail or skip. Name each problem (with the
    # test's own last output lines) so the suite log shows the reason.
    problems="$(jq -sr --argjson req "$required" '
      [.[] | select(.Test != null)] as $ev
      | ([$ev[] | select(.Action == "pass") | .Test] | unique) as $passed
      | ([$ev[] | select(.Action == "fail" or .Action == "skip") | {a: .Action, t: .Test}] | unique) as $bad
      | ($bad[] as $b | "\($b.a | ascii_upcase) \($b.t): " + ([$ev[] | select(.Test == $b.t and .Action == "output") | .Output | gsub("^\\s+|\\s+$"; "") | select(length > 0)] | .[-3:] | join(" | "))),
        (($req - $passed)[] | "MISSING \(.): required test did not pass")' "$temp/tests.jsonl" 2>&1)" || problems="FAIL go test output is not valid JSON"
    if [[ $rc -ne 0 || -n "$problems" ]]; then
      echo "FAIL SCEP live tests (go test exit $rc): $(head -1 <<< "$problems")"
      [[ -n "$problems" ]] && printf '%s\n' "$problems"
      [[ -s "$temp/tests.err" ]] && tail -5 "$temp/tests.err"
      exit 1
    fi
    echo "Verified SCEP enrollment, renewal and RA operations."
    ;;
  kubernetes)
    register
    cd "$repo/k8s/issuer"
    cluster="pki-${RUN_TAG,,}"
    [[ "$cluster" =~ ^[a-z0-9][a-z0-9-]{0,50}$ ]] || { echo 'Invalid kind cluster name'; exit 1; }
    if kind get clusters | grep -qx "$cluster"; then echo "Cluster $cluster exists"; exit 1; fi
    export KUBECONFIG="$temp/kubeconfig"
    kind create cluster --name "$cluster" --kubeconfig "$KUBECONFIG" --image "${KIND_NODE_IMAGE:-kindest/node:v1.31.12}"
    created_cluster="$cluster"
    [[ "$(kubectl config current-context)" == "kind-$cluster" ]]
    url="${K8S_TEST_BACKEND_URL:-}"
    if [[ -z "$url" ]]; then
      project="${K8S_TEST_COMPOSE_PROJECT:-$(cat "${ACCEPT_RUN_DIR:?}/driver/current")}"
      net="${project}_public"
      backend="$(docker ps -q --filter "label=com.docker.compose.project=$project" --filter label=com.docker.compose.service=backend)"
      ip="$(docker inspect "$backend" | jq -er --arg n "$net" '.[0].NetworkSettings.Networks[$n].IPAddress | select(length>0)')"
      docker network connect "$net" "$cluster-control-plane"
      url="http://$ip:3000"
    fi
    make install-cert-manager install-issuer KIND_CLUSTER="$cluster" IMG="pki-accept-issuer:$RUN_TAG"
    kubectl -n pki-manager-issuer wait --for=condition=available deployment --all --timeout=120s
    kubectl -n pki-manager-issuer create secret generic pki-manager-token --from-file="token=$token"
    awk '/^---/{f=1;next} f' test/e2e/sample-clusterissuer.yaml |
      kubectl create --dry-run=client -o json -f - |
      jq --arg url "$url" --arg ca "$ca" '.spec.url=$url | .spec.caId=$ca' | kubectl apply -f -
    kubectl wait --for=condition=Ready clusterissuer.pki-manager.issuer.io/pki-manager-default --timeout=120s
    kubectl apply -f test/e2e/sample-certificate.yaml
    kubectl wait --for=condition=Ready certificate/example-tls --timeout=180s
    kubectl get certificaterequests -o json | jq -e 'any(.items[]; (.status.conditions|any(.type=="Approved" and .status=="True")) and (.status.conditions|any(.type=="Ready" and .status=="True")))' >/dev/null
    kubectl get secret example-tls -o json > "$temp/tls.json"
    jq -r '.data["tls.crt"]' "$temp/tls.json" | base64 -d > "$temp/leaf.pem"
    cmp <(jq -r '.data["ca.crt"]' "$temp/tls.json" | base64 -d | openssl x509 -outform DER) <(openssl x509 -in "$WORK/ca-$ca.pem" -outform DER)
    openssl verify -x509_strict -CAfile "$WORK/ca-$ca.pem" "$temp/leaf.pem"
    cmp <(openssl x509 -in "$temp/leaf.pem" -pubkey -noout) <(jq -r '.data["tls.key"]' "$temp/tls.json" | base64 -d | openssl pkey -pubout)
    openssl x509 -in "$temp/leaf.pem" -noout -ext subjectAltName | grep -qF 'DNS:api.example.cluster.local'
    openssl x509 -in "$temp/leaf.pem" -noout -ext extendedKeyUsage | grep -qF 'TLS Web Server Authentication, TLS Web Client Authentication'
    echo "Verified cert-manager approval, certificate, chain, SAN, EKU and CSR key."
    ;;
  *) echo 'Expected scep or kubernetes' >&2; exit 2 ;;
esac
