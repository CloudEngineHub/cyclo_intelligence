# GreenVLA Backend Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add GreenVLA as an isolated Cyclo Brain policy backend that can load GreenVLA checkpoints, run Cyclo observations through the common two-process inference runtime, and prepare Cyclo v2.1 data for R1/SFT fine-tuning.

**Architecture:** GreenVLA will be a sibling backend to `lerobot` and `groot` under `cyclo_brain/policy/green_vla`. It will reuse the common `main-runtime` and `engine-process` services, mount its own `green_vla_engine`, and run in a separate `green_vla_server` container so dependency changes do not disturb the working LeRobot backend. R2/RL alignment is documented as a later research path; this implementation focuses on public-code-supported SFT/R1 and inference.

**Tech Stack:** Python, PyTorch, GreenVLA/LeRobot fork, Zenoh ROS2 SDK, Cyclo RobotClient, s6-overlay, Docker Compose, pytest.

---

### Task 1: Capture The GreenVLA Scope

**Files:**
- Create: `docs/green-vla-integration-notes.md`

**Step 1: Write the notes**

Document:
- Public GreenVLA supports checkpoint loading, inference examples, dataset stats, and SFT-style fine-tuning.
- R2 checkpoint evaluation is possible.
- R2 reproduction is not in scope because reward definitions, rollout orchestration, critic/actor implementations, validation criteria, and training scripts are not public in the repo.
- Cyclo first target is R1/SFT on `Dongkkka/cyclo_intelligence_test_dataset_lerobot_v2.1`.
- R2-like Cyclo work is future work: sparse reward, rollout logging, Q-guided trajectory improvement, dataset augmentation, and repeated SFT.

**Step 2: Verify no Korean text is introduced**

Run: `python - <<'PY'
from pathlib import Path
text = Path("docs/green-vla-integration-notes.md").read_text()
assert not any("\uac00" <= ch <= "\ud7a3" for ch in text)
PY`
Expected: no matches.

**Step 3: Commit**

```bash
git add docs/green-vla-integration-notes.md docs/plans/2026-05-21-green-vla-backend.md
git commit -m "docs: plan GreenVLA backend integration"
```

### Task 2: Add GreenVLA Engine Mapping Tests

**Files:**
- Create: `cyclo_brain/policy/green_vla/tests/test_io_mapping.py`
- Create: `cyclo_brain/policy/green_vla/green_vla_engine/__init__.py`
- Create: `cyclo_brain/policy/green_vla/green_vla_engine/io_mapping.py`

**Step 1: Write failing tests**

Test behaviors:
- Cyclo camera names map to GreenVLA image keys:
  - `cam_head_left` -> `observation.images.base_0_rgb`
  - `cam_wrist_left` -> `observation.images.left_wrist_0_rgb`
  - `cam_wrist_right` -> `observation.images.right_wrist_0_rgb`
- `cam_head_right` is ignored unless a checkpoint explicitly asks for it.
- Missing required GreenVLA camera keys raise a clear `RuntimeError`.
- Cyclo state/action dimensions are configured as 22D, padded to GreenVLA's 48D model space, then sliced back to 22D output.

**Step 2: Run tests to verify they fail**

Run: `pytest cyclo_brain/policy/green_vla/tests/test_io_mapping.py -v`
Expected: FAIL because `green_vla_engine.io_mapping` does not exist yet.

**Step 3: Implement minimal mapping helpers**

Implement:
- `GREEN_VLA_CAMERA_ALIASES`
- `resolve_camera_mappings(robot_camera_names, policy_image_keys)`
- `pad_state_to_model_dim(state, model_dim=48)`
- `slice_action_to_robot_dim(action, robot_dim=22)`

**Step 4: Run tests to verify they pass**

Run: `pytest cyclo_brain/policy/green_vla/tests/test_io_mapping.py -v`
Expected: PASS.

**Step 5: Commit**

```bash
git add cyclo_brain/policy/green_vla/green_vla_engine cyclo_brain/policy/green_vla/tests
git commit -m "feat(green-vla): add Cyclo IO mapping helpers"
```

### Task 3: Add A GreenVLA Engine Skeleton

