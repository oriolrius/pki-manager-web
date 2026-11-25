#!/usr/bin/env bash
# Run the shell examples of a Markdown doc against the demo stack, in order, and fail on the first error.
#   demo/doc-examples.sh docs/api/how-to.md
# - Runs every ```bash block, in one shell (variables carry over), in an empty temp folder.
# - A block directly after the line <!-- example: skip --> is not run (placeholders, other systems).
# - Setup (not in the doc): API, TOKEN (OIDC access token of the demo admin) and
#   INTEGRATION_TOKEN (a service token bound to a fresh CA), as a reader would have them.
# Needs: demo stack up (demo/demo.sh up), curl, jq, openssl, ssh-keygen.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
DOC="$(cd "$(dirname "$1")" && pwd)/$(basename "$1")"
WORK="$(mktemp -d)"; trap 'rm -rf "$WORK"' EXIT

export API=http://localhost:47300
export TOKEN; TOKEN="$("$HERE/demo.sh" token)"

# Setup: a CA for the integration, and its service token (integrations are created in the UI or tRPC).
SETUP_CA=$(curl -fsS -X POST "$API/api/v1/cas/" -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"subject":{"commonName":"Doc Examples CA '"$RANDOM"'","organization":"Example Corp","country":"ES"},"keyAlgorithm":"RSA-2048","validityYears":5}' | jq -r .id)
export INTEGRATION_TOKEN; INTEGRATION_TOKEN=$(curl -fsS -X POST "$API/trpc/integration.register" -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' -d '{"name":"doc-examples-'"$RANDOM"'","caId":"'"$SETUP_CA"'","kind":"generic"}' | jq -r '.result.data.token')
[[ "$INTEGRATION_TOKEN" == pkimg_* ]] || { echo "setup: no integration token"; exit 1; }

# Extract the runnable blocks.
python3 - "$DOC" > "$WORK/examples.sh" <<'EOF'
import re, sys
md = open(sys.argv[1]).read()
out = ['set -euo pipefail', 'trap \'echo "FAILED in block $BLOCK" >&2\' ERR']
n = 0
for m in re.finditer(r'(<!-- example: skip -->\s*\n)?```bash\n(.*?)```', md, re.S):
    if m.group(1):
        continue
    n += 1
    out.append(f'BLOCK={n}; echo "--- block {n}" >&2')
    out.append(m.group(2))
print('\n'.join(out))
print(f'echo "doc-examples: {n} blocks OK" >&2')
EOF
cd "$WORK" && bash examples.sh
