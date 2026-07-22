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

// Pure, side-effect-free core for the Mission Runner: arrival math, the empty-BT
// detector, and the state reducer that publishes observable run progress. No
// React, no ROS — this is the unit-test surface. The async driver that actually
// sends nav goals and ticks behavior trees lives in useMissionRunner.js.

import { yawFromPose } from "../utils/navigationTf";

export const RunnerStatus = {
  IDLE: "idle",
  STARTING: "starting",
  NAVIGATING: "navigating",
  RUNNING_BT: "running-bt",
  ADVANCING: "advancing",
  DONE: "done",
  FAILED: "failed",
  CANCELLED: "cancelled",
};

export const RunnerPhase = {
  NONE: "none",
  NAV_SENT: "nav-sent",
  AWAITING_ARRIVAL: "awaiting-arrival",
  ARRIVED: "arrived",
  BT_LOADING: "bt-loading",
  BT_RUNNING: "bt-running",
  BT_DONE: "bt-done",
};

export const WaypointState = {
  PENDING: "pending",
  NAVIGATING: "navigating",
  RUNNING_BT: "running-bt",
  DONE: "done",
  SKIPPED: "skipped",
  FAILED: "failed",
};

// Arrival tolerances match NavigationPage's manual-goal check (0.2 m, 0.4 rad).
export const DEFAULT_RUNNER_CONFIG = {
  distM: 0.2,
  yawRad: 0.4,
  settleMs: 800,
  navTimeoutMs: 120000,
  btStartTimeoutMs: 5000,
  btTimeoutMs: 300000,
  pollMs: 250,
};

// Wrap an angle into (-π, π].
export function angleWrap(angle) {
  let wrapped = angle;
  while (wrapped > Math.PI) wrapped -= 2 * Math.PI;
  while (wrapped <= -Math.PI) wrapped += 2 * Math.PI;
  return wrapped;
}

export function poseXyYaw(pose) {
  if (!pose || !pose.position) return null;
  return { x: pose.position.x, y: pose.position.y, yaw: yawFromPose(pose) };
}

// Goal descriptor for a spot; yaw is enforced unless the spot opts out.
export function goalFromSpot(spot) {
  const pose = (spot && spot.pose) || {};
  const ignoreYaw = Boolean(spot && spot.metadata && spot.metadata.ignore_yaw);
  return {
    x: Number(pose.x ?? 0),
    y: Number(pose.y ?? 0),
    yaw: Number(pose.yaw ?? 0),
    ignoreYaw,
  };
}

// Is the live pose within tolerance of the goal? Distance always; yaw unless ignored.
export function isArrived(currentPose, goal, config = DEFAULT_RUNNER_CONFIG) {
  if (!currentPose || !goal) return false;
  const here = poseXyYaw(currentPose);
  if (!here) return false;
  const dist = Math.hypot(here.x - goal.x, here.y - goal.y);
  if (dist > config.distM) return false;
  if (goal.ignoreYaw) return true;
  const yawError = Math.abs(angleWrap(here.yaw - goal.yaw));
  return yawError <= config.yawRad;
}

// A default/empty local BT (childless MainTree or blank) means "navigate only".
// Unparseable XML is treated as non-empty so load_and_run surfaces the error.
export function isEmptyBt(xml) {
  if (!xml || !xml.trim()) return true;
  if (typeof DOMParser === "undefined") return false;
  try {
    const doc = new DOMParser().parseFromString(xml, "text/xml");
    if (doc.getElementsByTagName("parsererror").length) return false;
    const trees = Array.from(doc.getElementsByTagName("BehaviorTree"));
    if (!trees.length) return true;
    const root = doc.documentElement;
    const mainId = root && root.getAttribute("main_tree_to_execute");
    const main = trees.find((tree) => tree.getAttribute("ID") === mainId) || trees[0];
    return !Array.from(main.childNodes).some((node) => node.nodeType === 1);
  } catch (error) {
    return false;
  }
}

export function initialRunnerState(spots = []) {
  return {
    status: RunnerStatus.IDLE,
    currentIndex: -1,
    phase: RunnerPhase.NONE,
    reason: "",
    total: spots.length,
    progress: spots.map((spot) => ({
      id: spot.id,
      label: spot.label || spot.id,
      state: WaypointState.PENDING,
    })),
  };
}

function withProgress(state, index, waypointState) {
  if (index < 0 || index >= state.progress.length) return state.progress;
  return state.progress.map((entry, i) => (
    i === index ? { ...entry, state: waypointState } : entry
  ));
}

// Reducer over runner actions. Callers dispatch coarse lifecycle events; the
// async driver in useMissionRunner drives these in order.
export function missionRunnerReducer(state, action) {
  switch (action.type) {
    case "reset":
      return initialRunnerState(action.spots || []);
    case "start":
      return {
        ...state,
        status: RunnerStatus.STARTING,
        currentIndex: -1,
        phase: RunnerPhase.NONE,
        reason: "",
        progress: state.progress.map((entry) => ({ ...entry, state: WaypointState.PENDING })),
      };
    case "navigate":
      return {
        ...state,
        status: RunnerStatus.NAVIGATING,
        currentIndex: action.index,
        phase: RunnerPhase.NAV_SENT,
        progress: withProgress(state, action.index, WaypointState.NAVIGATING),
      };
    case "phase":
      return { ...state, phase: action.phase };
    case "runBt":
      return {
        ...state,
        status: RunnerStatus.RUNNING_BT,
        currentIndex: action.index,
        phase: RunnerPhase.BT_LOADING,
        progress: withProgress(state, action.index, WaypointState.RUNNING_BT),
      };
    case "finish":
      return {
        ...state,
        phase: RunnerPhase.BT_DONE,
        progress: withProgress(
          state,
          action.index,
          action.skipped ? WaypointState.SKIPPED : WaypointState.DONE,
        ),
      };
    case "advance":
      return { ...state, status: RunnerStatus.ADVANCING };
    case "done":
      return { ...state, status: RunnerStatus.DONE, phase: RunnerPhase.NONE, currentIndex: -1 };
    case "fail":
      return {
        ...state,
        status: RunnerStatus.FAILED,
        reason: action.reason || "Mission failed",
        progress: action.index >= 0
          ? withProgress(state, action.index, WaypointState.FAILED)
          : state.progress,
      };
    case "cancel": {
      const active = state.currentIndex;
      const resetActive = (
        active >= 0
        && (state.status === RunnerStatus.NAVIGATING || state.status === RunnerStatus.RUNNING_BT)
      );
      return {
        ...state,
        status: RunnerStatus.CANCELLED,
        phase: RunnerPhase.NONE,
        reason: action.reason || "Cancelled",
        progress: resetActive
          ? withProgress(state, active, WaypointState.PENDING)
          : state.progress,
      };
    }
    default:
      return state;
  }
}

export function isRunnerActive(status) {
  return (
    status === RunnerStatus.STARTING
    || status === RunnerStatus.NAVIGATING
    || status === RunnerStatus.RUNNING_BT
    || status === RunnerStatus.ADVANCING
  );
}
