#!/usr/bin/env bash
# Start the API and the web app together. Ctrl-C stops both.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
API_PORT="${API_PORT:-8000}"
WEB_PORT="${WEB_PORT:-3000}"

if [[ ! -x "$ROOT/api/.venv/bin/uvicorn" ]]; then
  echo "Python venv missing. Run:  python3 -m venv api/.venv && api/.venv/bin/pip install -r api/requirements.txt"
  exit 1
fi

if [[ ! -d "$ROOT/web/node_modules" ]]; then
  echo "Node modules missing. Run:  (cd web && npm install)"
  exit 1
fi

cleanup() { kill 0 2>/dev/null || true; }
trap cleanup EXIT INT TERM

echo "API  → http://127.0.0.1:$API_PORT   (docs at /docs)"
echo "Web  → http://localhost:$WEB_PORT"
echo

(cd "$ROOT/api" && .venv/bin/uvicorn app.main:app --host 127.0.0.1 --port "$API_PORT" --reload) &
(cd "$ROOT/web" && API_BASE_URL="http://127.0.0.1:$API_PORT" npm run dev -- -p "$WEB_PORT") &

wait
