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

// Read-only behavior-tree viewer for the Run stage: renders a waypoint's stored
// BT XML and glows the node(s) currently ticking on the robot (from
// /bt/active_nodes). It reuses the authoring node components and highlight logic
// but strips every editing affordance (palette, param panel, drag, delete,
// history) so the running tree can only be watched, not changed. Because it
// parses the same XML string sent to /bt/load_and_run, the parser's bt_N ids
// line up with the backend's active-node ids — no name matching needed.

import { useEffect, useMemo, useState } from "react";
import { ReactFlow, Controls, Background } from "@xyflow/react";
import "@xyflow/react/dist/style.css";

import BTActionNode from "../bt/BTActionNode";
import BTControlNode from "../bt/BTControlNode";
import { parseBTXml } from "../../utils/btTreeParser";

const nodeTypes = {
  btControl: BTControlNode,
  btAction: BTActionNode,
};

const reactFlowProOptions = { hideAttribution: true };

function useIsDark() {
  const [isDark, setIsDark] = useState(() => (
    typeof document !== "undefined"
    && document.documentElement.classList.contains("dark")
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

export default function MissionBtRunView({ xml, activeNodeNames = [], loading = false }) {
  const isDark = useIsDark();
  const [graph, setGraph] = useState({ nodes: [], edges: [] });
  const [parseError, setParseError] = useState(null);

  useEffect(() => {
    try {
      const parsed = parseBTXml(xml || "");
      setGraph({ nodes: parsed.nodes || [], edges: parsed.edges || [] });
      setParseError(null);
    } catch (error) {
      setGraph({ nodes: [], edges: [] });
      setParseError(error instanceof Error ? error.message : "Failed to parse BT XML");
    }
  }, [xml]);

  // Mark the active leaf/control nodes; a control glows when any descendant is
  // active, so the whole running branch reads at a glance.
  const annotatedNodes = useMemo(() => {
    const activeSet = new Set(activeNodeNames);
    const childrenById = new Map(graph.nodes.map((node) => [node.id, []]));
    const childCount = new Map();
    graph.edges.forEach((edge) => {
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
    return graph.nodes.map((node) => {
      const isControl = node.type === "btControl";
      return {
        ...node,
        data: {
          ...node.data,
          isActive: activeSet.has(node.id) || (isControl && hasActiveDescendant(node.id)),
          isSelected: false,
          childCount: childCount.get(node.id) || 0,
        },
      };
    });
  }, [activeNodeNames, graph]);

  return (
    <div className="h-full min-h-0 relative bg-[var(--mc-bg)] text-[var(--mc-text)]">
      {loading ? (
        <div className="h-full flex items-center justify-center text-sm text-[var(--mc-text-muted)]">
          Loading behavior tree...
        </div>
      ) : parseError ? (
        <div className="h-full flex items-center justify-center text-center text-[var(--mc-danger)]">
          <div>
            <div className="font-semibold">Parse Error</div>
            <div className="mt-1 text-xs">{parseError}</div>
          </div>
        </div>
      ) : annotatedNodes.length === 0 ? (
        <div className="h-full flex items-center justify-center text-center text-[var(--mc-text-subtle)]">
          <div>
            <div className="text-sm font-semibold">Navigate only</div>
            <div className="mt-1 text-xs">This waypoint has no behavior tree.</div>
          </div>
        </div>
      ) : (
        <ReactFlow
          nodes={annotatedNodes}
          edges={graph.edges}
          nodeTypes={nodeTypes}
          fitView
          fitViewOptions={{ padding: 0.18 }}
          nodesDraggable={false}
          nodesConnectable={false}
          elementsSelectable={false}
          deleteKeyCode={null}
          minZoom={0.3}
          maxZoom={2}
          zoomOnScroll
          panOnScroll={false}
          zoomOnPinch
          zoomActivationKeyCode={null}
          proOptions={reactFlowProOptions}
        >
          <Controls showInteractive={false} />
          <Background color={isDark ? "#3a352e" : "#dcd7ca"} gap={16} />
        </ReactFlow>
      )}
    </div>
  );
}
