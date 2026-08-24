#!/usr/bin/env python3

from __future__ import annotations

import sys
import threading
import time
import types
import unittest
from types import SimpleNamespace


_MODULE_BACKUPS = {}


def _install_module_stub(name: str, **attributes) -> None:
    _MODULE_BACKUPS[name] = sys.modules.get(name)
    module = types.ModuleType(name)
    for key, value in attributes.items():
        setattr(module, key, value)
    sys.modules.setdefault(name, module)


class _Stub:
    pass


_install_module_stub("cyclo_data.recorder.session_manager", DataManager=_Stub)
_install_module_stub("cyclo_data.hub.endpoint_store", HFEndpointStore=_Stub)
_install_module_stub("cyclo_data.recorder.replay_handler", ReplayDataHandler=_Stub)
_install_module_stub(
    "cyclo_data.visualization.video_file_server",
    VideoFileServer=_Stub,
)

from interfaces.msg import InferenceStatus, TaskInfo  # noqa: E402
from orchestrator.orchestrator_node import OrchestratorNode  # noqa: E402

for _module_name, _previous_module in _MODULE_BACKUPS.items():
    if _previous_module is None:
        sys.modules.pop(_module_name, None)
    else:
        sys.modules[_module_name] = _previous_module


class FakeCommunicator:
    def __init__(self) -> None:
        self.phases = []
        self.inferencing = threading.Event()

    def publish_inference_status(self, *, phase, robot_type, error) -> None:
        self.phases.append((phase, robot_type, error))
        if phase == InferenceStatus.INFERENCING:
            self.inferencing.set()


class InitialPoseSyncOrchestratorTest(unittest.TestCase):
    def setUp(self) -> None:
        self.client = object()
        self.node = OrchestratorNode.__new__(OrchestratorNode)
        self.node._state_lock = threading.RLock()
        self.node.container_service_client = self.client
        self.node._initial_pose_sync_status_timer = None
        self.node._initial_pose_sync_status_generation = 0
        self.node.communicator = FakeCommunicator()
        self.node.robot_type = "ffw_sg2_rev1"

    def tearDown(self) -> None:
        self.node._cancel_initial_pose_sync_status()

    def test_task_info_settings_default_validate_and_copy(self) -> None:
        self.assertEqual(
            self.node._initial_pose_sync_from_task_info(SimpleNamespace()),
            (False, 5.0),
        )
        self.assertEqual(
            self.node._initial_pose_sync_from_task_info(
                SimpleNamespace(
                    initial_pose_sync=True,
                    initial_pose_sync_duration_s=7.5,
                )
            ),
            (True, 7.5),
        )
        with self.assertRaisesRegex(ValueError, "between 1.0 and 60.0"):
            self.node._initial_pose_sync_from_task_info(
                SimpleNamespace(
                    initial_pose_sync=True,
                    initial_pose_sync_duration_s=0.5,
                )
            )

        task_info = TaskInfo()
        task_info.initial_pose_sync = True
        task_info.initial_pose_sync_duration_s = 6.0
        copied = self.node._copy_task_info(task_info)
        self.assertTrue(copied.initial_pose_sync)
        self.assertEqual(copied.initial_pose_sync_duration_s, 6.0)

    def test_status_sequence_completes_for_the_active_client(self) -> None:
        self.node._publish_inference_phase(InferenceStatus.LOADING)
        self.node._begin_initial_pose_sync_status(self.client, 0.01)

        self.assertTrue(self.node.communicator.inferencing.wait(timeout=0.5))
        self.assertEqual(
            [phase for phase, _robot_type, _error in self.node.communicator.phases],
            [
                InferenceStatus.LOADING,
                InferenceStatus.SYNCING,
                InferenceStatus.INFERENCING,
            ],
        )

    def test_cancel_blocks_stale_completion(self) -> None:
        self.node._begin_initial_pose_sync_status(self.client, 0.02)
        self.node._cancel_initial_pose_sync_status()

        time.sleep(0.05)
        self.assertEqual(
            [phase for phase, _robot_type, _error in self.node.communicator.phases],
            [InferenceStatus.SYNCING],
        )

    def test_client_identity_blocks_stale_completion(self) -> None:
        self.node._begin_initial_pose_sync_status(self.client, 0.02)
        self.node.container_service_client = object()

        time.sleep(0.05)
        self.assertEqual(
            [phase for phase, _robot_type, _error in self.node.communicator.phases],
            [InferenceStatus.SYNCING],
        )


if __name__ == "__main__":
    unittest.main()
