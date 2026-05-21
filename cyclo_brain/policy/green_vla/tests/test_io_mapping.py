#!/usr/bin/env python3

import importlib.util
import sys
import types
import unittest
from pathlib import Path

import numpy as np


ENGINE_DIR = Path(__file__).resolve().parents[1] / "green_vla_engine"
package = types.ModuleType("green_vla_engine")
package.__path__ = [str(ENGINE_DIR)]
sys.modules.setdefault("green_vla_engine", package)

spec = importlib.util.spec_from_file_location(
    "green_vla_engine.io_mapping",
    ENGINE_DIR / "io_mapping.py",
)
io_mapping = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = io_mapping
spec.loader.exec_module(io_mapping)


class GreenVLACameraMappingTest(unittest.TestCase):
    def test_maps_cyclo_cameras_to_green_vla_policy_keys(self):
        robot_cameras = [
            "cam_head_left",
            "cam_head_right",
            "cam_wrist_left",
            "cam_wrist_right",
        ]
        policy_keys = {
            "observation.images.base_0_rgb",
            "observation.images.left_wrist_0_rgb",
            "observation.images.right_wrist_0_rgb",
        }

        self.assertEqual(
            io_mapping.resolve_camera_mappings(robot_cameras, policy_keys),
            {
                "cam_head_left": "observation.images.base_0_rgb",
                "cam_wrist_left": "observation.images.left_wrist_0_rgb",
                "cam_wrist_right": "observation.images.right_wrist_0_rgb",
            },
        )

    def test_accepts_rgb_prefixed_legacy_cyclo_camera_names(self):
        robot_cameras = [
            "rgb.cam_left_head",
            "rgb.cam_left_wrist",
            "rgb.cam_right_wrist",
        ]
        policy_keys = {
            "observation.images.base_0_rgb",
            "observation.images.left_wrist_0_rgb",
            "observation.images.right_wrist_0_rgb",
        }

        self.assertEqual(
            io_mapping.resolve_camera_mappings(robot_cameras, policy_keys),
            {
                "rgb.cam_left_head": "observation.images.base_0_rgb",
                "rgb.cam_left_wrist": "observation.images.left_wrist_0_rgb",
                "rgb.cam_right_wrist": "observation.images.right_wrist_0_rgb",
            },
        )

    def test_missing_required_policy_camera_raises_clear_error(self):
        with self.assertRaisesRegex(RuntimeError, "Missing camera mappings"):
            io_mapping.resolve_camera_mappings(
                ["cam_head_left", "cam_wrist_left"],
                {
                    "observation.images.base_0_rgb",
                    "observation.images.left_wrist_0_rgb",
                    "observation.images.right_wrist_0_rgb",
                },
            )


class GreenVLAStateActionShapeTest(unittest.TestCase):
    def test_pads_cyclo_state_to_green_vla_model_dim(self):
        state = np.arange(22, dtype=np.float32)

        padded = io_mapping.pad_state_to_model_dim(state)

        self.assertEqual(padded.shape, (48,))
        np.testing.assert_array_equal(padded[:22], state)
        np.testing.assert_array_equal(padded[22:], np.zeros(26, dtype=np.float32))

    def test_slices_green_vla_action_chunk_to_cyclo_robot_dim(self):
        action = np.arange(2 * 48, dtype=np.float32).reshape(2, 48)

        sliced = io_mapping.slice_action_to_robot_dim(action)

        self.assertEqual(sliced.shape, (2, 22))
        np.testing.assert_array_equal(sliced, action[:, :22])


if __name__ == "__main__":
    unittest.main()
