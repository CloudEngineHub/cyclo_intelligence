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

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import {
  MdAutoFixHigh,
  MdRedo,
  MdUndo,
} from "react-icons/md";

import BTActionNode from "../bt/BTActionNode";
import BTControlNode from "../bt/BTControlNode";
import BTNodePalette, { PALETTE_DRAG_MIME } from "../bt/BTNodePalette";
import BTParamPanel from "../bt/BTParamPanel";
import { useBTHistory } from "../../hooks/useBTHistory";
import { useBTNodeCatalog } from "../../hooks/useBTNodeCatalog";
import { parseBTXml, applyDagreLayout } from "../../utils/btTreeParser";
import { serializeFromGraph } from "../../utils/btXmlSerializer";

const nodeTypes = {
  btControl: BTControlNode,
  btAction: BTActionNode,
};

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

function layoutVisibleOnly(nodes, edges) {
  const hidden = computeHiddenIds(nodes, edges);
  const visibleNodes = nodes.filter((node) => !hidden.has(node.id));
  const visibleEdges = edges.filter((edge) => (
    !hidden.has(edge.source) && !hidden.has(edge.target)
  ));
  const laidOut = applyDagreLayout(visibleNodes, visibleEdges, { respectStored: false });
  const byId = new Map(laidOut.nodes.map((node) => [node.id, node]));
  return nodes.map((node) => byId.get(node.id) || node);
}

export default function MissionBtEditor({
  title,
  filePath,
  xml,
  loading = false,
  activeNodeNames = [],
  onXmlChange,
}) {
  const { catalog: nodeCatalog = [] } = useBTNodeCatalog();
  const [nodes, setNodes, onNodesChange] = useNodesState([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);
  const [nodeDataMap, setNodeDataMap] = useState(new Map());
  const [selectedNodeId, setSelectedNodeId] = useState(null);
  const [parseError, setParseError] = useState(null);
  const reactFlowRef = useRef(null);
  const nodesRef = useRef(nodes);
  const edgesRef = useRef(edges);
  const nodeDataMapRef = useRef(nodeDataMap);
  const lastEmittedXmlRef = useRef(null);
  const lastEmittedPathRef = useRef("");

  nodesRef.current = nodes;
  edgesRef.current = edges;
  nodeDataMapRef.current = nodeDataMap;

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

  useEffect(() => {
    if (
      filePath === lastEmittedPathRef.current &&
      xml === lastEmittedXmlRef.current
    ) {
      return;
    }
    try {
      const parsed = parseBTXml(xml || "");
      setNodes(parsed.nodes || []);
      setEdges(parsed.edges || []);
      setNodeDataMap(parsed.nodeDataMap || new Map());
      setSelectedNodeId(null);
      setParseError(null);
      resetHistory();
    } catch (error) {
      setNodes([]);
      setEdges([]);
      setNodeDataMap(new Map());
      setSelectedNodeId(null);
      setParseError(error instanceof Error ? error.message : "Failed to parse BT XML");
    }
  }, [filePath, resetHistory, setEdges, setNodes, xml]);

  useEffect(() => {
    if (parseError || typeof onXmlChange !== "function") return undefined;
    const timer = window.setTimeout(() => {
      try {
        const serialized = serializeFromGraph(nodes, edges, nodeDataMap);
        lastEmittedXmlRef.current = serialized;
        lastEmittedPathRef.current = filePath;
        onXmlChange(serialized);
      } catch {
        // Keep the last valid XML while the user is mid-editing a partial graph.
      }
    }, 250);
    return () => window.clearTimeout(timer);
  }, [edges, filePath, nodeDataMap, nodes, onXmlChange, parseError]);

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
    captureHistory();
    const nextEdges = addEdge(
      { ...connection, type: "smoothstep", animated: false },
      edgesRef.current,
    );
    setEdges(nextEdges);
    setNodes(layoutVisibleOnly(nodesRef.current, nextEdges));
  }, [captureHistory, setEdges, setNodes]);

  const handleAutoLayout = useCallback(() => {
    if (!nodesRef.current.length) return;
    captureHistory();
    setNodes(layoutVisibleOnly(nodesRef.current, edgesRef.current));
  }, [captureHistory, setNodes]);

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
    captureHistory();
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
  }, [captureHistory, setNodes]);

  const handleParamChange = useCallback((nodeId, paramName, value) => {
    captureHistory();
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
  }, [captureHistory, setNodes]);

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
      setNodes(layoutVisibleOnly(remainingNodes, remainingEdges));
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
    <div className="h-full min-h-0 relative flex bg-white text-gray-900">
      <div className="absolute top-3 right-3 z-20 flex items-center gap-1 rounded-md border border-gray-200 bg-white/95 p-1 shadow-sm">
          <button
            type="button"
            onClick={undoHistory}
            disabled={!canUndo}
            title="Undo"
            className={clsx(
              "h-8 w-8 rounded-md flex items-center justify-center transition-colors",
              canUndo ? "bg-gray-100 hover:bg-gray-200 text-gray-700" : "bg-gray-100 text-gray-300",
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
              "h-8 w-8 rounded-md flex items-center justify-center transition-colors",
              canRedo ? "bg-gray-100 hover:bg-gray-200 text-gray-700" : "bg-gray-100 text-gray-300",
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
              "h-8 w-8 rounded-md flex items-center justify-center transition-colors",
              nodes.length ? "bg-gray-100 hover:bg-gray-200 text-gray-700" : "bg-gray-100 text-gray-300",
            )}
          >
            <MdAutoFixHigh size={18} />
          </button>
      </div>

        <BTNodePalette canUpdateCatalog={false} />
        <div
          className="flex-1 min-w-0 relative"
          onDragOver={handleCanvasDragOver}
          onDrop={handleCanvasDrop}
        >
          {loading ? (
            <div className="h-full flex items-center justify-center text-sm text-gray-500">
              Loading BT XML...
            </div>
          ) : parseError ? (
            <div className="h-full flex items-center justify-center text-center text-red-600">
              <div>
                <div className="font-semibold">Parse Error</div>
                <div className="mt-1 text-xs">{parseError}</div>
              </div>
            </div>
          ) : nodes.length === 0 ? (
            <div className="h-full flex items-center justify-center text-center text-gray-400">
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
            >
              <Controls showInteractive={false} />
              <Background color="#e5e7eb" gap={16} />
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
    </div>
  );
}
