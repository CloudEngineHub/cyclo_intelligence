#!/usr/bin/env python3

import sys
import unittest
from pathlib import Path
from types import SimpleNamespace


ENGINE_ROOT = Path(__file__).resolve().parents[1]
POLICY_ROOT = ENGINE_ROOT.parent
RUNTIME_ROOT = POLICY_ROOT / "common" / "runtime"

for path in (ENGINE_ROOT, RUNTIME_ROOT):
    if str(path) not in sys.path:
        sys.path.insert(0, str(path))

from engine import InferenceEngine  # noqa: E402
from green_vla_engine import GreenVLAEngine, create_engine  # noqa: E402


class GreenVLAEngineContractTest(unittest.TestCase):
    def test_create_engine_returns_inference_engine(self):
        engine = create_engine()

        self.assertIsInstance(engine, GreenVLAEngine)
        self.assertIsInstance(engine, InferenceEngine)

    def test_engine_is_not_ready_before_load(self):
        engine = create_engine()

        self.assertFalse(engine.is_ready)

    def test_get_action_chunk_fails_before_load(self):
        engine = create_engine()

        result = engine.get_action_chunk(SimpleNamespace(task_instruction="pick"))

        self.assertFalse(result["success"])
        self.assertEqual(result["message"], "Not in inference mode")

    def test_cleanup_is_idempotent(self):
        engine = create_engine()

        engine.cleanup()
        engine.cleanup()

        self.assertFalse(engine.is_ready)


if __name__ == "__main__":
    unittest.main()
