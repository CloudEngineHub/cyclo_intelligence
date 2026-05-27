#!/usr/bin/env python3
#
# Copyright 2026 ROBOTIS CO., LTD.
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0

"""GreenVLA policy loading and RobotClient wiring helpers."""

from __future__ import annotations

import json
import logging
import os
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import numpy as np

from .io_mapping import IMAGE_KEY_PREFIX, resolve_camera_mappings


logger = logging.getLogger("green_vla_engine")


_ROBOT_CLIENT_PATH = os.environ.get("ROBOT_CLIENT_SDK_PATH", "/robot_client_sdk")
if os.path.exists(_ROBOT_CLIENT_PATH) and _ROBOT_CLIENT_PATH not in sys.path:
    sys.path.insert(0, _ROBOT_CLIENT_PATH)


@dataclass(frozen=True)
class GreenVLANormalization:
    """Apply GreenVLA dataset normalization around runtime inference."""

    mode: str | None = None
    state_stats: dict[str, np.ndarray] | None = None
    action_stats: dict[str, np.ndarray] | None = None

    @classmethod
    def identity(cls) -> "GreenVLANormalization":
        return cls()

    @property
    def enabled(self) -> bool:
        return self.state_stats is not None or self.action_stats is not None

    def normalize_state(self, state: np.ndarray) -> np.ndarray:
        return self._apply(state, self.state_stats, inverse=False)

    def unnormalize_actions(self, actions: np.ndarray) -> np.ndarray:
        return self._apply(actions, self.action_stats, inverse=True)

    def _apply(
        self,
        values: np.ndarray,
        stats: dict[str, np.ndarray] | None,
        *,
        inverse: bool,
    ) -> np.ndarray:
        if not stats:
            return np.asarray(values, dtype=np.float32)

        data = np.asarray(values, dtype=np.float32)
        mode = self.mode or "quantile"

        if mode == "quantile":
            low = stats["q01"].astype(data.dtype, copy=False)
            high = stats["q99"].astype(data.dtype, copy=False)
            if inverse:
                return (data + 1.0) / 2.0 * (high - low + 1e-6) + low
            return (data - low) / (high - low + 1e-6) * 2.0 - 1.0

        if mode == "mean_std":
            mean = stats["mean"].astype(data.dtype, copy=False)
            std = stats["std"].astype(data.dtype, copy=False)
            if inverse:
                return data * (std + 1e-6) + mean
            return (data - mean) / (std + 1e-6)

        if mode == "min_max":
            minimum = stats["min"].astype(data.dtype, copy=False)
            maximum = stats["max"].astype(data.dtype, copy=False)
            if inverse:
                return (data + 1.0) / 2.0 * (maximum - minimum + 1e-6) + minimum
            return (data - minimum) / (maximum - minimum + 1e-6) * 2.0 - 1.0

        logger.warning("Unknown GreenVLA normalization mode %r; using identity", mode)
        return data


