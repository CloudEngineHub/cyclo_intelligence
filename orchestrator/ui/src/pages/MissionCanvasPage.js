// Copyright 2026 ROBOTIS CO., LTD.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.

"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { MdPowerSettingsNew, MdStop } from "react-icons/md";
import {
  configureDesignLocalizationAmcl,
  getServiceStatus,
  getPgmFiles,
  requestNoMotionUpdate,
  saveNavigationMap,
  sendInitialPoseEstimate,
  startNavigation,
  stopNavigation,
} from "../utils/navigationApi";
import {
  createNavigationSpot,
  deleteNavigationSpot,
  getNavigationSpots,
  updateNavigationSpot,
} from "../utils/navigationSpotsApi";
import { useNavigationRosPublisher, useNavigationRosTopic } from "../hooks/useNavigationRosTopic";
import { MapEditorControls, useMapEditor } from "../components/navigation/MapEditor";
import { MapViewer } from "../components/navigation/MapViewer";
import {
  mergeTfMessages,
  poseFromBaseLinkTf,
  tfMessageFromBuffer,
  updateTfBuffer,
  yawFromPose,
} from "../utils/navigationTf";
import { FALLBACK_CATALOG } from "../constants/btNodeCatalogFallback";
import { BT_SUPPORTED_ROBOT_TYPE } from "../constants/btSupport";

const DEFAULT_MAP_NAME = "map";
const STATUS_POLL_MS = 10000;
const BT_NODE_STATUS_POLL_MS = 5000;
const NOMOTION_UPDATE_INTERVAL_MS = 1000;
const AUTO_LOCALIZE_MAX_UPDATES = 10;
const AUTO_LOCALIZE_MIN_UPDATES = 3;
const AUTO_LOCALIZE_UPDATE_DELAY_MS = 700;
const AUTO_LOCALIZE_XY_COVARIANCE_MAX = 0.6;
const AUTO_LOCALIZE_YAW_COVARIANCE_MAX = 0.5;
const ROS2_WS_FAST_TOPIC_OPTIONS = { throttleMs: 100 };
const BT_TOPIC_OPTIONS = { staleMs: 3000 };
const SUPERVISOR_API_BASE = "/api";
const STAGE_MAPPING = "mapping";
const STAGE_AUTHORING = "authoring";
const STAGE_RUN = "run";

const WORKSPACE_STAGES = [
  { id: STAGE_MAPPING, label: "Mapping" },
  { id: STAGE_AUTHORING, label: "Design" },
  { id: STAGE_RUN, label: "Run" },
];

const LAYER_DEFINITIONS = {
  map: "Map",
  scan: "Lidar",
  robotModel: "Robot Model",
  tf: "TF",
  globalCostmap: "Global costmap",
  localCostmap: "Local costmap",
  globalPlan: "Global plan",
  goalPose: "Goal pose",
};

const STAGE_LAYER_IDS = {
  [STAGE_MAPPING]: ["map", "scan", "robotModel", "tf"],
  [STAGE_AUTHORING]: ["map", "scan", "robotModel", "tf"],
  [STAGE_RUN]: [
    "map",
    "scan",
    "robotModel",
    "globalCostmap",
    "localCostmap",
    "globalPlan",
    "goalPose",
    "tf",
  ],
};

const LAYER_PRESETS = {
  [STAGE_MAPPING]: {
    map: true,
    scan: true,
    robotModel: true,
    tf: true,
    globalCostmap: false,
    localCostmap: false,
    globalPlan: false,
    goalPose: false,
  },
  [STAGE_AUTHORING]: {
    map: true,
    scan: false,
    robotModel: false,
    tf: false,
    globalCostmap: false,
    localCostmap: false,
    globalPlan: false,
    goalPose: false,
  },
  [STAGE_RUN]: {
    map: true,
    scan: true,
    robotModel: true,
    tf: false,
    globalCostmap: true,
    localCostmap: true,
    globalPlan: true,
    goalPose: true,
  },
};

const LAYER_TOPIC_IDS = {
  map: ["/map"],
  scan: ["/scan", "/amcl_pose"],
  robotModel: ["/amcl_pose", "/local_costmap/published_footprint"],
  tf: ["/tf", "/tf_static"],
  globalCostmap: ["/global_costmap/costmap"],
  localCostmap: ["/local_costmap/costmap"],
  globalPlan: ["/plan"],
  goalPose: ["/goal_pose"],
};

const STAGE_EXTRA_TOPIC_IDS = {
  [STAGE_MAPPING]: [],
  [STAGE_AUTHORING]: ["/bt/status", "/bt/active_nodes"],
  [STAGE_RUN]: ["/bt/status", "/bt/active_nodes"],
};

const TOPIC_ORDER = [
  "/map",
  "/scan",
  "/amcl_pose",
  "/tf",
  "/tf_static",
  "/local_costmap/published_footprint",
  "/global_costmap/costmap",
  "/local_costmap/costmap",
  "/plan",
  "/goal_pose",
  "/bt/status",
  "/bt/active_nodes",
];

const MISSION_BORDER = "#e5e7eb";
const MISSION_BUTTON_BORDER = "#cbd5e1";
const MISSION_PANEL_BORDER = "#cbd5e1";
const MISSION_STAGE_FILL = MISSION_BORDER;
const MISSION_STAGE_EMPTY = "#ffffff";
const MISSION_SURFACE = "#f8fafc";
const MISSION_SURFACE_STRONG = "#eef2f7";
const MISSION_TEXT = "#111827";
const MISSION_TEXT_MUTED = "#475569";
const MISSION_LIVE = "#15803d";
const MISSION_SWITCH_OFF = "#cbd5e1";
const MISSION_SWITCH_BORDER = "#94a3b8";
const MISSION_SWITCH_KNOB_BORDER = "#e2e8f0";
const MISSION_DESIGN_STORAGE_KEY = "mission_canvas_designs";
const MISSION_SESSION_STORAGE_KEY = "mission_canvas_session";
const TELEOP_TOPIC = "/cmd_vel";
const TELEOP_MESSAGE_TYPE = "geometry_msgs/msg/Twist";
const TELEOP_REPEAT_MS = 200;
const TELEOP_DEFAULT_LINEAR_SPEED = 0.4;
const TELEOP_DEFAULT_ANGULAR_SPEED = 0.8;
const TELEOP_STOP = { linearX: 0, angularZ: 0 };

function topicPayload(value) {
  if (!value || typeof value !== "object") return null;
  if (value.available === false) return null;
  return "data" in value ? value.data : value;
}

function messageData(value) {
  const data = topicPayload(value);
  return data && typeof data === "object" ? data : null;
}

function hasTopicMessage(value) {
  if (!value || typeof value !== "object") return false;
  if (value.available === false) return false;
  if (value.available === true) return true;
  return topicPayload(value) !== null;
}

function rosStringData(value) {
  const payload = topicPayload(value);
  if (typeof payload === "string") return payload;
  if (payload && typeof payload.data === "string") return payload.data;
  return "";
}

async function readJsonResponse(response) {
  const text = await response.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return { detail: text };
  }
}

async function requestSupervisorApi(path, init) {
  if (typeof fetch !== "function") {
    throw new Error("Supervisor API is not available");
  }
  const response = await fetch(`${SUPERVISOR_API_BASE}${path}`, init);
  const data = await readJsonResponse(response);
  if (!response.ok || data.ok === false) {
    throw new Error(data.detail || data.message || `Request failed (${response.status})`);
  }
  return data;
}

function getBtNodeServiceStatus() {
  return requestSupervisorApi("/services/bt_node/status");
}

function setBtNodeServiceActive(active) {
  const init = { method: "POST" };
  if (active) {
    init.headers = { "Content-Type": "application/json" };
    init.body = JSON.stringify({ robot_type: BT_SUPPORTED_ROBOT_TYPE });
  }
  return requestSupervisorApi(`/services/bt_node/${active ? "start" : "stop"}`, init);
}

