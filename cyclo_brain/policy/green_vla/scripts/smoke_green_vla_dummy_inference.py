#!/usr/bin/env python3
#
# Copyright 2026 ROBOTIS CO., LTD.
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0

"""Run GreenVLA inference with deterministic dummy inputs."""

from __future__ import annotations

import argparse
import sys
import time
from dataclasses import dataclass
from typing import Any


@dataclass(frozen=True)
class DummyRawInputs:
    """Raw tensors and tokenizer masks for one dummy GreenVLA observation."""

    images: dict[str, Any]
    image_masks: dict[str, Any]
    tokenizer_image_mask: dict[str, bool]
    state: Any


def build_arg_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--model",
        default="SberRoboticsCenter/GreenVLA-2b-base",
        help="HF repo id or local checkpoint path.",
    )
    parser.add_argument(
        "--device",
        default="cuda",
        choices=["cpu", "cuda"],
        help="Device used for model inference.",
    )
    parser.add_argument(
        "--prompt",
        default="move the robot arm to the target position",
        help="Instruction prompt used for the dummy observation.",
    )
    return parser


def build_dummy_raw_inputs(
    image_keys: list[str],
    image_shape: tuple[int, int],
    state_dim: int,
    device: Any,
) -> DummyRawInputs:
    import torch

    height, width = image_shape
    images = {}
    image_masks = {}
    tokenizer_image_mask = {}

    for index, key in enumerate(image_keys):
        image = torch.full((1, 3, height, width), 0.15 + 0.2 * index, dtype=torch.float32, device=device)
        image[:, index % 3, :, :] = 0.85
        images[key] = image.clamp(0.0, 1.0)
        image_masks[key] = torch.ones((1,), dtype=torch.bool, device=device)
        tokenizer_image_mask[key] = True

    state = torch.linspace(-0.05, 0.05, steps=state_dim, dtype=torch.float32, device=device).unsqueeze(0)

    return DummyRawInputs(
        images=images,
        image_masks=image_masks,
        tokenizer_image_mask=tokenizer_image_mask,
        state=state,
    )


def build_tokenized_prompt(config: Any, raw: DummyRawInputs, prompt: str, device: Any) -> dict[str, Any]:
    from lerobot.common.policies.greenvla_policy.greenvla_tokenizer import GreenVLATokenizer

    tokenizer = GreenVLATokenizer(
        max_len=config.tokenizer_max_length,
        state_dim=config.max_state_dim,
        control_mode="joint_position",
        embodiment_name="cyclo",
        base_vlm_model=config.base_vlm_model,
        image_keys=list(config.image_keys),
        discrete_state_input=config.discrete_state_input,
        continuous_state_input=config.continuous_state_input,
        state_dropout_prob=0.0,
        state_special_token_id=config.state_special_token_id,
        clip_state=config.clip_state,
        add_control_mode=config.add_control_mode,
        add_embodiment_name=config.add_embodiment_name,
        image_shape=tuple(config.image_shape),
        model_mode=config.model_mode,
    )

    tokenized = tokenizer.tokenize(
        prompt=prompt,
        state=raw.state.detach().cpu().numpy()[0],
        image_mask=raw.tokenizer_image_mask,
    )
    return {key: value.unsqueeze(0).to(device) for key, value in tokenized.items()}


def build_dummy_batch(policy: Any, prompt: str, device: Any) -> dict[str, Any]:
    config = policy.config
    raw = build_dummy_raw_inputs(
        image_keys=list(config.image_keys),
        image_shape=tuple(config.image_shape),
        state_dim=config.max_state_dim,
        device=device,
    )
    tokenized = build_tokenized_prompt(config, raw, prompt, device)
    return {
        "image": raw.images,
        "image_mask": raw.image_masks,
        "state": raw.state,
        **tokenized,
    }


def summarize_action(action: Any) -> dict[str, Any]:
    import torch

    detached = action.detach().float().cpu()
    finite_mask = torch.isfinite(detached)
    return {
        "shape": list(detached.shape),
        "finite": bool(finite_mask.all().item()),
        "nan_count": int(torch.isnan(detached).sum().item()),
        "inf_count": int(torch.isinf(detached).sum().item()),
        "min": float(detached.min().item()),
        "max": float(detached.max().item()),
        "mean": float(detached.mean().item()),
    }


def main(argv: list[str] | None = None) -> int:
    args = build_arg_parser().parse_args(argv)

    import torch
    from lerobot.common.policies.factory import load_pretrained_policy

    print(f"model={args.model}")
    print(f"requested_device={args.device}")
    print(f"torch={torch.__version__} cuda={torch.version.cuda} available={torch.cuda.is_available()}")

    if args.device == "cuda" and not torch.cuda.is_available():
        print("cuda requested but torch.cuda.is_available() is false", file=sys.stderr)
        return 2

    device = torch.device(args.device)
    if device.type == "cuda":
        torch.cuda.empty_cache()

    load_start = time.monotonic()
    policy, _, _ = load_pretrained_policy(
        args.model,
        data_config_name=None,
        config_overrides={
            "device": args.device,
            "attention_implementation": "sdpa",
        },
    )
    print(f"load_elapsed_sec={time.monotonic() - load_start:.2f}")
    print(f"policy_class={policy.__class__.__name__}")
    print(f"image_keys={list(policy.config.image_keys)}")
    print(f"image_shape={tuple(policy.config.image_shape)}")
    print(f"max_state_dim={policy.config.max_state_dim}")
    print(f"max_action_dim={policy.config.max_action_dim}")
    print(f"n_action_steps={policy.config.n_action_steps}")
    print(f"model_mode={policy.config.model_mode}")

    batch = build_dummy_batch(policy, args.prompt, device)
    print(f"batch.input_ids_shape={list(batch['input_ids'].shape)}")
    print(f"batch.state_shape={list(batch['state'].shape)}")
    print(f"batch.image_shapes={{{', '.join(f'{key}: {list(value.shape)}' for key, value in batch['image'].items())}}}")

    inference_start = time.monotonic()
    with torch.no_grad():
        action = policy.select_action(batch)
    if device.type == "cuda":
        torch.cuda.synchronize()
    inference_elapsed = time.monotonic() - inference_start

    summary = summarize_action(action)
    print(f"inference_elapsed_sec={inference_elapsed:.2f}")
    for key, value in summary.items():
        print(f"action.{key}={value}")

    preview = action.detach().float().cpu()[0, 0, : min(8, action.shape[-1])].tolist()
    print(f"action.first_step_preview={preview}")

    if summary["shape"] != [1, policy.config.n_action_steps, policy.config.max_action_dim]:
        print("unexpected action shape", file=sys.stderr)
        return 3
    if not summary["finite"]:
        print("non-finite action values detected", file=sys.stderr)
        return 4

    print("GREEN_VLA_DUMMY_INFERENCE_OK")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
