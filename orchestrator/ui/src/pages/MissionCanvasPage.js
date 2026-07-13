// Copyright 2026 ROBOTIS CO., LTD.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.

"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  getServiceStatus,
  saveNavigationMap,
  startNavigation,
  stopNavigation,
} from "../utils/navigationApi";
import {
  createNavigationSpot,
  deleteNavigationSpot,
  getNavigationSpots,
  updateNavigationSpot,
} from "../utils/navigationSpotsApi";
import { useNavigationRosTopic } from "../hooks/useNavigationRosTopic";
import { MapEditorControls, useMapEditor } from "../components/navigation/MapEditor";
import { MapViewer } from "../components/navigation/MapViewer";
import {
  mergeTfMessages,
  poseFromBaseLinkTf,
  tfMessageFromBuffer,
  updateTfBuffer,
} from "../utils/navigationTf";
import { FALLBACK_CATALOG } from "../constants/btNodeCatalogFallback";

const DEFAULT_MAP_NAME = "map";
const STATUS_POLL_MS = 10000;
const ROS2_WS_FAST_TOPIC_OPTIONS = { throttleMs: 100 };
const STAGE_MAPPING = "mapping";
const STAGE_AUTHORING = "authoring";
const STAGE_RUN = "run";

const WORKSPACE_STAGES = [
  { id: STAGE_MAPPING, label: "Mapping" },
  { id: STAGE_AUTHORING, label: "Design" },
  { id: STAGE_RUN, label: "Run" },
];

