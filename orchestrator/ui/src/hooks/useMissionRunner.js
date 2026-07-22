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

// Frontend-orchestrated Mission Runner. Drives an ordered waypoint list: send a
// nav goal, wait for TF-based arrival, run that waypoint's behavior tree to a
// fresh terminal /bt/status, then advance. Live signals are read through refs so
// the async loop never sees stale React values; the reducer only publishes
// observable progress for the UI. Cancellation aborts the loop and best-effort
// stops the robot. See missionRunnerCore.js for the pure, unit-tested pieces.

import { useCallback, useEffect, useMemo, useReducer, useRef } from "react";
import {
  DEFAULT_RUNNER_CONFIG,
  RunnerPhase,
  RunnerStatus,
  goalFromSpot,
  initialRunnerState,
  isArrived,
  isEmptyBt,
  isRunnerActive,
  missionRunnerReducer,
} from "./missionRunnerCore";

const normStatus = (value) => String(value || "").trim().toLowerCase();

// Sleep that rejects as soon as the abort signal fires, so a Stop mid-wait
// unwinds the driver loop immediately instead of after the next tick.
function cancellableSleep(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new DOMException("Aborted", "AbortError"));
      return;
    }
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new DOMException("Aborted", "AbortError"));
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

const isAbort = (error) => error && error.name === "AbortError";