**Files:**
- Create: `cyclo_brain/policy/green_vla/green_vla_engine/engine.py`
- Create: `cyclo_brain/policy/green_vla/green_vla_engine/loading.py`
- Create: `cyclo_brain/policy/green_vla/green_vla_engine/preprocessing.py`
- Create: `cyclo_brain/policy/green_vla/green_vla_engine/prediction.py`
- Test: `cyclo_brain/policy/green_vla/tests/test_engine_contract.py`

**Step 1: Write failing contract tests**

Test behaviors:
- `create_engine()` returns an object implementing `InferenceEngine`.
- `is_ready` is false before `load_policy`.
- `get_action_chunk()` returns `{"success": False, "message": "Not in inference mode"}` before load.
- `cleanup()` is idempotent.

**Step 2: Run tests to verify they fail**

Run: `PYTHONPATH=cyclo_brain/policy/common/runtime pytest cyclo_brain/policy/green_vla/tests/test_engine_contract.py -v`
Expected: FAIL because the engine does not exist.

**Step 3: Implement the skeleton**

Mirror the LeRobot split:
- `engine.GreenVLAEngine`
- `loading.LoadingMixin`
- `preprocessing.PreprocessingMixin`
- `prediction.PredictionMixin`
- module-level `create_engine()`

Keep real model loading behind helper methods so unit tests can avoid large weights.

**Step 4: Run tests to verify they pass**

Run: `PYTHONPATH=cyclo_brain/policy/common/runtime pytest cyclo_brain/policy/green_vla/tests/test_engine_contract.py -v`
Expected: PASS.

**Step 5: Commit**

```bash
git add cyclo_brain/policy/green_vla/green_vla_engine cyclo_brain/policy/green_vla/tests
git commit -m "feat(green-vla): add inference engine skeleton"
```

### Task 4: Add GreenVLA Docker Image

**Files:**
- Create: `cyclo_brain/policy/green_vla/Dockerfile.arm64`
- Create: `cyclo_brain/policy/green_vla/Dockerfile.amd64`
- Create: `cyclo_brain/policy/green_vla/checkpoints/.gitignore`
- Create: `cyclo_brain/policy/green_vla/checkpoints/README.md`
- Modify: `docker/docker-compose.yml`

**Step 1: Add Dockerfiles**

Use the current LeRobot image as the ARM64 base. Install GreenVLA dependencies without replacing Jetson CUDA PyTorch:
- Do not install upstream `torch`, `torchvision`, or `torchcodec` from PyPI on ARM64.
- Pin the GreenVLA-tested userland dependency set found in the probe container.
- Use `PYTHONPATH=/opt/GreenVLA:/app:/policy_runtime`.
- Set `HF_HOME`, `HUGGINGFACE_HUB_CACHE`, and `TRANSFORMERS_CACHE` to the mounted Hugging Face cache.

**Step 2: Patch or vendor the torchcodec fallback**

Add a build-time patch so GreenVLA video loading falls back to `pyav` on ARM64 when `torchcodec` is unavailable.

**Step 3: Add compose service**

Add `green_vla`:
- `container_name: green_vla_server`
- `image: robotis/green-vla-zenoh:0.1.0-${ARCH:-arm64}`
- `POLICY_BACKEND=green_vla`
- `POLICY_ENGINE_MODULE=green_vla_engine`
- checkpoint mount `/policy_checkpoints/green_vla`
- engine mount `../cyclo_brain/policy/green_vla/green_vla_engine:/app/green_vla_engine:ro`
- common runtime and SDK mounts matching LeRobot/GROOT.

**Step 4: Build smoke test**

Run: `ARCH=arm64 docker compose -f docker/docker-compose.yml build green_vla`
Expected: image builds without replacing CUDA-enabled PyTorch.

**Step 5: Import smoke test**

Run:
```bash
docker run --rm --runtime nvidia --network host robotis/green-vla-zenoh:0.1.0-arm64 \
  python -c "import torch; print(torch.__version__, torch.cuda.is_available()); import lerobot.common.policies.factory; import green_vla_engine"
```
Expected: CUDA is available and imports succeed.

**Step 6: Commit**

```bash
git add cyclo_brain/policy/green_vla docker/docker-compose.yml
git commit -m "feat(green-vla): add policy container"
```

### Task 5: Add Model Load Smoke Script

**Files:**
- Create: `cyclo_brain/policy/green_vla/scripts/smoke_green_vla_load.py`

