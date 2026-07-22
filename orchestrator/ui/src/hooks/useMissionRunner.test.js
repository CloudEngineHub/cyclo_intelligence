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

import { act, renderHook, waitFor } from "@testing-library/react";
import { useMissionRunner } from "./useMissionRunner";
import { RunnerStatus, WaypointState } from "./missionRunnerCore";

const poseAt = (x, y, yaw = 0) => ({
  position: { x, y, z: 0 },
  orientation: { z: Math.sin(yaw / 2), w: Math.cos(yaw / 2) },
});

const filledBt = [
  '<root BTCPP_format="4" main_tree_to_execute="MainTree">',
  '  <BehaviorTree ID="MainTree"><Wait duration="0.1"/></BehaviorTree>',
  "</root>",
].join("\n");
const emptyBt = [
  '<root BTCPP_format="4" main_tree_to_execute="MainTree">',
  '  <BehaviorTree ID="MainTree"/>',
  "</root>",
].join("\n");

const SPOTS = [
  { id: "a", label: "Dock", pose: { x: 0, y: 0, yaw: 0 } },
  { id: "b", label: "Bay", pose: { x: 5, y: 0, yaw: 0 } },
];

const FAST = { pollMs: 8, settleMs: 16, navTimeoutMs: 1500, btStartTimeoutMs: 800, btTimeoutMs: 1500 };

function makeHarness(overrides = {}) {
  const poseRef = { current: null };
  const btStatusRef = { current: "stopped" };
  const callService = jest.fn().mockResolvedValue({ success: true });
  const sendGoal = jest.fn().mockResolvedValue(undefined);
  const cancelGoal = jest.fn().mockResolvedValue(undefined);
  const stopBt = jest.fn().mockResolvedValue(undefined);
  const props = {
    orderedSpots: SPOTS,
    resolveBtXml: () => filledBt,
    currentPoseRef: poseRef,
    btStatusRef,
    callService,
    sendGoal,
    cancelGoal,
    stopBt,
    getFlags: () => ({ navRunning: true, btNodeIsUp: true }),
    onMessage: jest.fn(),
    config: FAST,
    ...overrides,
  };
  const view = renderHook(() => useMissionRunner(props));
  return { view, poseRef, btStatusRef, callService, sendGoal, cancelGoal, stopBt, onMessage: props.onMessage };
}

// Drive a fresh running→completed edge for the tree just loaded.
async function completeBt(btStatusRef) {
  await act(async () => { btStatusRef.current = "running"; await new Promise((r) => setTimeout(r, 20)); });
  await act(async () => { btStatusRef.current = "completed"; await new Promise((r) => setTimeout(r, 20)); });
}

test("runs the full route: navigate, run each BT, then done", async () => {
  const h = makeHarness();
  act(() => { h.view.result.current.start(); });

  // Waypoint 0
  await waitFor(() => expect(h.sendGoal).toHaveBeenCalledWith(0, 0, 0));
  act(() => { h.poseRef.current = poseAt(0, 0, 0); });
  await waitFor(() => expect(h.callService).toHaveBeenCalledTimes(1));
  expect(h.callService.mock.calls[0][0]).toBe("/bt/load_and_run");
  expect(h.callService.mock.calls[0][2]).toEqual({ tree_xml: filledBt });
  await completeBt(h.btStatusRef);

  // Waypoint 1
  await waitFor(() => expect(h.sendGoal).toHaveBeenCalledWith(5, 0, 0));
  act(() => { h.poseRef.current = poseAt(5, 0, 0); });
  await waitFor(() => expect(h.callService).toHaveBeenCalledTimes(2));
  await completeBt(h.btStatusRef);

  await waitFor(() => expect(h.view.result.current.status).toBe(RunnerStatus.DONE));
  expect(h.view.result.current.progress.map((p) => p.state)).toEqual([
    WaypointState.DONE,
    WaypointState.DONE,
  ]);
});

