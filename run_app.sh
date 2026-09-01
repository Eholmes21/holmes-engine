#!/bin/bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PYTHON_BIN="${PYTHON_BIN:-python3}"

if [ -x "$ROOT_DIR/backend/.venv/bin/python" ]; then
  PYTHON_BIN="$ROOT_DIR/backend/.venv/bin/python"
elif [ -x "$ROOT_DIR/backend/venv/bin/python" ]; then
  # Keep compatibility with the original checkout, which used ``venv``.
  PYTHON_BIN="$ROOT_DIR/backend/venv/bin/python"
fi

# Backend (FastAPI)
cd "$ROOT_DIR/backend"
"$PYTHON_BIN" -m uvicorn main:app --reload --host 127.0.0.1 --port 8000 &
BACKEND_PID=$!

cleanup() {
  if [ -n "${FRONTEND_PID:-}" ]; then
    kill "$FRONTEND_PID" 2>/dev/null || true
    wait "$FRONTEND_PID" 2>/dev/null || true
  fi
  kill "$BACKEND_PID" 2>/dev/null || true
  wait "$BACKEND_PID" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

# Do not start the UI until the API is ready. This keeps the first browser
# request from racing the backend startup and gives a clear failure if the API
# cannot bind its port.
for _ in {1..30}; do
  if curl --silent --fail http://127.0.0.1:8000/health >/dev/null 2>&1; then
    break
  fi
  if ! kill -0 "$BACKEND_PID" 2>/dev/null; then
    echo "Holmes backend exited before it became ready." >&2
    exit 1
  fi
  sleep 0.2
done
if ! curl --silent --fail http://127.0.0.1:8000/health >/dev/null 2>&1; then
  echo "Holmes backend did not become ready on port 8000." >&2
  exit 1
fi

# Frontend (Vite)
cd "$ROOT_DIR/frontend"
"$ROOT_DIR/frontend/node_modules/.bin/vite" --host 127.0.0.1 --port 5173 &
FRONTEND_PID=$!

wait "$FRONTEND_PID"
