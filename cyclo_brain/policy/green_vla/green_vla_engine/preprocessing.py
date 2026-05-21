#!/usr/bin/env python3
#
# Copyright 2026 ROBOTIS CO., LTD.
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0

"""GreenVLA observation preprocessing hooks."""

from __future__ import annotations

from typing import Any


class PreprocessingMixin:
    """Build GreenVLA model observations from RobotClient data."""

    def _build_observation(self, request: Any) -> dict:
        raise NotImplementedError("GreenVLA observation preprocessing is pending")

