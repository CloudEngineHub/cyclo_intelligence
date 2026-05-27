#!/usr/bin/env python3
#
# Copyright 2026 ROBOTIS CO., LTD.
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0

"""Runtime pipeline tests for the GreenVLA engine."""

from __future__ import annotations

import json
import sys
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace

import numpy as np

try:
    import torch
except ImportError:  # pragma: no cover - local hosts may not ship torch.
    torch = None


ENGINE_ROOT = Path(__file__).resolve().parents[1]
POLICY_ROOT = ENGINE_ROOT.parent
RUNTIME_ROOT = POLICY_ROOT / "common" / "runtime"

for path in (ENGINE_ROOT, RUNTIME_ROOT):
    if str(path) not in sys.path:
        sys.path.insert(0, str(path))

from green_vla_engine import GreenVLAEngine  # noqa: E402
from green_vla_engine.loading import LoadingMixin  # noqa: E402


class FakeTokenizer:
    def tokenize(self, prompt, state, image_mask):
        assert prompt == "pick"
        assert state.shape == (48,)
        assert image_mask == {
            "base_0_rgb": True,
            "left_wrist_0_rgb": True,
            "right_wrist_0_rgb": True,
        }
        return {
            "input_ids": torch.ones(4, dtype=torch.long),
            "attention_mask": torch.ones(4, dtype=torch.long),
        }


class FakePolicy:
    def __init__(self):
        self.config = SimpleNamespace(
            image_keys=["base_0_rgb", "left_wrist_0_rgb", "right_wrist_0_rgb"],
            image_shape=(448, 448),
            max_state_dim=48,
            max_action_dim=48,
            n_action_steps=2,
        )
        self.received_batch = None

    def select_action(self, batch):
        self.received_batch = batch
        return torch.arange(1 * 2 * 48, dtype=torch.float32).reshape(1, 2, 48)


class FakeNormalization:
    def normalize_state(self, state):
        return state + 100.0

    def unnormalize_actions(self, actions):
        return actions + 1000.0


class FakeRobot:
    camera_names = [
        "cam_head_left",
        "cam_head_right",
        "cam_wrist_left",
        "cam_wrist_right",
    ]
    action_keys = ["arm_left", "arm_right", "head", "lift", "mobile"]

    def __init__(self):
        self._config = {
            "joint_groups": {
                "follower_upper_body": {
                    "role": "follower",
                    "joint_names": [
                        "arm_l_joint1",
                        "arm_l_joint2",
                        "arm_l_joint3",
                        "arm_l_joint4",
                        "arm_l_joint5",
                        "arm_l_joint6",
                        "arm_l_joint7",
                        "gripper_l_joint1",
                        "arm_r_joint1",
                        "arm_r_joint2",
                        "arm_r_joint3",
                        "arm_r_joint4",
                        "arm_r_joint5",
                        "arm_r_joint6",
                        "arm_r_joint7",
                        "gripper_r_joint1",
                        "head_joint1",
                        "head_joint2",
                        "lift_joint",
                    ],
                },
                "follower_arm_left": {
                    "role": "follower",
                    "parent": "follower_upper_body",
                    "joint_names": ["arm_l_joint1"] * 8,
                },
                "follower_arm_right": {
                    "role": "follower",
                    "parent": "follower_upper_body",
                    "joint_names": ["arm_r_joint1"] * 8,
                },
                "follower_head": {
                    "role": "follower",
                    "parent": "follower_upper_body",
                    "joint_names": ["head_joint1"] * 2,
                },
                "follower_lift": {
                    "role": "follower",
                    "parent": "follower_upper_body",
                    "joint_names": ["lift_joint"],
                },
            },
            "sensors": {"odom": {"topic": "/odom"}},
        }
        self._action_groups = {
            "arm_left": {
                "msg_type": "trajectory_msgs/msg/JointTrajectory",
                "joint_names": ["arm_l_joint1"] * 8,
            },
            "arm_right": {
                "msg_type": "trajectory_msgs/msg/JointTrajectory",
                "joint_names": ["arm_r_joint1"] * 8,
            },
            "head": {
                "msg_type": "trajectory_msgs/msg/JointTrajectory",
                "joint_names": ["head_joint1"] * 2,
            },
            "lift": {
                "msg_type": "trajectory_msgs/msg/JointTrajectory",
                "joint_names": ["lift_joint"],
            },
            "mobile": {
                "msg_type": "geometry_msgs/msg/Twist",
                "joint_names": ["linear_x", "linear_y", "angular_z"],
            },
        }
        self.closed = False

    def wait_for_ready(self, timeout):
        self.ready_timeout = timeout

    def get_images(self, resize=None, format="bgr"):
        assert resize is None
        assert format == "rgb"
        return {
            "cam_head_left": np.full((64, 80, 3), 10, dtype=np.uint8),
            "cam_wrist_left": np.full((64, 80, 3), 20, dtype=np.uint8),
            "cam_wrist_right": np.full((64, 80, 3), 30, dtype=np.uint8),
        }

    def get_joint_positions(self):
        return {
            "follower_arm_left": np.arange(8, dtype=np.float32),
            "follower_arm_right": np.arange(8, 16, dtype=np.float32),
            "follower_head": np.arange(16, 18, dtype=np.float32),
            "follower_lift": np.array([18.0], dtype=np.float32),
        }

    def get_odom(self):
        return {
            "linear_velocity": np.array([19.0, 20.0, 0.0], dtype=np.float32),
            "angular_velocity": np.array([0.0, 0.0, 21.0], dtype=np.float32),
        }

    def close(self):
        self.closed = True


