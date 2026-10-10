#!/usr/bin/env bash
# One-command local run: pilot API on :8000 + Vite UI on :5173.
# Loads .env if present; generates a throwaway API_TOKEN when none is set.
set -euo pipefail
cd "$(dirname "$0")/.."
[ -f .env ] && set -a && . ./.env && set +a
export APP_MODE="${APP_MODE:-pilot}"
if [ "$APP_MODE" != "demo" ] && [ -z "${API_TOKEN:-}" ]; then
  API_TOKEN="$(python3 -c 'import secrets;print(secrets.token_urlsafe(36))')"
  echo "Generated a temporary API_TOKEN for this session."
fi
export API_TOKEN="${API_TOKEN:-}"
export DEV_PROXY_API_TOKEN="${DEV_PROXY_API_TOKEN:-$API_TOKEN}"
(cd backend && python3 -m pip install -q -r requirements.txt && \
  python3 -m uvicorn app.main:app --port 8000) &
API_PID=$!
trap 'kill $API_PID 2>/dev/null' EXIT
cd frontend && npm install --no-audit --no-fund && npm run dev
