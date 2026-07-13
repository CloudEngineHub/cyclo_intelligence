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
import { MapViewer } from "../components/navigation/MapViewer";
import {
  mergeTfMessages,
  poseFromBaseLinkTf,
  tfMessageFromBuffer,
  updateTfBuffer,
} from "../utils/navigationTf";

const DEFAULT_MAP_NAME = "map";
const STATUS_POLL_MS = 10000;
const ROS2_WS_FAST_TOPIC_OPTIONS = { throttleMs: 100 };
const STAGE_MAPPING = "mapping";
const STAGE_AUTHORING = "authoring";
const STAGE_RUN = "run";

const WORKSPACE_STAGES = [
  { id: STAGE_MAPPING, label: "Mapping" },
  { id: STAGE_AUTHORING, label: "Spot / BT" },
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

function Panel({ title, children, className = "" }) {
  return (
    <div
      className={`border p-3 ${className}`}
      style={{
        color: "var(--vscode-foreground)",
        borderColor: "var(--vscode-panel-border)",
        backgroundColor: "var(--vscode-sidebar-background)",
      }}
    >
      {title && <div className="text-xs font-semibold mb-2">{title}</div>}
      {children}
    </div>
  );
}

function LayerToggle({ label, checked, onChange }) {
  return (
    <label
      className="h-8 px-2 border flex items-center gap-2 text-xs font-medium"
      style={{
        color: "var(--vscode-foreground)",
        borderColor: "var(--vscode-panel-border)",
        backgroundColor: "var(--vscode-editor-background)",
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

export default function MissionCanvasPage() {
  const statusLoadingRef = useRef(false);
  const tfBufferRef = useRef(new Map());
  const [mapName, setMapName] = useState(DEFAULT_MAP_NAME);
  const [status, setStatus] = useState(null);
  const [spots, setSpots] = useState([]);
  const [selectedSpotId, setSelectedSpotId] = useState("");
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("Ready");
  const [interactionMode, setInteractionMode] = useState("view");
  const [tfBufferRevision, setTfBufferRevision] = useState(0);
  const [workspaceStage, setWorkspaceStage] = useState(STAGE_MAPPING);
  const [layersByStage, setLayersByStage] = useState(() => ({
    [STAGE_MAPPING]: { ...LAYER_PRESETS[STAGE_MAPPING] },
    [STAGE_AUTHORING]: { ...LAYER_PRESETS[STAGE_AUTHORING] },
    [STAGE_RUN]: { ...LAYER_PRESETS[STAGE_RUN] },
  }));

  const running = status?.is_up ?? false;
  const navigationTopicsActive = running && busy !== "Stop";
  const activeLayers = layersByStage[workspaceStage] || LAYER_PRESETS[workspaceStage];
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

  const runCommand = useCallback(async (label, action) => {
    setBusy(label);
    try {
      await action();
      setMessage(`${label} complete`);
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
      await startNavigation("map", mapName.trim() || DEFAULT_MAP_NAME);
    },
  ), [mapName, runCommand]);

  const handleSaveMap = useCallback(() => runCommand(
    "Save map",
    () => saveNavigationMap(mapName.trim() || DEFAULT_MAP_NAME),
  ), [mapName, runCommand]);

  const handleStopNavigation = useCallback(() => runCommand(
    "Stop",
    () => stopNavigation(),
  ), [runCommand]);

  const handleToggleSpotMode = useCallback(() => {
    setWorkspaceStage(STAGE_AUTHORING);
    setInteractionMode((value) => (value === "spot" ? "view" : "spot"));
  }, []);

  const handleCreateSpotAtPose = useCallback(async (x, y, yaw) => {
    if (interactionMode !== "spot") return;
    const normalizedMapName = mapName.trim() || DEFAULT_MAP_NAME;
    const label = `Spot ${spots.length + 1}`;
    try {
      const created = await createNavigationSpot({
        map_name: normalizedMapName,
        label,
        pose: spotPoseFromMapPose(x, y, yaw),
      });
      setSpots((current) => [...current, created]);
      setSelectedSpotId(created.id);
      setInteractionMode("view");
      setMessage(`Created ${created.label}`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Failed to create spot");
    }
  }, [interactionMode, mapName, spots.length]);

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

  return (
    <div className="mission-canvas-page h-full min-h-[560px] flex flex-col overflow-hidden p-4">
      <header
        className="shrink-0 border-b pb-3 mb-4 flex flex-col xl:flex-row xl:items-center xl:justify-between gap-3"
        style={{ borderColor: "var(--vscode-panel-border)" }}
      >
        <div className="min-w-0">
          <h1 className="text-base font-semibold" style={{ color: "var(--vscode-foreground)" }}>
            Mission Canvas
          </h1>
          <div className="mt-1 text-xs" style={{ color: "var(--vscode-descriptionForeground)" }}>
            {message}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div
            className="h-8 px-2.5 border flex items-center gap-2 text-sm"
            style={{
              color: "var(--vscode-foreground)",
              backgroundColor: "var(--vscode-sidebar-background)",
              borderColor: "var(--vscode-panel-border)",
            }}
          >
            <span
              className="w-2 h-2 rounded-full shrink-0"
              style={{ backgroundColor: running ? "#22c55e" : "#ef4444" }}
              title={running ? "Navigation running" : "Navigation idle"}
              aria-label={running ? "Navigation running" : "Navigation idle"}
            />
            <span className="font-medium">{running ? "running" : "idle"}</span>
          </div>
          <input
            value={mapName}
            onChange={(event) => setMapName(event.currentTarget.value)}
            className="h-8 w-28 px-2 border text-sm"
            style={{
              color: "var(--vscode-input-foreground)",
              backgroundColor: "var(--vscode-input-background)",
              borderColor: "var(--vscode-input-border, var(--vscode-panel-border))",
            }}
          />
          <button
            type="button"
            disabled={!!busy || running}
            onClick={handleStartMapping}
            className="h-8 px-3 border text-sm font-semibold disabled:opacity-50"
            style={{
              color: "var(--vscode-button-foreground)",
              backgroundColor: "var(--vscode-button-background)",
              borderColor: "var(--vscode-focusBorder)",
            }}
          >
            Mapping
          </button>
          <button
            type="button"
            disabled={!!busy || running}
            onClick={handleStartNavigation}
            className="h-8 px-3 border text-sm font-semibold disabled:opacity-50"
            style={{
              color: "var(--vscode-button-foreground)",
              backgroundColor: "var(--vscode-button-background)",
              borderColor: "var(--vscode-focusBorder)",
            }}
          >
            Navigation
          </button>
          <button
            type="button"
            disabled={!!busy || !running}
            onClick={handleSaveMap}
            className="h-8 px-3 border text-sm font-semibold disabled:opacity-50"
            style={{
              color: "var(--vscode-button-secondaryForeground)",
              backgroundColor: "var(--vscode-button-secondaryBackground)",
              borderColor: "var(--vscode-panel-border)",
            }}
          >
            Save Map
          </button>
          <button
            type="button"
            disabled={!!busy || !running}
            onClick={handleStopNavigation}
            className="h-8 px-3 border text-sm font-semibold disabled:opacity-50"
            style={{
              color: "#000000",
              backgroundColor: "var(--vscode-inputValidation-errorBackground, #b91c1c)",
              borderColor: "var(--vscode-inputValidation-errorBorder, #ef4444)",
            }}
          >
            Stop
          </button>
          <button
            type="button"
            disabled={!running || !map}
            onClick={handleToggleSpotMode}
            className="h-8 px-3 border text-sm font-semibold disabled:opacity-50"
            style={{
              color: interactionMode === "spot"
                ? "var(--vscode-button-secondaryForeground)"
                : "var(--vscode-button-foreground)",
              backgroundColor: interactionMode === "spot"
                ? "var(--vscode-button-secondaryBackground)"
                : "var(--vscode-button-background)",
              borderColor: interactionMode === "spot"
                ? "var(--vscode-panel-border)"
                : "var(--vscode-focusBorder)",
            }}
          >
            Spot
          </button>
        </div>
      </header>

      <div
        className="shrink-0 mb-4 flex flex-wrap gap-2"
        role="tablist"
        aria-label="Mission Canvas stages"
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
                if (stage.id !== STAGE_AUTHORING) setInteractionMode("view");
              }}
              className="h-8 px-3 border text-sm font-semibold"
              style={{
                color: selected
                  ? "var(--vscode-button-foreground)"
                  : "var(--vscode-foreground)",
                backgroundColor: selected
                  ? "var(--vscode-button-background)"
                  : "var(--vscode-editor-background)",
                borderColor: selected
                  ? "var(--vscode-focusBorder)"
                  : "var(--vscode-panel-border)",
              }}
            >
              {stage.label}
            </button>
          );
        })}
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
            map={map}
            globalCostmap={needsGlobalCostmap ? globalCostmap : null}
            localCostmap={needsLocalCostmap ? localCostmap : null}
            scan={needsScan ? scan : null}
            pose={navigationTopicsActive ? currentPose : null}
            plan={needsPlan ? plan : null}
            goalPose={needsGoalPose ? goalPose : null}
            footprint={needsRobotModel ? footprint : null}
            tf={needsTf ? bufferedTf : null}
            spots={spots}
            selectedSpotId={selectedSpotId}
            showMap={activeLayers.map}
            showGlobalCostmap={needsGlobalCostmap}
            showLocalCostmap={needsLocalCostmap}
            showScan={needsScan}
            showGlobalPlan={needsPlan}
            showGoalPose={needsGoalPose}
            showTf={navigationTopicsActive && activeLayers.tf}
            showRobotModel={needsRobotModel}
            interactionDisabled={!!busy}
            interactionMode={interactionMode}
            editorActive={false}
            fitContainer
            viewKey={`mission:${mapName}`}
            waitingLabel={running ? "Waiting for /map" : "Start Navigation to view /map"}
            onSpotClick={setSelectedSpotId}
            onMapPose={handleCreateSpotAtPose}
          />
          {workspaceStage === STAGE_AUTHORING && (
            <Panel title="Behavior Surface" className="min-h-0 overflow-hidden">
              <div className="text-xs leading-5" style={{ color: "var(--vscode-descriptionForeground)" }}>
                BT graph embedding starts after Spot persistence and NavigateToSpot are stable.
              </div>
            </Panel>
          )}
        </section>

        {workspaceStage === STAGE_AUTHORING ? (
          <aside className="min-h-0 grid grid-rows-[auto_1fr_minmax(160px,220px)] gap-4">
            <Panel className="grid gap-3">
            <div className="flex items-center justify-between gap-3">
              <div className="text-xs font-semibold">Inspector</div>
              <button
                type="button"
                disabled={!selectedSpot}
                onClick={handleDeleteSelectedSpot}
                className="h-7 px-2 border text-xs font-semibold disabled:opacity-50"
                style={{
                  color: "var(--vscode-button-secondaryForeground)",
                  backgroundColor: "var(--vscode-button-secondaryBackground)",
                  borderColor: "var(--vscode-panel-border)",
                }}
              >
                Delete
              </button>
            </div>
            {selectedSpot ? (
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
                      borderColor: "var(--vscode-input-border, var(--vscode-panel-border))",
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
                Select a Spot, or press Spot and click the map to create one.
              </div>
            )}
            </Panel>

            <Panel title="Spots" className="min-h-0 overflow-auto">
              <div className="grid gap-2">
                {spots.map((spot) => (
                  <button
                    key={spot.id}
                    type="button"
                    onClick={() => setSelectedSpotId(spot.id)}
                    className="h-8 px-2 border text-left text-xs min-w-0"
                    style={{
                      color: spot.id === selectedSpotId
                        ? "var(--vscode-button-foreground)"
                        : "var(--vscode-foreground)",
                      backgroundColor: spot.id === selectedSpotId
                        ? "var(--vscode-button-background)"
                        : "var(--vscode-editor-background)",
                      borderColor: "var(--vscode-panel-border)",
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
            </Panel>
            <TopicStatusPanel topicRows={topicRows} />
          </aside>
        ) : (
          <aside className="min-h-0 grid grid-rows-[auto_auto_minmax(0,1fr)] gap-4">
            <Panel title={workspaceStage === STAGE_MAPPING ? "Mapping" : "Run"}>
              <div className="text-xs leading-5" style={{ color: "var(--vscode-descriptionForeground)" }}>
                {workspaceStage === STAGE_MAPPING
                  ? "Focused map building view with map, lidar, robot model, and TF layers."
                  : "Runtime view for navigation, costmaps, global plan, goal pose, and future BT/VLA state."}
              </div>
              <div className="mt-3 text-xs">
                Map name: <span className="font-mono">{mapName || "-"}</span>
              </div>
              <div className="mt-1 text-xs">
                PID: <span className="font-mono">{status?.pid ?? "-"}</span>
              </div>
            </Panel>
            <LayersPanel layerToggles={layerToggles} />
            <TopicStatusPanel topicRows={topicRows} />
          </aside>
        )}
      </div>
    </div>
  );
}
