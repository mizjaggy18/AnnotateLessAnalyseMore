#!/usr/bin/env bash
# ── AnnotateLessAnalyseMore launcher (macOS / Linux) ──────────────────────

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
VENV_DIR="$SCRIPT_DIR/venv"

# Resolve python binary
if command -v python3 &>/dev/null; then
    PYTHON=python3
elif command -v python &>/dev/null; then
    PYTHON=python
else
    echo "[ERROR] Python not found. Install Python 3.9+ and ensure it is on PATH."
    exit 1
fi

# Create venv on first run
if [ ! -f "$VENV_DIR/bin/activate" ]; then
    echo "[SETUP] Creating virtual environment..."
    $PYTHON -m venv "$VENV_DIR"
fi

# Activate venv
# shellcheck disable=SC1091
source "$VENV_DIR/bin/activate"

# Install / upgrade dependencies
echo "[SETUP] Installing dependencies..."
pip install -q -r "$SCRIPT_DIR/requirements.txt"

# Launch app
echo ""
echo "[OK] Starting AnnotateLessAnalyseMore..."
echo "[OK] Open your browser at http://127.0.0.1:5000"
echo "[OK] Press Ctrl+C to stop the server."
echo ""
python "$SCRIPT_DIR/app.py"