def _prepared_engine() -> GreenVLAEngine:
    engine = GreenVLAEngine()
    engine._policy = FakePolicy()
    engine._tokenizer = FakeTokenizer()
    engine._device = torch.device("cpu")
    engine._init_robot_from_client(FakeRobot())
    engine._image_resize = (448, 448)
    return engine


def _write_norm_stats(root: str, stats: dict) -> None:
    stats_dir = Path(root) / "norm_stats" / "cyclo"
    stats_dir.mkdir(parents=True, exist_ok=True)
    with (stats_dir / "norm_stats.json").open("w", encoding="utf-8") as f:
        json.dump({"norm_stats": stats}, f)


@unittest.skipIf(torch is None, "torch is required for GreenVLA runtime tests")
class GreenVLARuntimePipelineTest(unittest.TestCase):
    def test_init_robot_from_client_resolves_green_vla_runtime_contract(self):
        engine = _prepared_engine()

        self.assertTrue(engine.is_ready)
        self.assertEqual(engine._action_keys, ["arm_left", "arm_right", "head", "lift", "mobile"])
        self.assertEqual(engine._robot_action_dim, 22)
        self.assertEqual(engine._image_resize, (448, 448))
        self.assertEqual(
            engine._cameras,
            {
                "cam_head_left": "observation.images.base_0_rgb",
                "cam_wrist_left": "observation.images.left_wrist_0_rgb",
                "cam_wrist_right": "observation.images.right_wrist_0_rgb",
            },
        )

    def test_build_observation_resizes_images_and_pads_state_to_green_vla_dim(self):
        engine = _prepared_engine()

        batch = engine._build_observation("pick")

        self.assertEqual(set(batch["image"]), {"base_0_rgb", "left_wrist_0_rgb", "right_wrist_0_rgb"})
        self.assertEqual(batch["image"]["base_0_rgb"].shape, (1, 3, 448, 448))
        self.assertIs(batch["image_mask"]["left_wrist_0_rgb"].dtype, torch.bool)
        self.assertEqual(batch["state"].shape, (1, 48))
        np.testing.assert_array_equal(batch["state"][0, :22].numpy(), np.arange(22, dtype=np.float32))
        np.testing.assert_array_equal(batch["state"][0, 22:].numpy(), np.zeros(26, dtype=np.float32))
        self.assertEqual(batch["input_ids"].shape, (1, 4))

    def test_build_observation_applies_green_vla_state_normalization(self):
        engine = _prepared_engine()
        engine._normalization = FakeNormalization()

        batch = engine._build_observation("pick")

        np.testing.assert_array_equal(
            batch["state"][0, :22].numpy(),
            np.arange(22, dtype=np.float32) + 100.0,
        )

    def test_get_action_chunk_slices_green_vla_output_for_robot_publish_contract(self):
        engine = _prepared_engine()

        result = engine.get_action_chunk(SimpleNamespace(task_instruction="pick"))

        self.assertTrue(result["success"])
        self.assertEqual(result["chunk_size"], 2)
        self.assertEqual(result["action_dim"], 22)
        chunk = result["action_chunk"].reshape(2, 22)
        np.testing.assert_array_equal(
            chunk,
            np.arange(2 * 48, dtype=np.float32).reshape(2, 48)[:, :22],
        )
        self.assertEqual(result["action_chunk"].dtype, np.float64)

    def test_get_action_chunk_applies_green_vla_action_unnormalization(self):
        engine = _prepared_engine()
        engine._normalization = FakeNormalization()

        result = engine.get_action_chunk(SimpleNamespace(task_instruction="pick"))

        self.assertTrue(result["success"])
        chunk = result["action_chunk"].reshape(2, 22)
        np.testing.assert_array_equal(
            chunk,
            np.arange(2 * 48, dtype=np.float32).reshape(2, 48)[:, :22] + 1000.0,
        )

    def test_load_normalization_requires_state_and_action_stats(self):
        with tempfile.TemporaryDirectory() as tmp:
            _write_norm_stats(
                tmp,
                {
                    "state": {
                        "q01": [0.0] * 48,
                        "q99": [1.0] * 48,
                    },
                },
            )

            with self.assertRaisesRegex(RuntimeError, "state.*action"):
                LoadingMixin._load_normalization(tmp, "cyclo", "quantile")

    def test_load_normalization_rejects_incomplete_quantile_stats(self):
        with tempfile.TemporaryDirectory() as tmp:
            _write_norm_stats(
                tmp,
                {
                    "state": {
                        "q01": [0.0] * 48,
                        "q99": [1.0] * 48,
                    },
                    "actions": {
                        "q01": [0.0] * 48,
                    },
                },
            )

            with self.assertRaisesRegex(RuntimeError, "q01.*q99"):
                LoadingMixin._load_normalization(tmp, "cyclo", "quantile")

    def test_load_normalization_rejects_stats_dimension_mismatch(self):
        with tempfile.TemporaryDirectory() as tmp:
            _write_norm_stats(
                tmp,
                {
                    "state": {
                        "q01": [0.0] * 22,
                        "q99": [1.0] * 22,
                    },
                    "actions": {
                        "q01": [0.0] * 48,
                        "q99": [1.0] * 48,
                    },
                },
            )

            with self.assertRaisesRegex(RuntimeError, "dimension"):
                LoadingMixin._load_normalization(
                    tmp,
                    "cyclo",
                    "quantile",
                    state_dim=48,
                    action_dim=48,
                )

    def test_validate_policy_config_rejects_token_prediction_models(self):
        config = SimpleNamespace(
            model_mode="mixed",
            inference_mode="token_prediction",
            map_to_unified_space=False,
        )

        with self.assertRaisesRegex(RuntimeError, "flow_matching"):
            LoadingMixin._validate_policy_config(config)

    def test_validate_policy_config_rejects_unified_space_models(self):
        config = SimpleNamespace(
            model_mode="mixed",
            inference_mode="flow_matching",
            map_to_unified_space=True,
        )

        with self.assertRaisesRegex(RuntimeError, "unified"):
            LoadingMixin._validate_policy_config(config)


if __name__ == "__main__":
    unittest.main()