test("fails with a nav-timeout reason when the robot never arrives", async () => {
  const h = makeHarness({ config: { ...FAST, navTimeoutMs: 80 } });
  act(() => { h.view.result.current.start(); });
  // Never move the pose into tolerance.
  await waitFor(() => expect(h.view.result.current.status).toBe(RunnerStatus.FAILED));
  expect(h.view.result.current.reason).toMatch(/Navigation timed out at Dock/);
  expect(h.callService).not.toHaveBeenCalled();
});

test("re-issues the nav goal while the robot is still en route", async () => {
  const h = makeHarness({ config: { ...FAST, goalResendMs: 40, navTimeoutMs: 3000 } });
  act(() => { h.view.result.current.start(); });
  await waitFor(() => expect(h.sendGoal).toHaveBeenCalledTimes(1));
  // The robot never arrives, so the same goal should be re-sent.
  await waitFor(
    () => expect(h.sendGoal.mock.calls.length).toBeGreaterThanOrEqual(2),
    { timeout: 3000 },
  );
  expect(h.sendGoal.mock.calls.every(([x, y]) => x === 0 && y === 0)).toBe(true);
});

test("skips load_and_run for a waypoint whose BT is empty", async () => {
  const h = makeHarness({ resolveBtXml: () => emptyBt });
  act(() => { h.view.result.current.start(); });
  await waitFor(() => expect(h.sendGoal).toHaveBeenCalledTimes(1));
  act(() => { h.poseRef.current = poseAt(0, 0, 0); });
  // Second goal means it advanced without ever calling the BT service.
  await waitFor(() => expect(h.sendGoal).toHaveBeenCalledTimes(2));
  act(() => { h.poseRef.current = poseAt(5, 0, 0); });
  await waitFor(() => expect(h.view.result.current.status).toBe(RunnerStatus.DONE));
  expect(h.callService).not.toHaveBeenCalled();
  expect(h.view.result.current.progress.map((p) => p.state)).toEqual([
    WaypointState.SKIPPED,
    WaypointState.SKIPPED,
  ]);
});

test("does not accept a stale latched 'completed' as fresh completion", async () => {
  // BT status is already 'completed' before this waypoint's tree is loaded and
  // never transitions to 'running'; the runner must NOT treat that as done.
  const h = makeHarness({ config: { ...FAST, btStartTimeoutMs: 120 } });
  act(() => { h.view.result.current.start(); });
  await waitFor(() => expect(h.sendGoal).toHaveBeenCalledTimes(1));
  act(() => {
    h.poseRef.current = poseAt(0, 0, 0);
    h.btStatusRef.current = "completed";
  });
  await waitFor(() => expect(h.callService).toHaveBeenCalledTimes(1));
  // With no fresh 'running' edge, it should fail on the start timeout, not advance.
  await waitFor(() => expect(h.view.result.current.status).toBe(RunnerStatus.FAILED));
  expect(h.view.result.current.reason).toMatch(/did not start/);
});

test("stop mid-navigation cancels the goal, stops the BT, and marks cancelled", async () => {
  const h = makeHarness();
  act(() => { h.view.result.current.start(); });
  await waitFor(() => expect(h.sendGoal).toHaveBeenCalledTimes(1));
  await act(async () => { h.view.result.current.stop(); await Promise.resolve(); });
  await waitFor(() => expect(h.view.result.current.status).toBe(RunnerStatus.CANCELLED));
  expect(h.cancelGoal).toHaveBeenCalled();
  expect(h.stopBt).toHaveBeenCalled();
  expect(h.view.result.current.progress[0].state).toBe(WaypointState.PENDING);
});

test("start is a no-op when there is no route", () => {
  const h = makeHarness({ orderedSpots: [] });
  act(() => { h.view.result.current.start(); });
  expect(h.sendGoal).not.toHaveBeenCalled();
  expect(h.onMessage).toHaveBeenCalledWith(expect.stringMatching(/No route/));
});

test("start fails fast when a BT is present but the BT node is down", () => {
  const h = makeHarness({ getFlags: () => ({ navRunning: true, btNodeIsUp: false }) });
  act(() => { h.view.result.current.start(); });
  expect(h.sendGoal).not.toHaveBeenCalled();
  expect(h.onMessage).toHaveBeenCalledWith(expect.stringMatching(/Activate the BT node/));
});
