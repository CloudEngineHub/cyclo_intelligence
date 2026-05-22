#!/usr/bin/env python3
#
# Copyright 2026 ROBOTIS CO., LTD.
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0

"""Tests for the GreenVLA dummy inference smoke script."""

from __future__ import annotations

import importlib.util
from pathlib import Path

import pytest

torch = pytest.importorskip("torch")


def _load_script_module():
    script_path = Path(__file__).parents[1] / "scripts" / "smoke_green_vla_dummy_inference.py"
    spec = importlib.util.spec_from_file_location("smoke_green_vla_dummy_inference", script_path)
    assert spec is not None
    assert spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_build_dummy_raw_inputs_matches_green_vla_shapes():
    module = _load_script_module()

    raw = module.build_dummy_raw_inputs(
        image_keys=["base_0_rgb", "left_wrist_0_rgb", "right_wrist_0_rgb"],
        image_shape=(16, 20),
        state_dim=48,
        device=torch.device("cpu"),
    )

    assert set(raw.images) == {"base_0_rgb", "left_wrist_0_rgb", "right_wrist_0_rgb"}
    assert raw.images["base_0_rgb"].shape == (1, 3, 16, 20)
    assert raw.image_masks["left_wrist_0_rgb"].shape == (1,)
    assert raw.image_masks["left_wrist_0_rgb"].dtype is torch.bool
    assert raw.tokenizer_image_mask == {
        "base_0_rgb": True,
        "left_wrist_0_rgb": True,
        "right_wrist_0_rgb": True,
    }
    assert raw.state.shape == (1, 48)
    assert raw.state.dtype is torch.float32


def test_summarize_action_reports_shape_and_finiteness():
    module = _load_script_module()
    action = torch.tensor([[[0.0, 1.0], [2.0, 3.0]]], dtype=torch.float32)

    summary = module.summarize_action(action)

    assert summary["shape"] == [1, 2, 2]
    assert summary["finite"] is True
    assert summary["nan_count"] == 0
    assert summary["min"] == 0.0
    assert summary["max"] == 3.0