function delay(ms) {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

function amclPoseLooksLocalized(amclPose) {
  const covariance = amclPose?.pose?.covariance;
  if (!Array.isArray(covariance) || covariance.length < 36) return false;
  const xVariance = Number(covariance[0]);
  const yVariance = Number(covariance[7]);
  const yawVariance = Number(covariance[35]);
  if (![xVariance, yVariance, yawVariance].every(Number.isFinite)) return false;
  return (
    Math.max(xVariance, yVariance) <= AUTO_LOCALIZE_XY_COVARIANCE_MAX &&
    yawVariance <= AUTO_LOCALIZE_YAW_COVARIANCE_MAX
  );
}

function spotPoseFromMapPose(x, y, yaw) {
  return {
    frame_id: "map",
    x,
    y,
    yaw,
  };
}

function mapPlacementMeta(grid) {
  const info = grid?.info;
  const width = Number(info?.width ?? 0);
  const height = Number(info?.height ?? 0);
  const resolution = Number(info?.resolution ?? 0);
  const origin = info?.origin ?? {};
  const originX = Number(origin.position?.x ?? 0);
  const originY = Number(origin.position?.y ?? 0);
  const originYaw = yawFromPose(origin);
  if (!width || !height || !resolution) return null;
  return {
    width,
    height,
    resolution,
    widthMeters: width * resolution,
    heightMeters: height * resolution,
    originX,
    originY,
    originYaw,
  };
}

function pointInMapBounds(x, y, meta) {
  const dx = x - meta.originX;
  const dy = y - meta.originY;
  const cos = Math.cos(meta.originYaw);
  const sin = Math.sin(meta.originYaw);
  const localX = cos * dx + sin * dy;
  const localY = -sin * dx + cos * dy;
  const padding = meta.resolution * 4;
  return (
    localX >= -padding &&
    localX <= meta.widthMeters + padding &&
    localY >= -padding &&
    localY <= meta.heightMeters + padding
  );
}

function legacyCellPointToMap(x, y, meta) {
  const localX = x * meta.resolution;
  const localY = y * meta.resolution;
  const cos = Math.cos(meta.originYaw);
  const sin = Math.sin(meta.originYaw);
  return {
    x: meta.originX + cos * localX - sin * localY,
    y: meta.originY + sin * localX + cos * localY,
  };
}

function spotForMapDisplay(spot, grid) {
  const pose = spot?.pose;
  const meta = mapPlacementMeta(grid);
  if (!pose || !meta || spot.metadata?.coordinate_space === "map") return spot;
  const x = Number(pose.x ?? 0);
  const y = Number(pose.y ?? 0);
  const looksLikeLegacyCell = x >= 0 && x <= meta.width && y >= 0 && y <= meta.height;
  if (!looksLikeLegacyCell || pointInMapBounds(x, y, meta)) return spot;
  const converted = legacyCellPointToMap(x, y, meta);
  return {
    ...spot,
    pose: {
      ...pose,
      x: converted.x,
      y: converted.y,
    },
    metadata: {
      ...(spot.metadata ?? {}),
      coordinate_space: "legacy_cell_display",
    },
  };
}

function behaviorNodeDefinition(tag) {
  return FALLBACK_CATALOG.find((node) => node.tag === tag) || {
    tag,
    category: "action",
  };
}

function behaviorNodeId(tag, index) {
  return `behavior_${index}_${tag.toLowerCase().replace(/[^a-z0-9]+/g, "_")}`;
}

function mapNameFromPgmPath(path) {
  const fileName = String(path || "").split("/").filter(Boolean).pop() || "";
  return fileName.replace(/\.pgm$/i, "") || DEFAULT_MAP_NAME;
}

function pgmPathFromMapName(mapName) {
  const trimmed = String(mapName || "").trim();
  return trimmed ? `${trimmed}.pgm` : "";
}

function readMissionSession() {
  if (typeof window === "undefined" || !window.sessionStorage) return {};
  try {
    const raw = window.sessionStorage.getItem(MISSION_SESSION_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function saveMissionSession(patch) {
  if (typeof window === "undefined" || !window.sessionStorage) return;
  const current = readMissionSession();
  const next = {
    ...current,
    ...patch,
    updatedAt: new Date().toISOString(),
  };
  window.sessionStorage.setItem(MISSION_SESSION_STORAGE_KEY, JSON.stringify(next));
}

function initialWorkspaceStage(session) {
  const stage = session?.workspaceStage;
  return WORKSPACE_STAGES.some((item) => item.id === stage) ? stage : STAGE_MAPPING;
}

function initialNavigationRuntimeMode(session) {
  const mode = session?.navigationRuntimeMode;
  return ["idle", "mapping", "localization", "run"].includes(mode) ? mode : "idle";
}

function navigationRuntimeModeFromStatus(status) {
  if (status?.is_up === false) return "idle";
  if (!status?.is_up) return "";
  if (status.mode === "map" || status.mode === "mapping") return "mapping";
  if (status.mode === "localize" || status.mode === "localization") return "localization";
  if (status.mode === "nav" || status.mode === "run") return "run";
  return "";
}

function readDesignStore() {
  if (typeof window === "undefined" || !window.localStorage) return {};
  try {
    const raw = window.localStorage.getItem(MISSION_DESIGN_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function savedBehaviorNodesForMap(mapName) {
  const saved = readDesignStore()[mapName]?.behaviorNodes;
  return Array.isArray(saved) ? saved : null;
}

function saveBehaviorNodesForMap(mapName, nodes) {
  if (typeof window === "undefined" || !window.localStorage) return;
  const store = readDesignStore();
  store[mapName] = {
    ...store[mapName],
    behaviorNodes: nodes,
    savedAt: new Date().toISOString(),
  };
  window.localStorage.setItem(MISSION_DESIGN_STORAGE_KEY, JSON.stringify(store));
}

function behaviorNodeSerialFromNodes(nodes) {
  return nodes.reduce((max, node) => {
    const match = String(node.id || "").match(/^behavior_(\d+)_/);
    return match ? Math.max(max, Number(match[1])) : max;
  }, 0);
}

function Panel({ title, children, className = "", compact = false }) {
  return (
    <div
      className={`border rounded-md min-h-0 min-w-0 ${compact ? "p-2" : "p-3"} ${className}`}
      style={{
        color: MISSION_TEXT,
        borderColor: MISSION_PANEL_BORDER,
        backgroundColor: MISSION_STAGE_EMPTY,
      }}
    >
      {title && (
        <div className={`text-xs font-semibold ${compact ? "mb-1" : "mb-2"}`}>
          {title}
        </div>
      )}
      {children}
    </div>
  );
}

function SaveMapDialog({
  open,
  value,
  busy,
  onChange,
  onCancel,
  onSubmit,
}) {
  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 px-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="mission-save-map-title"
    >
      <form
        className="w-full max-w-sm border rounded-md p-4 grid gap-3 shadow-2xl"
        style={{
          color: "#111827",
          backgroundColor: "#ffffff",
          borderColor: "#d1d5db",
        }}
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit();
        }}
      >
        <div id="mission-save-map-title" className="text-sm font-semibold">
          Save Map
        </div>
        <label className="grid gap-1 text-xs">
          <span style={{ color: "#4b5563" }}>Map name</span>
          <input
            autoFocus
            aria-label="Save map name"
            value={value}
            disabled={busy}
            onChange={(event) => onChange(event.currentTarget.value)}
            className="h-8 px-2 border rounded-md text-sm"
            style={{
              color: "#111827",
              backgroundColor: "#f9fafb",
              borderColor: "#9ca3af",
            }}
          />
        </label>
        <div className="flex justify-end gap-2">
          <ActionButton disabled={busy} onClick={onCancel} variant="secondary">
            Cancel
          </ActionButton>
          <ActionButton disabled={busy || !value.trim()} type="submit">
            Save
          </ActionButton>
        </div>
      </form>
    </div>
  );
}

function LoadMapDialog({
  open,
  files,
  selectedPath,
  busy,
  selectAriaLabel = "Map file",
  onChange,
  onCancel,
  onSubmit,
}) {
  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 px-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="mission-load-map-title"
    >
      <form
        className="w-full max-w-sm border rounded-md p-4 grid gap-3 shadow-2xl"
        style={{
          color: "#111827",
          backgroundColor: "#ffffff",
          borderColor: "#d1d5db",
        }}
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit();
        }}
      >
        <div id="mission-load-map-title" className="text-sm font-semibold">
          Load Map
        </div>
        <label className="grid gap-1 text-xs">
          <span style={{ color: "#4b5563" }}>Map file</span>
          <select
            aria-label={selectAriaLabel}
            value={selectedPath}
            disabled={busy || files.length === 0}
            onChange={(event) => onChange(event.currentTarget.value)}
            className="h-8 px-2 border rounded-md text-sm"
            style={{
              color: "#111827",
              backgroundColor: "#f9fafb",
              borderColor: "#9ca3af",
            }}
          >
            {files.length === 0 ? (
              <option value="">No maps found</option>
            ) : files.map((file) => (
              <option key={file.path} value={file.path}>
                {file.name || file.path}
              </option>
            ))}
          </select>
        </label>
        <div className="flex justify-end gap-2">
          <ActionButton disabled={busy} onClick={onCancel} variant="secondary">
            Cancel
          </ActionButton>
          <ActionButton disabled={busy || !selectedPath} type="submit" variant="secondary">
            Load
          </ActionButton>
        </div>
      </form>
    </div>
  );
}

function LayerToggle({ label, checked, compact = false, onChange }) {
  return (
    <div
      className={`${compact ? "min-h-7" : "min-h-8"} flex items-center justify-between gap-3 text-xs font-medium select-none`}
      style={{
        color: MISSION_TEXT,
      }}
    >
      <span className="truncate">{label}</span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        onClick={() => onChange(!checked)}
        className={`${compact ? "h-5 w-9" : "h-6 w-11"} inline-flex rounded-full relative shrink-0 border cursor-pointer transition-colors active:translate-y-px`}
        style={{
          backgroundColor: checked
            ? MISSION_LIVE
            : MISSION_SWITCH_OFF,
          borderColor: checked
            ? MISSION_LIVE
            : MISSION_SWITCH_BORDER,
          boxShadow: checked
            ? "inset 0 0 0 1px rgba(255,255,255,0.18)"
            : "inset 0 0 0 1px rgba(15,23,42,0.08)",
        }}
      >
        <span
          aria-hidden="true"
          className={`${compact ? "h-4 w-4 top-0.5" : "h-5 w-5 top-0.5"} block absolute left-0.5 rounded-full bg-white transition-transform duration-150 ease-out`}
          style={{
            border: `1px solid ${MISSION_SWITCH_KNOB_BORDER}`,
            boxShadow: "0 1px 3px rgba(15,23,42,0.24)",
            transform: checked
              ? `translateX(${compact ? "16px" : "20px"})`
              : "translateX(0)",
          }}
        />
      </button>
    </div>
  );
}

function LayersPanel({ layerToggles, compact = false }) {
  return (
    <Panel title="Layers" compact={compact} className={`grid content-start overflow-auto ${compact ? "gap-1" : "gap-2"}`}>
      <div className={`grid min-w-0 ${compact ? "gap-1" : "gap-2"}`}>
        {layerToggles.map((layer) => (
          <LayerToggle
            key={layer.id}
            label={layer.label}
            checked={layer.checked}
            compact={compact}
            onChange={layer.onChange}
          />
        ))}
      </div>
    </Panel>
  );
}

function TopicStatusPanel({ topicRows }) {
  return (
    <Panel title="Topics" className="grid gap-1 text-xs min-h-0 overflow-auto content-start">
      {topicRows.map(({ topic, isLive }) => (
        <div key={topic} className="min-h-5 flex items-center justify-between gap-2 min-w-0">
          <div className="font-mono truncate min-w-0">
            {topic}
          </div>
          <span
            className="shrink-0"
            style={{ color: isLive ? MISSION_LIVE : MISSION_TEXT_MUTED }}
          >
            {isLive ? "live" : "wait"}
          </span>
        </div>
      ))}
    </Panel>
  );
}

function SessionRow({ label, value, stacked = false }) {
  if (stacked) {
    return (
      <div className="grid gap-0.5 text-xs min-w-0">
        <span style={{ color: MISSION_TEXT_MUTED }}>{label}</span>
        <span className="font-mono truncate">{value}</span>
      </div>
    );
  }

  return (
    <div className="flex items-center justify-between gap-2 text-xs min-w-0">
      <span style={{ color: MISSION_TEXT_MUTED }}>{label}</span>
      <span className="font-mono truncate text-right">{value}</span>
    </div>
  );
}

function MappingSessionPanel({ mappingEditorActive, selectedPath, dirty }) {
  return (
    <Panel title="Mapping Session" compact className="grid gap-1 content-start overflow-auto">
      <div className="grid gap-1">
        <SessionRow
          label="Source"
          value={mappingEditorActive ? "Saved map" : "Live mapping"}
        />
        <SessionRow
          label="Map"
          value={mappingEditorActive && selectedPath ? selectedPath : "Not saved"}
        />
        <SessionRow
          label="Edits"
          value={mappingEditorActive && dirty ? "Unsaved changes" : "Clean"}
        />
      </div>
    </Panel>
  );
}

function RunSessionPanel({ mapName, running }) {
  return (
    <Panel title="Run Session" className="grid gap-2">
      <SessionRow label="Runtime" value={running ? "Running" : "Idle"} />
      <SessionRow label="Selected map" value={mapName || "Not selected"} />
    </Panel>
  );
}

function btNodeStateLabel(state) {
  if (state === "up") return "Active";
  if (state === "down") return "Inactive";
  return "Unknown";
}

function btNodeStateColor(state) {
  if (state === "up") return "#22c55e";
  if (state === "down") return "#94a3b8";
  return "#f59e0b";
}

function btExecutionLabel(status, nodeActive) {
  const normalized = String(status || "").trim().toLowerCase();
  if (!nodeActive) return "wait";
  if (!normalized || normalized === "stopped") return "Ready";
  if (normalized === "running") return "Running";
  if (normalized === "completed") return "Completed";
  if (normalized === "failed" || normalized === "failure") return "Failed";
  if (normalized === "stopping") return "Stopping";
  return status;
}

function btActiveNodesLabel(activeNodes, nodeActive, executionLabel) {
  if (!nodeActive) return "wait";
  if (activeNodes) return activeNodes;
  return executionLabel === "Running" ? "None" : "Waiting for run";
}

function BtRuntimePanel({
  nodeState,
  btStatus,
  activeNodes,
  busy,
  onActivate,
  onDeactivate,
}) {
  const isActive = nodeState === "up";
  const executionLabel = btExecutionLabel(btStatus, isActive);
  const activeNodesLabel = btActiveNodesLabel(activeNodes, isActive, executionLabel);

  return (
    <Panel title="BT Runtime" compact className="grid gap-2 content-start">
      <div className="flex items-center justify-between gap-2 min-w-0">
        <div className="flex items-center gap-2 min-w-0">
          <span
            className="w-2.5 h-2.5 rounded-full shrink-0"
            style={{ backgroundColor: btNodeStateColor(nodeState) }}
            aria-label={`BT node ${btNodeStateLabel(nodeState)}`}
            title={`BT node ${btNodeStateLabel(nodeState)}`}
          />
          <span className="text-xs font-semibold truncate">
            BT Node {btNodeStateLabel(nodeState)}
          </span>
        </div>
      </div>
      <div className="grid gap-1">
        <SessionRow label="Execution" value={executionLabel} />
        <SessionRow label="Active nodes" value={activeNodesLabel} />
      </div>
      <div className="flex flex-wrap gap-2 pt-1">
        <ActionButton
          disabled={busy || isActive}
          onClick={onActivate}
          title="Start BT node"
          variant="secondary"
        >
          <span className="inline-flex items-center gap-1.5">
            <MdPowerSettingsNew size={16} />
            Activate BT
          </span>
        </ActionButton>
        <ActionButton
          disabled={busy || !isActive}
          onClick={onDeactivate}
          title="Stop BT node"
          variant="danger"
        >
          <span className="inline-flex items-center gap-1.5">
            <MdStop size={16} />
            Deactivate BT
          </span>
        </ActionButton>
      </div>
    </Panel>
  );
}

function clampNumber(value, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) return min;
  return Math.min(Math.max(number, min), max);
}

