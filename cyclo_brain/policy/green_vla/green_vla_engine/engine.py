#!/usr/bin/env python3
#
# Copyright 2026 ROBOTIS CO., LTD.
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0

"""GreenVLA inference engine skeleton."""

from __future__ import annotations

import gc
import logging
import os
from typing import Any, Dict, Optional

from engine import InferenceEngine

from .loading import LoadingMixin
from .prediction import PredictionMixin
from .preprocessing import PreprocessingMixin


logger = logging.getLogger("green_vla_engine")


class GreenVLAEngine(
    LoadingMixin,
    PreprocessingMixin,
    PredictionMixin,
    InferenceEngine,
):
    """Wraps a GreenVLA policy behind the common Cyclo inference contract."""

    def __init__(self) -> None:
        self._policy = None
        self._normalization = None
        self._tokenizer = None
        self._robot = None
        self._device = None
        self._loaded_model_path: Optional[str] = None
        self._loaded_robot_type: Optional[str] = None
        self._embodiment_name = "cyclo"
        self._data_config_name = "cyclo"
        self._cameras: dict[str, str] = {}
        self._state_modalities: list[str] = []
        self._action_keys = []
        self._has_mobile_state = False
        self._robot_action_dim = 0
        self._image_resize: Optional[tuple[int, int]] = None

    @property
    def is_ready(self) -> bool:
        return (
            self._policy is not None
            and self._tokenizer is not None
            and self._robot is not None
            and self._device is not None
        )

    def load_policy(self, request: Any) -> Dict[str, Any]:
        model_path = str(getattr(request, "model_path", "") or "")
        robot_type = str(getattr(request, "robot_type", "") or "")
        self._embodiment_name = (
            str(getattr(request, "embodiment_tag", "") or "")
            or os.environ.get("GREEN_VLA_EMBODIMENT_NAME", "cyclo")
        )
        self._data_config_name = os.environ.get(
            "GREEN_VLA_DATA_CONFIG_NAME",
            "cyclo",
        )
        if os.environ.get("GREEN_VLA_DISABLE_NORMALIZATION", "").lower() in {
            "1",
            "true",
            "yes",
        }:
            self._data_config_name = ""

        try:
            if not model_path:
                return self._fail("model_path is required")
            if not robot_type:
                return self._fail("robot_type is required")

            cache_hit = (
                self._policy is not None
                and self._loaded_model_path == model_path
            )
            if cache_hit:
                logger.info("Reusing cached GreenVLA policy: %s", model_path)
                self._teardown_robot()
            else:
                logger.info("Loading GreenVLA policy from: %s", model_path)
                torch = self._import_torch()
                self._device = torch.device(
                    "cuda" if torch.cuda.is_available() else "cpu"
                )
                self._policy, self._normalization = self._load_policy_assets(
                    model_path,
                    self._device,
                    self._data_config_name,
                )
                self._tokenizer = self._build_tokenizer(
                    self._policy.config,
                    self._embodiment_name,
                )
                self._loaded_model_path = model_path

            self._init_robot(robot_type)
            self._loaded_robot_type = robot_type
            self._image_resize = self._infer_image_resize(self._policy)

            return {
                "success": True,
                "message": (
                    "GreenVLA inference restarted (policy cached)"
                    if cache_hit
                    else f"loaded {model_path}"
                ),
                "action_keys": list(self._action_keys),
            }
        except Exception as e:
            logger.error("load_policy failed: %s", e, exc_info=True)
            self.cleanup()
            return self._fail(str(e))

    def get_action_chunk(self, request: Any) -> Dict[str, Any]:
        if not self.is_ready:
            return self._fail("Not in inference mode")
        try:
            observation = self._build_observation(
                getattr(request, "task_instruction", "")
            )
            if "success" in observation:
                return observation
            return self._predict_action_chunk(observation)
        except Exception as e:
            logger.error("get_action_chunk failed: %s", e, exc_info=True)
            return self._fail(str(e))

    def cleanup(self) -> None:
        self._teardown_robot()

        had_policy = self._policy is not None
        self._policy = None
        self._normalization = None
        self._tokenizer = None
        self._robot = None
        self._device = None
        self._loaded_model_path = None
        self._loaded_robot_type = None
        self._embodiment_name = "cyclo"
        self._data_config_name = "cyclo"
        self._cameras = {}
        self._state_modalities = []
        self._action_keys = []
        self._has_mobile_state = False
        self._robot_action_dim = 0
        self._image_resize = None

        if had_policy:
            gc.collect()
            try:
                torch = self._import_torch()
                if torch.cuda.is_available():
                    torch.cuda.empty_cache()
                    torch.cuda.ipc_collect()
            except Exception:
                pass

    @staticmethod
    def _fail(message: str) -> Dict[str, Any]:
        return {"success": False, "message": message}

    @staticmethod
    def _import_torch():
        import torch

        return torch

    def _teardown_robot(self) -> None:
        if self._robot is not None:
            try:
                self._robot.close()
            except Exception:
                pass
            self._robot = None


def create_engine() -> GreenVLAEngine:
    """Factory used by the common Engine process."""

    return GreenVLAEngine()
