#!/usr/bin/env python3
#
# Copyright 2026 ROBOTIS CO., LTD.
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0

"""GreenVLA camera and vector mapping helpers."""

from __future__ import annotations

from typing import Dict, Iterable

import numpy as np


IMAGE_KEY_PREFIX = "observation.images."
DEFAULT_CYCLO_VECTOR_DIM = 22
DEFAULT_GREEN_VLA_VECTOR_DIM = 48

GREEN_VLA_CAMERA_ALIASES = {
    "base_0_rgb": {
        "base_0_rgb",
        "cam_head_left",
        "cam_left_head",
        "rgb.cam_head_left",
        "rgb.cam_left_head",
    },
    "left_wrist_0_rgb": {
        "left_wrist_0_rgb",
        "cam_wrist_left",
        "cam_left_wrist",
        "rgb.cam_wrist_left",
        "rgb.cam_left_wrist",
    },
    "right_wrist_0_rgb": {
        "right_wrist_0_rgb",
        "cam_wrist_right",
        "cam_right_wrist",
        "rgb.cam_wrist_right",
        "rgb.cam_right_wrist",
    },
}


def resolve_camera_mappings(
    robot_camera_names: Iterable[str],
    policy_image_keys: Iterable[str],
) -> Dict[str, str]:
    """Map RobotClient camera names to GreenVLA policy image keys.

    GreenVLA checkpoints commonly expect ``base_0_rgb``,
    ``left_wrist_0_rgb``, and ``right_wrist_0_rgb`` image inputs. Cyclo
    hardware exposes canonical camera names such as ``cam_head_left`` and
    ``cam_wrist_left``. This helper keeps the backend-specific aliasing out of
    the common runtime.
    """

    camera_names = list(robot_camera_names)
    policy_keys = set(policy_image_keys)
    if not policy_keys:
        return {cam: f"{IMAGE_KEY_PREFIX}{cam}" for cam in camera_names}

    active: Dict[str, str] = {}
    used_policy_keys = set()
    for cam in camera_names:
        candidates = _camera_policy_key_candidates(cam)
        matches = sorted(policy_keys & candidates)
        if not matches:
            continue
        if len(matches) > 1:
            exact = f"{IMAGE_KEY_PREFIX}{cam}"
            if exact in matches:
                chosen = exact
            else:
                raise RuntimeError(
                    f"Ambiguous camera mapping for {cam}: matches {matches}"
                )
        else:
            chosen = matches[0]

        if chosen in used_policy_keys:
            raise RuntimeError(
                f"Policy camera key {chosen} matched multiple robot cameras"
            )
        active[cam] = chosen
        used_policy_keys.add(chosen)

    missing = sorted(policy_keys - used_policy_keys)
    if missing:
        raise RuntimeError(
            "Missing camera mappings for policy input keys: "
            f"{missing}; robot has {camera_names}; matched {active}"
        )
    return active


def pad_state_to_model_dim(
    state: np.ndarray,
    model_dim: int = DEFAULT_GREEN_VLA_VECTOR_DIM,
) -> np.ndarray:
    """Pad a Cyclo state vector to GreenVLA's unified vector dimension."""

    arr = np.asarray(state)
    if arr.shape[-1] > model_dim:
        raise ValueError(
            f"state dim {arr.shape[-1]} exceeds GreenVLA model dim {model_dim}"
        )
    pad_width = [(0, 0)] * arr.ndim
    pad_width[-1] = (0, model_dim - arr.shape[-1])
    return np.pad(arr, pad_width, mode="constant")


def slice_action_to_robot_dim(
    action: np.ndarray,
    robot_dim: int = DEFAULT_CYCLO_VECTOR_DIM,
) -> np.ndarray:
    """Slice GreenVLA action output back to Cyclo's robot command dimension."""

    arr = np.asarray(action)
    if arr.shape[-1] < robot_dim:
        raise ValueError(
            f"action dim {arr.shape[-1]} is smaller than robot dim {robot_dim}"
        )
    return arr[..., :robot_dim]


def _camera_policy_key_candidates(camera_name: str) -> set[str]:
    aliases = {camera_name, _strip_rgb_prefix(camera_name)}
    for green_vla_name, cyclo_names in GREEN_VLA_CAMERA_ALIASES.items():
        if aliases & cyclo_names:
            aliases.add(green_vla_name)
    return {f"{IMAGE_KEY_PREFIX}{name}" for name in aliases}


def _strip_rgb_prefix(camera_name: str) -> str:
    return camera_name[4:] if camera_name.startswith("rgb.") else camera_name