export function useMissionRunner({
  orderedSpots,
  resolveBtXml,
  currentPoseRef,
  btStatusRef,
  callService,
  sendGoal,
  cancelGoal,
  stopBt,
  getFlags,
  onMessage,
  config: configOverride,
} = {}) {
  const config = useMemo(
    () => ({ ...DEFAULT_RUNNER_CONFIG, ...(configOverride || {}) }),
    [configOverride],
  );

  const [state, dispatch] = useReducer(missionRunnerReducer, orderedSpots || [], initialRunnerState);

  // Everything the loop needs, read live through refs (no stale closures).
  const spotsRef = useRef(orderedSpots || []);
  const resolveBtXmlRef = useRef(resolveBtXml);
  const callServiceRef = useRef(callService);
  const sendGoalRef = useRef(sendGoal);
  const cancelGoalRef = useRef(cancelGoal);
  const stopBtRef = useRef(stopBt);
  const getFlagsRef = useRef(getFlags);
  const onMessageRef = useRef(onMessage);
  const configRef = useRef(config);
  const abortRef = useRef(null);
  const isRunningRef = useRef(false);

  useEffect(() => { spotsRef.current = orderedSpots || []; }, [orderedSpots]);

  // Re-seed the observable progress list when the route changes while idle, so
  // the panel reflects the loaded mission before a run begins. Never clobber a
  // run in flight.
  useEffect(() => {
    if (!isRunningRef.current) {
      dispatch({ type: "reset", spots: orderedSpots || [] });
    }
  }, [orderedSpots]);
  useEffect(() => { resolveBtXmlRef.current = resolveBtXml; }, [resolveBtXml]);
  useEffect(() => { callServiceRef.current = callService; }, [callService]);
  useEffect(() => { sendGoalRef.current = sendGoal; }, [sendGoal]);
  useEffect(() => { cancelGoalRef.current = cancelGoal; }, [cancelGoal]);
  useEffect(() => { stopBtRef.current = stopBt; }, [stopBt]);
  useEffect(() => { getFlagsRef.current = getFlags; }, [getFlags]);
  useEffect(() => { onMessageRef.current = onMessage; }, [onMessage]);
  useEffect(() => { configRef.current = config; }, [config]);

  const emit = useCallback((message) => {
    if (message && typeof onMessageRef.current === "function") onMessageRef.current(message);
  }, []);

  // Keep the newly-loaded tree ticking until it reports a FRESH terminal status.
  // The engine latches the previous run's `completed`, so we only accept a
  // terminal once we've seen `running` (or the status object identity changed).
  const awaitBtTerminal = useCallback(async (signal) => {
    const cfg = configRef.current;
    const statusAtLoad = btStatusRef.current;
    let sawRunning = false;
    const startDeadline = Date.now() + cfg.btStartTimeoutMs;
    const runDeadline = Date.now() + cfg.btTimeoutMs;
    for (;;) {
      const status = normStatus(btStatusRef.current);
      if (status === "running") sawRunning = true;
      const fresh = sawRunning || btStatusRef.current !== statusAtLoad;
      if (fresh && status === "completed") return "completed";
      if (fresh && status === "failed") return "failed";
      if (!sawRunning && Date.now() > startDeadline) return "nostart";
      if (Date.now() > runDeadline) return "timeout";
      await cancellableSleep(cfg.pollMs, signal);
    }
  }, [btStatusRef]);

  // Poll TF pose until it settles inside tolerance, times out, or is cancelled.
  // Periodically re-issues the goal (onResend) so a goal dropped right after
  // nav bringup doesn't strand the robot short of the waypoint.
  const awaitArrival = useCallback(async (goal, signal, onResend) => {
    const cfg = configRef.current;
    const deadline = Date.now() + cfg.navTimeoutMs;
    let arrivedSince = null;
    let lastSend = Date.now();
    for (;;) {
      if (isArrived(currentPoseRef.current, goal, cfg)) {
        if (arrivedSince == null) arrivedSince = Date.now();
        if (Date.now() - arrivedSince >= cfg.settleMs) return "arrived";
      } else {
        arrivedSince = null;
        if (cfg.goalResendMs > 0 && onResend && Date.now() - lastSend >= cfg.goalResendMs) {
          lastSend = Date.now();
          Promise.resolve().then(onResend).catch(() => { /* best-effort resend */ });
        }
      }
      if (Date.now() > deadline) return "timeout";
      await cancellableSleep(cfg.pollMs, signal);
    }
  }, [currentPoseRef]);

  const runWaypoint = useCallback(async (index, signal) => {
    const spot = spotsRef.current[index];
    const label = (spot && (spot.label || spot.id)) || `Waypoint ${index + 1}`;

    dispatch({ type: "navigate", index });
    const goal = goalFromSpot(spot);
    await sendGoalRef.current(goal.x, goal.y, goal.yaw);
    dispatch({ type: "phase", phase: RunnerPhase.AWAITING_ARRIVAL });

    const arrival = await awaitArrival(
      goal,
      signal,
      () => sendGoalRef.current(goal.x, goal.y, goal.yaw),
    );
    if (arrival === "timeout") {
      dispatch({ type: "fail", reason: `Navigation timed out at ${label}`, index });
      return false;
    }
    dispatch({ type: "phase", phase: RunnerPhase.ARRIVED });

    const xml = resolveBtXmlRef.current ? resolveBtXmlRef.current(spot) : "";
    if (isEmptyBt(xml)) {
      dispatch({ type: "finish", index, skipped: true });
      return true;
    }

    dispatch({ type: "runBt", index });
    let loadResult;
    try {
      loadResult = await callServiceRef.current(
        "/bt/load_and_run",
        "interfaces/srv/LoadAndRunTree",
        { tree_xml: xml },
        30000,
      );
    } catch (error) {
      if (isAbort(error)) throw error;
      dispatch({ type: "fail", reason: `BT load failed at ${label}: ${error.message || error}`, index });
      return false;
    }
    if (loadResult && loadResult.success === false) {
      dispatch({ type: "fail", reason: `BT rejected at ${label}: ${loadResult.message || ""}`, index });
      return false;
    }
    dispatch({ type: "phase", phase: RunnerPhase.BT_RUNNING });

    const outcome = await awaitBtTerminal(signal);
    if (outcome === "completed") {
      dispatch({ type: "finish", index, skipped: false });
      return true;
    }
    const reasonByOutcome = {
      failed: `Behavior tree failed at ${label}`,
      timeout: `Behavior tree timed out at ${label}`,
      nostart: `Behavior tree did not start at ${label}`,
    };
    if (outcome === "timeout" || outcome === "nostart") {
      try { await stopBtRef.current(); } catch (error) { /* best-effort */ }
    }
    dispatch({ type: "fail", reason: reasonByOutcome[outcome] || `Behavior tree error at ${label}`, index });
    return false;
  }, [awaitArrival, awaitBtTerminal]);

  const start = useCallback(() => {
    if (isRunningRef.current) return;
    const spots = spotsRef.current;
    if (!spots.length) {
      emit("No route to run — connect waypoints in Design first");
      return;
    }
    const flags = getFlagsRef.current ? getFlagsRef.current() : {};
    if (!flags.navRunning) {
      emit("Start navigation before running the mission");
      return;
    }
    const needsBt = spots.some((spot) => !isEmptyBt(resolveBtXmlRef.current ? resolveBtXmlRef.current(spot) : ""));
    if (needsBt && !flags.btNodeIsUp) {
      emit("Activate the BT node before running the mission");
      return;
    }

    const controller = new AbortController();
    abortRef.current = controller;
    isRunningRef.current = true;
    dispatch({ type: "start" });

    (async () => {
      try {
        for (let index = 0; index < spotsRef.current.length; index += 1) {
          if (controller.signal.aborted) return;
          if (index > 0) dispatch({ type: "advance" });
          const ok = await runWaypoint(index, controller.signal);
          if (!ok) return;
        }
        dispatch({ type: "done" });
        emit("Mission complete");
      } catch (error) {
        if (!isAbort(error)) {
          dispatch({ type: "fail", reason: error.message || "Mission error", index: -1 });
        }
      } finally {
        isRunningRef.current = false;
        if (abortRef.current === controller) abortRef.current = null;
      }
    })();
  }, [emit, runWaypoint]);

  const stop = useCallback(() => {
    const controller = abortRef.current;
    if (controller) controller.abort();
    isRunningRef.current = false;
    dispatch({ type: "cancel" });
    Promise.allSettled([
      Promise.resolve().then(() => (cancelGoalRef.current ? cancelGoalRef.current() : null)),
      Promise.resolve().then(() => (stopBtRef.current ? stopBtRef.current() : null)),
    ]).then((results) => {
      if (results.some((r) => r.status === "rejected")) {
        emit("Stop sent, but the robot may still be executing");
      }
    });
  }, [emit]);

  // Abort on unmount, but only if a run is genuinely in flight (guards against
  // React StrictMode's double effect invocation spuriously cancelling).
  useEffect(() => () => {
    if (isRunningRef.current && abortRef.current) {
      abortRef.current.abort();
      isRunningRef.current = false;
      if (cancelGoalRef.current) Promise.resolve().then(cancelGoalRef.current).catch(() => {});
      if (stopBtRef.current) Promise.resolve().then(stopBtRef.current).catch(() => {});
    }
  }, []);

  const activeSpotId = state.currentIndex >= 0 && state.progress[state.currentIndex]
    ? state.progress[state.currentIndex].id
    : "";

  return {
    status: state.status,
    phase: state.phase,
    currentIndex: state.currentIndex,
    total: state.total,
    progress: state.progress,
    reason: state.reason,
    isRunning: isRunnerActive(state.status),
    activeSpotId,
    start,
    stop,
    RunnerStatus,
    RunnerPhase,
  };
}

export default useMissionRunner;
