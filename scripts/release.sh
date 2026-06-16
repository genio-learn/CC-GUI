#!/usr/bin/env bash
set -euo pipefail

# Cut a release: bump the version across all manifests, commit, tag, push.
# The tag push triggers .github/workflows/release.yml, which builds and
# attaches the bundles. Assumes feature commits are already on main.
#
# Usage: scripts/release.sh <patch|minor|major|X.Y.Z>

cd "$(dirname "$0")/.."

bump="${1:-}"
[[ -n "$bump" ]] || { echo "usage: $0 <patch|minor|major|X.Y.Z>" >&2; exit 1; }

# In-place file edit that works with both BSD (macOS) and GNU (Linux) sed:
# write through a temp file instead of relying on `sed -i`'s flavor-specific
# argument. The `s///` substitution syntax itself is identical across both.
replace_in() {
  local file="$1" expr="$2" tmp
  tmp=$(mktemp)
  sed "$expr" "$file" >"$tmp" && mv "$tmp" "$file"
}

# Preconditions — fail loudly before touching anything.
branch=$(git symbolic-ref --short HEAD)
[[ "$branch" == "main" ]]                    || { echo "error: not on main (on $branch)" >&2; exit 1; }
[[ -z "$(git status --porcelain)" ]]         || { echo "error: working tree not clean" >&2; exit 1; }
git fetch -q origin main
[[ -z "$(git rev-list HEAD..origin/main)" ]] || { echo "error: behind origin/main — pull first" >&2; exit 1; }

current=$(node -p "require('./package.json').version")

# Resolve the new version from a keyword or an explicit X.Y.Z.
if [[ "$bump" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  new="$bump"
else
  IFS=. read -r maj min pat <<<"$current"
  case "$bump" in
    major) new="$((maj + 1)).0.0" ;;
    minor) new="$maj.$((min + 1)).0" ;;
    patch) new="$maj.$min.$((pat + 1))" ;;
    *) echo "error: bump must be patch|minor|major|X.Y.Z" >&2; exit 1 ;;
  esac
fi

echo "Releasing v$new (from v$current)"

# Bump the three manifests; let each lockfile rewrite from the new manifest
# (cargo metadata for Cargo.lock, npm --package-lock-only for package-lock.json)
# so neither drifts and `npm ci` in CI stays happy.
replace_in package.json              "s/\"version\": \"$current\"/\"version\": \"$new\"/"
replace_in src-tauri/tauri.conf.json "s/\"version\": \"$current\"/\"version\": \"$new\"/"
replace_in src-tauri/Cargo.toml      "s/^version = \"$current\"/version = \"$new\"/"
cargo metadata --manifest-path src-tauri/Cargo.toml --format-version 1 >/dev/null
npm install --package-lock-only --silent

npm run typecheck   # cheap sanity gate before we tag

git commit -aqm "Release v$new"
git tag "v$new"
git push origin main
git push origin "v$new"

echo "Pushed v$new → https://github.com/Ed-Barnes937/CC-GUI/actions/workflows/release.yml"
