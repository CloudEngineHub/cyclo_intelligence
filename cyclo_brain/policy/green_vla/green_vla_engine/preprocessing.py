#!/usr/bin/env python3
#
# Copyright 2026 ROBOTIS CO., LTD.
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0

"""GreenVLA observation preprocessing."""

from __future__ import annotations

from typing import Any

import numpy as np

from .io_mapping import IMAGE_KEY_PREFIX, pad_state_to_model_dim


class PreprocessingMixin:
    """Build GreenVLA model observations from RobotClient data."""

    def _build_observation(self, task_instruction: Any) -> dict:
        """Read RobotClient data and build a GreenVLA ``select_action`` batch."""

        import torch

        assert self._robot is not None
        assert self._policy is not None
        assert self._tokenizer is not None
        assert self._device is not None

        images = self._robot.get_images(format="rgb")
        if not images:
            return self._fail("No camera frames available")

        joint_dict = self._robot.get_joint_positions()
        if not joint_dict:
            return self._fail("No joint positions available")

        image_tensors = {}
        image_masks = {}
        tokenizer_image_mask = {}
        for camera_name, policy_key in self._cameras.items():
            image = images.get(camera_name)
            if image is None:
                return self._fail(f"Missing camera frame: {camera_name}")
            image = self._resize_image_for_policy(image)

            green_vla_key = self._strip_image_key_prefix(policy_key)
            tensor = torch.from_numpy(image.copy()).to(
                device=self._device,
                dtype=torch.float32,
            )
            tensor = tensor.permute(2, 0, 1).contiguous().unsqueeze(0) / 255.0
            image_tensors[green_vla_key] = tensor
            image_masks[green_vla_key] = torch.ones(
                (1,),
                dtype=torch.bool,
                device=self._device,
            )
            tokenizer_image_mask[green_vla_key] = True

        state_parts: list[np.ndarray] = []
        for modality in self._state_modalities:
            if modality == "mobile":
                odom = self._robot.get_odom()
                if odom is None:
                    return self._fail("Missing odom for mobile state")
                state_parts.append(
                    np.array(
                        [
                            float(odom["linear_velocity"][0]),
                            float(odom["linear_velocity"][1]),
                            float(odom["angular_velocity"][2]),
                        ],
                        dtype=np.float32,
                    )
                )
                continue

            group = f"follower_{modality}"
            positions = joint_dict.get(group)
            if positions is None or len(positions) == 0:
                return self._fail(f"Missing joint group: {modality}")
            state_parts.append(np.asarray(positions, dtype=np.float32))

        flat_state = np.concatenate(state_parts).astype(np.float32, copy=False)
        model_state_dim = int(self._policy.config.max_state_dim)
        padded_state = pad_state_to_model_dim(flat_state, model_state_dim).astype(
            np.float32,
            copy=False,
        )
        if self._normalization is not None:
            padded_state = self._normalization.normalize_state(padded_state)
        state = torch.from_numpy(padded_state).to(self._device).unsqueeze(0)

        tokenized = self._tokenizer.tokenize(
            prompt=str(task_instruction or ""),
            state=state.detach().cpu().numpy()[0],
            image_mask=tokenizer_image_mask,
        )

        batch = {
            "image": image_tensors,
            "image_mask": image_masks,
            "state": state,
        }
        batch.update(
            {
                key: value.unsqueeze(0).to(self._device)
                for key, value in tokenized.items()
            }
        )
        return batch

    @staticmethod
    def _strip_image_key_prefix(policy_key: str) -> str:
        if policy_key.startswith(IMAGE_KEY_PREFIX):
            return policy_key[len(IMAGE_KEY_PREFIX):]
        return policy_key

    def _resize_image_for_policy(self, image: np.ndarray) -> np.ndarray:
        if self._image_resize is None:
            return np.asarray(image)

        width, height = self._image_resize
        from lerobot.common.utils.image_tools import resize_without_pad

        return resize_without_pad(np.asarray(image), height, width)
