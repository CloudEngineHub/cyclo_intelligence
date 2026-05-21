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
        self._processor = None
        self._robot = None
        self._loaded_model_path: Optional[str] = None
        self._action_keys = []

    @property
    def is_ready(self) -> bool:
        return self._policy is not None and self._robot is not None

    def load_policy(self, request: Any) -> Dict[str, Any]:
        try:
            return self._load_policy_not_implemented(request)
        except Exception as e:
            logger.error("load_policy failed: %s", e, exc_info=True)
            self.cleanup()
            return self._fail(str(e))

    def get_action_chunk(self, request: Any) -> Dict[str, Any]:
        if not self.is_ready:
            return self._fail("Not in inference mode")
        try:
            observation = self._build_observation(request)
            return self._predict_action_chunk(observation)
        except Exception as e:
            logger.error("get_action_chunk failed: %s", e, exc_info=True)
            return self._fail(str(e))

    def cleanup(self) -> None:
        if self._robot is not None:
            try:
                self._robot.close()
            except Exception:
                pass

        self._policy = None
        self._processor = None
        self._robot = None
        self._loaded_model_path = None
        self._action_keys = []
        gc.collect()

    @staticmethod
    def _fail(message: str) -> Dict[str, Any]:
        return {"success": False, "message": message}


def create_engine() -> GreenVLAEngine:
    """Factory used by the common Engine process."""

    return GreenVLAEngine()

