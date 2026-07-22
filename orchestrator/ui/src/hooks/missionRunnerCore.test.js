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

import {
  DEFAULT_RUNNER_CONFIG,
  RunnerPhase,
  RunnerStatus,
  WaypointState,
  angleWrap,
  goalFromSpot,
  initialRunnerState,
  isArrived,
  isEmptyBt,
  isRunnerActive,
  missionRunnerReducer,
} from "./missionRunnerCore";

const yawQuat = (yaw) => ({ z: Math.sin(yaw / 2), w: Math.cos(yaw / 2) });
const poseAt = (x, y, yaw = 0) => ({ position: { x, y, z: 0 }, orientation: yawQuat(yaw) });

const SPOTS = [
  { id: "a", label: "Dock", pose: { x: 0, y: 0, yaw: 0 } },
  { id: "b", label: "Bay", pose: { x: 5, y: 0, yaw: Math.PI / 2 } },
];

describe("angleWrap", () => {
  test("wraps into (-pi, pi]", () => {
    expect(angleWrap(0)).toBeCloseTo(0);
    expect(angleWrap(Math.PI)).toBeCloseTo(Math.PI);
    expect(angleWrap(Math.PI + 0.1)).toBeCloseTo(-Math.PI + 0.1);
    expect(angleWrap(-Math.PI - 0.1)).toBeCloseTo(Math.PI - 0.1, 5);
    expect(angleWrap(3 * Math.PI)).toBeCloseTo(Math.PI);
  });
});

describe("isArrived", () => {
  const goal = { x: 5, y: 0, yaw: Math.PI / 2, ignoreYaw: false };

  test("true when within distance and yaw tolerance", () => {
    expect(isArrived(poseAt(5.1, 0, Math.PI / 2), goal)).toBe(true);
  });

  test("false when outside distance tolerance", () => {
    expect(isArrived(poseAt(5.5, 0, Math.PI / 2), goal)).toBe(false);
  });

  test("false when yaw is off beyond tolerance", () => {
    expect(isArrived(poseAt(5, 0, -Math.PI / 2), goal)).toBe(false);
  });

  test("yaw ignored when goal opts out", () => {
    const relaxed = { ...goal, ignoreYaw: true };
    expect(isArrived(poseAt(5, 0, -Math.PI / 2), relaxed)).toBe(true);
  });

  test("yaw wrap boundary handled (pi vs -pi)", () => {
    const near = { x: 0, y: 0, yaw: Math.PI, ignoreYaw: false };
    expect(isArrived(poseAt(0, 0, -Math.PI + 0.05), near)).toBe(true);
  });

  test("false for null pose", () => {
    expect(isArrived(null, goal)).toBe(false);
  });
});

describe("goalFromSpot", () => {
  test("reads pose and defaults ignoreYaw false", () => {
    expect(goalFromSpot(SPOTS[1])).toEqual({ x: 5, y: 0, yaw: Math.PI / 2, ignoreYaw: false });
  });

  test("honors metadata.ignore_yaw", () => {
    const spot = { pose: { x: 1, y: 2, yaw: 0 }, metadata: { ignore_yaw: true } };
    expect(goalFromSpot(spot).ignoreYaw).toBe(true);
  });
});

describe("isEmptyBt", () => {
  const emptyXml = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<root BTCPP_format="4" main_tree_to_execute="MainTree">',
    '  <BehaviorTree ID="MainTree"/>',
    "</root>",
  ].join("\n");
  const filledXml = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<root BTCPP_format="4" main_tree_to_execute="MainTree">',
    '  <BehaviorTree ID="MainTree"><Wait duration="1.0"/></BehaviorTree>',
    "</root>",
  ].join("\n");

  test("blank / whitespace is empty", () => {
    expect(isEmptyBt("")).toBe(true);
    expect(isEmptyBt("   \n ")).toBe(true);
  });

  test("childless MainTree is empty", () => {
    expect(isEmptyBt(emptyXml)).toBe(true);
  });

  test("MainTree with a child is not empty", () => {
    expect(isEmptyBt(filledXml)).toBe(false);
  });

  test("unparseable XML is treated as non-empty so the error surfaces", () => {
    expect(isEmptyBt("<root><unclosed></root>")).toBe(false);
  });
});

