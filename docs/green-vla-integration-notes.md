# GreenVLA Integration Notes

## Scope

GreenVLA will be integrated as a separate Cyclo Brain policy backend. The backend should follow the same runtime shape as the existing LeRobot and GR00T backends: one policy container, common `main-runtime`, common `engine-process`, and one backend-specific engine package.

The first target is public-code-supported R1/SFT-style work:

- Load public GreenVLA checkpoints.
- Build Cyclo observations from RobotClient camera/state data.
- Produce action chunks through the common Cyclo Brain inference contract.
- Prepare the Cyclo LeRobot v2.1 dataset for GreenVLA fine-tuning.
- Validate offline with rosbag replay before any live robot test.

The initial Cyclo dataset target is `Dongkkka/cyclo_intelligence_test_dataset_lerobot_v2.1`.

## Public GreenVLA Capability Boundary

The public GreenVLA repository exposes checkpoint loading, inference examples, dataset statistics tooling, data configuration patterns, and supervised fine-tuning style training scripts. Public R2 checkpoints can be loaded and evaluated as model weights.

The repository does not expose enough implementation detail to reproduce the official R2 training pipeline directly. The GreenVLA paper describes R2 with Q-guided trajectory optimization, Implicit Q-Learning, source distribution optimization, environment validation, and repeated fine-tuning. However, the public code does not provide the complete reward definitions, rollout orchestration, critic and actor implementations, validation gates, or full training scripts needed to reproduce official R2 alignment.

## Practical Training Path

Use SFT first.

In this context, SFT means supervised fine-tuning on demonstration data:

```text
input: camera images + robot state + task instruction
target: recorded expert action
loss: predicted action should match the recorded action
```

For Cyclo:

```text
cam_head_left / wrist camera images
+ 22D robot state
+ task instruction
-> 22D action chunk
```

GreenVLA internally supports a larger unified model action/state space, so Cyclo's 22D vectors should be padded to the model dimension during input construction and sliced back to 22D before publishing actions.

## R1 And R2 Interpretation

R1 is a GreenVLA policy adapted to a target embodiment through fine-tuning on demonstration data. It is still the same VLA policy at inference time.

R2 is also the same VLA policy at inference time, but its weights have gone through an additional RL alignment stage. The reward model or critic used during training is not part of the deployed policy checkpoint.

This means:

- R2 checkpoints can be evaluated.
- R2 checkpoints may be used as SFT starting points if their embodiment bias is acceptable.
- Official R2 training cannot be reproduced from checkpoints alone.

## Recommended Experiment Order

1. Build `green_vla` as an isolated backend based on the current LeRobot runtime image.
2. Keep CUDA-enabled Jetson PyTorch intact; do not let upstream dependency resolution replace `torch`, `torchvision`, or `torchcodec` on ARM64.
3. Load `SberRoboticsCenter/GreenVLA-2b-base` as the first smoke model.
4. Add Cyclo camera and 22D state/action mapping.
5. Run model-load smoke tests on CPU first, then document CUDA memory behavior separately.
6. Prepare `Dongkkka/cyclo_intelligence_test_dataset_lerobot_v2.1` with GreenVLA-compatible data config and dataset stats.
7. Fine-tune from a base checkpoint before trying R2 checkpoints as SFT starting points.
8. Treat R2-like Cyclo alignment as a later research project.

## Future R2-Like Cyclo Work

A Cyclo R2-like path should be designed separately. It would need:

- Sparse success rewards for concrete tasks.
- Safe rollout capture from real robot trials or validated simulation.
- Success and failure annotation.
- A critic trained from Cyclo trajectories.
- Q-gradient action improvement or source-noise optimization.
- An environment validation gate before adding improved trajectories back to the training set.
- Repeated SFT after dataset augmentation.

That path is useful, but it should not block the first GreenVLA backend integration.
