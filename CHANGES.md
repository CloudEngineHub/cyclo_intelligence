# Moving Cyclo Intelligence to LeRobot 0.6.1

The LeRobot submodule moves from 0.5.2 to 0.6.1, which already ships MolmoAct2, VLA-JEPA and
FastWAM. Those three are added to Model Inference; no policy code is added here.

## What the upgrade required

Two call sites had to follow the rename and removal:

- `eval_freq` became `env_eval_freq`. Only the flag passed to `lerobot-train` changes; Cyclo keeps
  its own field name, so the ROS messages and UI are untouched.
- `sac` was replaced by `gaussian_actor` in the trainable policy lists.

Nothing else in the engine changed: `get_policy_class`, `PreTrainedPolicy.from_pretrained` and
`TrainPipelineConfig` all have identical signatures in 0.6.1.

## Model list

Three models are added to Model Inference: MolmoAct2, VLA-JEPA and FastWAM. The list stays limited
to policies that have been run end to end here. 0.6.1 registers others (VQ-BeT, Multitask DiT,
EO-1, EVO1, WALL-OSS, LingBot-VA, Pi0Fast) but they are left out until someone has a checkpoint to
verify them with.

## Fixes carried in the submodule

Two problems remain in stock 0.6.1 and are fixed on the submodule branch.

**VLA-JEPA cannot stack cameras of different sizes.** The world-model branch stacks all views into
one tensor, which fails on robots whose cameras differ (AI Worker: 376x672 scene, 424x240 wrists):

```
RuntimeError: stack expects each tensor to be equal size,
but got [2, 8, 3, 376, 672] at entry 0 and [2, 8, 3, 424, 240] at entry 1
```

Views are upscaled to the largest before stacking. Training only; inference resizes each image on
its own.

**VLA-JEPA config has no `qwen_lr`.** Checkpoints trained with a separate backbone learning rate
record the field, and strict parsing rejects it. Added with a default, so checkpoints without it
are unaffected.

## Fixes on the Cyclo side

**MolmoAct2 will not run unless the action head is named.**

```
ValueError: MolmoAct2 inference requires `inference_action_mode` to be set
explicitly to either 'continuous' or 'discrete'.
```

Cyclo runs the continuous (flow matching) head, so the engine sets it when a checkpoint does not.
A checkpoint that names one keeps its own value.

**FastWAM does not fit on a 24GB GPU.** It is a 5B video expert plus an action expert, a VAE and an
~11GB UMT5 text encoder. The text encoder only turns the instruction into a context vector and the
instruction is fixed for a session, so the engine encodes it once while the model is still on the
CPU, moves everything else to the GPU, and supplies the cached context on every prediction.
Proprioception is padded to the model's width in the same wrapper. Measured 13.5 GB.

Because the encoder is unreachable afterwards, the instruction must be set at load time. Loading
without one raises rather than failing later.

This uses `_apply_policy_optimization`, the hook the engine already calls after a policy loads, so
the engine lifecycle is unchanged.

**AI Worker cameras could not bind.** Those datasets name the left head camera `scene` and drop the
`cam_` prefix on the wrists, so the resolver found no match:

```
RuntimeError: Missing camera mappings for policy input keys:
['observation.images.scene', 'observation.images.wrist_left', 'observation.images.wrist_right']
```

`cam_left_head` now also answers to `scene`, matching the existing rule that maps the legacy
`cam_head` key to it, and wrist cameras answer without the prefix in either word order.

## Verification

Same build compared on both versions, so a failure that predates the upgrade is visible as such.

| Policy | 0.5.2 | 0.6.1 |
| --- | --- | --- |
| ACT | builds | builds |
| Pi0 | builds | builds |
| Pi0.5 | builds | builds |
| Diffusion | fails, mixed camera shapes | same |
| SmolVLA | fails, needs network for base weights | same |
| XVLA | fails, needs a pretrained config | same |

No policy regressed. Checkpoints covered OK.

GR00T runs in its own container against Isaac-GR00T and is not affected by this change.
