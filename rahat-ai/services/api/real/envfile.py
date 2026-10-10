"""Minimal .env loader (no extra dependency). Existing environment variables win; values are never logged."""
import os
from pathlib import Path


def load_env_file():
    for base in (Path.cwd(), Path(__file__).resolve().parents[3], Path(__file__).resolve().parents[1]):
        f = base / ".env"
        if not f.is_file():
            continue
        for line in f.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, _, v = line.partition("=")
            os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))
        return str(f)
    return None
