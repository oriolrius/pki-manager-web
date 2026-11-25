#!/usr/bin/env bash
# Run every native Go fuzz target (`func FuzzXxx(f *testing.F)`) of one module.
#
#   scripts/fuzz-go.sh <module dir> [fuzztime] [target regex]
#
#   scripts/fuzz-go.sh scep                    # each target for 30 s
#   scripts/fuzz-go.sh krl-client 5m           # each target for 5 minutes
#   scripts/fuzz-go.sh scep 2m FuzzEnroll      # one target
#
# The script finds the targets with `go test -list`, so a new FuzzXxx function
# needs no change here or in .github/workflows/fuzz.yml.
#
# When a target fails, Go writes the failing input to
# <package>/testdata/fuzz/<Target>/<hash>. The script runs the other targets
# too, copies the new input files to $FUZZ_CRASH_DIR (when set) and exits 1.
# See docs/development/testing.md (Fuzzing).
set -uo pipefail

module=${1:?usage: fuzz-go.sh <module dir> [fuzztime] [target regex]}
fuzztime=${2:-30s}
filter=${3:-^Fuzz}

root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
cd "$root/$module" || exit 2

packages=$(go list ./...) || exit 2
failed=()
count=0

for pkg in $packages; do
  targets=$(go test -run='^$' -list "$filter" "$pkg" | grep '^Fuzz' || true)
  for target in $targets; do
    count=$((count + 1))
    echo "::group::$pkg $target ($fuzztime)"
    if go test -run='^$' -fuzz="^${target}\$" -fuzztime="$fuzztime" "$pkg"; then
      echo "ok: $pkg $target"
    else
      failed+=("$pkg $target")
    fi
    echo "::endgroup::"
  done
done

if [ "$count" -eq 0 ]; then
  echo "error: no fuzz target matches '$filter' in $module" >&2
  exit 2
fi

if [ "${#failed[@]}" -gt 0 ]; then
  echo "FAILED fuzz targets in $module:" >&2
  printf '  %s\n' "${failed[@]}" >&2
  if [ -n "${FUZZ_CRASH_DIR:-}" ]; then
    # New (untracked) corpus files are the failing inputs of this run.
    git -C "$root" ls-files --others --exclude-standard -- "$module" | grep '/testdata/fuzz/' | while read -r file; do
      mkdir -p "$FUZZ_CRASH_DIR/$(dirname "$file")"
      cp "$root/$file" "$FUZZ_CRASH_DIR/$file"
      echo "failing input: $file" >&2
    done
  fi
  exit 1
fi

echo "All $count fuzz targets of $module passed ($fuzztime each)."
