#!/usr/bin/env bash
set -euo pipefail

repository_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
studio_root="${repository_root}/apps/studio"

if [[ ! -d "${studio_root}/node_modules" ]]; then
  echo "Studio dependencies are not installed." >&2
  echo "Run: cd ${studio_root} && npm ci" >&2
  exit 1
fi

export NEXUS_API_URL="${NEXUS_API_URL:-http://127.0.0.1:8000}"
studio_host="${NEXUS_STUDIO_HOST:-127.0.0.1}"
studio_port="${NEXUS_STUDIO_PORT:-3000}"

cd "${studio_root}"
exec npm run dev -- --hostname "${studio_host}" --port "${studio_port}" "$@"
