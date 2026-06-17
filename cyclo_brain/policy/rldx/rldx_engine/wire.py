#!/usr/bin/env python3
#
# Copyright 2026 ROBOTIS CO., LTD.
#
# Licensed under the Apache License, Version 2.0

"""Small RLDX PolicyServer-compatible ZMQ client.

The remote GPU PC should run RLDX's own ``run_rldx_server.py``. This client
mirrors RLDX's wire codec closely enough for the robot-side bridge without
importing the full RLDX package into the Cyclo policy container.
"""

from __future__ import annotations

import io
from typing import Any

import msgpack
import numpy as np


class MsgSerializer:
    @staticmethod
    def to_bytes(data: Any) -> bytes:
        return msgpack.packb(data, default=MsgSerializer.encode_custom_classes)

    @staticmethod
    def from_bytes(data: bytes) -> Any:
        return msgpack.unpackb(data, object_hook=MsgSerializer.decode_custom_classes)

    @staticmethod
    def decode_custom_classes(obj: Any) -> Any:
        if not isinstance(obj, dict):
            return obj
        if "__ModalityConfig_class__" in obj:
            return obj["as_json"]
        if "__ndarray_class__" in obj:
            return np.load(io.BytesIO(obj["as_npy"]), allow_pickle=False)
        return obj

    @staticmethod
    def encode_custom_classes(obj: Any) -> Any:
        if isinstance(obj, np.ndarray):
            output = io.BytesIO()
            np.save(output, obj, allow_pickle=False)
            return {"__ndarray_class__": True, "as_npy": output.getvalue()}
        if isinstance(obj, np.generic):
            return obj.item()
        return obj


class RLDXRemoteClient:
    """REQ client for RLDX ``PolicyServer`` endpoints."""

    def __init__(
        self,
        host: str = "127.0.0.1",
        port: int = 5555,
        timeout_ms: int = 120000,
        api_token: str | None = None,
    ) -> None:
        import zmq

        self._zmq = zmq
        self.host = str(host)
        self.port = int(port)
        self.timeout_ms = int(timeout_ms)
        self.api_token = api_token
        self.context = zmq.Context()
        self._init_socket()

    def _init_socket(self) -> None:
        self.socket = self.context.socket(self._zmq.REQ)
        self.socket.setsockopt(self._zmq.RCVTIMEO, self.timeout_ms)
        self.socket.setsockopt(self._zmq.SNDTIMEO, self.timeout_ms)
        self.socket.setsockopt(self._zmq.LINGER, 0)
        self.socket.connect(f"tcp://{self.host}:{self.port}")

    def close(self) -> None:
        try:
            self.socket.close(0)
        finally:
            self.context.term()

    def call_endpoint(
        self,
        endpoint: str,
        data: dict | None = None,
        *,
        requires_input: bool = True,
    ) -> Any:
        request: dict[str, Any] = {"endpoint": endpoint}
        if requires_input:
            request["data"] = data or {}
        if self.api_token:
            request["api_token"] = self.api_token

        try:
            self.socket.send(MsgSerializer.to_bytes(request))
            response = MsgSerializer.from_bytes(self.socket.recv())
        except self._zmq.Again as exc:
            self._init_socket()
            raise TimeoutError(
                f"RLDX endpoint {endpoint!r} timed out after {self.timeout_ms} ms"
            ) from exc

        if isinstance(response, dict) and "error" in response:
            raise RuntimeError(f"RLDX server error: {response['error']}")
        return response

    def ping(self) -> bool:
        self.call_endpoint("ping", requires_input=False)
        return True

    def get_modality_config(self) -> dict:
        return self.call_endpoint("get_modality_config", requires_input=False)

    def get_action(
        self,
        observation: dict[str, Any],
        options: dict[str, Any] | None = None,
    ) -> tuple[dict[str, np.ndarray], dict]:
        response = self.call_endpoint(
            "get_action",
            {"observation": observation, "options": options},
        )
        actions, info = tuple(response)
        return actions, info

    def reset(self, options: dict[str, Any] | None = None) -> dict:
        return self.call_endpoint("reset", {"options": options})
