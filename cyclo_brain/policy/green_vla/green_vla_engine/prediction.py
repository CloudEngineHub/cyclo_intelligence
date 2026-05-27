#!/usr/bin/env python3
#
# Copyright 2026 ROBOTIS CO., LTD.
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0

"""GreenVLA action prediction."""

from __future__ import annotations

import logging
from typing import Any, Dict

import numpy as np

from .io_mapping import slice_action_to_robot_dim


logger = logging.getLogger("green_vla_engine")


class PredictionMixin:
    """Run GreenVLA policy inference and return Cyclo action chunks."""

    def _predict_action_chunk(self, observation: Any) -> Dict[str, Any]:
        import torch

        assert self._policy is not None
        assert self._device is not None

        with torch.inference_mode():
            action = self._policy.select_action(observation)
        if getattr(self._device, "type", "") == "cuda":
            torch.cuda.synchronize()

        chunk = self._to_numpy_chunk(action)
        if self._normalization is not None:
            chunk = self._normalization.unnormalize_actions(chunk)
        robot_dim = int(self._robot_action_dim or chunk.shape[-1])
        chunk = slice_action_to_robot_dim(chunk, robot_dim)

        if not np.isfinite(chunk).all():
            nan_count = int(np.isnan(chunk).sum())
            inf_count = int(np.isinf(chunk).sum())
            return self._fail(
                f"GreenVLA produced non-finite action values: "
                f"nan={nan_count}, inf={inf_count}"
            )

        chunk = np.ascontiguousarray(chunk, dtype=np.float64)
        steps, dim = chunk.shape
        logger.info("Action chunk: T=%d, D=%d", steps, dim)
        return {
            "success": True,
            "action_chunk": chunk.reshape(-1),
            "chunk_size": int(steps),
            "action_dim": int(dim),
        }

    @staticmethod
    def _to_numpy_chunk(action: Any) -> np.ndarray:
        import torch

        if isinstance(action, torch.Tensor):
            chunk = action.detach().cpu()
            if chunk.dim() == 3:
                chunk = chunk[0]
            elif chunk.dim() == 2:
                pass
            elif chunk.dim() == 1:
                chunk = chunk.unsqueeze(0)
            else:
                raise ValueError(
                    f"Unexpected action tensor shape: {tuple(chunk.shape)}"
                )
            return chunk.to(torch.float32).numpy()

        chunk = np.asarray(action, dtype=np.float32)
        if chunk.ndim == 3:
            chunk = chunk[0]
        elif chunk.ndim == 1:
            chunk = chunk.reshape(1, -1)
        elif chunk.ndim != 2:
            raise ValueError(f"Unexpected action array shape: {chunk.shape}")
        return chunk
