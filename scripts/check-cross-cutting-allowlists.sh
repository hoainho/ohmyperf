#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
EXIT_CODE=0
SYSTEMS_CHECKED=0
SYSTEMS_FAILED=0

emit_fail() {
  echo "::error::[cross-cutting-allowlists] $1" >&2
  EXIT_CODE=1
  SYSTEMS_FAILED=$((SYSTEMS_FAILED + 1))
}

emit_pass() {
  echo "[cross-cutting-allowlists] PASS: $1"
}

check_chrome_ext_spa_allowlist() {
  SYSTEMS_CHECKED=$((SYSTEMS_CHECKED + 1))
  local manifest="$ROOT/apps/extension-chrome/static/manifest.json"
  local bg="$ROOT/apps/extension-chrome/src/background.ts"
  local env_ts="$ROOT/apps/website/lib/env.ts"
  local bridge="$ROOT/apps/website/lib/extension-bridge.ts"
  local detector="$ROOT/apps/website/lib/backend-detector.ts"

  for f in "$manifest" "$bg" "$env_ts" "$bridge" "$detector"; do
    if [ ! -f "$f" ]; then
      emit_fail "chrome-ext-spa-allowlist: missing file ${f#$ROOT/}"
      return
    fi
  done

  local hosts_diff
  hosts_diff=$(python3 - "$manifest" "$bg" <<'PY'
import json, re, sys
manifest_path, bg_path = sys.argv[1], sys.argv[2]

def normalize(s):
    s = re.sub(r'^https?://', '', s)
    s = re.sub(r'/\*?$', '', s)
    s = re.sub(r':\d+', '', s)
    s = s.replace('*.', 'WILDCARD.')
    return s.lower()

with open(manifest_path) as f:
    matches = json.load(f).get('externally_connectable', {}).get('matches', [])
manifest_hosts = sorted({normalize(m) for m in matches})

with open(bg_path) as f:
    bg = f.read()
section = re.search(r'MANIFEST_MATCH_PATTERNS[^[]*\[(.*?)\];', bg, re.DOTALL)
bg_hosts = []
if section:
    for m in re.finditer(r'/\^(.+?)\$/', section.group(1)):
        regex = m.group(1).replace('\\', '').replace('[a-z0-9-]+', 'WILDCARD')
        regex = re.sub(r'^https?://', '', regex)
        regex = re.sub(r':\d+', '', regex)
        bg_hosts.append(regex.lower())
bg_hosts = sorted(set(bg_hosts))

if set(manifest_hosts) == set(bg_hosts):
    print('MATCH')
else:
    print('MISMATCH')
    print('  manifest:', manifest_hosts)
    print('  bg:      ', bg_hosts)
PY
)
  if [ "$(echo "$hosts_diff" | head -1)" != "MATCH" ]; then
    emit_fail "chrome-ext-spa-allowlist: Layer A (manifest) vs Layer B (background.ts) host set mismatch"
    echo "$hosts_diff" >&2
    return
  fi

  local has_default
  has_default=$(grep -cE "DEFAULT_PUBLISHED_EXTENSION_ID\s*=\s*['\"][a-p]{32}['\"]" "$env_ts" || true)
  local has_discovery
  has_discovery=$(grep -cE "(ohmyperf/announce|announcedExtensionId|setExtensionIdOverride)" "$detector" || true)

  if [ "$has_default" -eq 0 ] && [ "$has_discovery" -eq 0 ]; then
    emit_fail "chrome-ext-spa-allowlist: Layer C empty AND Layer D (runtime discovery) absent"
    return
  fi

  emit_pass "chrome-ext-spa-allowlist: A==B host sets, C or D present"
}

check_node_globals_in_browser_bundle() {
  SYSTEMS_CHECKED=$((SYSTEMS_CHECKED + 1))
  local bundle="$ROOT/apps/extension-chrome/extension-dist/background.bundle.js"

  if [ ! -f "$bundle" ]; then
    echo "[cross-cutting-allowlists] SKIP node-globals-in-browser-bundle: bundle not built (run \`pnpm --filter @ohmyperf/extension-chrome build\` first)" >&2
    return
  fi

  local leaks
  leaks=$(python3 - "$bundle" <<'PY'
import re, sys
with open(sys.argv[1]) as f:
    raw = f.read()
stripped = re.sub(r'<define:process\.[^>]+>', '', raw)
patterns = {
    'process.': r'(?<![a-zA-Z_])process\.[a-zA-Z_]+',
    'Buffer.': r'(?<![a-zA-Z_])Buffer\.[a-zA-Z_]+',
    '__dirname': r'(?<![a-zA-Z_])__dirname',
    '__filename': r'(?<![a-zA-Z_])__filename',
    'setImmediate': r'(?<![a-zA-Z_])setImmediate',
}
hits = []
for name, pat in patterns.items():
    matches = re.findall(pat, stripped)
    if matches:
        hits.append(f"{name}={len(matches)}")
print(','.join(hits))
PY
)
  if [ -n "$leaks" ]; then
    emit_fail "node-globals-in-browser-bundle: unguarded Node globals in background.bundle.js: $leaks"
    return
  fi

  emit_pass "node-globals-in-browser-bundle: 0 unguarded process./Buffer./__dirname/setImmediate refs in background.bundle.js"
}

check_mv3_sw_port_lifecycle() {
  SYSTEMS_CHECKED=$((SYSTEMS_CHECKED + 1))
  local bridge="$ROOT/apps/website/lib/extension-bridge.ts"
  local bg="$ROOT/apps/extension-chrome/src/background.ts"

  if [ ! -f "$bridge" ] || [ ! -f "$bg" ]; then
    emit_fail "mv3-sw-port-lifecycle: missing $bridge or $bg"
    return
  fi

  local has_atomic
  has_atomic=$(grep -cE "(startMeasureAndStream|connect.*inside.*sendMessage)" "$bridge" || true)

  if [ "$has_atomic" -eq 0 ]; then
    emit_fail "mv3-sw-port-lifecycle: extension-bridge.ts has no startMeasureAndStream — risks SW idle race"
    return
  fi

  local on_connect_at_top
  on_connect_at_top=$(awk '/^if .typeof chrome/,/^}/' "$bg" | grep -c "onConnectExternal" || true)

  if [ "$on_connect_at_top" -eq 0 ]; then
    emit_fail "mv3-sw-port-lifecycle: onConnectExternal not registered at module top-level (must be sync registration)"
    return
  fi

  emit_pass "mv3-sw-port-lifecycle: atomic connect-inside-callback present + onConnectExternal sync-registered"
}

echo "[cross-cutting-allowlists] Running registered checks..."
echo

check_chrome_ext_spa_allowlist
check_node_globals_in_browser_bundle
check_mv3_sw_port_lifecycle

echo
echo "[cross-cutting-allowlists] $SYSTEMS_CHECKED systems checked, $SYSTEMS_FAILED failed"

exit $EXIT_CODE
