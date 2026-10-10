#!/usr/bin/env bash
cd "$(dirname "$0")/services/api" && python3 -m venv .venv && . .venv/bin/activate && pip install -q -r requirements.txt && uvicorn main:app --reload --port 8000
