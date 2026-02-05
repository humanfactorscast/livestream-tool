#!/usr/bin/env bash
set -euo pipefail

# Build a single-file executable launcher using PyInstaller.
# Run from repo root: ./build_executable.sh

python3 -m pip install --upgrade pip pyinstaller

pyinstaller \
  --onefile \
  --name livestream-copilot \
  launcher.py

echo "Build complete: dist/livestream-copilot"
echo "Run it: ./dist/livestream-copilot"
