// Copyright 2026 ROBOTIS CO., LTD.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.
//
// Author: Seongwoo Kim

import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  ReactFlow,
  Controls,
  Background,
  addEdge,
  useEdgesState,
  useNodesState,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import clsx from "clsx";
import toast from "react-hot-toast";
import {
  MdAutoFixHigh,
  MdDriveFileRenameOutline,
  MdRedo,
  MdSave,
  MdStar,
  MdUndo,
  MdUploadFile,
} from "react-icons/md";

import BTActionNode from "../bt/BTActionNode";
import BTControlNode from "../bt/BTControlNode";
import BTNodePalette, { PALETTE_DRAG_MIME } from "../bt/BTNodePalette";
import BTParamPanel from "../bt/BTParamPanel";
import { useBTHistory } from "../../hooks/useBTHistory";
import { useBTNodeCatalog } from "../../hooks/useBTNodeCatalog";
import {
  parseBTXml,
  applyDagreLayout,
  findDeletionLayoutAnchor,
} from "../../utils/btTreeParser";
import { serializeFromGraph } from "../../utils/btXmlSerializer";

const nodeTypes = {
  btControl: BTControlNode,
  btAction: BTActionNode,
};

const reactFlowProOptions = { hideAttribution: true };

// Observe the app's dark theme via the `dark` class on <html> so the ReactFlow
// canvas (which needs a JS color value for its dot grid) stays theme-aware.
function useIsDark() {
  const [isDark, setIsDark] = useState(() => (
    typeof document !== "undefined" &&
    document.documentElement.classList.contains("dark")
  ));
  useEffect(() => {
    if (typeof document === "undefined") return undefined;
    const root = document.documentElement;
    const sync = () => setIsDark(root.classList.contains("dark"));
    sync();
    const observer = new MutationObserver(sync);
    observer.observe(root, { attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, []);
  return isDark;
}

function catalogEntryToParams(entry) {
  return Object.fromEntries(
    (entry?.ports || []).map((port) => [port.name, port.default]),
  );
}

function collectDescendants(rootId, edges) {
  const out = new Set();
  const queue = [rootId];
  while (queue.length) {
    const id = queue.shift();
    for (const edge of edges) {
      if (edge.source === id && !out.has(edge.target)) {
        out.add(edge.target);
        queue.push(edge.target);
      }
    }
  }
  return out;
}

function computeHiddenIds(nodes, edges) {
  const hidden = new Set();
  nodes.forEach((node) => {
    if (node.type !== "btControl" || !node.data?.collapsed) return;
    collectDescendants(node.id, edges).forEach((id) => hidden.add(id));
  });
  return hidden;
}

export function isValidBtConnection(connection, nodes, edges) {
  const source = connection?.source;
  const target = connection?.target;
  if (!source || !target || source === target) return false;
  const sourceNode = nodes.find((node) => node.id === source);
  if (!sourceNode || sourceNode.type !== "btControl") return false;
  if (edges.some((edge) => edge.target === target)) return false;

  // Adding source -> target is cyclic when target already reaches source.
  const queue = [target];
  const visited = new Set();
  while (queue.length) {
    const nodeId = queue.shift();
    if (nodeId === source) return false;
    if (visited.has(nodeId)) continue;
    visited.add(nodeId);
    edges.forEach((edge) => {
      if (edge.source === nodeId) queue.push(edge.target);
    });
  }
  return true;
}

function layoutVisibleOnly(nodes, edges, { anchorNodeId = null } = {}) {
  const hidden = computeHiddenIds(nodes, edges);
  const visibleNodes = nodes.filter((node) => !hidden.has(node.id));
  const visibleEdges = edges.filter((edge) => (
    !hidden.has(edge.source) && !hidden.has(edge.target)
  ));
  const laidOut = applyDagreLayout(visibleNodes, visibleEdges, {
    respectStored: false,
    anchorNodeId,
  });
  const byId = new Map(laidOut.nodes.map((node) => [node.id, node]));
  return nodes.map((node) => byId.get(node.id) || node);
}

export default function MissionBtEditor({
  title,
  filePath,
  fileOptions = [],
  defaultFilePath = "",
  xml,
  loading = false,
  activeNodeNames = [],
  onXmlChange,
  onLoadXml,
  onSaveXml,
  onFilePathChange,
  onSaveXmlAs,
  onSetDefaultXml,
  fileActionsDisabled = false,
}) {
  const isDark = useIsDark();
  const { catalog: nodeCatalog = [] } = useBTNodeCatalog();
  const [nodes, setNodes, onNodesChange] = useNodesState([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);
  const [nodeDataMap, setNodeDataMap] = useState(new Map());
  const [selectedNodeId, setSelectedNodeId] = useState(null);
  const [parseError, setParseError] = useState(null);
  const [hydratedPath, setHydratedPath] = useState("");
  const [fileAction, setFileAction] = useState("");
  const [showLoadDialog, setShowLoadDialog] = useState(false);
  const [pendingLoadPath, setPendingLoadPath] = useState(filePath || "");
  const [showSaveAsDialog, setShowSaveAsDialog] = useState(false);
  const [saveAsName, setSaveAsName] = useState("");
  const reactFlowRef = useRef(null);
  const nodesRef = useRef(nodes);
  const edgesRef = useRef(edges);
  const nodeDataMapRef = useRef(nodeDataMap);
  const lastEmittedXmlRef = useRef(null);
  const lastEmittedPathRef = useRef("");
  const onXmlChangeRef = useRef(onXmlChange);
  const fileActionRequestRef = useRef(0);
  const coalescedEditRef = useRef({ key: "", lastChangeAt: 0 });

  nodesRef.current = nodes;
  edgesRef.current = edges;
  nodeDataMapRef.current = nodeDataMap;
  onXmlChangeRef.current = onXmlChange;

  useEffect(() => {
    fileActionRequestRef.current += 1;
    setFileAction("");
    setShowLoadDialog(false);
    setPendingLoadPath(filePath || "");
    setShowSaveAsDialog(false);
    setSaveAsName("");
  }, [filePath]);

  const availableFileOptions = useMemo(() => (
    [filePath, ...fileOptions]
      .map((path) => String(path || "").trim())
      .filter((path, index, paths) => path && paths.indexOf(path) === index)
  ), [fileOptions, filePath]);

  const getHistorySnapshot = useCallback(() => {
    if (nodes.length === 0) return null;
    return JSON.stringify({
      nodes: nodes.map(({ data: { isActive: _active, isSelected: _selected, ...data }, ...node }) => ({
        ...node,
        data,
      })),
      edges,
      nodeDataMap: [...nodeDataMap.entries()],
    });
  }, [edges, nodeDataMap, nodes]);

  const applyHistorySnapshot = useCallback((snapshot) => {
    try {
      const parsed = JSON.parse(snapshot);
      setNodes(parsed.nodes || []);
      setEdges(parsed.edges || []);
      setNodeDataMap(new Map(parsed.nodeDataMap || []));
      setSelectedNodeId(null);
      setParseError(null);
      coalescedEditRef.current = { key: "", lastChangeAt: 0 };
    } catch (error) {
      setParseError(error instanceof Error ? error.message : "Failed to restore history");
    }
  }, [setEdges, setNodes]);

  const {
    capture: captureHistory,
    undo: undoHistory,
    redo: redoHistory,
    reset: resetHistory,
    canUndo,
    canRedo,
  } = useBTHistory({
    getSnapshot: getHistorySnapshot,
    applySnapshot: applyHistorySnapshot,
  });

  const captureCoalescedEditHistory = useCallback((key) => {
    const now = Date.now();
    const previous = coalescedEditRef.current;
    if (previous.key !== key || now - previous.lastChangeAt > 750) {
      captureHistory();
    }
    coalescedEditRef.current = { key, lastChangeAt: now };
  }, [captureHistory]);

  useEffect(() => {
    if (
      filePath === lastEmittedPathRef.current &&
      xml === lastEmittedXmlRef.current
    ) {
      return;
    }
    try {
      const parsed = parseBTXml(xml || "");
      // The prop already is parent-owned state. Treat its normalized graph as
      // the baseline instead of emitting the component's initial empty graph
      // (or marking formatting-only normalization as a user edit).
      lastEmittedXmlRef.current = serializeFromGraph(
        parsed.nodes || [],
        parsed.edges || [],
        parsed.nodeDataMap || new Map(),
      );
      lastEmittedPathRef.current = filePath;
      setNodes(parsed.nodes || []);
      setEdges(parsed.edges || []);
      setNodeDataMap(parsed.nodeDataMap || new Map());
      setSelectedNodeId(null);
      setParseError(null);
      setHydratedPath(filePath);
      coalescedEditRef.current = { key: "", lastChangeAt: 0 };
      resetHistory();
    } catch (error) {
      setNodes([]);
      setEdges([]);
      setNodeDataMap(new Map());
      setSelectedNodeId(null);
      setParseError(error instanceof Error ? error.message : "Failed to parse BT XML");
      setHydratedPath(filePath);
      coalescedEditRef.current = { key: "", lastChangeAt: 0 };
    }
  }, [filePath, resetHistory, setEdges, setNodes, xml]);

  // Persist tree edits to the parent immediately (not debounced): a debounce
  // whose timer was reset by every parent re-render never fired, and switching
  // waypoints cleared the pending timer, silently dropping the whole tree.
  // serializeFromGraph omits node positions, so drags produce identical XML and
  // are skipped by the guard below — only real structural edits re-emit. filePath
  // is intentionally excluded from the deps: on a waypoint switch it changes one
  // render before `nodes` reloads, and emitting in that gap would write the old
  // tree to the new path.
  useLayoutEffect(() => {
    if (parseError || hydratedPath !== filePath) return;
    const emit = onXmlChangeRef.current;
    if (typeof emit !== "function") return;
    let serialized;
    try {
      serialized = serializeFromGraph(nodes, edges, nodeDataMap);
    } catch {
      return; // partial graph mid-edit; wait for the next change
    }
    if (filePath === lastEmittedPathRef.current && serialized === lastEmittedXmlRef.current) {
      return;
    }
    lastEmittedXmlRef.current = serialized;
    lastEmittedPathRef.current = filePath;
    emit(filePath, serialized);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [edges, hydratedPath, nodeDataMap, nodes, parseError]);

  const handleCanvasDragOver = useCallback((event) => {
    if (event.dataTransfer.types.includes(PALETTE_DRAG_MIME)) {
      event.preventDefault();
      event.dataTransfer.dropEffect = "move";
    }
  }, []);

  const handleCanvasDrop = useCallback((event) => {
    const tag = event.dataTransfer.getData(PALETTE_DRAG_MIME)
      || event.dataTransfer.getData("text/plain");
    const meta = nodeCatalog.find((entry) => entry.tag === tag);
    if (!tag || !meta) return;
    event.preventDefault();

    const position = reactFlowRef.current
      ? reactFlowRef.current.screenToFlowPosition({ x: event.clientX, y: event.clientY })
      : { x: 100 + Math.random() * 200, y: 100 + Math.random() * 200 };

    let maxIndex = 0;
    for (const { name } of nodeDataMapRef.current.values()) {
      const match = String(name || "").match(new RegExp(`^${tag}_(\\d+)$`));
      if (match) maxIndex = Math.max(maxIndex, parseInt(match[1], 10));
    }
    const name = `${tag}_${maxIndex + 1}`;
    const id = `bt_${Date.now()}`;
    const params = catalogEntryToParams(meta);
    const isControl = meta.category === "control";
    const nextNode = {
      id,
      type: isControl ? "btControl" : "btAction",
      position,
      data: isControl
        ? { label: name, nodeType: tag, params, collapsed: false }
        : { label: name, nodeType: tag, params },
    };

    captureHistory();
    setNodes((current) => [...current, nextNode]);
    setNodeDataMap((current) => {
      const next = new Map(current);
      next.set(
        id,
        isControl
          ? { tag, name, params, collapsed: false }
          : { tag, name, params },
      );
      return next;
    });
    setSelectedNodeId(id);
  }, [captureHistory, nodeCatalog, setNodes]);

  const handleConnect = useCallback((connection) => {
    if (!isValidBtConnection(connection, nodesRef.current, edgesRef.current)) {
      toast.error("BT connections must form a single-parent acyclic tree");
      return;
    }
    captureHistory();
    const nextEdges = addEdge(
      { ...connection, type: "smoothstep", animated: false },
      edgesRef.current,
    );
    setEdges(nextEdges);
    setNodes(layoutVisibleOnly(nodesRef.current, nextEdges, {
      anchorNodeId: connection.source,
    }));
  }, [captureHistory, setEdges, setNodes]);

  const handleAutoLayout = useCallback(() => {
    if (!nodesRef.current.length) return;
    captureHistory();
    setNodes(layoutVisibleOnly(nodesRef.current, edgesRef.current));
  }, [captureHistory, setNodes]);

  // Local waypoint XML is owned by the mission store. Keep file I/O behind
  // parent callbacks so this editor never reaches into BT Manager's global
  // orchestrator/bt/trees template directory.
  const serializeCurrentXml = useCallback(() => serializeFromGraph(
    nodesRef.current,
    edgesRef.current,
    nodeDataMapRef.current,
  ), []);

  const handleLoadXml = useCallback(async (targetPath) => {
    if (!targetPath || typeof onLoadXml !== "function") return;
    const requestId = fileActionRequestRef.current + 1;
    fileActionRequestRef.current = requestId;
    setFileAction("load");
    try {
      await onLoadXml(targetPath);
      if (fileActionRequestRef.current !== requestId) return;
      setShowLoadDialog(false);
      toast.success(`Loaded: ${targetPath}`);
      if (typeof onFilePathChange === "function") onFilePathChange(targetPath);
    } catch (error) {
      if (fileActionRequestRef.current !== requestId) return;
      toast.error(`Failed to load ${targetPath}: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      if (fileActionRequestRef.current === requestId) setFileAction("");
    }
  }, [onFilePathChange, onLoadXml]);

  const handleSaveXml = useCallback(async () => {
    if (!filePath || typeof onSaveXml !== "function") return;
    let serialized;
    try {
      serialized = serializeCurrentXml();
    } catch (error) {
      toast.error(`Failed to serialize ${filePath}: ${error instanceof Error ? error.message : String(error)}`);
      return;
    }
    const requestId = fileActionRequestRef.current + 1;
    fileActionRequestRef.current = requestId;
    setFileAction("save");
    try {
      await onSaveXml(filePath, serialized);
      if (fileActionRequestRef.current !== requestId) return;
      toast.success(`Saved: ${filePath}`);
    } catch (error) {
      if (fileActionRequestRef.current !== requestId) return;
      toast.error(`Failed to save ${filePath}: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      if (fileActionRequestRef.current === requestId) setFileAction("");
    }
  }, [filePath, onSaveXml, serializeCurrentXml]);

  const handleSaveXmlAs = useCallback(async (event) => {
    event.preventDefault();
    const targetName = saveAsName.trim();
    if (!filePath || !targetName || typeof onSaveXmlAs !== "function") return;
    let serialized;
    try {
      serialized = serializeCurrentXml();
    } catch (error) {
      toast.error(`Failed to serialize ${filePath}: ${error instanceof Error ? error.message : String(error)}`);
      return;
    }
    const requestId = fileActionRequestRef.current + 1;
    fileActionRequestRef.current = requestId;
    setFileAction("save-as");
    try {
      const response = await onSaveXmlAs(filePath, targetName, serialized);
      if (fileActionRequestRef.current !== requestId) return;
      const nextPath = String(response?.path || "").trim();
      setShowSaveAsDialog(false);
      setSaveAsName("");
      toast.success(`Saved as: ${nextPath || targetName}`);
      if (nextPath && response?.selected !== true && typeof onFilePathChange === "function") {
        onFilePathChange(nextPath);
      }
    } catch (error) {
      if (fileActionRequestRef.current !== requestId) return;
      toast.error(`Failed to save as ${targetName}: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      if (fileActionRequestRef.current === requestId) setFileAction("");
    }
  }, [filePath, onFilePathChange, onSaveXmlAs, saveAsName, serializeCurrentXml]);

  const handleSetDefaultXml = useCallback(async () => {
    if (!filePath || typeof onSetDefaultXml !== "function") return;
    const requestId = fileActionRequestRef.current + 1;
    fileActionRequestRef.current = requestId;
    setFileAction("set-default");
    try {
      await onSetDefaultXml(filePath);
      if (fileActionRequestRef.current !== requestId) return;
      toast.success(`Default BT: ${filePath}`);
    } catch (error) {
      if (fileActionRequestRef.current !== requestId) return;
      toast.error(`Failed to set default ${filePath}: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      if (fileActionRequestRef.current === requestId) setFileAction("");
    }
  }, [filePath, onSetDefaultXml]);

  const handleToggleCollapse = useCallback((nodeId) => {
    const target = nodesRef.current.find((node) => node.id === nodeId);
    if (!target || target.type !== "btControl") return;
    const nextCollapsed = !target.data?.collapsed;
    captureHistory();
    setNodeDataMap((current) => {
      const next = new Map(current);
      const entry = next.get(nodeId);
      if (entry) next.set(nodeId, { ...entry, collapsed: nextCollapsed });
      return next;
    });
    setNodes((current) => {
      const flipped = current.map((node) => (
        node.id === nodeId
          ? { ...node, data: { ...node.data, collapsed: nextCollapsed } }
          : node
      ));
      return layoutVisibleOnly(flipped, edgesRef.current);
    });
  }, [captureHistory, setNodes]);

  const handleNameChange = useCallback((nodeId, name) => {
    const trimmed = String(name || "").trim();
    if (!trimmed) return;
    captureCoalescedEditHistory(`name:${nodeId}`);
    setNodeDataMap((current) => {
      const next = new Map(current);
      const entry = next.get(nodeId);
      if (entry) next.set(nodeId, { ...entry, name: trimmed });
      return next;
    });
    setNodes((current) => current.map((node) => (
      node.id === nodeId
        ? { ...node, data: { ...node.data, label: trimmed } }
        : node
    )));
  }, [captureCoalescedEditHistory, setNodes]);

  const handleParamChange = useCallback((nodeId, paramName, value) => {
    captureCoalescedEditHistory(`param:${nodeId}:${paramName}`);
    setNodeDataMap((current) => {
      const next = new Map(current);
      const entry = next.get(nodeId);
      if (entry) next.set(nodeId, {
        ...entry,
        params: { ...entry.params, [paramName]: value },
      });
      return next;
    });
    setNodes((current) => current.map((node) => (
      node.id === nodeId
        ? {
          ...node,
          data: {
            ...node.data,
            params: { ...node.data.params, [paramName]: value },
          },
        }
        : node
    )));
  }, [captureCoalescedEditHistory, setNodes]);

  useEffect(() => {
    const handleDelete = (event) => {
      if (event.key !== "Delete" && event.key !== "Backspace") return;
      if (["INPUT", "TEXTAREA", "SELECT"].includes(event.target.tagName)) return;

      const selectedNodeIds = new Set(
        nodesRef.current
          .filter((node) => node.selected || node.id === selectedNodeId)
          .map((node) => node.id),
      );
      const selectedEdgeIds = new Set(
        edgesRef.current.filter((edge) => edge.selected).map((edge) => edge.id),
      );
      if (selectedNodeIds.size === 0 && selectedEdgeIds.size === 0) return;

      captureHistory();
      const remainingNodes = nodesRef.current.filter((node) => !selectedNodeIds.has(node.id));
      const remainingEdges = edgesRef.current.filter((edge) => (
        !selectedEdgeIds.has(edge.id) &&
        !selectedNodeIds.has(edge.source) &&
        !selectedNodeIds.has(edge.target)
      ));
      const anchorNodeId = findDeletionLayoutAnchor(
        nodesRef.current,
        edgesRef.current,
        selectedNodeIds,
        selectedEdgeIds,
      );
      setNodes(layoutVisibleOnly(remainingNodes, remainingEdges, { anchorNodeId }));
      setEdges(remainingEdges);
      setNodeDataMap((current) => {
        const next = new Map(current);
        selectedNodeIds.forEach((id) => next.delete(id));
        return next;
      });
      if (selectedNodeIds.has(selectedNodeId)) setSelectedNodeId(null);
    };
    document.addEventListener("keydown", handleDelete);
    return () => document.removeEventListener("keydown", handleDelete);
  }, [captureHistory, selectedNodeId, setEdges, setNodes]);

  const annotatedNodes = useMemo(() => {
    const activeSet = new Set(activeNodeNames);
    const hiddenIds = computeHiddenIds(nodes, edges);
    const childrenById = new Map(nodes.map((node) => [node.id, []]));
    const childCount = new Map();
    edges.forEach((edge) => {
      if (childrenById.has(edge.source)) childrenById.get(edge.source).push(edge.target);
      childCount.set(edge.source, (childCount.get(edge.source) || 0) + 1);
    });

    const hasActiveDescendant = (nodeId) => {
      const queue = [...(childrenById.get(nodeId) || [])];
      while (queue.length) {
        const id = queue.shift();
        if (activeSet.has(id)) return true;
        queue.push(...(childrenById.get(id) || []));
      }
      return false;
    };

    return nodes.map((node) => {
      const isControl = node.type === "btControl";
      return {
        ...node,
        hidden: hiddenIds.has(node.id),
        data: {
          ...node.data,
          isActive: activeSet.has(node.id) || (isControl && hasActiveDescendant(node.id)),
          isSelected: node.id === selectedNodeId,
          childCount: childCount.get(node.id) || 0,
          onToggleCollapse: handleToggleCollapse,
        },
      };
    });
  }, [activeNodeNames, edges, handleToggleCollapse, nodes, selectedNodeId]);

  return (
    <div className="h-full min-h-0 relative flex bg-[var(--mc-bg)] text-[var(--mc-text)]">
      <div className="absolute top-3 right-3 z-20 flex items-center gap-1 rounded-[10px] border border-[var(--mc-border)] bg-[var(--mc-surface)]/95 p-1 shadow-sm">
          <div
            className="min-w-0 max-w-36 px-2 text-right"
            title={`${title || "Local BT"} · ${filePath || "No XML selected"}`}
          >
            <div className="truncate text-[10px] text-[var(--mc-text-subtle)]">
              {title || "Local BT"}
            </div>
            <div className="flex items-center justify-end gap-1">
              <span className="truncate text-xs font-semibold text-[var(--mc-text-muted)]">
                {filePath?.split("/").pop() || "No XML"}
              </span>
              {filePath && filePath === defaultFilePath && (
                <span className="rounded bg-orange-500/15 px-1 py-0.5 text-[9px] font-semibold text-orange-500">
                  Default
                </span>
              )}
            </div>
          </div>
          <button
            type="button"
            onClick={undoHistory}
            disabled={!canUndo}
            title="Undo"
            className={clsx(
              "h-8 w-8 rounded-lg flex items-center justify-center transition-colors",
              canUndo
                ? "bg-[var(--mc-surface-2)] hover:bg-[var(--mc-surface-hover)] text-[var(--mc-text-muted)]"
                : "bg-[var(--mc-surface-2)] text-[var(--mc-text-subtle)] opacity-50",
            )}
          >
            <MdUndo size={18} />
          </button>
          <button
            type="button"
            onClick={redoHistory}
            disabled={!canRedo}
            title="Redo"
            className={clsx(
              "h-8 w-8 rounded-lg flex items-center justify-center transition-colors",
              canRedo
                ? "bg-[var(--mc-surface-2)] hover:bg-[var(--mc-surface-hover)] text-[var(--mc-text-muted)]"
                : "bg-[var(--mc-surface-2)] text-[var(--mc-text-subtle)] opacity-50",
            )}
          >
            <MdRedo size={18} />
          </button>
          <button
            type="button"
            onClick={handleAutoLayout}
            disabled={!nodes.length}
            title="Auto layout"
            className={clsx(
              "h-8 w-8 rounded-lg flex items-center justify-center transition-colors",
              nodes.length
                ? "bg-[var(--mc-surface-2)] hover:bg-[var(--mc-surface-hover)] text-[var(--mc-text-muted)]"
                : "bg-[var(--mc-surface-2)] text-[var(--mc-text-subtle)] opacity-50",
            )}
          >
            <MdAutoFixHigh size={18} />
          </button>
          <button
            type="button"
            onClick={() => {
              setPendingLoadPath(filePath || availableFileOptions[0] || "");
              setShowLoadDialog(true);
            }}
            disabled={loading || fileActionsDisabled || Boolean(fileAction) || !onLoadXml}
            title={filePath ? `Load ${filePath}` : "Load XML"}
            aria-label="Load XML"
            className={clsx(
              "h-8 flex items-center gap-1.5 rounded-lg bg-[var(--mc-surface-2)] px-2.5 text-xs font-medium text-[var(--mc-text-muted)] transition-colors hover:bg-[var(--mc-surface-hover)]",
              (loading || fileActionsDisabled || fileAction || !onLoadXml) && "cursor-not-allowed opacity-60",
            )}
          >
            <MdUploadFile size={18} />
            {fileAction === "load" ? "Loading..." : "Load XML"}
          </button>
          <button
            type="button"
            onClick={handleSaveXml}
            disabled={(
              loading ||
              fileActionsDisabled ||
              Boolean(fileAction) ||
              Boolean(parseError) ||
              hydratedPath !== filePath ||
              !onSaveXml
            )}
            title={filePath ? `Save ${filePath}` : "Save XML"}
            aria-label="Save XML"
            className={clsx(
              "h-8 flex items-center gap-1.5 rounded-lg bg-[var(--mc-surface-2)] px-2.5 text-xs font-medium text-[var(--mc-text-muted)] transition-colors hover:bg-[var(--mc-surface-hover)]",
              (
                loading ||
                fileActionsDisabled ||
                fileAction ||
                parseError ||
                hydratedPath !== filePath ||
                !onSaveXml
              ) && "cursor-not-allowed opacity-60",
            )}
          >
            <MdSave size={18} />
            {fileAction === "save" ? "Saving..." : "Save"}
          </button>
          <button
            type="button"
            onClick={() => setShowSaveAsDialog(true)}
            disabled={(
              loading
              || fileActionsDisabled
              || Boolean(fileAction)
              || Boolean(parseError)
              || hydratedPath !== filePath
              || !onSaveXmlAs
            )}
            title="Save the current tree as another waypoint XML"
            aria-label="Save XML as"
            className={clsx(
              "h-8 flex items-center gap-1.5 rounded-lg bg-[var(--mc-surface-2)] px-2.5 text-xs font-medium text-[var(--mc-text-muted)] transition-colors hover:bg-[var(--mc-surface-hover)]",
              (
                loading
                || fileActionsDisabled
                || fileAction
                || parseError
                || hydratedPath !== filePath
                || !onSaveXmlAs
              ) && "cursor-not-allowed opacity-60",
            )}
          >
            <MdDriveFileRenameOutline size={18} />
            {fileAction === "save-as" ? "Saving..." : "Save As"}
          </button>
          <button
            type="button"
            onClick={handleSetDefaultXml}
            disabled={(
              loading
              || fileActionsDisabled
              || Boolean(fileAction)
              || !filePath
              || filePath === defaultFilePath
              || !onSetDefaultXml
            )}
            title={filePath === defaultFilePath
              ? "This XML is already the default"
              : "Use this XML when the mission runs"}
            aria-label="Set default BT"
            className={clsx(
              "h-8 flex items-center gap-1.5 rounded-lg bg-[var(--mc-surface-2)] px-2.5 text-xs font-medium text-[var(--mc-text-muted)] transition-colors hover:bg-[var(--mc-surface-hover)]",
              (
                loading
                || fileActionsDisabled
                || fileAction
                || !filePath
                || filePath === defaultFilePath
                || !onSetDefaultXml
              ) && "cursor-not-allowed opacity-60",
            )}
          >
            <MdStar size={18} />
            {fileAction === "set-default" ? "Setting..." : "Set Default"}
          </button>
      </div>

        <BTNodePalette canUpdateCatalog={false} />
        <div
          className="flex-1 min-w-0 relative"
          onDragOver={handleCanvasDragOver}
          onDrop={handleCanvasDrop}
        >
          {loading ? (
            <div className="h-full flex items-center justify-center text-sm text-[var(--mc-text-muted)]">
              Loading BT XML...
            </div>
          ) : parseError ? (
            <div className="h-full flex items-center justify-center text-center text-[var(--mc-danger)]">
              <div>
                <div className="font-semibold">Parse Error</div>
                <div className="mt-1 text-xs">{parseError}</div>
              </div>
            </div>
          ) : nodes.length === 0 ? (
            <div className="h-full flex items-center justify-center text-center text-[var(--mc-text-subtle)]">
              <div>
                <div className="text-sm font-semibold">No behavior tree</div>
                <div className="mt-1 text-xs">Drag nodes from the palette.</div>
              </div>
            </div>
          ) : (
            <ReactFlow
              nodes={annotatedNodes}
              edges={edges}
              onNodesChange={onNodesChange}
              onEdgesChange={onEdgesChange}
              nodeTypes={nodeTypes}
              onInit={(instance) => { reactFlowRef.current = instance; }}
              onConnect={handleConnect}
              isValidConnection={(connection) => (
                isValidBtConnection(connection, nodesRef.current, edgesRef.current)
              )}
              onNodeClick={(_event, node) => setSelectedNodeId(node.id)}
              onNodeDragStop={captureHistory}
              fitView
              fitViewOptions={{ padding: 0.18 }}
              nodesDraggable
              nodesConnectable
              elementsSelectable
              deleteKeyCode={null}
              minZoom={0.3}
              maxZoom={2}
              zoomOnScroll
              panOnScroll={false}
              zoomOnPinch
              zoomActivationKeyCode={null}
              autoPanOnConnect={false}
              proOptions={reactFlowProOptions}
            >
              <Controls showInteractive={false} />
              <Background color={isDark ? "#3a352e" : "#dcd7ca"} gap={16} />
            </ReactFlow>
          )}
        </div>
        {selectedNodeId && (
          <BTParamPanel
            nodes={annotatedNodes}
            selectedNodeId={selectedNodeId}
            onParamChange={handleParamChange}
            onNameChange={handleNameChange}
            onClose={() => setSelectedNodeId(null)}
          />
        )}
        {showLoadDialog && (
          <div
            className="absolute inset-0 z-50 flex items-center justify-center bg-black/45 p-6"
            role="dialog"
            aria-modal="true"
            aria-label="Local BT XML files"
          >
            <form
              className="w-full max-w-md rounded-xl border border-[var(--mc-border)] bg-[var(--mc-surface)] p-4 shadow-xl"
              onSubmit={(event) => {
                event.preventDefault();
                void handleLoadXml(pendingLoadPath);
              }}
            >
              <div className="text-sm font-semibold">Load waypoint XML</div>
              <div className="mt-1 text-xs text-[var(--mc-text-subtle)]">
                Loading another XML changes the editor only. Use Set Default to change Run behavior.
              </div>
              <div className="mt-3 max-h-64 space-y-2 overflow-auto">
                {availableFileOptions.map((path) => (
                  <label
                    key={path}
                    className={clsx(
                      "flex cursor-pointer items-start gap-2 rounded-lg border p-2.5",
                      pendingLoadPath === path
                        ? "border-orange-500 bg-orange-500/10"
                        : "border-[var(--mc-border)] bg-[var(--mc-surface-2)]",
                    )}
                  >
                    <input
                      type="radio"
                      name="local-bt-xml"
                      value={path}
                      checked={pendingLoadPath === path}
                      onChange={() => setPendingLoadPath(path)}
                      className="mt-0.5"
                    />
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-1 text-xs font-semibold">
                        <span className="truncate">{path.split("/").pop()}</span>
                        {path === defaultFilePath && (
                          <span className="rounded bg-orange-500/15 px-1 py-0.5 text-[9px] text-orange-500">
                            Default
                          </span>
                        )}
                      </span>
                      <span className="block truncate text-[10px] text-[var(--mc-text-subtle)]">
                        {path}
                      </span>
                    </span>
                  </label>
                ))}
              </div>
              <div className="mt-4 flex justify-end gap-2">
                <button
                  type="button"
                  className="rounded-lg border border-[var(--mc-border)] px-3 py-2 text-xs"
                  onClick={() => setShowLoadDialog(false)}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={!pendingLoadPath || Boolean(fileAction)}
                  className="rounded-lg bg-orange-500 px-3 py-2 text-xs font-semibold text-white disabled:opacity-50"
                >
                  {fileAction === "load" ? "Loading..." : "Load Selected"}
                </button>
              </div>
            </form>
          </div>
        )}
        {showSaveAsDialog && (
          <div
            className="absolute inset-0 z-50 flex items-center justify-center bg-black/45 p-6"
            role="dialog"
            aria-modal="true"
            aria-label="Save local BT XML as"
          >
            <form
              className="w-full max-w-sm rounded-xl border border-[var(--mc-border)] bg-[var(--mc-surface)] p-4 shadow-xl"
              onSubmit={handleSaveXmlAs}
            >
              <div className="text-sm font-semibold">Save local BT as</div>
              <div className="mt-1 text-xs text-[var(--mc-text-subtle)]">
                A new XML is added to this waypoint. The current default does not change.
              </div>
              <label className="mt-4 block text-xs font-medium" htmlFor="local-bt-save-as-name">
                New BT XML name
              </label>
              <input
                id="local-bt-save-as-name"
                aria-label="New BT XML name"
                value={saveAsName}
                onChange={(event) => setSaveAsName(event.target.value)}
                placeholder="alternate.xml"
                className="mt-1 w-full rounded-lg border border-[var(--mc-border)] bg-[var(--mc-surface-2)] px-3 py-2 text-sm outline-none focus:border-orange-500"
                autoFocus
              />
              <div className="mt-1 text-[10px] text-[var(--mc-text-subtle)]">
                .xml is added automatically. Use letters, numbers, dot, underscore or hyphen.
              </div>
              <div className="mt-4 flex justify-end gap-2">
                <button
                  type="button"
                  className="rounded-lg border border-[var(--mc-border)] px-3 py-2 text-xs"
                  onClick={() => setShowSaveAsDialog(false)}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={!saveAsName.trim() || Boolean(fileAction)}
                  className="rounded-lg bg-orange-500 px-3 py-2 text-xs font-semibold text-white disabled:opacity-50"
                >
                  {fileAction === "save-as" ? "Saving..." : "Save As"}
                </button>
              </div>
            </form>
          </div>
        )}
    </div>
  );
}
