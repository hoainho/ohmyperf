#!/usr/bin/env bash
set -euo pipefail

REPO="${1:-hoainho/ohmyperf}"

if ! command -v gh >/dev/null 2>&1; then
  echo "ERROR: gh CLI not found. Install from https://cli.github.com/" >&2
  exit 1
fi

create() {
  local name="$1" color="$2" desc="$3"
  if gh label create "$name" --repo "$REPO" --color "$color" --description "$desc" 2>/dev/null; then
    echo "created: $name"
  else
    gh label edit "$name" --repo "$REPO" --color "$color" --description "$desc"
    echo "updated: $name"
  fi
}

create "type/bug"               "d73a4a" "Something measured wrong, crashed, or behaved unexpectedly"
create "type/feature"           "0e8a16" "New capability, metric, plugin, or surface"
create "type/enhancement"       "0e8a16" "Improvement to an existing capability"
create "type/docs"              "0075ca" "README, /docs, code comments, API reference"
create "type/refactor"          "a2eeef" "Internal cleanup, no behavior change"
create "type/test"              "bfd4f2" "Adding or fixing tests"
create "type/chore"             "cfd3d7" "Build, CI, tooling, deps"
create "type/question"          "d876e3" "A question, not a request for change"
create "type/security"          "ee0701" "Security advisory or hardening"

create "area/core"              "5319e7" "packages/core"
create "area/cli"               "5319e7" "apps/cli"
create "area/mcp"               "5319e7" "apps/mcp-server"
create "area/extension-chrome"  "5319e7" "apps/extension-chrome"
create "area/extension-vscode"  "5319e7" "apps/ide-vscode"
create "area/viewer"            "5319e7" "apps/website + packages/viewer"
create "area/eslint"            "5319e7" "packages/eslint-plugin"
create "area/fixers"            "5319e7" "packages/fixers"
create "area/reporter"          "5319e7" "packages/reporter-*"
create "area/driver-playwright" "5319e7" "packages/driver-playwright"
create "area/driver-extension"  "5319e7" "packages/driver-extension"
create "area/trace-utils"       "5319e7" "packages/trace-utils"
create "area/share-server"      "5319e7" "packages/share-server"
create "area/share-client"      "5319e7" "packages/share-client"
create "area/ci"                "5319e7" "GitHub Actions, scripts"
create "area/docs"              "5319e7" "/docs, README"
create "area/openspec"          "5319e7" "openspec/changes/**, openspec/specs/**"

create "priority/critical"      "b60205" "Data corruption, security, blocks all users"
create "priority/high"          "d93f0b" "Blocks a major use case"
create "priority/medium"        "fbca04" "Important but not blocking"
create "priority/low"           "0e8a16" "Nice to have, no timeline"

create "status/needs-triage"    "ededed" "New issue, not yet reviewed"
create "status/needs-repro"     "ededed" "Awaiting reproducible example"
create "status/needs-design"    "ededed" "Requires OpenSpec change proposal first"
create "status/accepted"        "0e8a16" "Ready for a contributor to pick up"
create "status/in-progress"     "fbca04" "Someone is actively working on it"
create "status/blocked"         "b60205" "Blocked by external dep or another issue"
create "status/stale"           "cfd3d7" "30+ days no activity"
create "status/wontfix"         "ffffff" "Intentionally not addressing"

create "good-first-issue"       "7057ff" "Small, well-scoped, < 4h work, with acceptance criteria"
create "help-wanted"            "008672" "Maintainer welcomes contributor takeover"
create "hacktoberfest"          "ff8c00" "Accepting Hacktoberfest PRs"
create "mentor-available"       "fef2c0" "Active mentorship offered"

create "breaking-change"        "b60205" "Touches the frozen core API surface"
create "dependencies"           "0366d6" "Updates a dependency"
create "duplicate"              "cfd3d7" "Same as another issue"
create "invalid"                "e4e669" "Not a real issue"
create "discussion"             "d4c5f9" "Should be in GitHub Discussions instead"

echo
echo "Done. View labels: https://github.com/$REPO/labels"
