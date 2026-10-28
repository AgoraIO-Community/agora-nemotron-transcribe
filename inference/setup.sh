#!/usr/bin/env bash
set -euo pipefail
command -v uv >/dev/null || { echo 'Install uv: https://docs.astral.sh/uv/getting-started/installation/'; exit 1; }
command -v nvidia-smi >/dev/null || { echo 'Run this on a Linux NVIDIA GPU host with working CUDA drivers.'; exit 1; }
ROOT="$(cd "$(dirname "$0")" && pwd)"
mkdir -p "$ROOT/runtime"
cd "$ROOT/runtime"
if [ ! -d nemo-speech/.git ]; then git clone https://github.com/NVIDIA-NeMo/Speech.git nemo-speech; fi
cd nemo-speech
# Set NEMO_REF to an audited commit for a repeatable release environment.
if [ -n "${NEMO_REF:-}" ]; then git checkout "$NEMO_REF"; fi
git rev-parse HEAD > ../nemo-commit.txt
uv venv --python 3.13 .venv
UV_PROJECT_ENVIRONMENT="$PWD/.venv" uv sync --extra asr --extra vllm --locked --no-install-project
uv pip install --python .venv/bin/python --no-deps -e .
uv pip install --python .venv/bin/python --no-deps av==19.0.2 opencv-python-headless==5.0.0.93
source .venv/bin/activate
hf download nvidia/NVIDIA-Nemotron-3.5-Transcribe-30B-A4B --local-dir ./NVIDIA-Nemotron-3.5-Transcribe-30B-A4B
echo 'Setup finished. Start inference with: bash inference/serve.sh (from the repository root).'