describe("missionRunnerReducer", () => {
  test("initial state marks every waypoint pending", () => {
    const state = initialRunnerState(SPOTS);
    expect(state.status).toBe(RunnerStatus.IDLE);
    expect(state.total).toBe(2);
    expect(state.progress.map((p) => p.state)).toEqual([
      WaypointState.PENDING,
      WaypointState.PENDING,
    ]);
  });

  test("happy path: start → navigate → runBt → finish → advance → done", () => {
    let state = initialRunnerState(SPOTS);
    state = missionRunnerReducer(state, { type: "start" });
    expect(state.status).toBe(RunnerStatus.STARTING);

    state = missionRunnerReducer(state, { type: "navigate", index: 0 });
    expect(state.status).toBe(RunnerStatus.NAVIGATING);
    expect(state.currentIndex).toBe(0);
    expect(state.progress[0].state).toBe(WaypointState.NAVIGATING);

    state = missionRunnerReducer(state, { type: "phase", phase: RunnerPhase.ARRIVED });
    expect(state.phase).toBe(RunnerPhase.ARRIVED);

    state = missionRunnerReducer(state, { type: "runBt", index: 0 });
    expect(state.status).toBe(RunnerStatus.RUNNING_BT);
    expect(state.progress[0].state).toBe(WaypointState.RUNNING_BT);

    state = missionRunnerReducer(state, { type: "finish", index: 0, skipped: false });
    expect(state.progress[0].state).toBe(WaypointState.DONE);

    state = missionRunnerReducer(state, { type: "advance" });
    expect(state.status).toBe(RunnerStatus.ADVANCING);

    state = missionRunnerReducer(state, { type: "navigate", index: 1 });
    state = missionRunnerReducer(state, { type: "finish", index: 1, skipped: true });
    expect(state.progress[1].state).toBe(WaypointState.SKIPPED);

    state = missionRunnerReducer(state, { type: "done" });
    expect(state.status).toBe(RunnerStatus.DONE);
    expect(state.currentIndex).toBe(-1);
  });

  test("fail marks the active waypoint failed and records a reason", () => {
    let state = initialRunnerState(SPOTS);
    state = missionRunnerReducer(state, { type: "navigate", index: 1 });
    state = missionRunnerReducer(state, { type: "fail", reason: "nav timeout at Bay", index: 1 });
    expect(state.status).toBe(RunnerStatus.FAILED);
    expect(state.reason).toBe("nav timeout at Bay");
    expect(state.progress[1].state).toBe(WaypointState.FAILED);
  });

  test("cancel rolls the active waypoint back to pending", () => {
    let state = initialRunnerState(SPOTS);
    state = missionRunnerReducer(state, { type: "navigate", index: 0 });
    state = missionRunnerReducer(state, { type: "cancel" });
    expect(state.status).toBe(RunnerStatus.CANCELLED);
    expect(state.progress[0].state).toBe(WaypointState.PENDING);
  });

  test("start resets progress after a prior failed run", () => {
    let state = initialRunnerState(SPOTS);
    state = missionRunnerReducer(state, { type: "navigate", index: 0 });
    state = missionRunnerReducer(state, { type: "fail", reason: "x", index: 0 });
    state = missionRunnerReducer(state, { type: "start" });
    expect(state.progress.every((p) => p.state === WaypointState.PENDING)).toBe(true);
    expect(state.reason).toBe("");
  });
});

describe("isRunnerActive", () => {
  test("true only for in-flight statuses", () => {
    expect(isRunnerActive(RunnerStatus.NAVIGATING)).toBe(true);
    expect(isRunnerActive(RunnerStatus.RUNNING_BT)).toBe(true);
    expect(isRunnerActive(RunnerStatus.IDLE)).toBe(false);
    expect(isRunnerActive(RunnerStatus.DONE)).toBe(false);
  });
});

test("DEFAULT_RUNNER_CONFIG exposes the documented tolerances", () => {
  expect(DEFAULT_RUNNER_CONFIG.distM).toBe(0.2);
  expect(DEFAULT_RUNNER_CONFIG.yawRad).toBe(0.4);
});
