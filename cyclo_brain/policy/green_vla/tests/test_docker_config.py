#!/usr/bin/env python3

import re
import unittest
from pathlib import Path

import yaml


REPO_ROOT = Path(__file__).resolve().parents[4]
GREEN_VLA_ROOT = REPO_ROOT / "cyclo_brain" / "policy" / "green_vla"
COMPOSE_FILE = REPO_ROOT / "docker" / "docker-compose.yml"


class GreenVLADockerConfigTest(unittest.TestCase):
    def test_arm64_dockerfile_preserves_jetson_torch(self):
        dockerfile = GREEN_VLA_ROOT / "Dockerfile.arm64"
        text = dockerfile.read_text()

        self.assertIn("ARG BASE_IMAGE=robotis/lerobot-zenoh:1.0.1-arm64", text)
        self.assertIn("ARG GREEN_VLA_REF=952a80c3f57880b7db4fb9280d1a4ef27b12f843", text)
        self.assertIn("ENV POLICY_BACKEND=green_vla", text)
        self.assertIn("ENV POLICY_ENGINE_MODULE=green_vla_engine", text)
        self.assertIn("ENV GREEN_VLA_DATA_CONFIG_NAME=cyclo", text)
        self.assertIn("ENV GREEN_VLA_CONTROL_MODE=joint_position", text)
        self.assertIn("ENV GREEN_VLA_EMBODIMENT_NAME=cyclo", text)
        self.assertIn("ENV PYTHONPATH=/opt/GreenVLA:/app:/policy_runtime", text)
        self.assertIn("TRANSFORMERS_CACHE=/root/.cache/huggingface/hub", text)
        self.assertIn("COPY green_vla/green_vla_engine/ /app/green_vla_engine/", text)
        self.assertIn("COPY green_vla/scripts/ /app/scripts/", text)
        self.assertIn("COPY common/runtime/ /policy_runtime/", text)

        forbidden_pins = [
            r"pip install[^\n]*torch==",
            r"pip install[^\n]*torchvision==",
            r"pip install[^\n]*torchcodec==",
            r"uv sync",
        ]
        for pattern in forbidden_pins:
            self.assertIsNone(re.search(pattern, text), pattern)

    def test_compose_declares_isolated_green_vla_service(self):
        compose = yaml.safe_load(COMPOSE_FILE.read_text())
        service = compose["services"]["green_vla"]

        self.assertEqual(service["container_name"], "green_vla_server")
        self.assertEqual(
            service["image"],
            "robotis/green-vla-zenoh:0.1.0-${ARCH:-arm64}",
        )
        self.assertEqual(service["build"]["context"], "../cyclo_brain/policy")
        self.assertEqual(service["build"]["dockerfile"], "green_vla/Dockerfile.${ARCH:-arm64}")

        environment = set(service["environment"])
        self.assertIn("POLICY_BACKEND=green_vla", environment)
        self.assertIn("POLICY_ENGINE_MODULE=green_vla_engine", environment)
        self.assertIn("GREEN_VLA_DATA_CONFIG_NAME=cyclo", environment)
        self.assertIn("GREEN_VLA_CONTROL_MODE=joint_position", environment)
        self.assertIn("GREEN_VLA_EMBODIMENT_NAME=cyclo", environment)
        self.assertIn("HF_HOME=/root/.cache/huggingface", environment)
        self.assertIn("TRANSFORMERS_CACHE=/root/.cache/huggingface/hub", environment)

        volumes = set(service["volumes"])
        self.assertIn(
            "../cyclo_brain/policy/green_vla/checkpoints:/policy_checkpoints/green_vla:rw",
            volumes,
        )
        self.assertIn(
            "../cyclo_brain/policy/green_vla/green_vla_engine:/app/green_vla_engine:ro",
            volumes,
        )
        self.assertIn(
            "../cyclo_brain/policy/green_vla/scripts:/app/scripts:ro",
            volumes,
        )


if __name__ == "__main__":
    unittest.main()