function teleopTwist({ linearX = 0, angularZ = 0 }) {
  return {
    linear: { x: linearX, y: 0, z: 0 },
    angular: { x: 0, y: 0, z: angularZ },
  };
}

function isTextInputTarget(target) {
  if (!target || !(target instanceof Element)) return false;
  const tagName = target.tagName.toLowerCase();
  return (
    tagName === "input" ||
    tagName === "textarea" ||
    tagName === "select" ||
    target.isContentEditable
  );
}

function TeleopButton({
  children,
  active = false,
  disabled = false,
  title,
  onStart,
  onStop,
}) {
  const handlePointerDown = (event) => {
    if (disabled) return;
    event.preventDefault();
    if (event.currentTarget.setPointerCapture) {
      event.currentTarget.setPointerCapture(event.pointerId);
    }
    onStart();
  };

  const handlePointerStop = (event) => {
    if (disabled) return;
    event.preventDefault();
    onStop();
  };

  return (
    <button
      type="button"
      disabled={disabled}
      title={title}
      aria-pressed={active ? true : undefined}
      onPointerDown={handlePointerDown}
      onPointerUp={handlePointerStop}
      onPointerCancel={handlePointerStop}
      onPointerLeave={handlePointerStop}
      className="h-12 w-14 border rounded-md text-base font-bold transition-all active:translate-y-px disabled:opacity-45"
      style={{
        color: active ? "var(--vscode-button-foreground)" : MISSION_TEXT,
        backgroundColor: active ? "var(--vscode-button-background)" : MISSION_STAGE_EMPTY,
        borderColor: MISSION_BUTTON_BORDER,
        boxShadow: "none",
      }}
    >
      {children}
    </button>
  );
}

function MappingTeleopPanel({ disabled, onPublish, onMessage }) {
  const [linearSpeed, setLinearSpeed] = useState(TELEOP_DEFAULT_LINEAR_SPEED);
  const [angularSpeed, setAngularSpeed] = useState(TELEOP_DEFAULT_ANGULAR_SPEED);
  const [activated, setActivated] = useState(false);
  const [activeLabel, setActiveLabel] = useState("");
  const activeMotionRef = useRef(null);
  const controlsDisabled = disabled || !activated;

  const publishMotion = useCallback((motion) => {
    void onPublish(motion).catch((error) => {
      setActivated(false);
      setActiveLabel("");
      activeMotionRef.current = null;
      onMessage(error instanceof Error ? error.message : "Teleop publish failed");
    });
  }, [onMessage, onPublish]);

  const stopTeleop = useCallback(() => {
    activeMotionRef.current = null;
    setActiveLabel("");
    publishMotion(TELEOP_STOP);
  }, [publishMotion]);

  const deactivateTeleop = useCallback(() => {
    activeMotionRef.current = null;
    setActiveLabel("");
    setActivated(false);
    publishMotion(TELEOP_STOP);
  }, [publishMotion]);

  const activateTeleop = useCallback(() => {
    if (disabled) return;
    setActivated(true);
    setActiveLabel("");
    onMessage("Mobile teleop activated");
  }, [disabled, onMessage]);

  const startTeleop = useCallback((label, motion) => {
    if (controlsDisabled) return;
    activeMotionRef.current = motion;
    setActiveLabel(label);
    publishMotion(motion);
  }, [controlsDisabled, publishMotion]);

  useEffect(() => {
    if (disabled) {
      if (activated || activeMotionRef.current) {
        publishMotion(TELEOP_STOP);
      }
      activeMotionRef.current = null;
      setActiveLabel("");
      setActivated(false);
      return undefined;
    }
    const interval = window.setInterval(() => {
      if (activeMotionRef.current) {
        publishMotion(activeMotionRef.current);
      }
    }, TELEOP_REPEAT_MS);
    return () => window.clearInterval(interval);
  }, [activated, disabled, publishMotion]);

  useEffect(() => () => {
    if (activeMotionRef.current) {
      void onPublish(TELEOP_STOP);
    }
  }, [onPublish]);

  const commandByKey = useMemo(() => ({
    w: {
      label: "W",
      motion: { linearX: linearSpeed, angularZ: 0 },
    },
    s: {
      label: "S",
      motion: { linearX: -linearSpeed, angularZ: 0 },
    },
    a: {
      label: "A",
      motion: { linearX: 0, angularZ: angularSpeed },
    },
    d: {
      label: "D",
      motion: { linearX: 0, angularZ: -angularSpeed },
    },
  }), [angularSpeed, linearSpeed]);

  const handleKeyDown = useCallback((event) => {
    if (controlsDisabled || event.repeat || isTextInputTarget(event.target)) return;
    const key = event.key === " " ? "space" : event.key.toLowerCase();
    if (key === "space") {
      event.preventDefault();
      stopTeleop();
      return;
    }
    const command = commandByKey[key];
    if (!command) return;
    event.preventDefault();
    startTeleop(command.label, command.motion);
  }, [commandByKey, controlsDisabled, startTeleop, stopTeleop]);

  const handleKeyUp = useCallback((event) => {
    if (controlsDisabled) return;
    const key = event.key.toLowerCase();
    if (!commandByKey[key]) return;
    if (isTextInputTarget(event.target) && !activeMotionRef.current) return;
    event.preventDefault();
    stopTeleop();
  }, [commandByKey, controlsDisabled, stopTeleop]);

  useEffect(() => {
    if (controlsDisabled) return undefined;
    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
    };
  }, [controlsDisabled, handleKeyDown, handleKeyUp]);

  const updateLinearSpeed = (value) => {
    const nextSpeed = clampNumber(value, 0.05, 1.2);
    setLinearSpeed(nextSpeed);
    if (activeMotionRef.current?.linearX) {
      const direction = Math.sign(activeMotionRef.current.linearX);
      const nextMotion = { linearX: direction * nextSpeed, angularZ: 0 };
      activeMotionRef.current = nextMotion;
      publishMotion(nextMotion);
    }
  };

  const updateAngularSpeed = (value) => {
    const nextSpeed = clampNumber(value, 0.05, 2);
    setAngularSpeed(nextSpeed);
    if (activeMotionRef.current?.angularZ) {
      const direction = Math.sign(activeMotionRef.current.angularZ);
      const nextMotion = { linearX: 0, angularZ: direction * nextSpeed };
      activeMotionRef.current = nextMotion;
      publishMotion(nextMotion);
    }
  };

  const speedControlStyle = {
    accentColor: "var(--vscode-button-background)",
  };

  return (
    <Panel title="Mobile Teleop" className="grid gap-3 min-h-0 content-start overflow-auto">
      <div className="flex items-center justify-between gap-2">
        <div className="text-xs" style={{ color: MISSION_TEXT_MUTED }}>
          {disabled ? "Unavailable" : activated ? "Active" : "Inactive"}
        </div>
        <ActionButton
          active={activated}
          disabled={disabled}
          onClick={activated ? deactivateTeleop : activateTeleop}
          variant="secondary"
        >
          {activated ? "Deactivate" : "Activate"}
        </ActionButton>
      </div>
      <div
        role="group"
        aria-label="Mobile Teleop"
        tabIndex={controlsDisabled ? -1 : 0}
        className="grid gap-4 min-h-0 outline-none"
      >
        <div className="grid grid-cols-3 gap-2 justify-self-center">
          <div />
          <TeleopButton
            active={activeLabel === "W"}
            disabled={controlsDisabled}
            title="Forward"
            onStart={() => startTeleop("W", { linearX: linearSpeed, angularZ: 0 })}
            onStop={stopTeleop}
          >
            W
          </TeleopButton>
          <div />
          <TeleopButton
            active={activeLabel === "A"}
            disabled={controlsDisabled}
            title="Left"
            onStart={() => startTeleop("A", { linearX: 0, angularZ: angularSpeed })}
            onStop={stopTeleop}
          >
            A
          </TeleopButton>
          <TeleopButton
            disabled={controlsDisabled}
            title="Stop"
            onStart={stopTeleop}
            onStop={stopTeleop}
          >
            0
          </TeleopButton>
          <TeleopButton
            active={activeLabel === "D"}
            disabled={controlsDisabled}
            title="Right"
            onStart={() => startTeleop("D", { linearX: 0, angularZ: -angularSpeed })}
            onStop={stopTeleop}
          >
            D
          </TeleopButton>
          <div />
          <TeleopButton
            active={activeLabel === "S"}
            disabled={controlsDisabled}
            title="Backward"
            onStart={() => startTeleop("S", { linearX: -linearSpeed, angularZ: 0 })}
            onStop={stopTeleop}
          >
            S
          </TeleopButton>
          <div />
        </div>

        <div className="grid gap-2 min-w-0">
          <label className="grid grid-cols-[52px_1fr_44px] items-center gap-2 text-xs">
            <span style={{ color: MISSION_TEXT_MUTED }}>Linear</span>
            <input
              type="range"
              min="0.05"
              max="1.2"
              step="0.05"
              value={linearSpeed}
              disabled={controlsDisabled}
              onChange={(event) => updateLinearSpeed(event.currentTarget.value)}
              style={speedControlStyle}
            />
            <span className="font-mono text-right">{linearSpeed.toFixed(2)}</span>
          </label>
          <label className="grid grid-cols-[52px_1fr_44px] items-center gap-2 text-xs">
            <span style={{ color: MISSION_TEXT_MUTED }}>Angular</span>
            <input
              type="range"
              min="0.05"
              max="2"
              step="0.05"
              value={angularSpeed}
              disabled={controlsDisabled}
              onChange={(event) => updateAngularSpeed(event.currentTarget.value)}
              style={speedControlStyle}
            />
            <span className="font-mono text-right">{angularSpeed.toFixed(2)}</span>
          </label>
          <div className="grid grid-cols-2 gap-2">
            <SessionRow label="Topic" value={TELEOP_TOPIC} stacked />
            <SessionRow
              label="Command"
              value={disabled ? "Unavailable" : activated ? activeLabel || "Stop" : "Inactive"}
              stacked
            />
          </div>
        </div>
      </div>
    </Panel>
  );
}

