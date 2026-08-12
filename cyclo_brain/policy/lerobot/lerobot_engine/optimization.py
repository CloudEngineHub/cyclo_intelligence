#!/usr/bin/env python3
#
# Copyright 2026 ROBOTIS CO., LTD.
#
# Licensed under the Apache License, Version 2.0

"""LeRobot optional policy optimization hook.

LeRobot currently runs through its native PyTorch policy path. This mixin exists
so optional runtime optimization (TensorRT, ONNX Runtime, torch.compile, etc.)
has a clear class boundary without changing the engine lifecycle.
"""

from __future__ import annotations

import logging
from typing import Any

import torch


logger = logging.getLogger("lerobot_engine")


class OptimizationMixin:
    """Optional policy optimization extension point."""

    def _apply_policy_optimization(self, model_path: str, request: Any) -> None:
        """Attach optional optimizers after policy load.

        No-op except for FastWAM, which needs CPU offload to fit on a 24GB GPU.
        """
        if getattr(getattr(self._policy, "config", None), "type", "") == "fastwam":
            self._offload_fastwam(request)
            return
        logger.debug("No LeRobot optimizer configured for %s", model_path)

    def _offload_fastwam(self, request: Any) -> None:
        """Keep FastWAM's ~11GB text encoder on the CPU so the rest fits on a 24GB GPU.

        The encoder only turns the instruction into a context, and the instruction is
        fixed for a session, so encode it once and hand the result to every predict call.
        """
        policy = self._policy
        model = policy.model
        cfg = policy.config
        device = self._device

        task = str(getattr(request, "task_instruction", "") or "").strip()
        if not task:
            raise RuntimeError(
                "FastWAM needs the task instruction at load time: the text encoder "
                "moves to the CPU afterwards and cannot encode a new prompt."
            )

        # Encode while everything is still on the CPU.
        template = getattr(cfg, "prompt_template", None)
        prompt = template.format(task=task) if template else task
        context, context_mask = model.encode_prompt([prompt])
        context, context_mask = context.detach(), context_mask.detach()

        # Everything except the text encoder goes to the GPU.
        for name, child in model.named_children():
            if name != "text_encoder":
                child.to(device)
        if hasattr(model, "vae"):
            model.vae.to(device)
        model.device = torch.device(device)
        cfg.device = str(device)
        context, context_mask = context.to(device), context_mask.to(device)
        if torch.cuda.is_available():
            torch.cuda.empty_cache()
            logger.info(
                "FastWAM offload done, VRAM %.1f GB, text encoder on CPU",
                torch.cuda.memory_allocated() / 1e9,
            )

        proprio_dim = getattr(cfg, "proprio_dim", None)
        real_predict = policy.predict_action_chunk

        def predict(batch, *args, **kwargs):
            b = dict(batch)
            b.pop("task", None)
            b.pop("prompt", None)
            b["context"], b["context_mask"] = context, context_mask
            state = b.get("proprio", b.get("observation.state"))
            if state is not None and proprio_dim is not None:
                if state.ndim == 1:
                    state = state.unsqueeze(0)
                dim = state.shape[-1]
                if dim < proprio_dim:
                    pad = torch.zeros(
                        *state.shape[:-1], proprio_dim - dim,
                        dtype=state.dtype, device=state.device,
                    )
                    state = torch.cat([state, pad], dim=-1)
                elif dim > proprio_dim:
                    state = state[..., :proprio_dim]
                b["proprio"] = state
            return real_predict(b, *args, **kwargs)

        policy.predict_action_chunk = predict
