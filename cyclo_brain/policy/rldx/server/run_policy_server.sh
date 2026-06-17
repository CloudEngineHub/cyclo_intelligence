#!/usr/bin/env bash
set -euo pipefail

repo_dir="${RLDX_SERVER_REPO_DIR:-/opt/RLDX-1}"
model_path="${RLDX_SERVER_MODEL_PATH:-/model/rldx}"
embodiment_tag="${RLDX_SERVER_EMBODIMENT_TAG:-}"
host="${RLDX_SERVER_HOST:-0.0.0.0}"
port="${RLDX_SERVER_PORT:-5555}"
compile="${RLDX_SERVER_COMPILE:-none}"
pixi_env="${RLDX_PIXI_ENV:-rldx}"

cd "$repo_dir"
export PYTHONPATH="$repo_dir${PYTHONPATH:+:${PYTHONPATH}}"

if [ -z "$embodiment_tag" ]; then
    embodiment_tag="$(
        RLDX_SERVER_MODEL_PATH="$model_path" pixi run --environment "$pixi_env" python - <<'PY'
import json
import os
import re
from pathlib import Path

from rldx.data.embodiment_tags import EmbodimentTag


def to_enum_name(value: str) -> str | None:
    value = value.strip()
    for tag in EmbodimentTag:
        if tag.value == value or tag.name == value:
            return tag.name
    return None


model_path = Path(os.environ["RLDX_SERVER_MODEL_PATH"])
for rel in ("experiment_cfg/conf.yaml", "experiment_cfg/config.yaml"):
    path = model_path / rel
    if not path.exists():
        continue
    match = re.search(r"embodiment_tag:\s*([A-Za-z0-9_]+)", path.read_text())
    if match:
        name = to_enum_name(match.group(1))
        if name:
            print(name)
            raise SystemExit(0)

path = model_path / "processor" / "processor_config.json"
if path.exists():
    data = json.loads(path.read_text())
    configs = (
        data.get("processor_kwargs", {})
        .get("modality_configs", {})
    )
    if "new_embodiment" in configs:
        print("NEW_EMBODIMENT")
        raise SystemExit(0)

print("GENERAL_EMBODIMENT")
PY
    )"
fi

echo "[rldx_policy_server] repo: $repo_dir"
echo "[rldx_policy_server] model: $model_path"
echo "[rldx_policy_server] embodiment: $embodiment_tag"
echo "[rldx_policy_server] bind: ${host}:${port}"
echo "[rldx_policy_server] compile: $compile"

extra_args=()
if [ -n "${RLDX_SERVER_EXTRA_ARGS:-}" ]; then
    # shellcheck disable=SC2206
    extra_args=(${RLDX_SERVER_EXTRA_ARGS})
fi

exec pixi run --environment "$pixi_env" \
    python rldx/eval/run_rldx_server.py \
        --model-path "$model_path" \
        --embodiment-tag "$embodiment_tag" \
        --host "$host" \
        --port "$port" \
        --compile "$compile" \
        "${extra_args[@]}"
