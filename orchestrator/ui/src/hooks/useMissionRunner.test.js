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

const FAST = { pollMs: 8, btStartTimeoutMs: 800, btTimeoutMs: 1500 };

function makeHarness(overrides = {}) {
  const btStatusRef = { current: "stopped" };
  const callService = jest.fn().mockResolvedValue({ success: true });
  const sendGoal = jest.fn().mockResolvedValue({ ok: true, status: "SUCCEEDED" });
  const sendGoals = jest.fn().mockResolvedValue({ ok: true, status: "SUCCEEDED" });
  const cancelGoal = jest.fn().mockResolvedValue(undefined);
  const stopBt = jest.fn().mockResolvedValue(undefined);
  const props = {
    orderedSpots: SPOTS,
    resolveBtXml: () => filledBt,
    btStatusRef,
    callService,
    sendGoal,
    sendGoals,
    cancelGoal,
    stopBt,
    getFlags: () => ({ navRunning: true, btNodeIsUp: true }),
    onMessage: jest.fn(),
    config: FAST,
    ...overrides,
  };
  const view = renderHook(() => useMissionRunner(props));
  return {
    view,
    btStatusRef,
    callService,
    sendGoal,
    sendGoals,
    cancelGoal,
    stopBt,
    onMessage: props.onMessage,
  };
}

