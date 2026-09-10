#!/usr/bin/env bash
set -a
source "$(dirname "$0")/../.env"
set +a

source "$(dirname "$0")/../.venv/bin/activate"

exec python -m uvicorn nexusos.api:create_app \
  --factory \
  --host 0.0.0.0 \
  --port 8000
