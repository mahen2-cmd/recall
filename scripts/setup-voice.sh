#!/usr/bin/env bash
# Installs the European Portuguese voices into .tts/ inside the project.
# Run it again if the online voice stops working: it updates edge-tts to the latest version.
set -euo pipefail
cd "$(dirname "$0")/.."

mkdir -p .tts/voices
[ -x .tts/venv/bin/python ] || python3 -m venv .tts/venv
# edge-tts gives the natural online voices; piper is the offline fallback.
.tts/venv/bin/pip install --quiet --upgrade edge-tts piper-tts

base="https://huggingface.co/rhasspy/piper-voices/resolve/main/pt/pt_PT/tug%C3%A3o/medium/pt_PT-tug%C3%A3o-medium"
[ -f .tts/voices/pt_PT-medium.onnx ] || curl -fL --progress-bar -o .tts/voices/pt_PT-medium.onnx "$base.onnx"
[ -f .tts/voices/pt_PT-medium.onnx.json ] || curl -fL -sS -o .tts/voices/pt_PT-medium.onnx.json "$base.onnx.json"

echo "Voices ready. Restart the app with: npm start"