function MissionFlowPanel({ spots, selectedSpotId, onSpotSelect }) {
  const orderedSpots = useMemo(() => (
    [...spots].sort((a, b) => String(a.label || a.id).localeCompare(String(b.label || b.id)))
  ), [spots]);

  return (
    <Panel title="Mission Flow" className="min-h-0 overflow-hidden">
      <div className="h-full min-h-0 grid grid-cols-1 lg:grid-cols-[minmax(220px,0.34fr)_minmax(0,1fr)] gap-3 overflow-hidden">
        <div
          className="min-h-0 border rounded-md p-3 grid content-start gap-3 overflow-auto"
          style={{
            backgroundColor: MISSION_SURFACE,
            borderColor: MISSION_PANEL_BORDER,
          }}
        >
          <div className="flex items-center justify-between gap-2 min-w-0">
            <div
              className="text-[10px] uppercase font-semibold"
              style={{ color: MISSION_TEXT_MUTED }}
            >
              Global BT
            </div>
            <span
              className="text-[10px] font-semibold"
              style={{ color: MISSION_TEXT_MUTED }}
            >
              {orderedSpots.length} waypoints
            </span>
          </div>
          <div className="grid gap-2">
            {[
              "Mission Root",
              "Navigate",
              "Local BT",
            ].map((label) => (
              <div
                key={label}
                className="h-8 px-3 border rounded-md flex items-center text-xs font-semibold"
                style={{
                  color: MISSION_TEXT,
                  backgroundColor: MISSION_STAGE_EMPTY,
                  borderColor: MISSION_PANEL_BORDER,
                }}
              >
                {label}
              </div>
            ))}
          </div>
        </div>

        <div className="min-h-0 overflow-auto">
          <div className="min-w-max flex items-center gap-2 pr-2">
            <div
              className="h-10 px-3 border rounded-md flex items-center text-xs font-semibold shrink-0"
              style={{
                color: MISSION_TEXT,
                backgroundColor: MISSION_STAGE_EMPTY,
                borderColor: MISSION_PANEL_BORDER,
              }}
            >
              Start
            </div>
            {orderedSpots.map((spot, index) => (
              <div key={spot.id} className="flex items-center gap-2 shrink-0">
                <div
                  className="w-8 h-px"
                  aria-hidden="true"
                  style={{ backgroundColor: MISSION_PANEL_BORDER }}
                />
                <button
                  type="button"
                  onClick={() => onSpotSelect(spot.id)}
                  className="w-44 h-20 border rounded-md p-2 text-left grid content-start gap-1 active:translate-y-px"
                  style={{
                    color: spot.id === selectedSpotId
                      ? "var(--vscode-button-foreground)"
                      : MISSION_TEXT,
                    backgroundColor: spot.id === selectedSpotId
                      ? "var(--vscode-button-background)"
                      : MISSION_STAGE_EMPTY,
                    borderColor: MISSION_PANEL_BORDER,
                  }}
                >
                  <span className="text-[10px] font-semibold" style={{
                    color: spot.id === selectedSpotId
                      ? "var(--vscode-button-foreground)"
                      : MISSION_TEXT_MUTED,
                  }}>
                    {`Step ${index + 1}`}
                  </span>
                  <span className="text-xs font-semibold truncate">{spot.label}</span>
                  <span className="text-[11px] font-mono truncate">
                    {spot.linked_bt_tree || "Local BT: none"}
                  </span>
                </button>
              </div>
            ))}
            <div
              className="w-8 h-px shrink-0"
              aria-hidden="true"
              style={{ backgroundColor: MISSION_PANEL_BORDER }}
            />
            <div
              className="h-10 px-3 border rounded-md flex items-center text-xs font-semibold shrink-0"
              style={{
                color: MISSION_TEXT,
                backgroundColor: MISSION_STAGE_EMPTY,
                borderColor: MISSION_PANEL_BORDER,
              }}
            >
              End
            </div>
            {orderedSpots.length === 0 && (
              <div className="h-10 px-3 flex items-center text-xs" style={{ color: MISSION_TEXT_MUTED }}>
                No waypoints for this map yet.
              </div>
            )}
          </div>
        </div>
      </div>
    </Panel>
  );
}

function ActionButton({
  children,
  active = false,
  disabled = false,
  onClick,
  title,
  type = "button",
  variant = "primary",
}) {
  const styles = {
    primary: {
      color: "var(--vscode-button-foreground)",
      backgroundColor: "var(--vscode-button-background)",
      borderColor: MISSION_BUTTON_BORDER,
    },
    secondary: {
      color: MISSION_TEXT,
      backgroundColor: MISSION_STAGE_EMPTY,
      borderColor: MISSION_BUTTON_BORDER,
    },
    danger: {
      color: "#ffffff",
      backgroundColor: "var(--vscode-inputValidation-errorBackground, #b91c1c)",
      borderColor: "var(--vscode-inputValidation-errorBorder, #ef4444)",
    },
  };
  const activeStyles = active
    ? {
      color: variant === "danger"
        ? styles.danger.color
        : MISSION_TEXT,
      backgroundColor: variant === "danger"
        ? styles.danger.backgroundColor
        : MISSION_SURFACE_STRONG,
      borderColor: variant === "danger" ? styles.danger.borderColor : MISSION_BUTTON_BORDER,
      boxShadow: "none",
    }
    : {};

  return (
    <button
      type={type}
      disabled={disabled}
      onClick={onClick}
      title={title}
      aria-pressed={active ? true : undefined}
      className={[
        "h-8 px-3 border rounded-md text-sm font-semibold transition-all active:translate-y-px",
        active ? "disabled:opacity-90" : "disabled:opacity-50",
        "disabled:active:translate-y-0",
      ].join(" ")}
      style={{ ...styles[variant], ...activeStyles }}
    >
      {children}
    </button>
  );
}

