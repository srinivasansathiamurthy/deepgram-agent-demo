#!/usr/bin/env bash
# start.sh — launch the Deepgram Documentation Voice Agent
#
# In development, run two processes:
#   1. FastAPI backend on port 8000 (handles Deepgram WS bridge + recording)
#   2. Vite frontend dev server on port 5173 (proxies /api/* to backend)
#
# For production: run `cd frontend && npm run build` first, then just start
# the backend (it serves the built frontend from frontend/dist/).

set -e

# Ensure we run from the project root regardless of where the script is called.
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$DIR"

# Check that the .env file exists with required keys.
if [ ! -f .env ]; then
  echo "ERROR: .env file not found."
  echo "  Copy .env.example → .env and fill in your API keys."
  exit 1
fi

# Create the sessions directory if it doesn't exist yet.
mkdir -p sessions

echo ""
echo "🎙️  Starting Deepgram Documentation Voice Agent"
echo ""

# Kill anything already on port 8000 so there's exactly one backend process.
# This prevents "multiple stream" issues from orphaned uvicorn children.
EXISTING=$(lsof -ti tcp:8000 2>/dev/null)
if [ -n "$EXISTING" ]; then
  echo "   Killing existing process on port 8000 (PID $EXISTING)..."
  kill "$EXISTING" 2>/dev/null
  sleep 0.5
fi

echo "   Backend  →  http://localhost:8000"
echo "   Frontend →  http://localhost:5173  (open this in your browser)"
echo ""
echo "   Press Ctrl+C to stop both servers."
echo ""

# Start the FastAPI backend in the background.
(cd backend && pipenv run python server.py) &
BACKEND_PID=$!

# Start the Vite frontend dev server in the background.
cd frontend
npm run dev &
FRONTEND_PID=$!
cd "$DIR"

# On Ctrl+C, kill both background processes cleanly.
trap "echo ''; echo 'Shutting down...'; kill $BACKEND_PID $FRONTEND_PID 2>/dev/null; exit 0" INT TERM

# Wait for both processes; exit if either crashes.
wait $BACKEND_PID $FRONTEND_PID
