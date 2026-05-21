#!/usr/bin/env python3
#
# Copyright 2026 ROBOTIS CO., LTD.
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0

"""GreenVLA action prediction hooks."""

from __future__ import annotations

from typing import Any, Dict


class PredictionMixin:
    """Run GreenVLA policy inference and return Cyclo action chunks."""

    def _predict_action_chunk(self, observation: Any) -> Dict[str, Any]:
        raise NotImplementedError("GreenVLA action prediction is pending")
