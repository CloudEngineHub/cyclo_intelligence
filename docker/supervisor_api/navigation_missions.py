#!/usr/bin/env python3
#
# Copyright 2025 ROBOTIS CO., LTD.
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.
#
# Author: Seongwoo Kim

"""Mission manifest and BT XML persistence for Mission Canvas."""

from __future__ import annotations

import json
import os
from pathlib import Path
import re
from typing import Any

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field


router = APIRouter(prefix="/navigation/missions", tags=["navigation-missions"])

NAVIGATION_DATA_ROOT = Path(
    os.environ.get("CYCLO_NAVIGATION_DATA_DIR", "/workspace/navigation")
)
MISSION_SCHEMA_VERSION = 1
_SAFE_NAME = re.compile(r"^[A-Za-z0-9_.-]+$")
_SAFE_RELATIVE_FILE = re.compile(r"^[A-Za-z0-9_./-]+$")


class SpotPose(BaseModel):
    frame_id: str = "map"
    x: float
    y: float
    yaw: float = 0.0


class MissionWaypoint(BaseModel):
    id: str = Field(min_length=1, max_length=128)
    label: str = Field(min_length=1, max_length=128)
    pose: SpotPose
    local_bt: str = Field(default="", max_length=256)
    metadata: dict[str, Any] = Field(default_factory=dict)


class MissionManifest(BaseModel):
    schema_version: int = MISSION_SCHEMA_VERSION
    map_name: str = Field(min_length=1, max_length=128)
    global_bt: str = Field(default="global.xml", max_length=256)
    compiled_bt: str = Field(default="compiled.xml", max_length=256)
    waypoints: list[MissionWaypoint] = Field(default_factory=list)
    metadata: dict[str, Any] = Field(default_factory=dict)


class MissionLoadResponse(MissionManifest):
    exists: bool = False


class MissionSaveRequest(BaseModel):
    global_bt: str = Field(default="global.xml", max_length=256)
    compiled_bt: str = Field(default="compiled.xml", max_length=256)
    waypoints: list[MissionWaypoint] = Field(default_factory=list)
    metadata: dict[str, Any] = Field(default_factory=dict)


class MissionBtFileRequest(BaseModel):
    path: str = Field(min_length=1, max_length=256)
    content: str = ""


class MissionBtFileResponse(BaseModel):
    path: str
    content: str = ""
    exists: bool = False


def _validate_safe_name(value: str, *, label: str) -> str:
    name = value.strip()
    if not name:
        raise HTTPException(400, f"{label} must not be empty")
    if not _SAFE_NAME.fullmatch(name):
        raise HTTPException(
            400,
            f"{label} may contain only letters, numbers, '.', '_' and '-'",
        )
    return name


def _validate_map_name(value: str) -> str:
    return _validate_safe_name(value, label="map_name")


def _validate_spot_id(value: str) -> str:
    return _validate_safe_name(value, label="waypoint_id")


def _validate_relative_file(value: str, *, default: str) -> str:
    raw = (value or default).strip() or default
    if raw.startswith("/") or ".." in Path(raw).parts:
        raise HTTPException(400, "BT file path must stay inside the mission")
    if not _SAFE_RELATIVE_FILE.fullmatch(raw):
        raise HTTPException(400, "BT file path contains unsupported characters")
    return raw


def _mission_dir(map_name: str) -> Path:
    return NAVIGATION_DATA_ROOT / "missions" / _validate_map_name(map_name)


def _manifest_path(map_name: str) -> Path:
    return _mission_dir(map_name) / "mission.json"


def _empty_manifest(map_name: str) -> MissionLoadResponse:
    normalized = _validate_map_name(map_name)
    return MissionLoadResponse(
        exists=False,
        schema_version=MISSION_SCHEMA_VERSION,
        map_name=normalized,
        global_bt="global.xml",
        compiled_bt="compiled.xml",
        waypoints=[],
        metadata={},
    )


def _serialize_model(model: BaseModel) -> dict[str, Any]:
    if hasattr(model, "model_dump"):
        return model.model_dump()
    return model.dict()


def _normalize_waypoint(waypoint: MissionWaypoint) -> MissionWaypoint:
    waypoint_id = _validate_spot_id(waypoint.id)
    local_bt = _validate_relative_file(
        waypoint.local_bt,
        default=f"locals/{waypoint_id}.xml",
    )
    return MissionWaypoint(
        id=waypoint_id,
        label=waypoint.label.strip(),
        pose=waypoint.pose,
        local_bt=local_bt,
        metadata=waypoint.metadata,
    )