const BEHAVIOR_NODE_GROUPS = [
  { id: "action", label: "Actions" },
  { id: "control", label: "Controls" },
  { id: "decorator", label: "Decorators" },
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

const TOPIC_LABELS = {
  "/map": "Map",
  "/scan": "Lidar",
  "/amcl_pose": "AMCL pose",
  "/tf": "TF",
  "/tf_static": "TF static",
  "/local_costmap/published_footprint": "Footprint",
  "/global_costmap/costmap": "Global costmap",
  "/local_costmap/costmap": "Local costmap",
  "/plan": "Global plan",
  "/goal_pose": "Goal pose",
  "/bt/status": "BT status",
  "/bt/active_nodes": "BT active nodes",
};

const MISSION_BORDER = "#e5e7eb";
const MISSION_BORDER_SOFT = "#e5e7eb";
const MISSION_ACTIVE_BORDER = "#93c5fd";
const MISSION_SURFACE = "color-mix(in srgb, var(--vscode-foreground, #ffffff) 5%, transparent)";
const MISSION_SURFACE_STRONG = "color-mix(in srgb, var(--vscode-foreground, #ffffff) 8%, transparent)";

function messageData(value) {
  if (!value || typeof value !== "object") return null;
  if (value.available === false) return null;
  const data = "data" in value ? value.data : value;
  return data && typeof data === "object" ? data : null;
}

function spotPoseFromMapPose(x, y, yaw) {
  return {
    frame_id: "map",
    x,
    y,
    yaw,
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

function Panel({ title, children, className = "" }) {
  return (
    <div
      className={`border p-3 ${className}`}
      style={{
        color: "var(--vscode-foreground)",
        borderColor: MISSION_BORDER,
        backgroundColor: MISSION_SURFACE,
      }}
    >
      {title && <div className="text-xs font-semibold mb-2">{title}</div>}
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
        className="w-full max-w-sm border p-4 grid gap-3 shadow-2xl"
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
            className="h-8 px-2 border text-sm"
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

function LayerToggle({ label, checked, onChange }) {
  return (
    <label
      className="h-8 px-2 border flex items-center gap-2 text-xs font-medium"
      style={{
        color: "var(--vscode-foreground)",
        borderColor: MISSION_BORDER_SOFT,
        backgroundColor: MISSION_SURFACE,
      }}
    >
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.currentTarget.checked)}
      />
      {label}
    </label>
  );
}

function LayersPanel({ layerToggles }) {
  return (
    <Panel title="Layers" className="grid gap-2 shrink-0">
      <div className="flex flex-wrap gap-2">
        {layerToggles.map((layer) => (
          <LayerToggle
            key={layer.id}
            label={layer.label}
            checked={layer.checked}
            onChange={layer.onChange}
          />
        ))}
      </div>
    </Panel>
  );
}

function TopicStatusPanel({ topicRows }) {
  return (
    <Panel title="Topics" className="grid gap-2 text-xs min-h-0 overflow-auto">
      {topicRows.map(({ topic, isLive }) => (
        <div key={topic} className="flex items-center justify-between gap-3 min-w-0">
          <div className="min-w-0">
            <div className="font-mono truncate">{topic}</div>
            <div style={{ color: "var(--vscode-descriptionForeground)" }}>
              {TOPIC_LABELS[topic] || topic}
            </div>
          </div>
          <span
            className="shrink-0"
            style={{ color: isLive ? "#22c55e" : "var(--vscode-descriptionForeground)" }}
          >
            {isLive ? "live" : "wait"}
          </span>
        </div>
      ))}
    </Panel>
  );
}

function SessionRow({ label, value }) {
  return (
    <div className="flex items-center justify-between gap-3 text-xs">
      <span style={{ color: "var(--vscode-descriptionForeground)" }}>{label}</span>
      <span className="font-mono truncate text-right">{value}</span>
    </div>
  );
}

function MappingSessionPanel({ mappingEditorActive, selectedPath, dirty }) {
  return (
    <Panel title="Mapping Session" className="grid gap-2">
      <SessionRow
        label="Source"
        value={mappingEditorActive ? "Saved map" : "Live mapping"}
      />
      <SessionRow
        label="Map file"
        value={mappingEditorActive && selectedPath ? selectedPath : "Not saved"}
      />
      <SessionRow
        label="Edits"
        value={mappingEditorActive && dirty ? "Unsaved changes" : "Clean"}
      />
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

function BehaviorPalette({ selectedTag = "", onNodeSelect }) {
  const groupedNodes = useMemo(() => (
    BEHAVIOR_NODE_GROUPS.map((group) => ({
      ...group,
      nodes: FALLBACK_CATALOG.filter((node) => node.category === group.id),
    }))
  ), []);

  const handleDragStart = (event, tag) => {
    event.dataTransfer.setData("application/bt-node-tag", tag);
    event.dataTransfer.setData("text/plain", tag);
    event.dataTransfer.effectAllowed = "copy";
  };

  return (
    <Panel title="Behavior Palette" className="min-h-0 overflow-hidden">
      <div className="h-full min-h-0 grid grid-cols-1 md:grid-cols-3 gap-3 overflow-auto">
        {groupedNodes.map((group) => (
          <div key={group.id} className="min-w-0">
            <div
              className="text-[10px] uppercase font-semibold mb-2"
              style={{ color: "var(--vscode-descriptionForeground)" }}
            >
              {group.label}
            </div>
            <div className="flex flex-wrap gap-2">
              {group.nodes.map((node) => (
                <button
                  key={node.tag}
                  type="button"
                  draggable
                  aria-pressed={selectedTag === node.tag}
                  onClick={() => onNodeSelect(node.tag)}
                  onDragStart={(event) => handleDragStart(event, node.tag)}
                  className="h-8 px-2 border text-xs font-medium transition-all active:translate-y-px"
                  style={{
                    color: selectedTag === node.tag
                      ? "var(--vscode-button-foreground)"
                      : "var(--vscode-foreground)",
                    backgroundColor: selectedTag === node.tag
                      ? "var(--vscode-button-background)"
                      : MISSION_SURFACE,
                    borderColor: selectedTag === node.tag
                      ? MISSION_ACTIVE_BORDER
                      : MISSION_BORDER_SOFT,
                    boxShadow: selectedTag === node.tag
                      ? `inset 0 0 0 1px ${MISSION_ACTIVE_BORDER}`
                      : "none",
                  }}
                  title={node.tag}
                >
                  {node.tag}
                </button>
              ))}
              {group.nodes.length === 0 && (
                <div
                  className="h-8 px-2 border flex items-center text-xs"
                  style={{
                    color: "var(--vscode-descriptionForeground)",
                    backgroundColor: MISSION_SURFACE,
                    borderColor: MISSION_BORDER_SOFT,
                  }}
                >
                  No nodes
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </Panel>
  );
}

function ActionButton({
  children,
  active = false,
  disabled = false,
  onClick,
  type = "button",
  variant = "primary",
}) {
  const styles = {
    primary: {
      color: "var(--vscode-button-foreground)",
      backgroundColor: "var(--vscode-button-background)",
      borderColor: MISSION_BORDER,
    },
    secondary: {
      color: "var(--vscode-foreground)",
      backgroundColor: MISSION_SURFACE_STRONG,
      borderColor: MISSION_BORDER,
    },
    danger: {
      color: "#000000",
      backgroundColor: "var(--vscode-inputValidation-errorBackground, #b91c1c)",
      borderColor: "var(--vscode-inputValidation-errorBorder, #ef4444)",
    },
  };
  const activeStyles = active
    ? {
      color: variant === "danger"
        ? styles.danger.color
        : "var(--vscode-list-activeSelectionForeground, var(--vscode-button-foreground))",
      backgroundColor: variant === "danger"
        ? styles.danger.backgroundColor
        : "var(--vscode-list-activeSelectionBackground, var(--vscode-button-background))",
      borderColor: MISSION_ACTIVE_BORDER,
      boxShadow: [
        `inset 0 0 0 1px ${MISSION_ACTIVE_BORDER}`,
        `inset 3px 0 0 ${MISSION_ACTIVE_BORDER}`,
      ].join(", "),
    }
    : {};

  return (
    <button
      type={type}
      disabled={disabled}
      onClick={onClick}
      aria-pressed={active ? true : undefined}
      className={[
        "h-8 px-3 border text-sm font-semibold transition-all active:translate-y-px",
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
  const statusLoadingRef = useRef(false);
  const tfBufferRef = useRef(new Map());
  const behaviorNodeSerialRef = useRef(0);
  const [mapName, setMapName] = useState(DEFAULT_MAP_NAME);
  const [status, setStatus] = useState(null);
  const [spots, setSpots] = useState([]);
  const [selectedSpotId, setSelectedSpotId] = useState("");
  const [behaviorNodes, setBehaviorNodes] = useState([]);
  const [selectedBehaviorNodeId, setSelectedBehaviorNodeId] = useState("");
  const [pendingBehaviorNodeTag, setPendingBehaviorNodeTag] = useState("");
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("Ready");
  const [interactionMode, setInteractionMode] = useState("view");
  const [tfBufferRevision, setTfBufferRevision] = useState(0);
  const [workspaceStage, setWorkspaceStage] = useState(STAGE_MAPPING);
  const [showPgmFix, setShowPgmFix] = useState(false);
  const [showSaveMapDialog, setShowSaveMapDialog] = useState(false);
  const [saveMapName, setSaveMapName] = useState(DEFAULT_MAP_NAME);
  const [mapEditorReloadToken, setMapEditorReloadToken] = useState(0);
  const [layersByStage, setLayersByStage] = useState(() => ({
    [STAGE_MAPPING]: { ...LAYER_PRESETS[STAGE_MAPPING] },
    [STAGE_AUTHORING]: { ...LAYER_PRESETS[STAGE_AUTHORING] },
    [STAGE_RUN]: { ...LAYER_PRESETS[STAGE_RUN] },
  }));

  const running = status?.is_up ?? false;
  const mappingEditorActive = workspaceStage === STAGE_MAPPING && showPgmFix;
  const navigationTopicsActive = running && busy !== "Stop" && !mappingEditorActive;
  const activeLayers = layersByStage[workspaceStage] || LAYER_PRESETS[workspaceStage];
  const currentMapName = mapName.trim() || DEFAULT_MAP_NAME;
  const mapEditor = useMapEditor({
    open: mappingEditorActive,
    mapName: currentMapName,
    onMessage: setMessage,
    reloadToken: mapEditorReloadToken,
  });
  const needsGlobalCostmap = navigationTopicsActive && activeLayers.globalCostmap;
  const needsLocalCostmap = navigationTopicsActive && activeLayers.localCostmap;
  const needsScan = navigationTopicsActive && activeLayers.scan;
  const needsGoalPose = navigationTopicsActive && activeLayers.goalPose;
  const needsPlan = navigationTopicsActive && activeLayers.globalPlan;
  const needsRobotModel = navigationTopicsActive && activeLayers.robotModel;
  const needsTf = navigationTopicsActive && (
    activeLayers.tf ||
    activeLayers.scan ||
    activeLayers.robotModel
  );
  const selectedSpot = useMemo(
    () => spots.find((spot) => spot.id === selectedSpotId) || null,
    [selectedSpotId, spots],
  );
  const activeBehaviorNodes = useMemo(
    () => behaviorNodes.filter((node) => node.map_name === currentMapName),
    [behaviorNodes, currentMapName],
  );
  const selectedBehaviorNode = useMemo(
    () => activeBehaviorNodes.find((node) => node.id === selectedBehaviorNodeId) || null,
    [activeBehaviorNodes, selectedBehaviorNodeId],
  );
  const { topicData: mapData } = useNavigationRosTopic(
    navigationTopicsActive && activeLayers.map ? "/map" : null,
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
    navigationTopicsActive && (needsRobotModel || needsScan) ? "/amcl_pose" : null,
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
  const latestTf = useMemo(() => mergeTfMessages(tfStatic, tf), [tf, tfStatic]);
  void tfBufferRevision;
  const bufferedTf = tfMessageFromBuffer(tfBufferRef.current) ?? latestTf;
  const fallbackPose = amclPose?.pose?.pose ?? null;
  const currentPose = poseFromBaseLinkTf(bufferedTf) ?? fallbackPose;
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
  const topicRows = useMemo(() => ([
    { topic: "/map", isLive: !!map },
    { topic: "/scan", isLive: !!scan },
    { topic: "/amcl_pose", isLive: !!amclPose },
    { topic: "/tf", isLive: !!(tf?.transforms?.length) },
    { topic: "/tf_static", isLive: !!(tfStatic?.transforms?.length) },
    {
      topic: "/local_costmap/published_footprint",
      isLive: !!(footprint?.polygon?.points?.length),
    },
    { topic: "/global_costmap/costmap", isLive: !!globalCostmap },
    { topic: "/local_costmap/costmap", isLive: !!localCostmap },
    { topic: "/plan", isLive: !!plan },
    { topic: "/goal_pose", isLive: !!goalPose },
    { topic: "/bt/status", isLive: false },
    { topic: "/bt/active_nodes", isLive: false },
  ]), [
    amclPose,
    footprint,
    globalCostmap,
    goalPose,
    localCostmap,
    map,
    plan,
    scan,
    tf,
    tfStatic,
  ]);

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

  const loadSpots = useCallback(async () => {
    try {
      const result = await getNavigationSpots(mapName.trim() || DEFAULT_MAP_NAME);
      setSpots(result.spots || []);
      setSelectedSpotId((current) => (
        result.spots?.some((spot) => spot.id === current) ? current : ""
      ));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Failed to load spots");
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
    void loadSpots();
  }, [loadSpots]);

  useEffect(() => {
    if (updateTfBuffer(tfBufferRef.current, latestTf)) {
      setTfBufferRevision((value) => value + 1);
    }
  }, [latestTf]);

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

  const handleStartNavigation = useCallback(() => runCommand(
    "Navigation",
    async () => {
      setWorkspaceStage(STAGE_RUN);
      await startNavigation("nav", mapName.trim() || DEFAULT_MAP_NAME);
    },
  ), [mapName, runCommand]);

  const handleStartMapping = useCallback(() => runCommand(
    "Mapping",
    async () => {
      setWorkspaceStage(STAGE_MAPPING);
      setShowPgmFix(false);
      await startNavigation("map", mapName.trim() || DEFAULT_MAP_NAME);
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
        setShowPgmFix(true);
        setMapEditorReloadToken((value) => value + 1);
        setShowSaveMapDialog(false);
        return result;
      },
    );
  }, [runCommand, saveMapName]);

  const handleLoadMap = useCallback(() => {
    setWorkspaceStage(STAGE_MAPPING);
    setInteractionMode("view");
    setShowPgmFix(true);
    setMessage("Loading saved maps");
  }, []);

  const handleToggleMapFix = useCallback(() => {
    setWorkspaceStage(STAGE_MAPPING);
    setInteractionMode("view");
    setShowPgmFix((value) => !value);
  }, []);

  const handleStopNavigation = useCallback(() => runCommand(
    "Stop",
    () => stopNavigation(),
  ), [runCommand]);

  const handleSelectSpot = useCallback((spotId) => {
    setSelectedSpotId(spotId);
    setSelectedBehaviorNodeId("");
    setPendingBehaviorNodeTag("");
    setInteractionMode("view");
  }, []);

  const handleSelectBehaviorNode = useCallback((nodeId) => {
    setSelectedBehaviorNodeId(nodeId);
    setSelectedSpotId("");
    setPendingBehaviorNodeTag("");
    setInteractionMode("view");
  }, []);

  const handleSelectBehaviorPaletteNode = useCallback((tag) => {
    setWorkspaceStage(STAGE_AUTHORING);
    setPendingBehaviorNodeTag(tag);
    setSelectedSpotId("");
    setInteractionMode("behavior");
    setMessage(`${tag} selected`);
  }, []);

  const handleToggleSpotMode = useCallback(() => {
    setWorkspaceStage(STAGE_AUTHORING);
    setPendingBehaviorNodeTag("");
    setSelectedBehaviorNodeId("");
    setInteractionMode((value) => (value === "spot" ? "view" : "spot"));
  }, []);

  const handleCreateSpotAtPose = useCallback(async (x, y, yaw) => {
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
    const label = `Spot ${spots.length + 1}`;
    try {
      const created = await createNavigationSpot({
        map_name: currentMapName,
        label,
        pose: spotPoseFromMapPose(x, y, yaw),
      });
      setSpots((current) => [...current, created]);
      setSelectedSpotId(created.id);
      setSelectedBehaviorNodeId("");
      setInteractionMode("view");
      setMessage(`Created ${created.label}`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Failed to create spot");
    }
  }, [
    currentMapName,
    interactionMode,
    pendingBehaviorNodeTag,
    spots.length,
  ]);

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
      setMessage(error instanceof Error ? error.message : "Failed to update spot");
    }
  }, [selectedSpot]);

  const handleDeleteSelectedSpot = useCallback(async () => {
    if (!selectedSpot) return;
    try {
      await deleteNavigationSpot(selectedSpot.id, selectedSpot.map_name);
      setSpots((current) => current.filter((spot) => spot.id !== selectedSpot.id));
      setSelectedSpotId("");
      setMessage(`Deleted ${selectedSpot.label}`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Failed to delete spot");
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
        className="shrink-0 mb-4 flex flex-wrap items-end gap-1 border-b"
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
                }
              }}
              className="relative h-10 px-5 border border-b-0 rounded-t-md text-sm font-semibold transition-colors"
              style={{
                color: selected
                  ? "var(--vscode-list-activeSelectionForeground, var(--vscode-button-foreground))"
                  : "var(--vscode-foreground)",
                backgroundColor: selected
                  ? "var(--vscode-list-activeSelectionBackground, var(--vscode-button-background))"
                  : "transparent",
                borderColor: selected
                  ? MISSION_BORDER
                  : "transparent",
                boxShadow: selected
                  ? `inset 0 3px 0 ${MISSION_ACTIVE_BORDER}`
                  : "none",
                transform: selected ? "translateY(1px)" : "none",
              }}
            >
              {stage.label}
            </button>
          );
        })}
      </div>

      <div
        className="shrink-0 mb-4 border px-3 py-2 flex flex-wrap items-center gap-2"
        style={{
          color: "var(--vscode-foreground)",
          borderColor: MISSION_BORDER,
          backgroundColor: MISSION_SURFACE_STRONG,
        }}
      >
        {workspaceStage === STAGE_MAPPING && (
          <>
            <ActionButton
              active={busy === "Mapping" || (running && !mappingEditorActive)}
              disabled={!!busy || running}
              onClick={handleStartMapping}
            >
              Mapping
            </ActionButton>
            <ActionButton
              active={showSaveMapDialog || busy === "Save map"}
              disabled={!!busy || !running}
              onClick={handleOpenSaveMapDialog}
              variant="secondary"
            >
              Save Map
            </ActionButton>
            <ActionButton
              active={mappingEditorActive}
              disabled={!!busy}
              onClick={handleLoadMap}
              variant="secondary"
            >
              Load Map
            </ActionButton>
            <ActionButton
              active={mappingEditorActive}
              disabled={!!busy}
              onClick={handleToggleMapFix}
              variant="secondary"
            >
              Fix Map
            </ActionButton>
            <ActionButton
              active={busy === "Stop"}
              disabled={!!busy || !running}
              onClick={handleStopNavigation}
              variant="danger"
            >
              Stop
            </ActionButton>
            {mappingEditorActive && (
              <>
                <div
                  className="h-6 w-px"
                  aria-hidden="true"
                  style={{ backgroundColor: MISSION_BORDER }}
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
                  undo={mapEditor.undo}
                  save={mapEditor.save}
                />
              </>
            )}
          </>
        )}

        {workspaceStage === STAGE_AUTHORING && (
          <>
            <ActionButton
              active={interactionMode === "spot"}
              disabled={!running || !map}
              onClick={handleToggleSpotMode}
              variant="secondary"
            >
              Spot
            </ActionButton>
            <ActionButton
              disabled={!selectedSpot}
              onClick={handleDeleteSelectedSpot}
              variant="secondary"
            >
              Delete Spot
            </ActionButton>
            <ActionButton
              disabled={!selectedBehaviorNode}
              onClick={handleDeleteSelectedBehaviorNode}
              variant="secondary"
            >
              Delete Node
            </ActionButton>
            <ActionButton disabled variant="secondary">
              Create BT
            </ActionButton>
            <ActionButton disabled variant="secondary">
              Edit BT
            </ActionButton>
          </>
        )}

        {workspaceStage === STAGE_RUN && (
          <>
            <div
              className="h-8 px-2.5 border flex items-center gap-2 text-sm"
              style={{
                color: "var(--vscode-foreground)",
                backgroundColor: MISSION_SURFACE,
                borderColor: MISSION_BORDER,
              }}
            >
              <span style={{ color: "var(--vscode-descriptionForeground)" }}>Map</span>
              <span className="font-mono">{mapName.trim() || DEFAULT_MAP_NAME}</span>
            </div>
            <ActionButton
              active={busy === "Navigation" || (running && workspaceStage === STAGE_RUN)}
              disabled={!!busy || running}
              onClick={handleStartNavigation}
            >
              Navigation
            </ActionButton>
            <ActionButton disabled variant="secondary">
              Run BT
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
            map={mappingEditorActive ? mapEditor.map : map}
            globalCostmap={mappingEditorActive ? null : needsGlobalCostmap ? globalCostmap : null}
            localCostmap={mappingEditorActive ? null : needsLocalCostmap ? localCostmap : null}
            scan={mappingEditorActive ? null : needsScan ? scan : null}
            pose={mappingEditorActive ? null : navigationTopicsActive ? currentPose : null}
            plan={mappingEditorActive ? null : needsPlan ? plan : null}
            goalPose={mappingEditorActive ? null : needsGoalPose ? goalPose : null}
            footprint={mappingEditorActive ? null : needsRobotModel ? footprint : null}
            tf={mappingEditorActive ? null : needsTf ? bufferedTf : null}
            spots={mappingEditorActive ? [] : spots}
            selectedSpotId={mappingEditorActive ? "" : selectedSpotId}
            behaviorNodes={mappingEditorActive ? [] : activeBehaviorNodes}
            selectedBehaviorNodeId={mappingEditorActive ? "" : selectedBehaviorNodeId}
            showMap={mappingEditorActive ? true : activeLayers.map}
            showGlobalCostmap={mappingEditorActive ? false : needsGlobalCostmap}
            showLocalCostmap={mappingEditorActive ? false : needsLocalCostmap}
            showScan={mappingEditorActive ? false : needsScan}
            showGlobalPlan={mappingEditorActive ? false : needsPlan}
            showGoalPose={mappingEditorActive ? false : needsGoalPose}
            showTf={mappingEditorActive ? false : navigationTopicsActive && activeLayers.tf}
            showRobotModel={mappingEditorActive ? false : needsRobotModel}
            interactionDisabled={!!busy || (mappingEditorActive && mapEditor.busy)}
            interactionMode={mappingEditorActive ? "view" : interactionMode}
            editorActive={mappingEditorActive && !!mapEditor.map && mapEditor.tool !== "view"}
            fitContainer
            viewKey={mappingEditorActive
              ? `mission-editor:${mapEditor.selectedPath || "none"}`
              : `mission:${mapName}`}
            waitingLabel={mappingEditorActive
              ? "Select a PGM"
              : running ? "Waiting for /map" : "Start Navigation to view /map"}
            onSpotClick={handleSelectSpot}
            onBehaviorNodeClick={handleSelectBehaviorNode}
            onEditorMapPoint={mapEditor.editAtMapPoint}
            onMapPose={handleCreateSpotAtPose}
          />
          {workspaceStage === STAGE_AUTHORING && (
            <BehaviorPalette
              selectedTag={pendingBehaviorNodeTag}
              onNodeSelect={handleSelectBehaviorPaletteNode}
            />
          )}
        </section>

        {workspaceStage === STAGE_AUTHORING ? (
          <aside className="min-h-0 grid grid-rows-[auto_1fr_minmax(160px,220px)] gap-4">
            <Panel title="Inspector" className="grid gap-3">
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
                </div>
              ) : selectedSpot ? (
                <div className="grid gap-2 text-xs">
                  <label className="grid gap-1">
                    <span style={{ color: "var(--vscode-descriptionForeground)" }}>Label</span>
                    <input
                      value={selectedSpot.label}
                      onChange={handleRenameSpot}
                      className="h-8 px-2 border text-sm"
                      style={{
                        color: "var(--vscode-input-foreground)",
                        backgroundColor: "var(--vscode-input-background)",
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
                </div>
              ) : (
                <div className="text-xs leading-5" style={{ color: "var(--vscode-descriptionForeground)" }}>
                  No selection.
                </div>
              )}
            </Panel>

            <Panel title="Design Objects" className="min-h-0 overflow-auto">
              <div className="grid gap-3">
                <div className="grid gap-2">
                  <div
                    className="text-[10px] uppercase font-semibold"
                    style={{ color: "var(--vscode-descriptionForeground)" }}
                  >
                    Behavior Nodes
                  </div>
                  {activeBehaviorNodes.map((node) => (
                    <button
                      key={node.id}
                      type="button"
                      onClick={() => handleSelectBehaviorNode(node.id)}
                      className="h-8 px-2 border text-left text-xs min-w-0"
                      style={{
                        color: node.id === selectedBehaviorNodeId
                          ? "var(--vscode-button-foreground)"
                          : "var(--vscode-foreground)",
                        backgroundColor: node.id === selectedBehaviorNodeId
                          ? "var(--vscode-button-background)"
                          : MISSION_SURFACE,
                        borderColor: MISSION_BORDER_SOFT,
                      }}
                    >
                      <span className="block truncate">{node.tag}</span>
                    </button>
                  ))}
                  {activeBehaviorNodes.length === 0 && (
                    <div className="text-xs" style={{ color: "var(--vscode-descriptionForeground)" }}>
                      No behavior nodes placed yet.
                    </div>
                  )}
                </div>
                <div className="grid gap-2">
                  <div
                    className="text-[10px] uppercase font-semibold"
                    style={{ color: "var(--vscode-descriptionForeground)" }}
                  >
                    Spots
                  </div>
                  {spots.map((spot) => (
                    <button
                      key={spot.id}
                      type="button"
                      onClick={() => handleSelectSpot(spot.id)}
                      className="h-8 px-2 border text-left text-xs min-w-0"
                      style={{
                        color: spot.id === selectedSpotId
                          ? "var(--vscode-button-foreground)"
                          : "var(--vscode-foreground)",
                        backgroundColor: spot.id === selectedSpotId
                          ? "var(--vscode-button-background)"
                          : MISSION_SURFACE,
                        borderColor: MISSION_BORDER_SOFT,
                      }}
                    >
                      <span className="block truncate">{spot.label}</span>
                    </button>
                  ))}
                  {spots.length === 0 && (
                    <div className="text-xs" style={{ color: "var(--vscode-descriptionForeground)" }}>
                      No spots for this map yet.
                    </div>
                  )}
                </div>
              </div>
            </Panel>
            <TopicStatusPanel topicRows={topicRows} />
          </aside>
        ) : (
          <aside className="min-h-0 grid grid-rows-[auto_auto_minmax(0,1fr)] gap-4">
            {workspaceStage === STAGE_MAPPING ? (
              <MappingSessionPanel
                mappingEditorActive={mappingEditorActive}
                selectedPath={mapEditor.selectedPath}
                dirty={mapEditor.dirty}
              />
            ) : (
              <RunSessionPanel mapName={currentMapName} running={running} />
            )}
            <LayersPanel layerToggles={layerToggles} />
            <TopicStatusPanel topicRows={topicRows} />
          </aside>
        )}
      </div>
    </div>
  );
}