export default function MissionCanvasPage() {
  const initialSessionRef = useRef(null);
  if (initialSessionRef.current === null) {
    initialSessionRef.current = readMissionSession();
  }
  const initialSession = initialSessionRef.current;
  const restoredDesignMapPath = (
    typeof initialSession.designMapPath === "string" && initialSession.designMapPath.trim()
      ? initialSession.designMapPath.trim()
      : ""
  );
  const statusLoadingRef = useRef(false);
  const nomotionUpdateBusyRef = useRef(false);
  const tfBufferRef = useRef(new Map());
  const currentPoseRef = useRef(null);
  const amclPoseRef = useRef(null);
  const behaviorNodeSerialRef = useRef(0);
  const [mapName, setMapName] = useState(() => (
    typeof initialSession.mapName === "string" && initialSession.mapName.trim()
      ? initialSession.mapName
      : DEFAULT_MAP_NAME
  ));
  const [status, setStatus] = useState(null);
  const [spots, setSpots] = useState([]);
  const [selectedSpotId, setSelectedSpotId] = useState("");
  const [behaviorNodes, setBehaviorNodes] = useState([]);
  const [selectedBehaviorNodeId, setSelectedBehaviorNodeId] = useState("");
  const [pendingBehaviorNodeTag, setPendingBehaviorNodeTag] = useState("");
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("Ready");
  const [btNodeStatus, setBtNodeStatus] = useState({
    state: "unknown",
    raw: "not checked",
  });
  const [btNodeBusy, setBtNodeBusy] = useState("");
  const [btLayerSpotId, setBtLayerSpotId] = useState("");
  const [interactionMode, setInteractionMode] = useState("view");
  const [showWaypointOptions, setShowWaypointOptions] = useState(false);
  const [designPoseInitialized, setDesignPoseInitialized] = useState(() => (
    initialNavigationRuntimeMode(initialSession) === "localization" &&
    initialSession.designPoseInitialized === true
  ));
  const [navigationRuntimeMode, setNavigationRuntimeMode] = useState(() => (
    initialNavigationRuntimeMode(initialSession)
  ));
  const [tfBufferRevision, setTfBufferRevision] = useState(0);
  const [workspaceStage, setWorkspaceStage] = useState(() => initialWorkspaceStage(initialSession));
  const [showPgmFix, setShowPgmFix] = useState(false);
  const [showSaveMapDialog, setShowSaveMapDialog] = useState(false);
  const [saveMapName, setSaveMapName] = useState(DEFAULT_MAP_NAME);
  const [showDesignMapDialog, setShowDesignMapDialog] = useState(false);
  const [designMapFiles, setDesignMapFiles] = useState([]);
  const [designMapPath, setDesignMapPath] = useState(restoredDesignMapPath);
  const [pendingDesignMapPath, setPendingDesignMapPath] = useState(restoredDesignMapPath);
  const [designMapBusy, setDesignMapBusy] = useState(false);
  const [designMapReloadToken, setDesignMapReloadToken] = useState(0);
  const [showRunMapDialog, setShowRunMapDialog] = useState(false);
  const [runMapFiles, setRunMapFiles] = useState([]);
  const [runMapPath, setRunMapPath] = useState("");
  const [runMapBusy, setRunMapBusy] = useState(false);
  const [mapEditorReloadToken, setMapEditorReloadToken] = useState(0);
  const [layersByStage, setLayersByStage] = useState(() => ({
    [STAGE_MAPPING]: { ...LAYER_PRESETS[STAGE_MAPPING] },
    [STAGE_AUTHORING]: { ...LAYER_PRESETS[STAGE_AUTHORING] },
    [STAGE_RUN]: { ...LAYER_PRESETS[STAGE_RUN] },
  }));
  const publishRosTopic = useNavigationRosPublisher();

  const running = status?.is_up ?? false;
  const mappingEditorActive = workspaceStage === STAGE_MAPPING && showPgmFix;
  const designMapActive = workspaceStage === STAGE_AUTHORING && !!designMapPath;
  const robotPoseCaptureActive = workspaceStage === STAGE_AUTHORING && designMapActive;
  const mappingRuntimeActive = running && navigationRuntimeMode === "mapping";
  const runRuntimeActive = running && navigationRuntimeMode === "run";
  const designLocalizationActive = (
    workspaceStage === STAGE_AUTHORING &&
    designMapActive &&
    running &&
    navigationRuntimeMode === "localization"
  );
  const mappingTopicsActive = (
    workspaceStage === STAGE_MAPPING &&
    mappingRuntimeActive &&
    busy !== "Stop" &&
    !mappingEditorActive
  );
  const runTopicsActive = (
    workspaceStage === STAGE_RUN &&
    runRuntimeActive &&
    busy !== "Stop"
  );
  const stageNavigationTopicsActive = mappingTopicsActive || runTopicsActive;
  const activeLayers = layersByStage[workspaceStage] || LAYER_PRESETS[workspaceStage];
  const currentMapName = mapName.trim() || DEFAULT_MAP_NAME;
  const mapEditor = useMapEditor({
    open: mappingEditorActive,
    mapName: currentMapName,
    onMessage: setMessage,
    reloadToken: mapEditorReloadToken,
  });
  const designMapEditor = useMapEditor({
    open: designMapActive,
    mapName: currentMapName,
    onMessage: setMessage,
    reloadToken: designMapReloadToken,
  });
  const needsGlobalCostmap = stageNavigationTopicsActive && activeLayers.globalCostmap;
  const needsLocalCostmap = stageNavigationTopicsActive && activeLayers.localCostmap;
  const needsScan = designLocalizationActive || (stageNavigationTopicsActive && activeLayers.scan);
  const needsGoalPose = stageNavigationTopicsActive && activeLayers.goalPose;
  const needsPlan = stageNavigationTopicsActive && activeLayers.globalPlan;
  const needsRobotModel = designLocalizationActive || (
    stageNavigationTopicsActive && activeLayers.robotModel
  );
  const needsAmclPose = robotPoseCaptureActive || (
    stageNavigationTopicsActive && (needsRobotModel || needsScan)
  );
  const needsTf = robotPoseCaptureActive || (
    stageNavigationTopicsActive && (
      activeLayers.tf ||
      activeLayers.scan ||
      activeLayers.robotModel
    )
  );
  const needsMap = (
    stageNavigationTopicsActive ||
    designLocalizationActive
  ) && activeLayers.map;
  const needsBtTopics = (
    workspaceStage === STAGE_AUTHORING ||
    workspaceStage === STAGE_RUN
  );
  const activeBehaviorNodes = useMemo(
    () => behaviorNodes.filter((node) => node.map_name === currentMapName),
    [behaviorNodes, currentMapName],
  );
  const selectedBehaviorNode = useMemo(
    () => activeBehaviorNodes.find((node) => node.id === selectedBehaviorNodeId) || null,
    [activeBehaviorNodes, selectedBehaviorNodeId],
  );
  const behaviorPreviewNode = useMemo(() => (
    pendingBehaviorNodeTag ? behaviorNodeDefinition(pendingBehaviorNodeTag) : null
  ), [pendingBehaviorNodeTag]);
  const { topicData: mapData } = useNavigationRosTopic(
    needsMap ? "/map" : null,
  );
  const { topicData: globalCostmapData } = useNavigationRosTopic(
    needsGlobalCostmap ? "/global_costmap/costmap" : null,
  );
  const { topicData: localCostmapData } = useNavigationRosTopic(
    needsLocalCostmap ? "/local_costmap/costmap" : null,
  );
  const { topicData: footprintData } = useNavigationRosTopic(
    needsRobotModel ? "/local_costmap/published_footprint" : null,
    ROS2_WS_FAST_TOPIC_OPTIONS,
  );
  const { topicData: scanData } = useNavigationRosTopic(
    needsScan ? "/scan" : null,
    ROS2_WS_FAST_TOPIC_OPTIONS,
  );
  const { topicData: amclData } = useNavigationRosTopic(
    needsAmclPose ? "/amcl_pose" : null,
    ROS2_WS_FAST_TOPIC_OPTIONS,
  );
  const { topicData: planData } = useNavigationRosTopic(
    needsPlan ? "/plan" : null,
  );
  const { topicData: goalPoseData } = useNavigationRosTopic(
    needsGoalPose ? "/goal_pose" : null,
  );
  const { topicData: tfData } = useNavigationRosTopic(
    needsTf ? "/tf" : null,
    ROS2_WS_FAST_TOPIC_OPTIONS,
  );
  const { topicData: tfStaticData } = useNavigationRosTopic(
    needsTf ? "/tf_static" : null,
  );
  const { topicData: btStatusData } = useNavigationRosTopic(
    needsBtTopics ? "/bt/status" : null,
    BT_TOPIC_OPTIONS,
  );
  const { topicData: btActiveNodesData } = useNavigationRosTopic(
    needsBtTopics ? "/bt/active_nodes" : null,
    BT_TOPIC_OPTIONS,
  );
  const map = useMemo(() => messageData(mapData), [mapData]);
  const globalCostmap = useMemo(() => messageData(globalCostmapData), [globalCostmapData]);
  const localCostmap = useMemo(() => messageData(localCostmapData), [localCostmapData]);
  const footprint = useMemo(() => messageData(footprintData), [footprintData]);
  const scan = useMemo(() => messageData(scanData), [scanData]);
  const amclPose = useMemo(() => messageData(amclData), [amclData]);
  const plan = useMemo(() => messageData(planData), [planData]);
  const goalPose = useMemo(() => messageData(goalPoseData), [goalPoseData]);
  const tf = useMemo(() => messageData(tfData), [tfData]);
  const tfStatic = useMemo(() => messageData(tfStaticData), [tfStaticData]);
  const btStatusText = useMemo(() => rosStringData(btStatusData), [btStatusData]);
  const btActiveNodesText = useMemo(() => {
    const names = rosStringData(btActiveNodesData)
      .split(",")
      .map((name) => name.trim())
      .filter(Boolean);
    return names.join(", ");
  }, [btActiveNodesData]);
  const btNodeIsUp = btNodeStatus.state === "up";
  const latestTf = useMemo(() => mergeTfMessages(tfStatic, tf), [tf, tfStatic]);
  void tfBufferRevision;
  const bufferedTf = tfMessageFromBuffer(tfBufferRef.current) ?? latestTf;
  const fallbackPose = amclPose?.pose?.pose ?? null;
  const currentPose = poseFromBaseLinkTf(bufferedTf) ?? fallbackPose;
  const displayedMap = mappingEditorActive
    ? mapEditor.map
    : workspaceStage === STAGE_AUTHORING
      ? designMapActive ? designMapEditor.map : null
      : map;
  const designMapAvailable = designMapActive && !!designMapEditor.map;
  const missionOverlayActive = (
    workspaceStage === STAGE_RUN ||
    (workspaceStage === STAGE_AUTHORING && designMapAvailable)
  );
  const visibleSpots = useMemo(
    () => spots.map((spot) => spotForMapDisplay(spot, displayedMap)),
    [displayedMap, spots],
  );
  const selectedSpot = useMemo(
    () => visibleSpots.find((spot) => spot.id === selectedSpotId) || null,
    [selectedSpotId, visibleSpots],
  );
  const selectedBtLayerSpot = useMemo(
    () => visibleSpots.find((spot) => spot.id === btLayerSpotId) || null,
    [btLayerSpotId, visibleSpots],
  );
  const btLayerExecutionLabel = btExecutionLabel(btStatusText, btNodeIsUp);
  const btLayerActiveNodesLabel = btActiveNodesLabel(
    btActiveNodesText,
    btNodeIsUp,
    btLayerExecutionLabel,
  );
  const waypointBtLayer = (
    workspaceStage === STAGE_AUTHORING &&
    btNodeIsUp &&
    selectedBtLayerSpot
  ) ? {
      spot: selectedBtLayerSpot,
      nodeLabel: btNodeStateLabel(btNodeStatus.state),
      executionLabel: btLayerExecutionLabel,
      activeNodesLabel: btLayerActiveNodesLabel,
    }
    : null;
  const layerToggles = useMemo(() => (
    STAGE_LAYER_IDS[workspaceStage].map((id) => ({
      id,
      label: LAYER_DEFINITIONS[id],
      checked: !!activeLayers[id],
      onChange: (checked) => {
        setLayersByStage((current) => ({
          ...current,
          [workspaceStage]: {
            ...current[workspaceStage],
            [id]: checked,
          },
        }));
      },
    }))
  ), [activeLayers, workspaceStage]);
  const topicRows = useMemo(() => {
    const liveByTopic = {
      "/map": !!map,
      "/scan": !!scan,
      "/amcl_pose": !!amclPose,
      "/tf": !!(tf?.transforms?.length),
      "/tf_static": !!(tfStatic?.transforms?.length),
      "/local_costmap/published_footprint": !!(footprint?.polygon?.points?.length),
      "/global_costmap/costmap": !!globalCostmap,
      "/local_costmap/costmap": !!localCostmap,
      "/plan": !!plan,
      "/goal_pose": !!goalPose,
      "/bt/status": hasTopicMessage(btStatusData) || btNodeIsUp,
      "/bt/active_nodes": hasTopicMessage(btActiveNodesData) || btNodeIsUp,
    };
    const selectedTopics = new Set(STAGE_EXTRA_TOPIC_IDS[workspaceStage] || []);
    (STAGE_LAYER_IDS[workspaceStage] || []).forEach((layerId) => {
      if (!activeLayers[layerId]) return;
      (LAYER_TOPIC_IDS[layerId] || []).forEach((topic) => selectedTopics.add(topic));
    });
    if (workspaceStage === STAGE_AUTHORING && !designLocalizationActive) {
      selectedTopics.delete("/map");
      selectedTopics.delete("/scan");
      selectedTopics.delete("/amcl_pose");
      selectedTopics.delete("/tf");
      selectedTopics.delete("/tf_static");
      selectedTopics.delete("/local_costmap/published_footprint");
    }
    if (designLocalizationActive) {
      ["/scan", "/amcl_pose", "/tf", "/tf_static", "/local_costmap/published_footprint"].forEach((topic) => {
        selectedTopics.add(topic);
      });
    }
    if (workspaceStage === STAGE_MAPPING) {
      selectedTopics.delete("/amcl_pose");
    }
    return TOPIC_ORDER.filter((topic) => selectedTopics.has(topic)).map((topic) => ({
      topic,
      isLive: !!liveByTopic[topic],
    }));
  }, [
    activeLayers,
    amclPose,
    btActiveNodesData,
    btStatusData,
    btNodeIsUp,
    footprint,
    globalCostmap,
    goalPose,
    localCostmap,
    map,
    plan,
    scan,
    tf,
    tfStatic,
    workspaceStage,
    designLocalizationActive,
  ]);
  const teleopDisabled = !!busy || mappingEditorActive;

  const loadStatus = useCallback(async () => {
    if (statusLoadingRef.current || document.visibilityState === "hidden") {
      return;
    }
    statusLoadingRef.current = true;
    try {
      setStatus(await getServiceStatus());
    } catch {
      setStatus((current) => current);
    } finally {
      statusLoadingRef.current = false;
    }
  }, []);

  const refreshBtNodeStatus = useCallback(async ({ quiet = false } = {}) => {
    try {
      const nextStatus = await getBtNodeServiceStatus();
      setBtNodeStatus(nextStatus);
      return nextStatus;
    } catch (error) {
      const nextStatus = {
        state: "unknown",
        raw: error instanceof Error ? error.message : "status failed",
      };
      setBtNodeStatus(nextStatus);
      if (!quiet) {
        setMessage(error instanceof Error ? error.message : "BT node status failed");
      }
      return nextStatus;
    }
  }, []);

  const loadSpots = useCallback(async () => {
    try {
      const result = await getNavigationSpots(mapName.trim() || DEFAULT_MAP_NAME);
      setSpots(result.spots || []);
      setSelectedSpotId((current) => (
        result.spots?.some((spot) => spot.id === current) ? current : ""
      ));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Failed to load waypoints");
    }
  }, [mapName]);

  useEffect(() => {
    void loadStatus();
    const interval = window.setInterval(loadStatus, STATUS_POLL_MS);
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") void loadStatus();
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [loadStatus]);

  useEffect(() => {
    if (!needsBtTopics || document.visibilityState === "hidden") return undefined;
    void refreshBtNodeStatus({ quiet: true });
    const interval = window.setInterval(() => {
      void refreshBtNodeStatus({ quiet: true });
    }, BT_NODE_STATUS_POLL_MS);
    return () => {
      window.clearInterval(interval);
    };
  }, [needsBtTopics, refreshBtNodeStatus]);

  useEffect(() => {
    if (!btLayerSpotId) return;
    if (
      workspaceStage !== STAGE_AUTHORING ||
      !btNodeIsUp ||
      !visibleSpots.some((spot) => spot.id === btLayerSpotId)
    ) {
      setBtLayerSpotId("");
    }
  }, [btLayerSpotId, btNodeIsUp, visibleSpots, workspaceStage]);

  useEffect(() => {
    void loadSpots();
  }, [loadSpots]);

  useEffect(() => {
    currentPoseRef.current = currentPose;
  }, [currentPose]);

  useEffect(() => {
    amclPoseRef.current = amclPose;
  }, [amclPose]);

  useEffect(() => {
    saveMissionSession({
      mapName: currentMapName,
      workspaceStage,
      designMapPath,
      navigationRuntimeMode,
      designPoseInitialized,
    });
  }, [currentMapName, designMapPath, designPoseInitialized, navigationRuntimeMode, workspaceStage]);

  useEffect(() => {
    const statusMode = navigationRuntimeModeFromStatus(status);
    if (statusMode) {
      setNavigationRuntimeMode(statusMode);
      if (statusMode === "idle") setDesignPoseInitialized(false);
    }
  }, [status]);

  useEffect(() => {
    if (!designLocalizationActive || !designPoseInitialized) {
      return undefined;
    }
    let cancelled = false;
    const tick = async () => {
      if (cancelled || nomotionUpdateBusyRef.current) return;
      nomotionUpdateBusyRef.current = true;
      try {
        await requestNoMotionUpdate();
      } catch (error) {
        console.warn("No-motion AMCL update failed:", error);
      } finally {
        nomotionUpdateBusyRef.current = false;
      }
    };
    void tick();
    const interval = window.setInterval(tick, NOMOTION_UPDATE_INTERVAL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [designLocalizationActive, designPoseInitialized]);

  useEffect(() => {
    if (updateTfBuffer(tfBufferRef.current, latestTf)) {
      setTfBufferRevision((value) => value + 1);
    }
  }, [latestTf]);

  const clearLocalizationPoseCache = useCallback(() => {
    tfBufferRef.current.clear();
    currentPoseRef.current = null;
    amclPoseRef.current = null;
    setTfBufferRevision((value) => value + 1);
  }, []);

  useEffect(() => {
    if (!mappingEditorActive || !mapEditor.selectedPath) return;
    const loadedMapName = mapNameFromPgmPath(mapEditor.selectedPath);
    if (loadedMapName !== currentMapName) {
      setMapName(loadedMapName);
    }
  }, [currentMapName, mapEditor.selectedPath, mappingEditorActive]);

  const runCommand = useCallback(async (label, action) => {
    setBusy(label);
    try {
      const result = await action();
      if (typeof result === "string") {
        setMessage(result);
      } else {
        setMessage(result?.message || `${label} complete`);
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : `${label} failed`);
    } finally {
      setBusy("");
      void loadStatus();
    }
  }, [loadStatus]);

  const publishTeleopCommand = useCallback((motion) => (
    publishRosTopic(TELEOP_TOPIC, TELEOP_MESSAGE_TYPE, teleopTwist(motion))
  ), [publishRosTopic]);

  const handleBtNodeActivate = useCallback(async () => {
    setBtNodeBusy("activate");
    try {
      await setBtNodeServiceActive(true);
      setMessage("BT node activated");
      await refreshBtNodeStatus({ quiet: true });
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Failed to activate BT node");
      await refreshBtNodeStatus({ quiet: true });
    } finally {
      setBtNodeBusy("");
    }
  }, [refreshBtNodeStatus]);

  const handleBtNodeDeactivate = useCallback(async () => {
    setBtNodeBusy("deactivate");
    try {
      await setBtNodeServiceActive(false);
      setMessage("BT node deactivated");
      await refreshBtNodeStatus({ quiet: true });
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Failed to deactivate BT node");
      await refreshBtNodeStatus({ quiet: true });
    } finally {
      setBtNodeBusy("");
    }
  }, [refreshBtNodeStatus]);

  const loadSavedDesignForMap = useCallback((targetMapName) => {
    const savedNodes = savedBehaviorNodesForMap(targetMapName);
    if (!savedNodes) return false;
    setBehaviorNodes((current) => [
      ...current.filter((node) => node.map_name !== targetMapName),
      ...savedNodes,
    ]);
    behaviorNodeSerialRef.current = Math.max(
      behaviorNodeSerialRef.current,
      behaviorNodeSerialFromNodes(savedNodes),
    );
    return true;
  }, []);

  const handleOpenDesignMapDialog = useCallback(() => {
    setWorkspaceStage(STAGE_AUTHORING);
    setShowPgmFix(false);
    setShowWaypointOptions(false);
    setShowDesignMapDialog(true);
    setPendingDesignMapPath(designMapPath);
    setDesignMapBusy(true);
    setMessage("Loading saved maps");
    getPgmFiles()
      .then((response) => {
        const files = response.files || [];
        const existing = files.find((file) => file.path === designMapPath);
        const preferred = existing
          || files.find((file) => mapNameFromPgmPath(file.path) === currentMapName)
          || files[0];
        setDesignMapFiles(files);
        setPendingDesignMapPath(preferred?.path || "");
        if (!files.length) {
          setMessage("No PGM files found");
        }
      })
      .catch((error) => {
        setMessage(error instanceof Error ? error.message : "Failed to list PGM files");
      })
      .finally(() => setDesignMapBusy(false));
  }, [currentMapName, designMapPath]);

  const handleConfirmDesignMap = useCallback(() => {
    if (!pendingDesignMapPath) {
      setMessage("Map file required");
      return;
    }
    const selectedMapName = mapNameFromPgmPath(pendingDesignMapPath);
    if (!selectedMapName) {
      setMessage("Map file required");
      return;
    }
    setMapName(selectedMapName);
    setDesignMapPath(pendingDesignMapPath);
    setShowDesignMapDialog(false);
    setWorkspaceStage(STAGE_AUTHORING);
    setInteractionMode("view");
    setDesignMapReloadToken((value) => value + 1);
    const loadedDesign = loadSavedDesignForMap(selectedMapName);
    saveMissionSession({
      mapName: selectedMapName,
      workspaceStage: STAGE_AUTHORING,
      designMapPath: pendingDesignMapPath,
      navigationRuntimeMode,
    });
    setMessage(loadedDesign
      ? `Loaded design for ${selectedMapName}`
      : `Loaded map ${selectedMapName}`);
  }, [loadSavedDesignForMap, navigationRuntimeMode, pendingDesignMapPath]);

  const handleSaveDesign = useCallback(() => {
    try {
      saveBehaviorNodesForMap(currentMapName, activeBehaviorNodes);
      setMessage(`Saved design for ${currentMapName}`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Failed to save design");
    }
  }, [activeBehaviorNodes, currentMapName]);

  const handleRunMission = useCallback(() => runCommand(
    "Run mission",
    async () => {
      setWorkspaceStage(STAGE_RUN);
      await startNavigation("nav", mapName.trim() || DEFAULT_MAP_NAME);
      setNavigationRuntimeMode("run");
      setDesignPoseInitialized(false);
      saveMissionSession({
        mapName: mapName.trim() || DEFAULT_MAP_NAME,
        workspaceStage: STAGE_RUN,
        navigationRuntimeMode: "run",
        designPoseInitialized: false,
      });
    },
  ), [mapName, runCommand]);

  const handleOpenRunMapDialog = useCallback(() => {
    setWorkspaceStage(STAGE_RUN);
    setShowPgmFix(false);
    setShowRunMapDialog(true);
    setRunMapBusy(true);
    setMessage("Loading saved maps");
    getPgmFiles()
      .then((response) => {
        const files = response.files || [];
        const preferred = files.find((file) => mapNameFromPgmPath(file.path) === currentMapName)
          || files[0];
        setRunMapFiles(files);
        setRunMapPath(preferred?.path || "");
        if (!files.length) {
          setMessage("No PGM files found");
        }
      })
      .catch((error) => {
        setMessage(error instanceof Error ? error.message : "Failed to list PGM files");
      })
      .finally(() => setRunMapBusy(false));
  }, [currentMapName]);

  const handleConfirmRunMap = useCallback(() => {
    const selectedMapName = mapNameFromPgmPath(runMapPath);
    if (!selectedMapName) {
      setMessage("Map file required");
      return;
    }
    setMapName(selectedMapName);
    setShowRunMapDialog(false);
    setWorkspaceStage(STAGE_RUN);
    setInteractionMode("view");
    setMessage(`Loaded map ${selectedMapName}`);
  }, [runMapPath]);

  const handleStartMapping = useCallback(() => runCommand(
    "Mapping",
    async () => {
      setWorkspaceStage(STAGE_MAPPING);
      setShowPgmFix(false);
      await startNavigation("map", mapName.trim() || DEFAULT_MAP_NAME);
      setNavigationRuntimeMode("mapping");
      setDesignPoseInitialized(false);
      saveMissionSession({
        mapName: mapName.trim() || DEFAULT_MAP_NAME,
        workspaceStage: STAGE_MAPPING,
        navigationRuntimeMode: "mapping",
        designPoseInitialized: false,
      });
    },
  ), [mapName, runCommand]);

  const handleOpenSaveMapDialog = useCallback(() => {
    setSaveMapName(currentMapName);
    setShowSaveMapDialog(true);
  }, [currentMapName]);

  const handleConfirmSaveMap = useCallback(() => {
    const targetMapName = saveMapName.trim();
    if (!targetMapName) {
      setMessage("Map name required");
      return;
    }
    void runCommand(
      "Save map",
      async () => {
        const result = await saveNavigationMap(targetMapName);
        setMapName(targetMapName);
        setWorkspaceStage(STAGE_MAPPING);
        setInteractionMode("view");
        setMapEditorReloadToken((value) => value + 1);
        setShowSaveMapDialog(false);
        return result;
      },
    );
  }, [runCommand, saveMapName]);

  const handleToggleMapEditor = useCallback(() => {
    setWorkspaceStage(STAGE_MAPPING);
    setInteractionMode("view");
    if (!showPgmFix) {
      setMessage("Loading saved maps");
    }
    setShowPgmFix((value) => !value);
  }, [showPgmFix]);

  const handleStopNavigation = useCallback(() => runCommand(
    "Stop",
    async () => {
      const result = await stopNavigation();
      setNavigationRuntimeMode("idle");
      setDesignPoseInitialized(false);
      saveMissionSession({ navigationRuntimeMode: "idle", designPoseInitialized: false });
      return result;
    },
  ), [runCommand]);

  const handleSelectSpot = useCallback((spotId) => {
    setSelectedSpotId(spotId);
    setSelectedBehaviorNodeId("");
    setPendingBehaviorNodeTag("");
    setShowWaypointOptions(false);
    setInteractionMode("view");
    if (workspaceStage === STAGE_AUTHORING && btNodeIsUp) {
      setBtLayerSpotId(spotId);
    } else {
      setBtLayerSpotId("");
    }
  }, [btNodeIsUp, workspaceStage]);

  const handleSelectBehaviorNode = useCallback((nodeId) => {
    setSelectedBehaviorNodeId(nodeId);
    setSelectedSpotId("");
    setPendingBehaviorNodeTag("");
    setShowWaypointOptions(false);
    setBtLayerSpotId("");
    setInteractionMode("view");
  }, []);

  const handleSelectBehaviorPaletteNode = useCallback((tag) => {
    setWorkspaceStage(STAGE_AUTHORING);
    setPendingBehaviorNodeTag(tag);
    setSelectedSpotId("");
    setBtLayerSpotId("");
    setShowWaypointOptions(false);
    setInteractionMode("behavior");
    setMessage(`${tag} selected`);
  }, []);

  const handleToggleWaypointOptions = useCallback(() => {
    setWorkspaceStage(STAGE_AUTHORING);
    setShowWaypointOptions((value) => !value);
  }, []);

  const handleToggleSpotMode = useCallback(() => {
    setWorkspaceStage(STAGE_AUTHORING);
    setPendingBehaviorNodeTag("");
    setSelectedBehaviorNodeId("");
    setBtLayerSpotId("");
    setShowWaypointOptions(false);
    setInteractionMode((value) => (value === "spot" ? "view" : "spot"));
  }, []);

  const waitForAutoLocalizedPose = useCallback(async () => {
    let latestPose = null;
    for (let attempt = 0; attempt < AUTO_LOCALIZE_MAX_UPDATES; attempt += 1) {
      await requestNoMotionUpdate();
      await delay(AUTO_LOCALIZE_UPDATE_DELAY_MS);
      const amclPoseMessage = amclPoseRef.current;
      const pose = amclPoseMessage?.pose?.pose;
      if (pose?.position) {
        latestPose = pose;
        if (
          attempt + 1 >= AUTO_LOCALIZE_MIN_UPDATES &&
          amclPoseLooksLocalized(amclPoseMessage)
        ) {
          return pose;
        }
      }
    }
    if (latestPose?.position) return latestPose;
    throw new Error("Robot pose unavailable after automatic localization");
  }, []);

  const handleCreateSpotAtPose = useCallback(async (x, y, yaw) => {
    if (interactionMode === "initial") {
      setInteractionMode("view");
      setShowWaypointOptions(false);
      void runCommand(
        "At Robot",
        async () => {
          clearLocalizationPoseCache();
          await sendInitialPoseEstimate({
            x,
            y,
            yaw,
            frameId: "map",
            mapName: currentMapName,
          });
          setDesignPoseInitialized(true);
          saveMissionSession({ designPoseInitialized: true });
          const localizedPose = await waitForAutoLocalizedPose();
          const position = localizedPose.position;
          const localizedX = Number(position.x ?? 0);
          const localizedY = Number(position.y ?? 0);
          const localizedYaw = yawFromPose(localizedPose);
          const label = `Waypoint ${spots.length + 1}`;
          const created = await createNavigationSpot({
            map_name: currentMapName,
            label,
            pose: spotPoseFromMapPose(localizedX, localizedY, localizedYaw),
            metadata: { source: "mission_canvas", coordinate_space: "map" },
          });
          setSpots((current) => [...current, created]);
          setSelectedSpotId(created.id);
          setSelectedBehaviorNodeId("");
          await stopNavigation();
          setNavigationRuntimeMode("idle");
          setDesignPoseInitialized(false);
          saveMissionSession({
            mapName: currentMapName,
            workspaceStage: STAGE_AUTHORING,
            designMapPath,
            navigationRuntimeMode: "idle",
            designPoseInitialized: false,
          });
          return `Created ${created.label} at robot`;
        },
      );
      return;
    }
    if (interactionMode === "behavior" && pendingBehaviorNodeTag) {
      const definition = behaviorNodeDefinition(pendingBehaviorNodeTag);
      behaviorNodeSerialRef.current += 1;
      const index = behaviorNodeSerialRef.current;
      const node = {
        id: behaviorNodeId(pendingBehaviorNodeTag, index),
        map_name: currentMapName,
        tag: pendingBehaviorNodeTag,
        label: pendingBehaviorNodeTag,
        category: definition.category || "action",
        pose: spotPoseFromMapPose(x, y, yaw),
        metadata: { source: "mission_canvas" },
      };
      setBehaviorNodes((current) => [...current, node]);
      setSelectedBehaviorNodeId(node.id);
      setSelectedSpotId("");
      setPendingBehaviorNodeTag("");
      setInteractionMode("view");
      setMessage(`Placed ${node.tag}`);
      return;
    }
    if (interactionMode !== "spot") return;
    const label = `Waypoint ${spots.length + 1}`;
    try {
      const created = await createNavigationSpot({
        map_name: currentMapName,
        label,
        pose: spotPoseFromMapPose(x, y, yaw),
        metadata: { source: "mission_canvas", coordinate_space: "map" },
      });
      setSpots((current) => [...current, created]);
      setSelectedSpotId(created.id);
      setSelectedBehaviorNodeId("");
      setMessage(`Created ${created.label}`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Failed to create waypoint");
    }
  }, [
    currentMapName,
    clearLocalizationPoseCache,
    designMapPath,
    interactionMode,
    pendingBehaviorNodeTag,
    runCommand,
    spots.length,
    waitForAutoLocalizedPose,
  ]);

  const handleCreateSpotAtRobot = useCallback(() => {
    if (!designMapAvailable || !designMapPath) {
      setMessage("Load a map before creating a waypoint");
      return;
    }
    const resolvedDesignMapPath = designMapPath;
    setWorkspaceStage(STAGE_AUTHORING);
    setPendingBehaviorNodeTag("");
    setSelectedBehaviorNodeId("");
    setSelectedSpotId("");
    setShowWaypointOptions(false);
    setDesignPoseInitialized(false);
    clearLocalizationPoseCache();
    void runCommand(
      "At Robot",
      async () => {
        await startNavigation("localize", currentMapName);
        await configureDesignLocalizationAmcl();
        setNavigationRuntimeMode("localization");
        saveMissionSession({
          mapName: currentMapName,
          workspaceStage: STAGE_AUTHORING,
          designMapPath: resolvedDesignMapPath,
          navigationRuntimeMode: "localization",
          designPoseInitialized: false,
        });
        setInteractionMode("initial");
        return "Click and drag the robot pose on the map";
      },
    );
  }, [
    currentMapName,
    clearLocalizationPoseCache,
    designMapAvailable,
    designMapPath,
    runCommand,
  ]);

  const handleMoveSpot = useCallback(async (spotId, x, y, yaw) => {
    const spot = spots.find((item) => item.id === spotId);
    if (!spot) return;
    const nextPose = spotPoseFromMapPose(x, y, yaw ?? spot.pose?.yaw ?? 0);
    setSpots((current) => current.map((item) => (
      item.id === spotId ? { ...item, pose: nextPose } : item
    )));
    try {
      const updated = await updateNavigationSpot(spotId, {
        map_name: spot.map_name,
        pose: nextPose,
        metadata: {
          ...(spot.metadata ?? {}),
          coordinate_space: "map",
        },
      });
      setSpots((current) => current.map((item) => (
        item.id === updated.id ? updated : item
      )));
      setMessage(`Moved ${updated.label || spot.label}`);
    } catch (error) {
      setSpots((current) => current.map((item) => (
        item.id === spotId ? spot : item
      )));
      setMessage(error instanceof Error ? error.message : "Failed to move waypoint");
    }
  }, [spots]);

  const handleMoveBehaviorNode = useCallback((nodeId, x, y, yaw) => {
    setBehaviorNodes((current) => current.map((node) => (
      node.id === nodeId
        ? {
          ...node,
          pose: spotPoseFromMapPose(x, y, yaw ?? node.pose?.yaw ?? 0),
        }
        : node
    )));
    const node = behaviorNodes.find((item) => item.id === nodeId);
    setMessage(`Moved ${node?.tag || "node"}`);
  }, [behaviorNodes]);

  const handleOpenSelectedSpotBt = useCallback(() => {
    if (!selectedSpot) return;
    if (!btNodeIsUp) {
      setMessage("Activate BT before opening waypoint BT");
      return;
    }
    setBtLayerSpotId(selectedSpot.id);
  }, [btNodeIsUp, selectedSpot]);

  const handleRenameSpot = useCallback(async (event) => {
    if (!selectedSpot) return;
    const label = event.currentTarget.value;
    setSpots((current) => current.map((spot) => (
      spot.id === selectedSpot.id ? { ...spot, label } : spot
    )));
    try {
      const updated = await updateNavigationSpot(selectedSpot.id, {
        map_name: selectedSpot.map_name,
        label,
      });
      setSpots((current) => current.map((spot) => (
        spot.id === updated.id ? updated : spot
      )));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Failed to update waypoint");
    }
  }, [selectedSpot]);

  const handleDeleteSelectedSpot = useCallback(async () => {
    if (!selectedSpot) return;
    try {
      await deleteNavigationSpot(selectedSpot.id, selectedSpot.map_name);
      setSpots((current) => current.filter((spot) => spot.id !== selectedSpot.id));
      setSelectedSpotId("");
      setBtLayerSpotId("");
      setMessage(`Deleted ${selectedSpot.label}`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Failed to delete waypoint");
    }
  }, [selectedSpot]);

  const handleDeleteSelectedBehaviorNode = useCallback(() => {
    if (!selectedBehaviorNode) return;
    setBehaviorNodes((current) => current.filter((node) => (
      node.id !== selectedBehaviorNode.id
    )));
    setSelectedBehaviorNodeId("");
    setMessage(`Deleted ${selectedBehaviorNode.tag}`);
  }, [selectedBehaviorNode]);

  return (
    <div className="mission-canvas-page h-full min-h-[560px] flex flex-col overflow-hidden p-4">
      <SaveMapDialog
        open={showSaveMapDialog}
        value={saveMapName}
        busy={!!busy}
        onChange={setSaveMapName}
        onCancel={() => setShowSaveMapDialog(false)}
        onSubmit={handleConfirmSaveMap}
      />
      <LoadMapDialog
        open={showDesignMapDialog}
        files={designMapFiles}
        selectedPath={pendingDesignMapPath}
        busy={designMapBusy}
        selectAriaLabel="Design map file"
        onChange={setPendingDesignMapPath}
        onCancel={() => {
          setPendingDesignMapPath(designMapPath);
          setShowDesignMapDialog(false);
        }}
        onSubmit={handleConfirmDesignMap}
      />
      <LoadMapDialog
        open={showRunMapDialog}
        files={runMapFiles}
        selectedPath={runMapPath}
        busy={runMapBusy}
        selectAriaLabel="Run map file"
        onChange={setRunMapPath}
        onCancel={() => setShowRunMapDialog(false)}
        onSubmit={handleConfirmRunMap}
      />
      <header
        className="shrink-0 border-b pb-3 mb-4 flex flex-col xl:flex-row xl:items-center xl:justify-between gap-3"
        style={{ borderColor: MISSION_BORDER }}
      >
        <div className="min-w-0">
          <h1 className="text-xl font-bold" style={{ color: "var(--vscode-foreground)" }}>
            Mission Canvas
          </h1>
          <div className="mt-1 text-xs" style={{ color: "var(--vscode-descriptionForeground)" }}>
            {message}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div
            className="h-8 flex items-center gap-2 text-base"
            style={{
              color: "var(--vscode-foreground)",
            }}
          >
            <span
              className="w-2.5 h-2.5 rounded-full shrink-0"
              style={{ backgroundColor: running ? "#22c55e" : "#ef4444" }}
              title={running ? "Navigation running" : "Navigation idle"}
              aria-label={running ? "Navigation running" : "Navigation idle"}
            />
            <span className="font-semibold">Status: {running ? "running" : "idle"}</span>
          </div>
        </div>
      </header>

      <div
        className="shrink-0 flex flex-wrap items-end border-b"
        role="tablist"
        aria-label="Mission Canvas stages"
        style={{ borderColor: MISSION_BORDER }}
      >
        {WORKSPACE_STAGES.map((stage) => {
          const selected = workspaceStage === stage.id;
          return (
            <button
              key={stage.id}
              type="button"
              role="tab"
              aria-selected={selected}
              onClick={() => {
                setWorkspaceStage(stage.id);
                if (stage.id !== STAGE_MAPPING) {
                  setShowPgmFix(false);
                }
                if (stage.id !== STAGE_AUTHORING) {
                  setInteractionMode("view");
                  setPendingBehaviorNodeTag("");
                  setShowWaypointOptions(false);
                }
              }}
              className="relative h-10 w-24 px-3 border border-b-0 rounded-t-md text-sm font-semibold transition-colors"
              style={{
                color: MISSION_TEXT,
                backgroundColor: selected
                  ? MISSION_STAGE_FILL
                  : MISSION_STAGE_EMPTY,
                borderColor: selected
                  ? MISSION_BORDER
                  : MISSION_BORDER,
                boxShadow: "none",
                transform: selected ? "translateY(1px)" : "none",
              }}
            >
              {stage.label}
            </button>
          );
        })}
      </div>

      <div
        className="flex-1 min-h-0 border border-t-0 rounded-b-md p-3 flex flex-col gap-4"
        style={{
          color: MISSION_TEXT,
          borderColor: MISSION_BORDER,
          backgroundColor: MISSION_STAGE_FILL,
        }}
      >
        <div className="shrink-0 flex flex-wrap items-center gap-2">
          {workspaceStage === STAGE_MAPPING && (
            <>
              <ActionButton
                active={busy === "Mapping" || (mappingRuntimeActive && !mappingEditorActive)}
                disabled={!!busy || mappingRuntimeActive || runRuntimeActive}
                onClick={handleStartMapping}
                variant="secondary"
              >
                Start Mapping
              </ActionButton>
              <ActionButton
                active={busy === "Stop"}
                disabled={!!busy || !mappingRuntimeActive}
                onClick={handleStopNavigation}
                variant="danger"
              >
                Stop
              </ActionButton>
              <ActionButton
                active={showSaveMapDialog || busy === "Save map"}
                disabled={!!busy || !mappingRuntimeActive}
                onClick={handleOpenSaveMapDialog}
                variant="secondary"
              >
                Save Map
              </ActionButton>
              <ActionButton
                active={mappingEditorActive}
                disabled={!!busy || mappingRuntimeActive || runRuntimeActive}
                onClick={handleToggleMapEditor}
                variant="secondary"
              >
                Map Editor
              </ActionButton>
              {mappingEditorActive && (
                <>
                  <div
                    className="h-6 w-px"
                    aria-hidden="true"
                    style={{ backgroundColor: MISSION_BUTTON_BORDER }}
                  />
                  <MapEditorControls
                    files={mapEditor.files}
                    selectedPath={mapEditor.selectedPath}
                    setSelectedPath={mapEditor.setSelectedPath}
                    tool={mapEditor.tool}
                    setTool={mapEditor.setTool}
                    brushSize={mapEditor.brushSize}
                    setBrushSize={mapEditor.setBrushSize}
                    busy={mapEditor.busy}
                    image={mapEditor.image}
                    dirty={mapEditor.dirty}
                    canUndo={mapEditor.canUndo}
                    canRedo={mapEditor.canRedo}
                    undo={mapEditor.undo}
                    redo={mapEditor.redo}
                    save={mapEditor.save}
                  />
                </>
              )}
            </>
          )}

          {workspaceStage === STAGE_AUTHORING && (
            <>
              <ActionButton
                active={showDesignMapDialog || designMapBusy}
                disabled={!!busy || designMapBusy}
                onClick={handleOpenDesignMapDialog}
                variant="secondary"
              >
                Load Map
              </ActionButton>
              <ActionButton
                disabled={!!busy}
                onClick={handleSaveDesign}
                variant="secondary"
              >
                Save Map
              </ActionButton>
              <div className="flex items-center gap-1">
                <ActionButton
                  active={showWaypointOptions || interactionMode === "spot"}
                  disabled={!designMapAvailable}
                  onClick={handleToggleWaypointOptions}
                  variant="secondary"
                >
                  Create Waypoint
                </ActionButton>
                {showWaypointOptions && (
                  <div
                    className="flex items-center gap-1 border rounded-md p-1"
                    role="menu"
                    aria-label="Waypoint creation options"
                    style={{
                      backgroundColor: MISSION_STAGE_EMPTY,
                      borderColor: MISSION_BUTTON_BORDER,
                    }}
                  >
                    <ActionButton
                      active={interactionMode === "spot"}
                      disabled={!designMapAvailable}
                      onClick={handleToggleSpotMode}
                      variant="secondary"
                    >
                      On Map
                    </ActionButton>
                    <ActionButton
                      active={interactionMode === "initial" || busy === "At Robot"}
                      disabled={!!busy || !designMapAvailable}
                      onClick={handleCreateSpotAtRobot}
                      variant="secondary"
                    >
                      At Robot
                    </ActionButton>
                  </div>
                )}
              </div>
            </>
          )}

          {workspaceStage === STAGE_RUN && (
            <>
              <ActionButton
                active={showRunMapDialog || runMapBusy}
                disabled={!!busy || running || runMapBusy}
                onClick={handleOpenRunMapDialog}
                variant="secondary"
              >
                Load Map
              </ActionButton>
              <ActionButton
                active={busy === "Run mission" || (running && navigationRuntimeMode === "run")}
                disabled={!!busy || running}
                onClick={handleRunMission}
                variant="secondary"
              >
                Run Mission
              </ActionButton>
              <ActionButton
                active={busy === "Stop"}
                disabled={!!busy || !running}
                onClick={handleStopNavigation}
                variant="danger"
              >
                Stop
              </ActionButton>
            </>
          )}
        </div>

        <div className="flex-1 min-h-0 grid grid-cols-1 xl:grid-cols-[minmax(520px,1fr)_360px] gap-4">
        <section
          className={[
            "min-h-0 overflow-hidden grid gap-4",
            workspaceStage === STAGE_AUTHORING
              ? "grid-rows-[minmax(0,1fr)_180px]"
              : "grid-rows-[minmax(0,1fr)]",
          ].join(" ")}
        >
          <MapViewer
            map={displayedMap}
            globalCostmap={mappingEditorActive ? null : needsGlobalCostmap ? globalCostmap : null}
            localCostmap={mappingEditorActive ? null : needsLocalCostmap ? localCostmap : null}
            scan={mappingEditorActive ? null : needsScan ? scan : null}
            pose={mappingEditorActive ? null : (designLocalizationActive || stageNavigationTopicsActive) ? currentPose : null}
            plan={mappingEditorActive ? null : needsPlan ? plan : null}
            goalPose={mappingEditorActive ? null : needsGoalPose ? goalPose : null}
            footprint={mappingEditorActive ? null : needsRobotModel ? footprint : null}
            tf={mappingEditorActive ? null : needsTf ? bufferedTf : null}
            spots={missionOverlayActive ? visibleSpots : []}
            selectedSpotId={missionOverlayActive ? selectedSpotId : ""}
            behaviorNodes={missionOverlayActive ? activeBehaviorNodes : []}
            selectedBehaviorNodeId={missionOverlayActive ? selectedBehaviorNodeId : ""}
            behaviorPreviewNode={missionOverlayActive ? behaviorPreviewNode : null}
            btLayer={waypointBtLayer}
            showMap={mappingEditorActive ? true : activeLayers.map}
            showGlobalCostmap={mappingEditorActive ? false : needsGlobalCostmap}
            showLocalCostmap={mappingEditorActive ? false : needsLocalCostmap}
            showScan={mappingEditorActive ? false : needsScan}
            showGlobalPlan={mappingEditorActive ? false : needsPlan}
            showGoalPose={mappingEditorActive ? false : needsGoalPose}
            showTf={mappingEditorActive ? false : stageNavigationTopicsActive && activeLayers.tf}
            showRobotModel={mappingEditorActive ? false : needsRobotModel}
            interactionDisabled={
              !!busy ||
              (mappingEditorActive && mapEditor.busy) ||
              (designMapActive && designMapEditor.busy)
            }
            interactionMode={mappingEditorActive ? "view" : interactionMode}
            editorActive={mappingEditorActive && !!mapEditor.map && mapEditor.tool !== "view"}
            fitContainer
            viewKey={mappingEditorActive
              ? `mission-editor:${mapEditor.selectedPath || "none"}`
              : workspaceStage === STAGE_AUTHORING
                ? designMapActive
                  ? `mission-design:${designMapEditor.selectedPath || designMapPath || "none"}`
                  : "mission-design:none"
                : `mission:${mapName}`}
            waitingLabel={mappingEditorActive
              ? "Select a PGM"
              : workspaceStage === STAGE_AUTHORING
                ? designMapActive ? "Loading selected map" : "Load a map"
                : running ? "Waiting for /map" : "Run Mission to view /map"}
            onSpotClick={handleSelectSpot}
            onBehaviorNodeClick={handleSelectBehaviorNode}
            onSpotPoseChange={handleMoveSpot}
            onBehaviorNodePoseChange={handleMoveBehaviorNode}
            onEditorMapPoint={mapEditor.editAtMapPoint}
            onMapPose={handleCreateSpotAtPose}
            onBtLayerClose={() => setBtLayerSpotId("")}
          />
          {workspaceStage === STAGE_AUTHORING && (
            <MissionFlowPanel
              spots={spots}
              selectedSpotId={selectedSpotId}
              onSpotSelect={handleSelectSpot}
            />
          )}
        </section>

        {workspaceStage === STAGE_AUTHORING ? (
          <aside className="min-h-0 grid grid-rows-[auto_auto_1fr_minmax(160px,220px)] gap-4">
            <BtRuntimePanel
              nodeState={btNodeStatus.state}
              btStatus={btStatusText}
              activeNodes={btActiveNodesText}
              busy={!!btNodeBusy}
              onActivate={handleBtNodeActivate}
              onDeactivate={handleBtNodeDeactivate}
            />
            <Panel title="Properties" className="grid gap-3">
              {selectedBehaviorNode ? (
                <div className="grid gap-2 text-xs">
                  <div>
                    Node: <span className="font-mono">{selectedBehaviorNode.tag}</span>
                  </div>
                  <div>
                    Type: <span className="font-mono">{selectedBehaviorNode.category}</span>
                  </div>
                  <div>
                    ID: <span className="font-mono">{selectedBehaviorNode.id}</span>
                  </div>
                  <div>
                    Pose:{" "}
                    <span className="font-mono">
                      {selectedBehaviorNode.pose.x.toFixed(2)},{" "}
                      {selectedBehaviorNode.pose.y.toFixed(2)}, yaw{" "}
                      {selectedBehaviorNode.pose.yaw.toFixed(2)}
                    </span>
                  </div>
                  <div className="pt-2 border-t grid justify-start" style={{ borderColor: MISSION_PANEL_BORDER }}>
                    <ActionButton
                      onClick={handleDeleteSelectedBehaviorNode}
                      variant="danger"
                    >
                      Delete Node
                    </ActionButton>
                  </div>
                </div>
              ) : selectedSpot ? (
                <div className="grid gap-2 text-xs">
                  <label className="grid gap-1">
                    <span style={{ color: MISSION_TEXT_MUTED }}>Label</span>
                    <input
                      value={selectedSpot.label}
                      onChange={handleRenameSpot}
                      className="h-8 px-2 border rounded-md text-sm"
                      style={{
                        color: MISSION_TEXT,
                        backgroundColor: MISSION_SURFACE,
                        borderColor: MISSION_BORDER,
                      }}
                    />
                  </label>
                  <div>
                    ID: <span className="font-mono">{selectedSpot.id}</span>
                  </div>
                  <div>
                    Pose:{" "}
                    <span className="font-mono">
                      {selectedSpot.pose.x.toFixed(2)}, {selectedSpot.pose.y.toFixed(2)}, yaw {selectedSpot.pose.yaw.toFixed(2)}
                    </span>
                  </div>
                  <div>
                    BT: <span className="font-mono">{selectedSpot.linked_bt_tree || "-"}</span>
                  </div>
                  <div className="pt-2 border-t grid gap-2" style={{ borderColor: MISSION_PANEL_BORDER }}>
                    <div className="flex flex-wrap gap-2">
                      <ActionButton
                        disabled={!btNodeIsUp || !!selectedSpot.linked_bt_tree}
                        onClick={handleOpenSelectedSpotBt}
                        variant="secondary"
                      >
                        Create BT
                      </ActionButton>
                      <ActionButton
                        disabled={!btNodeIsUp || !selectedSpot.linked_bt_tree}
                        onClick={handleOpenSelectedSpotBt}
                        variant="secondary"
                      >
                        Edit BT
                      </ActionButton>
                    </div>
                    <div className="grid justify-start">
                      <ActionButton
                        onClick={handleDeleteSelectedSpot}
                        variant="danger"
                      >
                        Delete Waypoint
                      </ActionButton>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="text-xs leading-5" style={{ color: MISSION_TEXT_MUTED }}>
                  Select a waypoint or behavior node on the map.
                </div>
              )}
            </Panel>

            <Panel title="Design Objects" className="min-h-0 overflow-auto">
              <div className="grid gap-3">
                <div className="grid gap-2">
                  <div
                    className="text-[10px] uppercase font-semibold"
                    style={{ color: MISSION_TEXT_MUTED }}
                  >
                    Behavior Nodes
                  </div>
                  {activeBehaviorNodes.map((node) => (
                    <button
                      key={node.id}
                      type="button"
                      onClick={() => handleSelectBehaviorNode(node.id)}
                      className="h-8 px-2 border rounded-md text-left text-xs min-w-0"
                      style={{
                        color: node.id === selectedBehaviorNodeId
                          ? "var(--vscode-button-foreground)"
                          : MISSION_TEXT,
                        backgroundColor: node.id === selectedBehaviorNodeId
                          ? "var(--vscode-button-background)"
                          : MISSION_STAGE_EMPTY,
                        borderColor: MISSION_PANEL_BORDER,
                      }}
                    >
                      <span className="block truncate">{node.tag}</span>
                    </button>
                  ))}
                  {activeBehaviorNodes.length === 0 && (
                    <div className="text-xs" style={{ color: MISSION_TEXT_MUTED }}>
                      No behavior nodes placed yet.
                    </div>
                  )}
                </div>
                <div className="grid gap-2">
                  <div
                    className="text-[10px] uppercase font-semibold"
                    style={{ color: MISSION_TEXT_MUTED }}
                  >
                    Waypoints
                  </div>
                  {spots.map((spot) => (
                    <button
                      key={spot.id}
                      type="button"
                      onClick={() => handleSelectSpot(spot.id)}
                      className="h-8 px-2 border rounded-md text-left text-xs min-w-0"
                      style={{
                        color: spot.id === selectedSpotId
                          ? "var(--vscode-button-foreground)"
                          : MISSION_TEXT,
                        backgroundColor: spot.id === selectedSpotId
                          ? "var(--vscode-button-background)"
                          : MISSION_STAGE_EMPTY,
                        borderColor: MISSION_PANEL_BORDER,
                      }}
                    >
                      <span className="block truncate">{spot.label}</span>
                    </button>
                  ))}
                  {spots.length === 0 && (
                    <div className="text-xs" style={{ color: MISSION_TEXT_MUTED }}>
                      No waypoints for this map yet.
                    </div>
                  )}
                </div>
              </div>
            </Panel>
            <TopicStatusPanel topicRows={topicRows} />
          </aside>
        ) : (
          <aside
            className={[
              "min-h-0 grid gap-4 overflow-hidden",
              workspaceStage === STAGE_MAPPING
                ? "grid-rows-[minmax(0,1.35fr)_minmax(0,0.42fr)_minmax(0,0.34fr)_minmax(0,1fr)]"
                : "grid-rows-[auto_auto_minmax(0,1fr)]",
            ].join(" ")}
          >
            {workspaceStage === STAGE_MAPPING && (
              <MappingTeleopPanel
                disabled={teleopDisabled}
                onPublish={publishTeleopCommand}
                onMessage={setMessage}
              />
            )}
            {workspaceStage === STAGE_MAPPING ? (
              <MappingSessionPanel
                mappingEditorActive={mappingEditorActive}
                selectedPath={mapEditor.selectedPath}
                dirty={mapEditor.dirty}
              />
            ) : (
              <RunSessionPanel mapName={currentMapName} running={running} />
            )}
            <LayersPanel
              layerToggles={layerToggles}
              compact={workspaceStage === STAGE_MAPPING}
            />
            <TopicStatusPanel topicRows={topicRows} />
          </aside>
        )}
      </div>
      </div>
    </div>
  );
}