def _normalize_manifest(
    map_name: str,
    *,
    global_bt: str,
    compiled_bt: str,
    waypoints: list[MissionWaypoint],
    metadata: dict[str, Any],
    exists: bool,
) -> MissionLoadResponse:
    normalized_map = _validate_map_name(map_name)
    return MissionLoadResponse(
        exists=exists,
        schema_version=MISSION_SCHEMA_VERSION,
        map_name=normalized_map,
        global_bt=_validate_relative_file(global_bt, default="global.xml"),
        compiled_bt=_validate_relative_file(compiled_bt, default="compiled.xml"),
        waypoints=[_normalize_waypoint(waypoint) for waypoint in waypoints],
        metadata=metadata,
    )


def _read_manifest(map_name: str) -> MissionLoadResponse:
    normalized = _validate_map_name(map_name)
    path = _manifest_path(normalized)
    try:
        with path.open("r", encoding="utf-8") as f:
            raw = json.load(f)
    except FileNotFoundError:
        return _empty_manifest(normalized)
    except (OSError, json.JSONDecodeError) as exc:
        raise HTTPException(
            500, f"Failed to read mission for {normalized}: {exc}"
        ) from exc

    if not isinstance(raw, dict):
        return _empty_manifest(normalized)
    waypoints = []
    for value in raw.get("waypoints") or []:
        if not isinstance(value, dict):
            continue
        try:
            waypoints.append(MissionWaypoint(**value))
        except Exception:
            continue
    return _normalize_manifest(
        normalized,
        global_bt=str(raw.get("global_bt") or "global.xml"),
        compiled_bt=str(raw.get("compiled_bt") or "compiled.xml"),
        waypoints=waypoints,
        metadata=raw.get("metadata") if isinstance(raw.get("metadata"), dict) else {},
        exists=True,
    )


def _write_manifest(manifest: MissionLoadResponse) -> None:
    path = _manifest_path(manifest.map_name)
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = _serialize_model(manifest)
    payload.pop("exists", None)
    payload["schema_version"] = MISSION_SCHEMA_VERSION
    tmp_path = path.with_suffix(".json.tmp")
    try:
        with tmp_path.open("w", encoding="utf-8") as f:
            json.dump(payload, f, indent=2, sort_keys=True)
            f.write("\n")
        os.replace(tmp_path, path)
    except OSError as exc:
        raise HTTPException(
            500, f"Failed to write mission for {manifest.map_name}: {exc}"
        ) from exc


def _resolve_bt_path(map_name: str, relative_path: str) -> Path:
    mission_dir = _mission_dir(map_name)
    safe_path = _validate_relative_file(relative_path, default="global.xml")
    path = mission_dir / safe_path
    try:
        path.relative_to(mission_dir)
    except ValueError as exc:
        raise HTTPException(400, "BT file path escapes the mission") from exc
    return path


@router.get("/{map_name}", response_model=MissionLoadResponse)
def load_mission(map_name: str):
    return _read_manifest(map_name)


@router.post("/{map_name}", response_model=MissionLoadResponse)
def save_mission(map_name: str, request: MissionSaveRequest):
    manifest = _normalize_manifest(
        map_name,
        global_bt=request.global_bt,
        compiled_bt=request.compiled_bt,
        waypoints=request.waypoints,
        metadata=request.metadata,
        exists=True,
    )
    _write_manifest(manifest)
    return manifest


@router.get("/{map_name}/bt", response_model=MissionBtFileResponse)
def load_bt_file(
    map_name: str,
    path: str = Query(min_length=1, max_length=256),
):
    bt_path = _resolve_bt_path(map_name, path)
    safe_path = str(bt_path.relative_to(_mission_dir(map_name)))
    try:
        content = bt_path.read_text(encoding="utf-8")
    except FileNotFoundError:
        return MissionBtFileResponse(path=safe_path, content="", exists=False)
    except OSError as exc:
        raise HTTPException(500, f"Failed to read BT XML: {exc}") from exc
    return MissionBtFileResponse(path=safe_path, content=content, exists=True)


@router.put("/{map_name}/bt", response_model=MissionBtFileResponse)
def save_bt_file(map_name: str, request: MissionBtFileRequest):
    bt_path = _resolve_bt_path(map_name, request.path)
    safe_path = str(bt_path.relative_to(_mission_dir(map_name)))
    try:
        bt_path.parent.mkdir(parents=True, exist_ok=True)
        bt_path.write_text(request.content, encoding="utf-8")
    except OSError as exc:
        raise HTTPException(500, f"Failed to write BT XML: {exc}") from exc
    return MissionBtFileResponse(path=safe_path, content=request.content, exists=True)