**Step 1: Write the smoke script**

The script should:
- load `SberRoboticsCenter/GreenVLA-2b-base` on CPU by default;
- optionally try CUDA with `--device cuda`;
- print checkpoint id, policy class, model dims, dtype summary, and memory notes;
- fail clearly if CUDA OOM occurs.

**Step 2: Run inside the container**

Run:
```bash
docker compose -f docker/docker-compose.yml run --rm green_vla \
  python /app/scripts/smoke_green_vla_load.py --model SberRoboticsCenter/GreenVLA-2b-base --device cpu
```
Expected: CPU model load succeeds.

**Step 3: Optional CUDA probe**

Run:
```bash
docker compose -f docker/docker-compose.yml run --rm green_vla \
  python /app/scripts/smoke_green_vla_load.py --model SberRoboticsCenter/GreenVLA-2b-base --device cuda
```
Expected: either successful CUDA load or a documented OOM; no silent failure.

**Step 4: Commit**

```bash
git add cyclo_brain/policy/green_vla/scripts/smoke_green_vla_load.py
git commit -m "test(green-vla): add model load smoke test"
```

### Task 6: Add Cyclo v2.1 Dataset Prep Notes

**Files:**
- Create: `cyclo_brain/policy/green_vla/RESULTS/README.md`
- Create: `cyclo_brain/policy/green_vla/RESULTS/DATASET_PREP.md`

**Step 1: Document the data mapping**

Record:
- dataset: `Dongkkka/cyclo_intelligence_test_dataset_lerobot_v2.1`
- camera mapping to GreenVLA's `base_0_rgb`, `left_wrist_0_rgb`, `right_wrist_0_rgb`
- 22D state/action order
- 48D padding and action mask behavior
- `compute_dataset_stats.py` requirement before training.

**Step 2: Verify no Korean text is introduced**

Run: `python - <<'PY'
from pathlib import Path
for root in [Path("cyclo_brain/policy/green_vla"), Path("docs/green-vla-integration-notes.md")]:
    paths = [root] if root.is_file() else [p for p in root.rglob("*") if p.is_file()]
    for path in paths:
        text = path.read_text(errors="ignore")
        assert not any("\uac00" <= ch <= "\ud7a3" for ch in text), path
PY`
Expected: no matches.

**Step 3: Commit**

```bash
git add cyclo_brain/policy/green_vla/RESULTS
git commit -m "docs(green-vla): document Cyclo dataset prep"
```

### Task 7: End-To-End Runtime Smoke

**Files:**
- No new files unless the smoke reveals a test gap.

**Step 1: Start the service**

Run: `ARCH=arm64 docker compose -f docker/docker-compose.yml up -d green_vla`
Expected: `green_vla_server` is healthy.

**Step 2: Check common runtime services**

Run:
```bash
docker exec green_vla_server sh -lc \
  's6-svstat /run/service/main-runtime && s6-svstat /run/service/engine-process'
```
Expected: both are up.

**Step 3: Check Zenoh service exposure**

Run the same service discovery approach used for LeRobot/GROOT, with the `/green_vla/inference_command` prefix.
Expected: service liveliness appears.

**Step 4: LOAD/UNLOAD dry run**

Use a small client script or the existing UI/service client to call:
- `LOAD` with `model_path=SberRoboticsCenter/GreenVLA-2b-base`
- `UNLOAD`

Expected: CPU load works; CUDA load result is recorded separately because current Jetson probe showed possible OOM.

**Step 5: Commit any fixes**

```bash
git add <changed-files>
git commit -m "fix(green-vla): pass runtime smoke"
```

### Task 8: Future R2-Like Research Spike

**Files:**
- Create: `docs/plans/2026-05-21-green-vla-r2-like-research.md`

**Step 1: Write a separate research plan**

Include:
- sparse reward definition for Cyclo tasks;
- rollout capture from real robot and/or rosbag replay;
- success/failure annotation;
- IQL critic design;
- Q-gradient action improvement;
- environment validation gate;
- dataset augmentation;
- repeated SFT from R0/R1 weights.

**Step 2: Commit**

```bash
git add docs/plans/2026-05-21-green-vla-r2-like-research.md
git commit -m "docs: outline GreenVLA R2-like research path"
```
