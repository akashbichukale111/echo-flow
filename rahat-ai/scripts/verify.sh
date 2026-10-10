#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT/services/api"
python3 -m compileall -q .
python3 -m ruff check .
python3 -m pytest -q
cd "$ROOT/apps/web"
npm install
npm run lint
npm run typecheck
npm run test
npm run build
npx playwright install chromium
npm run test:e2e