class LoadingMixin:
    """Policy load helpers and robot I/O mapping."""

    @staticmethod
    def _load_policy_assets(
        model_path: str,
        device: Any,
        data_config_name: str | None = "cyclo",
    ) -> tuple[Any, GreenVLANormalization]:
        """Load a GreenVLA checkpoint through the upstream LeRobot factory."""

        from lerobot.common.policies.factory import load_pretrained_policy

        policy, _, _ = load_pretrained_policy(
            model_path,
            data_config_name=None,
            config_overrides={
                "device": str(device),
                "attention_implementation": "sdpa",
            },
        )
        policy.eval()
        LoadingMixin._validate_policy_config(policy.config)
        normalization = LoadingMixin._load_normalization(
            model_path,
            data_config_name,
            getattr(policy.config, "normalization_mode", None),
            state_dim=getattr(policy.config, "max_state_dim", None),
            action_dim=getattr(policy.config, "max_action_dim", None),
        )
        return policy, normalization

    @staticmethod
    def _load_normalization(
        model_path: str,
        data_config_name: str | None,
        normalization_mode: str | None,
        *,
        state_dim: int | None = None,
        action_dim: int | None = None,
    ) -> GreenVLANormalization:
        if not data_config_name:
            logger.info("GreenVLA norm_stats disabled")
            return GreenVLANormalization.identity()

        try:
            payload = LoadingMixin._load_norm_stats_payload(
                model_path,
                data_config_name,
            )
        except Exception as e:
            if os.environ.get(
                "GREEN_VLA_ALLOW_MISSING_NORM_STATS",
                "",
            ).lower() in {"1", "true", "yes"}:
                logger.warning(
                    "GreenVLA norm_stats unavailable for %s/%s: %s; "
                    "continuing without dataset normalization",
                    model_path,
                    data_config_name,
                    e,
                )
                return GreenVLANormalization.identity()
            raise RuntimeError(
                "GreenVLA norm_stats are required for robot inference. "
                f"Expected norm_stats/{data_config_name}/norm_stats.json in "
                f"{model_path}. Set GREEN_VLA_DISABLE_NORMALIZATION=1 only for "
                "non-actuating load smoke tests."
            ) from e

        stats = payload.get("norm_stats", payload)
        state_stats = LoadingMixin._coerce_norm_entry(stats.get("state"))
        action_stats = LoadingMixin._coerce_norm_entry(
            stats.get("actions") or stats.get("action")
        )
        mode = normalization_mode or "quantile"
        LoadingMixin._validate_norm_stats(
            state_stats,
            action_stats,
            mode,
            state_dim=state_dim,
            action_dim=action_dim,
        )
        normalization = GreenVLANormalization(
            mode=mode,
            state_stats=state_stats,
            action_stats=action_stats,
        )
        logger.info(
            "Loaded GreenVLA norm_stats: data_config=%s mode=%s state=%s actions=%s",
            data_config_name,
            mode,
            bool(state_stats),
            bool(action_stats),
        )
        return normalization

    @staticmethod
    def _load_norm_stats_payload(model_path: str, data_config_name: str) -> dict:
        subpath = f"norm_stats/{data_config_name}/norm_stats.json"
        if Path(model_path).is_dir():
            stats_path = Path(model_path) / subpath
            with stats_path.open("r", encoding="utf-8") as f:
                return json.load(f)

        from huggingface_hub import hf_hub_download

        stats_path = hf_hub_download(model_path, subpath)
        with open(stats_path, "r", encoding="utf-8") as f:
            return json.load(f)

    @staticmethod
    def _coerce_norm_entry(entry: dict | None) -> dict[str, np.ndarray] | None:
        if not entry:
            return None
        return {
            key: np.asarray(value, dtype=np.float32)
            for key, value in entry.items()
            if value is not None
        }

    @staticmethod
    def _validate_norm_stats(
        state_stats: dict[str, np.ndarray] | None,
        action_stats: dict[str, np.ndarray] | None,
        mode: str,
        *,
        state_dim: int | None = None,
        action_dim: int | None = None,
    ) -> None:
        required_by_mode = {
            "quantile": ("q01", "q99"),
            "mean_std": ("mean", "std"),
            "min_max": ("min", "max"),
        }
        if mode not in required_by_mode:
            raise RuntimeError(f"Unsupported GreenVLA normalization mode: {mode}")
        if not state_stats or not action_stats:
            raise RuntimeError(
                "GreenVLA norm_stats must include both state and action entries "
                "for robot inference"
            )

        required = required_by_mode[mode]
        for name, stats, expected_dim in (
            ("state", state_stats, state_dim),
            ("action", action_stats, action_dim),
        ):
            missing = [key for key in required if key not in stats]
            if missing:
                raise RuntimeError(
                    f"GreenVLA {mode} norm_stats for {name} must include "
                    f"{', '.join(required)}; missing {missing}"
                )

            shapes = {key: np.asarray(stats[key]).shape for key in required}
            if len(set(shapes.values())) != 1:
                raise RuntimeError(
                    f"GreenVLA norm_stats for {name} have inconsistent shapes: "
                    f"{shapes}"
                )

            if expected_dim is not None:
                actual_shape = next(iter(shapes.values()))
                actual_dim = actual_shape[-1] if actual_shape else 1
                if int(actual_dim) != int(expected_dim):
                    raise RuntimeError(
                        f"GreenVLA norm_stats dimension mismatch for {name}: "
                        f"expected {expected_dim}, got {actual_dim}"
                    )

    @staticmethod
    def _validate_policy_config(config: Any) -> None:
        model_mode = getattr(config, "model_mode", None)
        inference_mode = getattr(config, "inference_mode", None)
        uses_flow_matching = model_mode == "flow_matching" or (
            model_mode == "mixed" and inference_mode == "flow_matching"
        )
        if not uses_flow_matching:
            raise RuntimeError(
                "Cyclo GreenVLA runtime currently supports flow_matching inference "
                "only. token_prediction models require upstream action-token decode "
                "through ExtractGreenVLAActionsTorch."
            )

        if bool(getattr(config, "map_to_unified_space", False)):
            raise RuntimeError(
                "Cyclo GreenVLA runtime does not support upstream unified-space "
                "mapping yet. Train or export the Cyclo checkpoint with "
                "map_to_unified_space=false."
            )

    @staticmethod
    def _build_tokenizer(config: Any, embodiment_name: str) -> Any:
        """Build the GreenVLA prompt/state tokenizer for runtime inference."""

        from lerobot.common.policies.greenvla_policy.greenvla_tokenizer import (
            GreenVLATokenizer,
        )

        return GreenVLATokenizer(
            max_len=config.tokenizer_max_length,
            state_dim=config.max_state_dim,
            control_mode=os.environ.get("GREEN_VLA_CONTROL_MODE", "joint_position"),
            embodiment_name=embodiment_name,
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

    def _init_robot(self, robot_type: str) -> None:
        """Create RobotClient and resolve cameras/state/actions."""

        from robot_client import RobotClient

        self._init_robot_from_client(RobotClient(robot_type))

    def _init_robot_from_client(self, robot: Any) -> None:
        """Attach an already-created RobotClient-like object.

        Tests use this hook with a fake robot; production uses ``_init_robot``.
        """

        self._robot = robot

        policy_image_keys = self._policy_image_keys(self._policy)
        active = resolve_camera_mappings(robot.camera_names, policy_image_keys)
        if not active and policy_image_keys:
            raise RuntimeError(
                "No cameras match GreenVLA policy inputs: "
                f"policy needs {sorted(policy_image_keys)}, robot has "
                f"{robot.camera_names}"
            )
        self._cameras = active

        groups = robot._config.get("joint_groups", {})
        parents = {cfg.get("parent") for cfg in groups.values() if cfg.get("parent")}
        modality_groups = []
        for name, cfg in groups.items():
            if cfg.get("role") != "follower" or not name.startswith("follower_"):
                continue
            if cfg.get("parent"):
                modality_groups.append(name)
            elif name not in parents:
                modality_groups.append(name)

        modalities = sorted(name[len("follower_"):] for name in modality_groups)
        if not modalities:
            raise RuntimeError("No follower joint groups are available for GreenVLA")

        sensors = robot._config.get("sensors", {})
        self._has_mobile_state = "odom" in sensors
        if self._has_mobile_state:
            modalities = sorted(set(modalities) | {"mobile"})
        self._state_modalities = modalities

        self._action_keys = list(getattr(robot, "action_keys", []) or modalities)
        self._robot_action_dim = self._compute_robot_action_dim(robot, self._action_keys)

        robot.wait_for_ready(timeout=10.0)
        logger.info(
            "Robot ready: cameras=%s state_modalities=%s action_keys=%s action_dim=%d",
            list(self._cameras.keys()),
            self._state_modalities,
            self._action_keys,
            self._robot_action_dim,
        )

    @staticmethod
    def _policy_image_keys(policy: Any) -> set[str]:
        config = getattr(policy, "config", None)
        image_keys = list(getattr(config, "image_keys", []) or [])
        return {f"{IMAGE_KEY_PREFIX}{key}" for key in image_keys}

    @staticmethod
    def _infer_image_resize(policy: Any) -> tuple[int, int] | None:
        """Return RobotClient resize tuple as ``(width, height)``."""

        shape = getattr(getattr(policy, "config", None), "image_shape", None)
        if shape and len(shape) == 2:
            height, width = shape
            return (int(width), int(height))
        return None

    @staticmethod
    def _compute_robot_action_dim(robot: Any, action_keys: list[str]) -> int:
        action_groups = getattr(robot, "_action_groups", {}) or {}
        total = 0
        for action_key in action_keys:
            cfg = action_groups.get(action_key, {})
            msg_type = cfg.get("msg_type")
            if msg_type == "geometry_msgs/msg/Twist":
                total += 3
            else:
                total += len(cfg.get("joint_names", []))
        return total