// Drive a fresh running→completed edge for the tree just loaded.
async function completeBt(btStatusRef) {
  await act(async () => {
    btStatusRef.current = "running";
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
  await act(async () => {
    btStatusRef.current = "completed";
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
}

test("runs each BT only after Nav2 succeeds, then advances", async () => {
  const h = makeHarness();
  act(() => { h.view.result.current.start(); });

  await waitFor(() => expect(h.sendGoal).toHaveBeenCalledWith(0, 0, 0, expect.any(Object)));
  await waitFor(() => expect(h.callService).toHaveBeenCalledTimes(1));
  expect(h.callService.mock.calls[0][0]).toBe("/bt/load_and_run");
  expect(h.callService.mock.calls[0][2]).toEqual({ tree_xml: filledBt });
  await completeBt(h.btStatusRef);

  await waitFor(() => expect(h.sendGoal).toHaveBeenCalledWith(5, 0, 0, expect.any(Object)));
  await waitFor(() => expect(h.callService).toHaveBeenCalledTimes(2));
  await completeBt(h.btStatusRef);

  await waitFor(() => expect(h.view.result.current.status).toBe(RunnerStatus.DONE));
  expect(h.view.result.current.progress.map((entry) => entry.state)).toEqual([
    WaypointState.DONE,
    WaypointState.DONE,
  ]);
});

test("does not run the waypoint BT before Nav2 returns SUCCEEDED", async () => {
  let resolveNavigation;
  const sendGoal = jest.fn(() => new Promise((resolve) => { resolveNavigation = resolve; }));
  const h = makeHarness({ sendGoal });
  act(() => { h.view.result.current.start(); });

  await waitFor(() => expect(sendGoal).toHaveBeenCalledTimes(1));
  expect(h.callService).not.toHaveBeenCalled();

  await act(async () => {
    resolveNavigation({ ok: true, status: "SUCCEEDED" });
    await Promise.resolve();
  });
  await waitFor(() => expect(h.callService).toHaveBeenCalledTimes(1));
});

test.each(["ABORTED", "CANCELED", "TIMEOUT", "REJECTED", "UNKNOWN"])(
  "does not run BT or advance when navigation returns %s",
  async (status) => {
    const h = makeHarness({
      sendGoal: jest.fn().mockResolvedValue({ ok: false, status }),
    });
    act(() => { h.view.result.current.start(); });

    await waitFor(() => expect(h.view.result.current.status).toBe(RunnerStatus.FAILED));
    expect(h.view.result.current.reason).toMatch(new RegExp(status, "i"));
    expect(h.callService).not.toHaveBeenCalled();
    expect(h.view.result.current.progress[0].state).toBe(WaypointState.FAILED);
  },
);

test("reports a navigation request error without running BT", async () => {
  const h = makeHarness({
    sendGoal: jest.fn().mockRejectedValue(new Error("action server unavailable")),
  });
  act(() => { h.view.result.current.start(); });

  await waitFor(() => expect(h.view.result.current.status).toBe(RunnerStatus.FAILED));
  expect(h.view.result.current.reason).toMatch(/action server unavailable/);
  expect(h.callService).not.toHaveBeenCalled();
});

test("groups consecutive empty BT waypoints into NavigateThroughPoses", async () => {
  const h = makeHarness({ resolveBtXml: () => emptyBt });
  act(() => { h.view.result.current.start(); });

  await waitFor(() => expect(h.sendGoals).toHaveBeenCalledTimes(1));
  await waitFor(() => expect(h.view.result.current.status).toBe(RunnerStatus.DONE));
  expect(h.sendGoal).not.toHaveBeenCalled();
  expect(h.sendGoals).toHaveBeenCalledWith(
    [
      { x: 0, y: 0, yaw: 0 },
      { x: 5, y: 0, yaw: 0 },
    ],
    expect.any(Object),
  );
  expect(h.callService).not.toHaveBeenCalled();
  expect(h.view.result.current.progress.map((entry) => entry.state)).toEqual([
    WaypointState.SKIPPED,
    WaypointState.SKIPPED,
  ]);
});

test("groups one empty waypoint with the following BT endpoint", async () => {
  let resolveNavigation;
  const sendGoals = jest.fn(() => new Promise((resolve) => {
    resolveNavigation = resolve;
  }));
  const h = makeHarness({
    resolveBtXml: (spot) => (spot.id === "a" ? emptyBt : filledBt),
    sendGoals,
  });
  act(() => { h.view.result.current.start(); });

  await waitFor(() => expect(sendGoals).toHaveBeenCalledTimes(1));
  expect(h.sendGoal).not.toHaveBeenCalled();
  expect(h.callService).not.toHaveBeenCalled();
  expect(h.view.result.current.progress.map((entry) => entry.state)).toEqual([
    WaypointState.NAVIGATING,
    WaypointState.NAVIGATING,
  ]);

  await act(async () => {
    resolveNavigation({ ok: true, status: "SUCCEEDED" });
    await Promise.resolve();
  });

  await waitFor(() => expect(h.callService).toHaveBeenCalledTimes(1));
  expect(h.view.result.current.progress[0].state).toBe(WaypointState.SKIPPED);
  expect(h.view.result.current.progress[1].state).toBe(WaypointState.RUNNING_BT);
  await completeBt(h.btStatusRef);
  await waitFor(() => expect(h.view.result.current.status).toBe(RunnerStatus.DONE));
});

test("limits a batch to two empty waypoints before the BT endpoint", async () => {
  const spots = [
    { id: "a", pose: { x: 0, y: 0, yaw: 0 } },
    { id: "b", pose: { x: 1, y: 0, yaw: 0 } },
    { id: "c", pose: { x: 2, y: 0, yaw: 0 } },
    { id: "d", pose: { x: 3, y: 0, yaw: 0 } },
  ];
  const h = makeHarness({
    orderedSpots: spots,
    resolveBtXml: (spot) => (spot.id === "d" ? filledBt : emptyBt),
  });
  act(() => { h.view.result.current.start(); });

  await waitFor(() => expect(h.sendGoals).toHaveBeenCalledTimes(2));
  expect(h.sendGoals.mock.calls[0][0]).toEqual([
    { x: 0, y: 0, yaw: 0 },
    { x: 1, y: 0, yaw: 0 },
  ]);
  expect(h.sendGoals.mock.calls[1][0]).toEqual([
    { x: 2, y: 0, yaw: 0 },
    { x: 3, y: 0, yaw: 0 },
  ]);
  await waitFor(() => expect(h.callService).toHaveBeenCalledTimes(1));
  await completeBt(h.btStatusRef);
  await waitFor(() => expect(h.view.result.current.status).toBe(RunnerStatus.DONE));
});

test("uses NavigateToPose for one trailing empty waypoint", async () => {
  const h = makeHarness({
    orderedSpots: [SPOTS[0]],
    resolveBtXml: () => emptyBt,
  });
  act(() => { h.view.result.current.start(); });

  await waitFor(() => expect(h.view.result.current.status).toBe(RunnerStatus.DONE));
  expect(h.sendGoal).toHaveBeenCalledTimes(1);
  expect(h.sendGoals).not.toHaveBeenCalled();
  expect(h.callService).not.toHaveBeenCalled();
  expect(h.view.result.current.progress[0].state).toBe(WaypointState.SKIPPED);
});

test.each(["ABORTED", "CANCELED", "TIMEOUT", "REJECTED", "UNKNOWN"])(
  "fails every grouped waypoint when NavigateThroughPoses returns %s",
  async (status) => {
    const h = makeHarness({
      resolveBtXml: (spot) => (spot.id === "a" ? emptyBt : filledBt),
      sendGoals: jest.fn().mockResolvedValue({ ok: false, status }),
    });
    act(() => { h.view.result.current.start(); });

    await waitFor(() => expect(h.view.result.current.status).toBe(RunnerStatus.FAILED));
    expect(h.view.result.current.progress.map((entry) => entry.state)).toEqual([
      WaypointState.FAILED,
      WaypointState.FAILED,
    ]);
    expect(h.callService).not.toHaveBeenCalled();
    expect(h.sendGoal).not.toHaveBeenCalled();
  },
);

test("does not accept a stale latched completed as fresh BT completion", async () => {
  const h = makeHarness({ config: { ...FAST, btStartTimeoutMs: 120 } });
  h.btStatusRef.current = "completed";
  act(() => { h.view.result.current.start(); });

  await waitFor(() => expect(h.callService).toHaveBeenCalledTimes(1));
  await waitFor(() => expect(h.view.result.current.status).toBe(RunnerStatus.FAILED));
  expect(h.view.result.current.reason).toMatch(/did not start/);
});

test("stop while awaiting navigation cancels without becoming failed", async () => {
  const sendGoal = jest.fn((x, y, yaw, signal) => new Promise((resolve, reject) => {
    signal.addEventListener("abort", () => {
      reject(new DOMException("Aborted", "AbortError"));
    }, { once: true });
  }));
  const h = makeHarness({ sendGoal });
  act(() => { h.view.result.current.start(); });
  await waitFor(() => expect(sendGoal).toHaveBeenCalledTimes(1));

  await act(async () => {
    h.view.result.current.stop();
    await Promise.resolve();
  });

  await waitFor(() => expect(h.view.result.current.status).toBe(RunnerStatus.CANCELLED));
  expect(h.cancelGoal).toHaveBeenCalledTimes(1);
  expect(h.stopBt).toHaveBeenCalledTimes(1);
  expect(h.callService).not.toHaveBeenCalled();
  expect(h.view.result.current.progress[0].state).toBe(WaypointState.PENDING);
});

test("stop while awaiting NavigateThroughPoses resets the whole batch", async () => {
  const sendGoals = jest.fn((goals, signal) => new Promise((resolve, reject) => {
    signal.addEventListener("abort", () => {
      reject(new DOMException("Aborted", "AbortError"));
    }, { once: true });
  }));
  const h = makeHarness({
    resolveBtXml: () => emptyBt,
    sendGoals,
  });
  act(() => { h.view.result.current.start(); });
  await waitFor(() => expect(sendGoals).toHaveBeenCalledTimes(1));

  await act(async () => {
    h.view.result.current.stop();
    await Promise.resolve();
  });

  await waitFor(() => expect(h.view.result.current.status).toBe(RunnerStatus.CANCELLED));
  expect(h.cancelGoal).toHaveBeenCalledTimes(1);
  expect(h.view.result.current.progress.map((entry) => entry.state)).toEqual([
    WaypointState.PENDING,
    WaypointState.PENDING,
  ]);
});

test("a late NavigateThroughPoses response cannot overwrite cancellation", async () => {
  let resolveNavigation;
  const sendGoals = jest.fn(() => new Promise((resolve) => {
    resolveNavigation = resolve;
  }));
  const h = makeHarness({
    resolveBtXml: () => emptyBt,
    sendGoals,
  });
  act(() => { h.view.result.current.start(); });
  await waitFor(() => expect(sendGoals).toHaveBeenCalledTimes(1));

  await act(async () => {
    h.view.result.current.stop();
    resolveNavigation({ ok: true, status: "SUCCEEDED" });
    await Promise.resolve();
  });

  await waitFor(() => expect(h.view.result.current.status).toBe(RunnerStatus.CANCELLED));
  expect(h.callService).not.toHaveBeenCalled();
  expect(h.view.result.current.progress.map((entry) => entry.state)).toEqual([
    WaypointState.PENDING,
    WaypointState.PENDING,
  ]);
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
