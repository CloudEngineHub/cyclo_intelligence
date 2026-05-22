#!/usr/bin/env python3
#
# Copyright 2026 ROBOTIS CO., LTD.
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0

"""Smoke-test GreenVLA checkpoint loading."""

from __future__ import annotations

import argparse
import sys
import time
from collections import Counter
from typing import Any


def build_arg_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--model",
        default="SberRoboticsCenter/GreenVLA-2b-base",
        help="HF repo id or local checkpoint path.",
    )
    parser.add_argument(
        "--device",
        default="cpu",
        choices=["cpu", "cuda"],
        help="Device override for GreenVLA config.",
    )
    parser.add_argument(
        "--data-config",
        default=None,
        help="Optional GreenVLA robotics data config. Omit for model-load only.",
    )
    return parser


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

    if args.device == "cuda":
        torch.cuda.empty_cache()

    start = time.monotonic()
    try:
        policy, input_transforms, output_transforms = load_pretrained_policy(
            args.model,
            data_config_name=args.data_config,
            config_overrides={
                "device": args.device,
                "attention_implementation": "sdpa",
            },
        )
    except RuntimeError as exc:
        if "out of memory" in str(exc).lower():
            print(f"cuda_oom={exc}", file=sys.stderr)
            return 3
        raise

    elapsed = time.monotonic() - start
    print(f"load_elapsed_sec={elapsed:.2f}")
    print(f"policy_class={policy.__class__.__name__}")
    print(f"input_transforms={_describe_transforms(input_transforms)}")
    print(f"output_transforms={_describe_transforms(output_transforms)}")

    config = getattr(policy, "config", None)
    if config is not None:
        for name in (
            "base_vlm_model",
            "max_state_dim",
            "max_action_dim",
            "n_action_steps",
            "device",
            "attention_implementation",
        ):
            if hasattr(config, name):
                print(f"config.{name}={getattr(config, name)}")

    dtype_counts: Counter[str] = Counter()
    dtype_numel: Counter[str] = Counter()
    total_params = 0
    total_bytes = 0
    first_device = None
    for param in policy.parameters():
        dtype_key = str(param.dtype)
        dtype_counts[dtype_key] += 1
        dtype_numel[dtype_key] += param.numel()
        total_params += param.numel()
        total_bytes += param.numel() * param.element_size()
        if first_device is None:
            first_device = param.device

    print(f"param_device={first_device}")
    print(f"total_params={total_params}")
    print(f"approx_param_gib={total_bytes / (1024 ** 3):.3f}")
    print(f"dtype_counts={dict(dtype_counts)}")
    print(f"dtype_numel={dict(dtype_numel)}")
    print("GREEN_VLA_MODEL_LOAD_OK")
    return 0


def _describe_transforms(transforms: Any) -> str:
    if transforms is None:
        return "none"
    try:
        return transforms.__class__.__name__
    except Exception:
        return str(type(transforms))


if __name__ == "__main__":
    raise SystemExit(main())
