#!/usr/bin/env python3
#
# Copyright 2026 ROBOTIS CO., LTD.
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0

"""GreenVLA policy loading helpers."""

from __future__ import annotations

from typing import Any, Dict


class LoadingMixin:
    """Policy loading surface for GreenVLA.

    The concrete loader is added after the container pins the GreenVLA source
    tree and dependency set. Keeping this as a mixin mirrors the existing
    LeRobot and GR00T backends while making the initial runtime contract
    testable without large model dependencies.
    """

    def _load_policy_not_implemented(self, request: Any) -> Dict[str, Any]:
        model_path = getattr(request, "model_path", "")
        return {
            "success": False,
            "message": f"GreenVLA model loading is not implemented yet: {model_path}",
        }

