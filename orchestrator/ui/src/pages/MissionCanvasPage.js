// Copyright 2026 ROBOTIS CO., LTD.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.

"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  getServiceStatus,
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

const DEFAULT_MAP_NAME = "map";
const STATUS_POLL_MS = 10000;

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

export default function MissionCanvasPage() {
  const statusLoadingRef = useRef(false);
  const [mapName, setMapName] = useState(DEFAULT_MAP_NAME);
  const [status, setStatus] = useState(null);
  const [spots, setSpots] = useState([]);
  const [selectedSpotId, setSelectedSpotId] = useState("");
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("Ready");
  const [interactionMode, setInteractionMode] = useState("view");

  const running = status?.is_up ?? false;
  const selectedSpot = useMemo(
    () => spots.find((spot) => spot.id === selectedSpotId) || null,
    [selectedSpotId, spots],
  );
  const { topicData: mapData } = useNavigationRosTopic(
    running ? "/map" : null,
  );
  const map = useMemo(() => messageData(mapData), [mapData]);

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
    () => startNavigation("nav", mapName.trim() || DEFAULT_MAP_NAME),
  ), [mapName, runCommand]);

  const handleStopNavigation = useCallback(() => runCommand(
    "Stop",
    () => stopNavigation(),
  ), [runCommand]);

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
            onClick={() => setInteractionMode((value) => (value === "spot" ? "view" : "spot"))}
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

      <div className="flex-1 min-h-0 grid grid-cols-1 xl:grid-cols-[minmax(520px,1fr)_360px] gap-4">
        <section className="min-h-0 grid grid-rows-[1fr_180px] gap-4">
          <MapViewer
            map={map}
            globalCostmap={null}
            localCostmap={null}
            scan={null}
            pose={null}
            plan={null}
            goalPose={null}
            footprint={null}
            tf={null}
            spots={spots}
            selectedSpotId={selectedSpotId}
            showMap
            showGlobalCostmap={false}
            showLocalCostmap={false}
            showScan={false}
            showGlobalPlan={false}
            showGoalPose={false}
            showTf={false}
            showRobotModel={false}
            interactionDisabled={!!busy}
            interactionMode={interactionMode}
            editorActive={false}
            viewKey={`mission:${mapName}`}
            waitingLabel={running ? "Waiting for /map" : "Start Navigation to view /map"}
            onSpotClick={setSelectedSpotId}
            onMapPose={handleCreateSpotAtPose}
          />
          <div
            className="border p-3 min-h-0 overflow-hidden"
            style={{
              color: "var(--vscode-foreground)",
              borderColor: "var(--vscode-panel-border)",
              backgroundColor: "var(--vscode-sidebar-background)",
            }}
          >
            <div className="text-xs font-semibold mb-2">Behavior Surface</div>
            <div className="text-xs leading-5" style={{ color: "var(--vscode-descriptionForeground)" }}>
              BT graph embedding starts after Spot persistence and NavigateToSpot are stable.
            </div>
          </div>
        </section>

        <aside className="min-h-0 grid grid-rows-[auto_1fr] gap-4">
          <div
            className="border p-3 grid gap-3"
            style={{
              color: "var(--vscode-foreground)",
              borderColor: "var(--vscode-panel-border)",
              backgroundColor: "var(--vscode-sidebar-background)",
            }}
          >
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
          </div>

          <div
            className="border p-3 min-h-0 overflow-auto"
            style={{
              color: "var(--vscode-foreground)",
              borderColor: "var(--vscode-panel-border)",
              backgroundColor: "var(--vscode-sidebar-background)",
            }}
          >
            <div className="text-xs font-semibold mb-2">Spots</div>
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
          </div>
        </aside>
      </div>
    </div>
  );
}
