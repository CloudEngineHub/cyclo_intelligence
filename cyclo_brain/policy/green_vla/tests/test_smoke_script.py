#!/usr/bin/env python3

import importlib.util
import unittest
from pathlib import Path


SCRIPT_PATH = (
    Path(__file__).resolve().parents[1]
    / "scripts"
    / "smoke_green_vla_load.py"
)


class GreenVLASmokeScriptTest(unittest.TestCase):
    def test_script_exposes_parser_without_loading_model_dependencies(self):
        spec = importlib.util.spec_from_file_location("smoke_green_vla_load", SCRIPT_PATH)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)

        parser = module.build_arg_parser()
        args = parser.parse_args([])

        self.assertEqual(args.model, "SberRoboticsCenter/GreenVLA-2b-base")
        self.assertEqual(args.device, "cpu")


if __name__ == "__main__":
    unittest.main()
