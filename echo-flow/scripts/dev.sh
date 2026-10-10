#!/usr/bin/env bash
# Starts API (127.0.0.1:5201) and frontend (127.0.0.1:5174) for local development. Loopback only.
set -euo pipefail
cd "$(dirname "$0")/.."
[ -d .venv ] || python3 -m venv .venv
. .venv/bin/activate
pip install -q -e ".[test]"
[ -f .env ] || cp .env.example .env
(cd frontend && npm install --no-audit --no-fund)
trap 'kill 0' EXIT
python -m uvicorn backend.main:app --host 127.0.0.1 --port 5201 &
(cd frontend && npm run dev) &
echo "ECHO-FLOW Command Center: http://127.0.0.1:5174  (API docs: http://127.0.0.1:5201/docs)"
wait
