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

import {
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  MdAdd,
  MdAddLocationAlt,
  MdContentCopy,
  MdDelete,
  MdEdit,
  MdLabel,
  MdMyLocation,
  MdOutlinedFlag,
  MdPlayArrow,
  MdRedo,
  MdRoute,
  MdSave,
  MdStop,
  MdUndo,
  MdVisibility,
} from "react-icons/md";
import {
  ANNOTATION_ERASE_TOOL,
  ANNOTATION_EXTEND_TOOL,
  ANNOTATION_TOOL,
  EDIT_TOOLS,
  useMapEditor,
} from "../../components/navigation/MapEditor";
import { MapViewer } from "../../components/navigation/MapViewer";
import MissionBtEditor from "../../components/navigation/MissionBtEditor";
import MissionBtRunView from "../../components/navigation/MissionBtRunView";
import { RunnerStatus } from "../../hooks/missionRunnerCore";
import { useBTHistory } from "../../hooks/useBTHistory";
import { useMappingPoseSync } from "../../hooks/useMappingPoseSync";
import { useMissionRunner } from "../../hooks/useMissionRunner";
import {
  useNavigationRosPublisher,
  useNavigationRosTopic,
} from "../../hooks/useNavigationRosTopic";
import { useRosServiceCaller } from "../../hooks/useRosServiceCaller";
import { parseBTXml } from "../../utils/btTreeParser";
import {
  cancelNavigateToPoseGoal,
  configureDesignLocalizationAmcl,
  deletePgmMap,
  getPgmFiles,
  getServiceStatus,
  requestNoMotionUpdate,
  saveNavigationMap,
  sendInitialPoseEstimate,
  sendNavigateThroughPosesGoalsAndWait,
  sendNavigateToPoseGoalAndWait,
  startNavigation,
  stopNavigation,
} from "../../utils/navigationApi";
import {
  deleteNavigationMission,
  deleteNavigationMissionBtFile,
  duplicateNavigationMission,
  getNavigationMission,
  getNavigationMissionBtFile,
  getNavigationMissions,
  renameNavigationMission,
  saveNavigationMission,
  saveNavigationMissionBtFile,
  setNavigationMissionDefaultBtFile,
} from "../../utils/navigationMissionsApi";
import {
  createNavigationSpot,
  deleteNavigationSpot,
  getNavigationSpots,
  updateNavigationSpot,
} from "../../utils/navigationSpotsApi";
import {
  applyPoseSyncToTf,
  mergeTfMessages,
  orientationFromYaw,
  poseFromBaseLinkTf,
  tfMessageFromBuffer,
  updateTfBuffer,
  yawFromPose,
} from "../../utils/navigationTf";
import { rosTimestampNow } from "../../utils/rosTime";
import { formatTaskDisplayMessage } from "../../utils/taskTerminology";
import {
  STAGE_AUTHORING,
  STAGE_MAPPING,
  STAGE_MAP_EDIT,
  STAGE_NAVIGATE,
  STAGE_RUN,
  WORKSPACE_NAV_GROUPS,
  WORKSPACE_STAGES,
} from "./lib/stages";
import {
  EDITOR_BRUSH_RING_COLORS,
  MISSION_BORDER,
  MISSION_RAIL_BG,
  MISSION_STAGE_EMPTY,
  MISSION_SURFACE,
  MISSION_TEXT,
  MISSION_TEXT_MUTED,
} from "./lib/theme";
import {
  initialNavigationRuntimeMode,
  initialRunRuntimeOwned,
  initialRunShutdownPending,
  initialWorkspaceStage,
  readMissionSession,
  recentRunShutdownMarker,
  saveMissionSession,
} from "./lib/session";
import {
  DEFAULT_MAP_NAME,
  DEFAULT_MISSION_NAME,
  isValidMissionName,
  mapNameFromPgmPath,
  missionRequestName,
  uniqueMissionName,
} from "./lib/missionNames";
import {
  assembleMissionBtFilesForSave,
  buildGlobalMissionXml,
  canonicalLocalBtPathForSpot,
  canonicalLocalBtPathsForSpot,
  changedLocalBtPaths,
  defaultLocalBtXml,
  initializeCreatedWaypointLocalBt,
  localBtDirectoriesForSpots,
  localBtDirectoryForSpot,
  localBtPathForSpot,
  localBtPathsForSpot,
  localBtSaveAsPath,
  migrateCanonicalLocalBtFileKeys,
  missionBtFileDefaultsForRunSpots,
  missionBtFileDefaultsForSpots,
  withLocalBtLibrary,
} from "./lib/missionBtFiles";
import {
  filterMissionFlowEdges,
  missionFlowEdgesForRouteOrder,
  missionStepSpotsFromMissionFlow,
  normalizeMissionFlow,
  orderedSpotsFromMissionFlow,
  serializeMissionFlow,
  syncMissionFlowNodesWithSpots,
} from "./lib/missionFlow";
import {
  isMissionManifestSpot,
  missionWaypointsFromSpots,
  nextWaypointLabel,
  orderedMissionSpots,
  spotForMapDisplay,
  spotPoseFromMapPose,
  spotsFromMissionWaypoints,
} from "./lib/missionSpots";
import {
  behaviorNodeDefinition,
  behaviorNodeId,
  behaviorNodeSerialFromNodes,
  saveBehaviorNodesForMap,
  savedBehaviorNodesForMap,
} from "./lib/designStore";
import {
  LAYER_DEFINITIONS,
  LAYER_PRESETS,
  LAYER_TOPIC_IDS,
  STAGE_EXTRA_TOPIC_IDS,
  STAGE_LAYER_IDS,
  TOPIC_ORDER,
} from "./lib/layers";
import { hasTopicMessage, messageData, rosStringData } from "./lib/rosTopicPayload";
import { getBtNodeServiceStatus, setBtNodeServiceActive } from "./lib/btNodeApi";
import { isTextInputTarget } from "./lib/dom";
import { ActionButton, MapEditToolButton, WaypointOptionButton } from "./components/primitives";
import { ConfirmDialog, LoadMapDialog, SaveMapDialog, SaveMissionDialog } from "./components/dialogs";
import { LayersPopover, TopicStatusPanel } from "./components/mapChrome";
import StageIcon from "./components/StageIcon";
import MappingTeleopPanel, { TELEOP_MESSAGE_TYPE, TELEOP_TOPIC, teleopTwist } from "./components/mapping/MappingTeleopPanel";
import MappingSessionPanel from "./components/mapping/MappingSessionPanel";
import MapDeleteControl from "./components/mapping/MapDeleteControl";
import {
  MAP_EDIT_AREA_TOOLS,
  MAP_EDIT_AREA_TOOL_IDS,
  MAP_EDIT_PIXEL_TOOL_IDS,
  MapAreaManager,
  MapEditBrushRow,
} from "./components/mapEdit/MapEditTools";
import RunSessionPanel from "./components/run/RunSessionPanel";
import NavigateSessionPanel from "./components/run/NavigateSessionPanel";

const STATUS_POLL_MS = 10000;

const BT_NODE_STATUS_POLL_MS = 5000;

// s6 reports "up" as soon as the launcher process exists, before ROS has
// necessarily registered /bt/load_and_run. Run Mission therefore waits for a
// read-only service on the same node before treating activation as complete.
const BT_NODE_ACTIVATION_POLL_MS = 500;

const BT_NODE_ACTIVATION_POLL_ATTEMPTS = 10;

const BT_NODE_READY_PROBE_TIMEOUT_MS = 1000;

const NOMOTION_UPDATE_INTERVAL_MS = 1000;

const AUTO_LOCALIZE_MAX_UPDATES = 10;

const AUTO_LOCALIZE_MIN_UPDATES = 3;

const AUTO_LOCALIZE_UPDATE_DELAY_MS = 700;

const AUTO_LOCALIZE_XY_COVARIANCE_MAX = 0.6;

const AUTO_LOCALIZE_YAW_COVARIANCE_MAX = 0.5;

const ROS2_WS_FAST_TOPIC_OPTIONS = { throttleMs: 100 };

const ROS2_WS_ODOM_TOPIC_OPTIONS = { throttleMs: 50, staleMs: 1000 };

// throttleMs: the BT glow only needs ~7fps; unthrottled status messages
// re-render the whole page per message and starve the map's pulse loop
// while the BT split view is open.
const BT_TOPIC_OPTIONS = { staleMs: 3000, throttleMs: 150 };

function taskDisplayMessage(value) {
  return formatTaskDisplayMessage(value, "Waypoint Task");
}

function delay(ms) {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

function amclPoseLooksLocalized(amclPose) {
  const covariance = amclPose?.pose?.covariance;
  if (!Array.isArray(covariance) || covariance.length < 36) return false;
  const xVariance = Number(covariance[0]);
  const yVariance = Number(covariance[7]);
  const yawVariance = Number(covariance[35]);
  if (![xVariance, yVariance, yawVariance].every(Number.isFinite)) return false;
  return (
    Math.max(xVariance, yVariance) <= AUTO_LOCALIZE_XY_COVARIANCE_MAX &&
    yawVariance <= AUTO_LOCALIZE_YAW_COVARIANCE_MAX
  );
}

function navigationRuntimeModeFromStatus(status) {
  if (status?.is_up === false) return "idle";
  if (!status?.is_up) return "";
  if (status.mode === "map" || status.mode === "mapping") return "mapping";
  if (status.mode === "localize" || status.mode === "localization") return "localization";
  if (status.mode === "nav" || status.mode === "run") return "run";
  return "";
}

// Mounted by the Autonomy Studio shell, which owns the page root, the app bar
// and the workspace choice. `dialogHost` is the shell's page root (dialogs must
// portal inside the --mc-* token scope), `onExitStateChange` publishes the
// reason the back button is blocked, and `exitHandleRef` receives
// `requestExit(onExit)` so leaving passes through the unsaved-Design guard.
export default function MissionCanvasWorkspace({
  dialogHost = null,
  onExitStateChange = null,
  exitHandleRef = null,
}) {
  const initialSessionRef = useRef(null);
  if (initialSessionRef.current === null) {
    initialSessionRef.current = readMissionSession();
  }
  const initialSession = initialSessionRef.current;
  const restoredDesignMapPath = (
    typeof initialSession.designMapPath === "string" && initialSession.designMapPath.trim()
      ? initialSession.designMapPath.trim()
      : ""
  );
  const statusLoadingRef = useRef(false);
  const runPageExitStopSentRef = useRef(false);
  const runShutdownConfirmationRef = useRef(null);
  const nomotionUpdateBusyRef = useRef(false);
  const tfBufferRef = useRef(new Map());
  const currentPoseRef = useRef(null);
  const amclPoseRef = useRef(null);
  const btStatusRef = useRef("stopped");
  const btNodeReleaseRef = useRef(Promise.resolve());
  const missionBtNodeOwnedRef = useRef(false);
  const behaviorNodeSerialRef = useRef(0);
  const legacySpotLoadGenerationRef = useRef(0);
  const designMissionLoadGenerationRef = useRef(0);
  const runMissionLoadGenerationRef = useRef(0);
  const [mapName, setMapName] = useState(() => (
    typeof initialSession.mapName === "string" && initialSession.mapName.trim()
      ? initialSession.mapName
      : DEFAULT_MAP_NAME
  ));
  const [missionName, setMissionName] = useState(() => (
    typeof initialSession.missionName === "string" && initialSession.missionName.trim()
      ? initialSession.missionName.trim()
      : DEFAULT_MISSION_NAME
  ));
  const designMapNameRef = useRef(mapName);
  const designMissionNameRef = useRef(missionName);
  designMapNameRef.current = mapName;
  designMissionNameRef.current = missionName;
  // Missions known to exist on the server for the loaded design map.
  const [designCatalog, setDesignCatalog] = useState({ mapName: "", names: [] });
  const [status, setStatus] = useState(null);
  const [spots, setSpots] = useState([]);
  const [selectedSpotId, setSelectedSpotId] = useState("");
  const [editingSpotId, setEditingSpotId] = useState("");
  const [editingSpotLabel, setEditingSpotLabel] = useState("");
  const [behaviorNodes, setBehaviorNodes] = useState([]);
  const [selectedBehaviorNodeId, setSelectedBehaviorNodeId] = useState("");
  const [pendingBehaviorNodeTag, setPendingBehaviorNodeTag] = useState("");
  const [missionBtFiles, setMissionBtFiles] = useState({});
  const missionBtFilesRef = useRef(missionBtFiles);
  missionBtFilesRef.current = missionBtFiles;
  const persistedMissionBtFilesRef = useRef({});
  const persistedLocalBtPathsRef = useRef(new Set());
  const persistedMissionRevisionRef = useRef(0);
  const dirtyLocalBtPathsRef = useRef(new Set());
  const localBtFileOperationRef = useRef(0);
  const waypointCreatePendingRef = useRef(false);
  const routeMutationLockRef = useRef(false);
  const saveDesignMissionRef = useRef(null);
  const [deletedMissionBtPaths, setDeletedMissionBtPaths] = useState([]);
  const [missionFlowNodes, setMissionFlowNodes] = useState([]);
  const [missionFlowEdges, setMissionFlowEdges] = useState([]);
  // Run is deliberately a separate, read-only mission session. Loading a
  // mission to execute must never replace the mission currently being edited.
  const [runMapName, setRunMapName] = useState("");
  const [runMissionName, setRunMissionName] = useState(() => (
    typeof initialSession.runMissionName === "string" && initialSession.runMissionName.trim()
      ? initialSession.runMissionName.trim()
      : DEFAULT_MISSION_NAME
  ));
  const [runCatalog, setRunCatalog] = useState({ mapName: "", names: [] });
  const [runSpots, setRunSpots] = useState([]);
  const [runMissionBtFiles, setRunMissionBtFiles] = useState({});
  const [runMissionFlowNodes, setRunMissionFlowNodes] = useState([]);
  const [runMissionFlowEdges, setRunMissionFlowEdges] = useState([]);
  const [missionRouteMode, setMissionRouteMode] = useState(false);
  const [missionRouteSourceId, setMissionRouteSourceId] = useState("");
  const [missionBtLoadingPath, setMissionBtLoadingPath] = useState("");
  const [busy, setBusy] = useState("");
  // Status strings are no longer surfaced anywhere (the header status line
  // was removed on purpose); the state stays because ~70 flows and child
  // panels still report through setMessage, keeping the wiring in place if a
  // notification surface ever returns.
  const [message, setMessage] = useState("");
  void message;
  const [btNodeStatus, setBtNodeStatus] = useState({
    state: "unknown",
    raw: "not checked",
  });
  const [btNodeBusy, setBtNodeBusy] = useState("");
  const [btLayerSpotId, setBtLayerSpotId] = useState("");
  // The read-only Run BT view only needs a stable map context. Suspending
  // high-frequency visual overlays while it is open avoids redrawing the
  // WebGL map underneath every ReactFlow update; Nav2 itself is unaffected.
  const [runBtVisualizationActive, setRunBtVisualizationActive] = useState(false);
  const [editingLocalBtPathBySpotId, setEditingLocalBtPathBySpotId] = useState({});
  const [interactionMode, setInteractionMode] = useState("view");
  // Run stage: AMCL must be given an initial pose after nav bringup before the
  // mission runner may send goals — a lost robot stays still otherwise.
  const [runPoseInitialized, setRunPoseInitialized] = useState(false);
  const [showWaypointOptions, setShowWaypointOptions] = useState(false);
  const [designPoseInitialized, setDesignPoseInitialized] = useState(() => (
    initialNavigationRuntimeMode(initialSession) === "localization" &&
    initialSession.designPoseInitialized === true
  ));
  const [navigationRuntimeMode, setNavigationRuntimeMode] = useState(() => (
    initialNavigationRuntimeMode(initialSession)
  ));
  const [runRuntimeOwned, setRunRuntimeOwned] = useState(() => (
    initialRunRuntimeOwned(initialSession)
  ));
  const [runShutdownPending, setRunShutdownPending] = useState(() => (
    initialRunShutdownPending(initialSession)
  ));
  const [tfBufferRevision, setTfBufferRevision] = useState(0);
  const [workspaceStage, setWorkspaceStage] = useState(() => initialWorkspaceStage(initialSession));
  // Run-family handlers (map load / localize) historically forced the Run
  // stage; with Navigate sharing that runtime they must keep the stage the
  // user is on. The ref avoids re-creating those callbacks per stage change.
  const workspaceStageRef = useRef(workspaceStage);
  workspaceStageRef.current = workspaceStage;
  const runFamilyStageTarget = () => (
    workspaceStageRef.current === STAGE_NAVIGATE ? STAGE_NAVIGATE : STAGE_RUN
  );
  const [showSaveMapDialog, setShowSaveMapDialog] = useState(false);
  const [saveMapName, setSaveMapName] = useState(DEFAULT_MAP_NAME);
  const [showSaveMissionDialog, setShowSaveMissionDialog] = useState(false);
  const [saveMissionName, setSaveMissionName] = useState("");
  const [showDuplicateMissionDialog, setShowDuplicateMissionDialog] = useState(false);
  const [duplicateMissionName, setDuplicateMissionName] = useState("");
  const [showRenameMissionDialog, setShowRenameMissionDialog] = useState(false);
  const [renameMissionName, setRenameMissionName] = useState("");
  const [showDeleteMissionDialog, setShowDeleteMissionDialog] = useState(false);
  // Design edits not yet written to the mission manifest (BT/route/waypoints).
  const [designDirty, setDesignDirty] = useState(false);
  const designDirtyRef = useRef(false);
  const designBtRevisionRef = useRef(0);
  const designNonBtRevisionRef = useRef(0);
  const nonBtDesignDirtyRef = useRef(false);
  const [showUnsavedDialog, setShowUnsavedDialog] = useState(false);
  const pendingGuardActionRef = useRef(null);
  const [showDesignMapDialog, setShowDesignMapDialog] = useState(false);
  const [designMapFiles, setDesignMapFiles] = useState([]);
  const [designMissionNames, setDesignMissionNames] = useState([]);
  const [designMapPath, setDesignMapPath] = useState(restoredDesignMapPath);
  // Whether a map is loaded for display in Design/Run. Deliberately NOT restored
  // from session: a refresh, a stage switch, or the backend going down should
  // drop the stale map so it never lingers after the system is off.
  const [missionMapLoaded, setMissionMapLoaded] = useState(false);
  const prevRunningRef = useRef(false);
  const [pendingDesignMapPath, setPendingDesignMapPath] = useState(restoredDesignMapPath);
  const [pendingDesignMissionName, setPendingDesignMissionName] = useState(DEFAULT_MISSION_NAME);
  const [designMapBusy, setDesignMapBusy] = useState(false);
  const [designMissionLoadError, setDesignMissionLoadError] = useState("");
  const [designMapReloadToken, setDesignMapReloadToken] = useState(0);
  const [showEditMapDialog, setShowEditMapDialog] = useState(false);
  const [pendingEditMapPath, setPendingEditMapPath] = useState("");
  // Map Edit HUD tool-group popovers (the Design HUD's waypoint-options idiom).
  const [mapEditToolsOpen, setMapEditToolsOpen] = useState(false);
  const [labelToolsOpen, setLabelToolsOpen] = useState(false);
  const [showRunMapDialog, setShowRunMapDialog] = useState(false);
  const [runMapDialogStage, setRunMapDialogStage] = useState(STAGE_RUN);
  const runMapDialogRequestRef = useRef(0);
  const [runMapFiles, setRunMapFiles] = useState([]);
  const [runMissionNames, setRunMissionNames] = useState([]);
  const [runMapPath, setRunMapPath] = useState("");
  const [pendingRunMissionName, setPendingRunMissionName] = useState(DEFAULT_MISSION_NAME);
  const [runMapBusy, setRunMapBusy] = useState(false);
  // A fresh Run tab has no authoritative map/mission snapshot yet. Localize
  // becomes available only after the first successful Run map load.
  const [runMapSnapshotInvalid, setRunMapSnapshotInvalid] = useState(true);
  const [mapEditorReloadToken, setMapEditorReloadToken] = useState(0);
  // Saved-map inventory for the Mapping HUD; refreshed on stage entry and
  // whenever Save Map lands (the same token also refreshes the editor).
  const [savedMaps, setSavedMaps] = useState([]);
  useEffect(() => {
    if (workspaceStage !== STAGE_MAPPING) return undefined;
    let cancelled = false;
    getPgmFiles()
      .then((response) => {
        if (!cancelled) setSavedMaps(response.files || []);
      })
      .catch(() => {
        if (!cancelled) setSavedMaps([]);
      });
    return () => {
      cancelled = true;
    };
  }, [mapEditorReloadToken, workspaceStage]);

  const handleDeleteSavedMap = useCallback(async (path) => {
    try {
      await deletePgmMap(path);
      setSavedMaps((files) => files.filter((file) => file.path !== path));
      setMessage(`Deleted map ${path}`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Failed to delete map");
    }
  }, []);
  const [layersByStage, setLayersByStage] = useState(() => ({
    [STAGE_MAPPING]: { ...LAYER_PRESETS[STAGE_MAPPING] },
    [STAGE_MAP_EDIT]: { ...LAYER_PRESETS[STAGE_MAP_EDIT] },
    [STAGE_NAVIGATE]: { ...LAYER_PRESETS[STAGE_NAVIGATE] },
    [STAGE_AUTHORING]: { ...LAYER_PRESETS[STAGE_AUTHORING] },
    [STAGE_RUN]: { ...LAYER_PRESETS[STAGE_RUN] },
  }));
  const publishRosTopic = useNavigationRosPublisher();

  const getDesignHistorySnapshot = useCallback(() => JSON.stringify({
    spots,
    behaviorNodes,
    missionBtFiles,
    deletedMissionBtPaths,
    missionFlowNodes,
    missionFlowEdges,
    selectedSpotId,
    selectedBehaviorNodeId,
    designDirty,
    nonBtDesignDirty: nonBtDesignDirtyRef.current,
  }), [
    behaviorNodes,
    deletedMissionBtPaths,
    designDirty,
    missionBtFiles,
    missionFlowEdges,
    missionFlowNodes,
    selectedBehaviorNodeId,
    selectedSpotId,
    spots,
  ]);

  const applyDesignHistorySnapshot = useCallback((snapshot) => {
    try {
      const restored = JSON.parse(snapshot);
      const restoredSpots = Array.isArray(restored.spots) ? restored.spots : [];
      const restoredBehaviorNodes = Array.isArray(restored.behaviorNodes)
        ? restored.behaviorNodes
        : [];
      const restoredMissionBtFiles = restored.missionBtFiles || {};
      const restoredNonBtDirty = restored.nonBtDesignDirty === undefined
        ? restored.designDirty === true
        : restored.nonBtDesignDirty === true;
      const restoredLocalDirtyPaths = changedLocalBtPaths(
        restoredMissionBtFiles,
        persistedMissionBtFilesRef.current,
      );
      const restoredDirty = restoredNonBtDirty || restoredLocalDirtyPaths.size > 0;

      setSpots(restoredSpots);
      setBehaviorNodes(restoredBehaviorNodes);
      // Save reads the synchronous ref so an immediate Undo/Redo -> Save must
      // persist the graph visible after history restoration, not the graph
      // from the preceding render.
      missionBtFilesRef.current = restoredMissionBtFiles;
      setMissionBtFiles(restoredMissionBtFiles);
      designBtRevisionRef.current += 1;
      designNonBtRevisionRef.current += 1;
      nonBtDesignDirtyRef.current = restoredNonBtDirty;
      dirtyLocalBtPathsRef.current = restoredLocalDirtyPaths;
      setDeletedMissionBtPaths(
        Array.isArray(restored.deletedMissionBtPaths) ? restored.deletedMissionBtPaths : [],
      );
      setMissionFlowNodes(
        Array.isArray(restored.missionFlowNodes) ? restored.missionFlowNodes : [],
      );
      setMissionFlowEdges(
        Array.isArray(restored.missionFlowEdges) ? restored.missionFlowEdges : [],
      );
      setSelectedSpotId(
        restoredSpots.some((spot) => spot.id === restored.selectedSpotId)
          ? restored.selectedSpotId
          : "",
      );
      setSelectedBehaviorNodeId(
        restoredBehaviorNodes.some((node) => node.id === restored.selectedBehaviorNodeId)
          ? restored.selectedBehaviorNodeId
          : "",
      );
      setMissionRouteSourceId("");
      setEditingSpotId("");
      setEditingSpotLabel("");
      setBtLayerSpotId("");
      setInteractionMode("view");
      setShowWaypointOptions(false);
      behaviorNodeSerialRef.current = Math.max(
        behaviorNodeSerialRef.current,
        behaviorNodeSerialFromNodes(restoredBehaviorNodes),
      );
      designDirtyRef.current = restoredDirty;
      setDesignDirty(restoredDirty);
      setMessage("Design history restored");
    } catch {
      setMessage("Failed to restore design history");
    }
  }, []);

  const {
    capture: captureDesignHistory,
    undo: undoDesignHistory,
    redo: redoDesignHistory,
    reset: resetDesignHistory,
    canUndo: canUndoDesign,
    canRedo: canRedoDesign,
  } = useBTHistory({
    getSnapshot: getDesignHistorySnapshot,
    applySnapshot: applyDesignHistorySnapshot,
  });

  const running = status?.is_up ?? false;
  const mappingEditorActive = workspaceStage === STAGE_MAP_EDIT;
  const designMapActive = workspaceStage === STAGE_AUTHORING && !!designMapPath && missionMapLoaded;
  const robotPoseCaptureActive = workspaceStage === STAGE_AUTHORING && designMapActive;
  const mappingRuntimeActive = running && navigationRuntimeMode === "mapping";
  const runRuntimeActive = running && navigationRuntimeMode === "run";
  const designLocalizationActive = (
    workspaceStage === STAGE_AUTHORING &&
    designMapActive &&
    running &&
    navigationRuntimeMode === "localization"
  );
  const mappingTopicsActive = (
    workspaceStage === STAGE_MAPPING &&
    mappingRuntimeActive &&
    busy !== "Stop" &&
    !mappingEditorActive
  );
  const mappingPoseSubscriptionActive = (
    workspaceStage === STAGE_MAPPING &&
    !mappingEditorActive &&
    busy !== "Stop"
  );
  // Navigate shares the Run runtime plumbing (map snapshot, localization,
  // live topics); only the mission machinery stays Run-only.
  const runFamilyStage = workspaceStage === STAGE_RUN || workspaceStage === STAGE_NAVIGATE;
  const runTopicsActive = (
    runFamilyStage &&
    runRuntimeActive &&
    busy !== "Stop"
  );
  const stageNavigationTopicsActive = mappingTopicsActive || runTopicsActive;
  const activeLayers = layersByStage[workspaceStage] || LAYER_PRESETS[workspaceStage];
  const runSessionActive = runFamilyStage;
  const currentMapName = (runSessionActive ? runMapName : mapName).trim() || DEFAULT_MAP_NAME;
  const activeSpots = runSessionActive ? runSpots : spots;
  const activeMissionBtFiles = runSessionActive ? runMissionBtFiles : missionBtFiles;
  const activeMissionFlowNodes = runSessionActive ? runMissionFlowNodes : missionFlowNodes;
  const activeMissionFlowEdges = runSessionActive ? runMissionFlowEdges : missionFlowEdges;
  const mapEditor = useMapEditor({
    open: mappingEditorActive,
    mapName: currentMapName,
    onMessage: setMessage,
    reloadToken: mapEditorReloadToken,
    autoSelect: false,
  });
  const designMapEditor = useMapEditor({
    open: designMapActive,
    mapName: currentMapName,
    onMessage: setMessage,
    reloadToken: designMapReloadToken,
  });
  // Run stage shows the saved floor plan (with its resolution/origin) so loaded
  // waypoints are framed correctly before the live /map arrives from nav2.
  const runDisplayMapEditor = useMapEditor({
    open: runFamilyStage && missionMapLoaded,
    mapName: currentMapName,
    onMessage: setMessage,
  });
  const runBtMapLightweight = workspaceStage === STAGE_RUN && runBtVisualizationActive;
  const needsGlobalCostmap = (
    stageNavigationTopicsActive && activeLayers.globalCostmap && !runBtMapLightweight
  );
  const needsLocalCostmap = (
    stageNavigationTopicsActive && activeLayers.localCostmap && !runBtMapLightweight
  );
  const needsScan = designLocalizationActive || (
    stageNavigationTopicsActive && activeLayers.scan && !runBtMapLightweight
  );
  const needsPlan = (
    stageNavigationTopicsActive && activeLayers.globalPlan && !runBtMapLightweight
  );
  const needsRobotModel = designLocalizationActive || (
    stageNavigationTopicsActive && activeLayers.robotModel
  );
  // Keep the SLAM/odometry anchor warm for the whole Mapping session. If all
  // pose-dependent layers are toggled off while the robot is stationary,
  // slam_toolbox may not publish another /pose when a layer is re-enabled.
  const needsMappingPose = mappingPoseSubscriptionActive;
  const needsAmclPose = robotPoseCaptureActive || runTopicsActive;
  const needsTf = robotPoseCaptureActive || (
    stageNavigationTopicsActive && !runBtMapLightweight && (
      activeLayers.tf ||
      activeLayers.scan ||
      activeLayers.robotModel
    )
  );
  const needsMap = (
    stageNavigationTopicsActive ||
    designLocalizationActive
  ) && activeLayers.map;
  const needsBtTopics = workspaceStage === STAGE_RUN;
  const activeBehaviorNodes = useMemo(
    () => behaviorNodes.filter((node) => node.map_name === currentMapName),
    [behaviorNodes, currentMapName],
  );

  // A loaded map/mission is a new authoring document. History must never leak
  // across documents, including an explicit reload of the same map/mission.
  useEffect(() => {
    resetDesignHistory();
  }, [designMapReloadToken, mapName, missionName, resetDesignHistory]);
  const behaviorPreviewNode = useMemo(() => (
    pendingBehaviorNodeTag ? behaviorNodeDefinition(pendingBehaviorNodeTag) : null
  ), [pendingBehaviorNodeTag]);
  const { topicData: mapData } = useNavigationRosTopic(
    needsMap ? "/map" : null,
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
  const { topicData: slamPoseData } = useNavigationRosTopic(
    needsMappingPose ? "/pose" : null,
    ROS2_WS_FAST_TOPIC_OPTIONS,
  );
  const { topicData: odometryData } = useNavigationRosTopic(
    needsMappingPose || runTopicsActive ? "/odom" : null,
    ROS2_WS_ODOM_TOPIC_OPTIONS,
  );
  const { topicData: amclData } = useNavigationRosTopic(
    needsAmclPose ? "/amcl_pose" : null,
    ROS2_WS_FAST_TOPIC_OPTIONS,
  );
  const { topicData: planData } = useNavigationRosTopic(
    needsPlan ? "/plan" : null,
  );
  const { topicData: tfData } = useNavigationRosTopic(
    needsTf ? "/tf" : null,
    ROS2_WS_FAST_TOPIC_OPTIONS,
  );
  const { topicData: tfStaticData } = useNavigationRosTopic(
    needsTf ? "/tf_static" : null,
  );
  const { topicData: btStatusData } = useNavigationRosTopic(
    needsBtTopics ? "/bt/status" : null,
    BT_TOPIC_OPTIONS,
  );
  const { topicData: btActiveNodesData } = useNavigationRosTopic(
    needsBtTopics ? "/bt/active_nodes" : null,
    BT_TOPIC_OPTIONS,
  );
  const map = useMemo(() => messageData(mapData), [mapData]);
  const globalCostmap = useMemo(() => messageData(globalCostmapData), [globalCostmapData]);
  const localCostmap = useMemo(() => messageData(localCostmapData), [localCostmapData]);
  const footprint = useMemo(() => messageData(footprintData), [footprintData]);
  const scan = useMemo(() => messageData(scanData), [scanData]);
  const slamPose = useMemo(() => messageData(slamPoseData), [slamPoseData]);
  const odometry = useMemo(() => messageData(odometryData), [odometryData]);
  const amclPose = useMemo(() => messageData(amclData), [amclData]);
  const plan = useMemo(() => messageData(planData), [planData]);
  const tf = useMemo(() => messageData(tfData), [tfData]);
  const tfStatic = useMemo(() => messageData(tfStaticData), [tfStaticData]);
  const btStatusText = useMemo(() => rosStringData(btStatusData), [btStatusData]);
  const btActiveNodesText = useMemo(() => {
    const names = rosStringData(btActiveNodesData)
      .split(",")
      .map((name) => name.trim())
      .filter(Boolean);
    return names.join(", ");
  }, [btActiveNodesData]);
  const btNodeIsUp = btNodeStatus.state === "up";
  const latestTf = useMemo(() => mergeTfMessages(tfStatic, tf), [tf, tfStatic]);
  void tfBufferRevision;
  const bufferedTf = tfMessageFromBuffer(tfBufferRef.current) ?? latestTf;
  const fallbackPose = amclPose?.pose?.pose ?? null;
  const tfPose = poseFromBaseLinkTf(bufferedTf);
  const mappingPoseSync = useMappingPoseSync({
    active: mappingPoseSubscriptionActive && !!odometry,
    slamPose,
    odometry,
    scanStamp: scan?.header?.stamp ?? null,
  });
  const resetMappingPoseSync = mappingPoseSync.reset;
  const runPoseSync = useMappingPoseSync({
    active: runTopicsActive && !!odometry,
    slamPose: amclPose,
    odometry,
    scanStamp: scan?.header?.stamp ?? null,
  });
  const mappingTf = mappingTopicsActive
    ? applyPoseSyncToTf(bufferedTf, mappingPoseSync)
    : bufferedTf;
  const runTf = runTopicsActive
    ? applyPoseSyncToTf(bufferedTf, runPoseSync)
    : bufferedTf;
  const displayTf = runTopicsActive ? runTf : mappingTf;
  // In Run, AMCL is the authoritative map-frame localization estimate. The
  // rosbridge-throttled /tf stream can miss low-rate map -> odom updates while
  // still receiving odom -> base_link, leaving this browser's composed TF pose
  // stale even though Nav2's internal TF buffer is current. Retain TF as a
  // startup fallback until the first AMCL pose arrives.
  const currentPose = runSessionActive
    ? runPoseSync.pose ?? fallbackPose ?? tfPose
    : mappingTopicsActive
      ? mappingPoseSync.pose ?? tfPose
      : tfPose ?? fallbackPose;
  const displayedMap = mappingEditorActive
    ? mapEditor.map
    : workspaceStage === STAGE_AUTHORING
      ? designMapActive ? designMapEditor.map : null
      : runFamilyStage
        ? (map || runDisplayMapEditor.map)
        : map;
  const designMapAvailable = designMapActive && !!designMapEditor.map;
  // A restored map/mission name is only a picker default. Do not expose any
  // in-memory Design document until the explicit map+mission load has fully
  // completed; otherwise a previous map's legacy spots can flash in the rail.
  const designDocumentReady = (
    designMapAvailable
    && !designMapBusy
    && !designMissionLoadError
  );
  // Waypoints/route only render on top of a loaded map: marker size and
  // placement derive from the map's resolution, so without a map they would
  // draw at raw scale — huge, overlapping, and floating in empty space.
  const missionOverlayActive = (
    (workspaceStage === STAGE_RUN && !!displayedMap) ||
    (workspaceStage === STAGE_AUTHORING && designDocumentReady)
  );
  const visibleSpots = useMemo(
    () => activeSpots.map((spot) => spotForMapDisplay(spot, displayedMap)),
    [activeSpots, displayedMap],
  );
  const missionRouteEdges = useMemo(
    () => filterMissionFlowEdges(activeMissionFlowEdges, visibleSpots),
    [activeMissionFlowEdges, visibleSpots],
  );
  const missionRouteOrderedSpots = useMemo(
    () => {
      if (missionRouteEdges.length === 0) return [];
      return orderedSpotsFromMissionFlow(
        visibleSpots,
        activeMissionFlowNodes,
        missionRouteEdges,
      );
    },
    [activeMissionFlowNodes, missionRouteEdges, visibleSpots],
  );
  const missionRouteExecutionSpots = useMemo(
    () => {
      if (missionRouteEdges.length === 0) return [];
      return missionStepSpotsFromMissionFlow(
        visibleSpots,
        activeMissionFlowNodes,
        missionRouteEdges,
      );
    },
    [activeMissionFlowNodes, missionRouteEdges, visibleSpots],
  );
  const missionRouteClosed = (
    missionRouteExecutionSpots.length > missionRouteOrderedSpots.length
    && missionRouteExecutionSpots.length > 2
    && missionRouteExecutionSpots[0]?.id
      === missionRouteExecutionSpots[missionRouteExecutionSpots.length - 1]?.id
  );
  const missionRouteOrder = useMemo(
    () => (
      missionRouteOrderedSpots.map((spot, index) => ({
        id: spot.id,
        order: index + 1,
      }))
    ),
    [missionRouteOrderedSpots],
  );
  const missionRouteTreeSpots = useMemo(() => {
    if (missionRouteOrderedSpots.length > 0) return missionRouteOrderedSpots;
    if (!missionRouteSourceId) return [];
    const sourceSpot = visibleSpots.find((spot) => spot.id === missionRouteSourceId);
    return sourceSpot ? [sourceSpot] : [];
  }, [missionRouteOrderedSpots, missionRouteSourceId, visibleSpots]);
  const designPanelSpots = useMemo(
    () => (designDocumentReady ? spots : []),
    [designDocumentReady, spots],
  );
  const designPanelBehaviorNodes = useMemo(
    () => (designDocumentReady ? activeBehaviorNodes : []),
    [activeBehaviorNodes, designDocumentReady],
  );
  const designPanelRouteSpots = useMemo(
    () => (designDocumentReady ? missionRouteTreeSpots : []),
    [designDocumentReady, missionRouteTreeSpots],
  );
  const designPanelRouteClosed = designDocumentReady && missionRouteClosed;
  const selectedBtLayerSpot = useMemo(
    () => visibleSpots.find((spot) => spot.id === btLayerSpotId) || null,
    [btLayerSpotId, visibleSpots],
  );
  const localBtDirectoryBySpotId = useMemo(
    () => localBtDirectoriesForSpots(visibleSpots),
    [visibleSpots],
  );
  const selectedBtLayerDirectory = selectedBtLayerSpot
    ? localBtDirectoryBySpotId.get(selectedBtLayerSpot.id)
      || localBtDirectoryForSpot(selectedBtLayerSpot)
    : "";
  const selectedBtLayerDefaultPath = selectedBtLayerSpot
    ? localBtPathForSpot(selectedBtLayerSpot)
    : "";
  const selectedBtLayerPaths = useMemo(
    () => (selectedBtLayerSpot ? localBtPathsForSpot(selectedBtLayerSpot) : []),
    [selectedBtLayerSpot],
  );
  const requestedBtLayerPath = selectedBtLayerSpot
    ? editingLocalBtPathBySpotId[selectedBtLayerSpot.id]
    : "";
  const selectedBtLayerPath = selectedBtLayerPaths.includes(requestedBtLayerPath)
    ? requestedBtLayerPath
    : selectedBtLayerDefaultPath;
  const designMissionIsStored = (
    designCatalog.mapName === mapName
    && designCatalog.names.includes(missionName)
  );
  const localBtFileActionsDisabled = (
    Boolean(busy)
    || designMapBusy
    || Boolean(designMissionLoadError)
  );
  const loadMissionLocalBtXml = useCallback(async (path) => {
    if (!selectedBtLayerSpot || !selectedBtLayerPaths.includes(path)) {
      throw new Error("This XML does not belong to the selected waypoint");
    }
    if (busy) throw new Error(`${busy} is already in progress`);
    if (!persistedLocalBtPathsRef.current.has(path)) {
      const content = missionBtFilesRef.current[path];
      if (typeof content !== "string") {
        throw new Error("No Waypoint Task is available at this path");
      }
      return {
        path,
        content,
        exists: true,
        revision: persistedMissionRevisionRef.current,
      };
    }
    const targetMapName = String(mapName || "").trim() || DEFAULT_MAP_NAME;
    const targetMissionName = String(missionName || "").trim() || DEFAULT_MISSION_NAME;
    const generation = designMissionLoadGenerationRef.current;
    const contentAtLoadStart = missionBtFilesRef.current[path];
    const operation = localBtFileOperationRef.current + 1;
    localBtFileOperationRef.current = operation;
    const busyLabel = "Load Waypoint Task";
    setBusy(busyLabel);
    try {
      const response = await getNavigationMissionBtFile(
        targetMapName,
        path,
        missionRequestName(targetMissionName),
      );
      if (
        designMissionLoadGenerationRef.current !== generation
        || designMapNameRef.current !== targetMapName
        || designMissionNameRef.current !== targetMissionName
      ) {
        throw new Error("Mission changed while the Waypoint Task was loading");
      }
      if (
        Number.isInteger(response?.revision)
        && response.revision !== persistedMissionRevisionRef.current
      ) {
        throw new Error("Mission changed in another session. Reload it before editing.");
      }
      if (!response?.exists || typeof response.content !== "string") {
        throw new Error(`No saved XML exists at ${path}`);
      }
      // Do not replace a valid in-memory edit with malformed disk content.
      parseBTXml(response.content);
      const current = missionBtFilesRef.current;
      if (current[path] !== contentAtLoadStart) {
        throw new Error("Waypoint Task changed while its saved file was loading");
      }
      if (current[path] !== response.content) {
        captureDesignHistory();
        const next = { ...current, [path]: response.content };
        persistedMissionBtFilesRef.current = {
          ...persistedMissionBtFilesRef.current,
          [path]: response.content,
        };
        const dirtyPaths = changedLocalBtPaths(next, persistedMissionBtFilesRef.current);
        const nextDirty = nonBtDesignDirtyRef.current || dirtyPaths.size > 0;
        missionBtFilesRef.current = next;
        dirtyLocalBtPathsRef.current = dirtyPaths;
        designBtRevisionRef.current += 1;
        designDirtyRef.current = nextDirty;
        setDesignDirty(nextDirty);
        setMissionBtFiles(next);
      } else {
        persistedMissionBtFilesRef.current = {
          ...persistedMissionBtFilesRef.current,
          [path]: response.content,
        };
        const dirtyPaths = changedLocalBtPaths(current, persistedMissionBtFilesRef.current);
        const nextDirty = nonBtDesignDirtyRef.current || dirtyPaths.size > 0;
        dirtyLocalBtPathsRef.current = dirtyPaths;
        designDirtyRef.current = nextDirty;
        setDesignDirty(nextDirty);
      }
      return response;
    } finally {
      if (localBtFileOperationRef.current === operation) {
        setBusy((current) => (current === busyLabel ? "" : current));
      }
    }
  }, [
    busy,
    captureDesignHistory,
    mapName,
    missionName,
    selectedBtLayerPaths,
    selectedBtLayerSpot,
  ]);
  const saveMissionLocalBtXml = useCallback(async (path, content) => {
    if (!selectedBtLayerSpot || !selectedBtLayerPaths.includes(path)) {
      throw new Error("This XML does not belong to the selected waypoint");
    }
    if (busy) throw new Error(`${busy} is already in progress`);
    if (designMissionLoadError) {
      throw new Error("Reload the mission before saving its Waypoint Task");
    }
    const current = missionBtFilesRef.current;
    if (current[path] !== content) {
      captureDesignHistory();
      const next = { ...current, [path]: content };
      missionBtFilesRef.current = next;
      designBtRevisionRef.current += 1;
      const dirtyPaths = changedLocalBtPaths(next, persistedMissionBtFilesRef.current);
      dirtyLocalBtPathsRef.current = dirtyPaths;
      designDirtyRef.current = true;
      setDesignDirty(true);
      setMissionBtFiles(next);
    }
    if (!persistedLocalBtPathsRef.current.has(path)) {
      const saveMission = saveDesignMissionRef.current;
      if (typeof saveMission !== "function") {
        throw new Error("Mission save is not ready yet");
      }
      await saveMission(missionName);
      const canonicalPath = canonicalLocalBtPathForSpot(
        selectedBtLayerSpot,
        selectedBtLayerDirectory,
      );
      const savedPath = persistedLocalBtPathsRef.current.has(path)
        ? path
        : canonicalPath;
      if (!persistedLocalBtPathsRef.current.has(savedPath)) {
        throw new Error("Failed to register this Waypoint Task. Reload the mission and retry.");
      }
      return {
        path: savedPath,
        content,
        exists: true,
        revision: persistedMissionRevisionRef.current,
      };
    }
    const targetMapName = String(mapName || "").trim() || DEFAULT_MAP_NAME;
    const targetMissionName = String(missionName || "").trim() || DEFAULT_MISSION_NAME;
    const generation = designMissionLoadGenerationRef.current;
    const operation = localBtFileOperationRef.current + 1;
    localBtFileOperationRef.current = operation;
    const busyLabel = "Save Waypoint Task";
    setBusy(busyLabel);
    try {
      const response = await saveNavigationMissionBtFile(
        targetMapName,
        path,
        content,
        missionRequestName(targetMissionName),
        {
          waypointId: selectedBtLayerSpot.id,
          expectedRevision: persistedMissionRevisionRef.current,
        },
      );
      if (
        designMissionLoadGenerationRef.current !== generation
        || designMapNameRef.current !== targetMapName
        || designMissionNameRef.current !== targetMissionName
      ) {
        return response;
      }
      persistedMissionBtFilesRef.current = {
        ...persistedMissionBtFilesRef.current,
        [path]: content,
      };
      if (Number.isInteger(response?.revision)) {
        persistedMissionRevisionRef.current = response.revision;
      }
      const dirtyPaths = changedLocalBtPaths(
        missionBtFilesRef.current,
        persistedMissionBtFilesRef.current,
      );
      const nextDirty = nonBtDesignDirtyRef.current || dirtyPaths.size > 0;
      dirtyLocalBtPathsRef.current = dirtyPaths;
      designDirtyRef.current = nextDirty;
      setDesignDirty(nextDirty);
      return response;
    } finally {
      if (localBtFileOperationRef.current === operation) {
        setBusy((current) => (current === busyLabel ? "" : current));
      }
    }
  }, [
    busy,
    captureDesignHistory,
    designMissionLoadError,
    mapName,
    missionName,
    selectedBtLayerDirectory,
    selectedBtLayerPaths,
    selectedBtLayerSpot,
  ]);
  const selectMissionLocalBtXml = useCallback((path) => {
    if (!selectedBtLayerSpot || !selectedBtLayerPaths.includes(path)) {
      throw new Error("This XML does not belong to the selected waypoint");
    }
    setEditingLocalBtPathBySpotId((current) => ({
      ...current,
      [selectedBtLayerSpot.id]: path,
    }));
  }, [selectedBtLayerPaths, selectedBtLayerSpot]);
  const saveMissionLocalBtXmlAs = useCallback(async (_sourcePath, fileName, content) => {
    if (busy) throw new Error(`${busy} is already in progress`);
    if (designMissionLoadError) {
      throw new Error("Reload the mission before saving its Waypoint Task");
    }
    if (!selectedBtLayerSpot) throw new Error("Select a waypoint first");
    if (
      !designMissionIsStored
      || !persistedLocalBtPathsRef.current.has(selectedBtLayerDefaultPath)
    ) {
      const saveMission = saveDesignMissionRef.current;
      if (typeof saveMission !== "function") {
        throw new Error("Mission save is not ready yet");
      }
      await saveMission(missionName);
      const canonicalPath = canonicalLocalBtPathForSpot(
        selectedBtLayerSpot,
        selectedBtLayerDirectory,
      );
      if (!persistedLocalBtPathsRef.current.has(canonicalPath)) {
        throw new Error("Failed to register this Waypoint Task. Reload the mission and retry.");
      }
    }

    const targetPath = localBtSaveAsPath(
      selectedBtLayerSpot,
      fileName,
      selectedBtLayerDirectory,
    );
    const occupiedPaths = new Set([
      ...visibleSpots.flatMap((spot) => localBtPathsForSpot(spot)),
      ...Object.keys(missionBtFilesRef.current),
      ...persistedLocalBtPathsRef.current,
    ].map((path) => String(path).toLowerCase()));
    if (occupiedPaths.has(targetPath.toLowerCase())) {
      throw new Error(`A Waypoint Task named ${targetPath.split("/").pop()} already exists`);
    }

    const targetMapName = String(mapName || "").trim() || DEFAULT_MAP_NAME;
    const targetMissionName = String(missionName || "").trim() || DEFAULT_MISSION_NAME;
    const targetSpotId = selectedBtLayerSpot.id;
    const generation = designMissionLoadGenerationRef.current;
    const operation = localBtFileOperationRef.current + 1;
    localBtFileOperationRef.current = operation;
    const busyLabel = "Save Waypoint Task as";
    setBusy(busyLabel);
    try {
      const response = await saveNavigationMissionBtFile(
        targetMapName,
        targetPath,
        content,
        missionRequestName(targetMissionName),
        {
          waypointId: targetSpotId,
          expectedRevision: persistedMissionRevisionRef.current,
        },
      );
      if (
        designMissionLoadGenerationRef.current !== generation
        || designMapNameRef.current !== targetMapName
        || designMissionNameRef.current !== targetMissionName
      ) {
        throw new Error("Mission changed while the Waypoint Task was being saved");
      }

      captureDesignHistory();
      const nextFiles = { ...missionBtFilesRef.current, [targetPath]: content };
      missionBtFilesRef.current = nextFiles;
      persistedMissionBtFilesRef.current = {
        ...persistedMissionBtFilesRef.current,
        [targetPath]: content,
      };
      if (Number.isInteger(response?.revision)) {
        persistedMissionRevisionRef.current = response.revision;
      }
      persistedLocalBtPathsRef.current = new Set([
        ...persistedLocalBtPathsRef.current,
        targetPath,
      ]);
      dirtyLocalBtPathsRef.current = changedLocalBtPaths(
        nextFiles,
        persistedMissionBtFilesRef.current,
      );
      designBtRevisionRef.current += 1;
      setMissionBtFiles(nextFiles);
      setSpots((current) => current.map((spot) => (
        spot.id === targetSpotId
          ? withLocalBtLibrary(
            spot,
            localBtPathForSpot(spot),
            [...localBtPathsForSpot(spot), targetPath],
          )
          : spot
      )));
      setEditingLocalBtPathBySpotId((current) => ({
        ...current,
        [targetSpotId]: targetPath,
      }));
      const nextDirty = (
        nonBtDesignDirtyRef.current
        || dirtyLocalBtPathsRef.current.size > 0
      );
      designDirtyRef.current = nextDirty;
      setDesignDirty(nextDirty);
      return { ...response, path: targetPath, selected: true };
    } finally {
      if (localBtFileOperationRef.current === operation) {
        setBusy((current) => (current === busyLabel ? "" : current));
      }
    }
  }, [
    busy,
    captureDesignHistory,
    designMissionIsStored,
    designMissionLoadError,
    mapName,
    missionName,
    selectedBtLayerDirectory,
    selectedBtLayerDefaultPath,
    selectedBtLayerSpot,
    visibleSpots,
  ]);
  const setMissionLocalBtDefault = useCallback(async (path) => {
    if (!selectedBtLayerSpot || !selectedBtLayerPaths.includes(path)) {
      throw new Error("This XML does not belong to the selected waypoint");
    }
    if (path === selectedBtLayerDefaultPath) return;
    if (busy) throw new Error(`${busy} is already in progress`);
    if (designMissionLoadError) {
      throw new Error("Reload the mission before changing its default Waypoint Task");
    }
    if (!designMissionIsStored || !persistedLocalBtPathsRef.current.has(path)) {
      throw new Error("Save Mission before changing its default Waypoint Task");
    }

    const targetMapName = String(mapName || "").trim() || DEFAULT_MAP_NAME;
    const targetMissionName = String(missionName || "").trim() || DEFAULT_MISSION_NAME;
    const targetSpotId = selectedBtLayerSpot.id;
    const generation = designMissionLoadGenerationRef.current;
    const operation = localBtFileOperationRef.current + 1;
    localBtFileOperationRef.current = operation;
    const busyLabel = "Set default Waypoint Task";
    setBusy(busyLabel);
    try {
      const response = await setNavigationMissionDefaultBtFile(
        targetMapName,
        targetSpotId,
        path,
        missionRequestName(targetMissionName),
        { expectedRevision: persistedMissionRevisionRef.current },
      );
      if (
        designMissionLoadGenerationRef.current !== generation
        || designMapNameRef.current !== targetMapName
        || designMissionNameRef.current !== targetMissionName
      ) {
        throw new Error("Mission changed while its default Waypoint Task was being updated");
      }
      setSpots((current) => current.map((spot) => (
        spot.id === targetSpotId
          ? withLocalBtLibrary(spot, path, localBtPathsForSpot(spot))
          : spot
      )));
      if (Number.isInteger(response?.revision)) {
        persistedMissionRevisionRef.current = response.revision;
      }
      // Changing the default is an immediate persistence boundary. Clear
      // snapshots from before it so Undo cannot make the UI look clean while
      // the server still points at the newly selected default.
      resetDesignHistory();
      const nextDirty = (
        nonBtDesignDirtyRef.current
        || dirtyLocalBtPathsRef.current.size > 0
      );
      designDirtyRef.current = nextDirty;
      setDesignDirty(nextDirty);
      setMessage(`${path.split("/").pop()} set as the default Waypoint Task`);
      return response;
    } finally {
      if (localBtFileOperationRef.current === operation) {
        setBusy((current) => (current === busyLabel ? "" : current));
      }
    }
  }, [
    busy,
    designMissionIsStored,
    designMissionLoadError,
    mapName,
    missionName,
    resetDesignHistory,
    selectedBtLayerDefaultPath,
    selectedBtLayerPaths,
    selectedBtLayerSpot,
  ]);
  const btActiveNodeNames = useMemo(() => (
    btActiveNodesText
      .split(",")
      .map((name) => name.trim())
      .filter(Boolean)
  ), [btActiveNodesText]);

  // ── Mission runner (Run stage): navigate → run waypoint BT → advance ──────
  const { callService } = useRosServiceCaller();
  const resolveMissionBtXml = useCallback(
    (spot) => (spot ? activeMissionBtFiles[localBtPathForSpot(spot)] : ""),
    [activeMissionBtFiles],
  );
  const sendMissionGoal = useCallback(async (x, y, yaw, signal) => {
    const poseStamped = {
      header: { frame_id: "map", stamp: rosTimestampNow() },
      pose: { position: { x, y, z: 0 }, orientation: orientationFromYaw(yaw) },
    };
    return sendNavigateToPoseGoalAndWait({ pose: poseStamped }, signal);
  }, []);
  const sendMissionGoals = useCallback(async (goals, signal) => {
    const poses = goals.map(({ x, y, yaw }) => ({
      header: { frame_id: "map", stamp: rosTimestampNow() },
      pose: { position: { x, y, z: 0 }, orientation: orientationFromYaw(yaw) },
    }));
    return sendNavigateThroughPosesGoalsAndWait({ poses }, signal);
  }, []);

  // ── Navigate stage: direct point-to-point goal (no mission) ───────────────
  const [navGoalPose, setNavGoalPose] = useState(null);
  // idle | driving | reached | failed
  const [navGoalStatus, setNavGoalStatus] = useState("idle");
  const navGoalSeqRef = useRef(0);
  const navGoalDriving = navGoalStatus === "driving";

  const handleSendNavGoal = useCallback(async (x, y, yaw) => {
    const seq = navGoalSeqRef.current + 1;
    navGoalSeqRef.current = seq;
    setNavGoalPose({
      pose: { position: { x, y, z: 0 }, orientation: orientationFromYaw(yaw) },
    });
    setNavGoalStatus("driving");
    // One-shot arm: return to view mode so OrbitControls (scroll zoom) work
    // while the camera follows the drive, and a stray click cannot send a
    // second goal. Re-arm Set Goal for the next target.
    setInteractionMode("view");
    setMessage(`Goal ${x.toFixed(2)}, ${y.toFixed(2)}`);
    try {
      const result = await sendMissionGoal(x, y, yaw);
      if (navGoalSeqRef.current !== seq) return;
      // /goal/wait resolves 200 even for ABORTED/REJECTED/CANCELED/TIMEOUT —
      // only SUCCEEDED means the robot actually arrived.
      const status = String(result?.status || "").toUpperCase();
      if (result?.ok === false || (status && status !== "SUCCEEDED")) {
        setNavGoalStatus("failed");
        setMessage(result?.message || `Navigation goal ${status || "failed"}`);
        return;
      }
      setNavGoalStatus("reached");
      setMessage("Goal reached");
    } catch (error) {
      if (navGoalSeqRef.current !== seq) return;
      setNavGoalStatus("failed");
      setMessage(error instanceof Error ? error.message : "Navigation goal failed");
    }
  }, [sendMissionGoal]);
  const stopMissionBt = useCallback(async () => {
    const result = await callService(
      "/bt/set_running",
      "std_srvs/srv/SetBool",
      { data: false },
    );
    if (result?.success === false) {
      throw new Error(taskDisplayMessage(result.message) || "Task Engine stop rejected");
    }
    return result;
  }, [callService]);
  const missionRunnerFlags = useCallback(
    () => ({ navRunning: running, btNodeIsUp }),
    [btNodeIsUp, running],
  );
  // Run borrows an already-up BT node, or owns the process only when it starts
  // one on demand. Cleanup must never stop a node owned by the standalone
  // workspace (or another external client).
  const ensureMissionBtActive = useCallback(async () => {
    // A completed/failed mission releases bt_node asynchronously. Serialize a
    // quick retry behind that shutdown so an old stop cannot kill the new node.
    await btNodeReleaseRef.current;
    const readState = async () => {
      try {
        const status = await getBtNodeServiceStatus();
        setBtNodeStatus(status);
        return status.state;
      } catch {
        return "unknown";
      }
    };
    const servicesAreReady = async () => {
      try {
        // /bt/nodes/catalog is created after /bt/load_and_run in bt_node's
        // constructor. A successful response is therefore a readiness barrier
        // for the mutating service used immediately after navigation arrives.
        const result = await callService(
          "/bt/nodes/catalog",
          "interfaces/srv/GetNodeCatalog",
          {},
          BT_NODE_READY_PROBE_TIMEOUT_MS,
        );
        return result?.success !== false;
      } catch {
        return false;
      }
    };

    setBtNodeBusy("activate");
    try {
      const initialState = await readState();
      missionBtNodeOwnedRef.current = false;
      if (initialState === "up") {
        const executionStatus = String(btStatusRef.current || "").trim().toLowerCase();
        if (executionStatus === "running" || executionStatus === "stopping") {
          setMessage("Task Engine is already running another task. Stop it before running this mission.");
          return false;
        }
        if (!["stopped", "completed", "failed"].includes(executionStatus)) {
          // Failing closed is intentional: /bt/load_and_run replaces the
          // current tree, so an unknown status must not be treated as idle.
          setMessage("Unable to verify that the Task Engine is idle. Wait for its status and try again.");
          return false;
        }
      }
      if (initialState !== "up" && initialState !== "down") {
        setMessage("Unable to verify the Task Engine state. Try again after its status is available.");
        return false;
      }
      if (initialState === "down") {
        await setBtNodeServiceActive(true);
        missionBtNodeOwnedRef.current = true;
      }
      for (let attempt = 0; attempt < BT_NODE_ACTIVATION_POLL_ATTEMPTS; attempt += 1) {
        if ((await readState()) === "up" && await servicesAreReady()) return true;
        await delay(BT_NODE_ACTIVATION_POLL_MS);
      }
      return false;
    } catch {
      return false;
    } finally {
      setBtNodeBusy("");
    }
  }, [callService]);
  const releaseMissionBt = useCallback(async () => {
    const release = (async () => {
      if (!missionBtNodeOwnedRef.current) {
        try {
          setBtNodeStatus(await getBtNodeServiceStatus());
        } catch {
          setBtNodeStatus({ state: "unknown", raw: "status failed" });
        }
        return;
      }
      // Clear ownership before the request so duplicate cleanup paths cannot
      // stop a process that a later run has already borrowed or restarted.
      missionBtNodeOwnedRef.current = false;
      setBtNodeBusy("deactivate");
      try {
        await setBtNodeServiceActive(false);
      } catch {
        // Best-effort — the node may already be down.
      }
      try {
        setBtNodeStatus(await getBtNodeServiceStatus());
      } catch {
        setBtNodeStatus({ state: "unknown", raw: "status failed" });
      } finally {
        setBtNodeBusy("");
      }
    })();
    btNodeReleaseRef.current = release;
    await release;
  }, []);
  const missionRunner = useMissionRunner({
    // A closed route intentionally contains the start waypoint a second time
    // as its final execution step. Keep the unique list for badges/editing,
    // but give the runner the full traversal so last -> start is sent to Nav2.
    orderedSpots: missionRouteExecutionSpots,
    resolveBtXml: resolveMissionBtXml,
    btStatusRef,
    callService,
    sendGoal: sendMissionGoal,
    sendGoals: sendMissionGoals,
    cancelGoal: cancelNavigateToPoseGoal,
    stopBt: stopMissionBt,
    ensureBtActive: ensureMissionBtActive,
    releaseBt: releaseMissionBt,
    getFlags: missionRunnerFlags,
    onMessage: setMessage,
  });
  const missionRunnerActive = missionRunner.isRunning;
  const missionRunnerStopping = (
    missionRunnerActive && missionRunner.status === RunnerStatus.CANCELLED
  );
  const missionFollowRobot = (
    missionRunnerActive
    && (missionRunner.phase === "nav-sent" || missionRunner.phase === "awaiting-nav-result")
  ) || (workspaceStage === STAGE_NAVIGATE && navGoalStatus === "driving");

  const waypointBtEditor = selectedBtLayerSpot ? (
    <MissionBtEditor
      title={`${selectedBtLayerSpot.label || selectedBtLayerSpot.id} Waypoint Task`}
      filePath={selectedBtLayerPath}
      fileOptions={selectedBtLayerPaths}
      defaultFilePath={selectedBtLayerDefaultPath}
      xml={missionBtFiles[selectedBtLayerPath] || defaultLocalBtXml(selectedBtLayerSpot)}
      loading={missionBtLoadingPath === selectedBtLayerPath}
      activeNodeNames={[]}
      onLoadXml={loadMissionLocalBtXml}
      onSaveXml={saveMissionLocalBtXml}
      onFilePathChange={selectMissionLocalBtXml}
      onSaveXmlAs={saveMissionLocalBtXmlAs}
      onSetDefaultXml={setMissionLocalBtDefault}
      fileActionsDisabled={localBtFileActionsDisabled}
      onXmlChange={(path, nextXml) => {
        if (!path) return;
        const current = missionBtFilesRef.current;
        // Until the server fetch resolves this path, the editor only holds the
        // fallback tree. A hydration emission must never claim that slot.
        if (current[path] === undefined || current[path] === nextXml) return;
        captureDesignHistory();
        const next = { ...current, [path]: nextXml };
        // Keep an event-synchronous snapshot for Save. React state and the
        // Save-button closure may still represent the previous render when a
        // field loses focus and the button is clicked immediately afterward.
        missionBtFilesRef.current = next;
        designBtRevisionRef.current += 1;
        const dirtyPaths = changedLocalBtPaths(next, persistedMissionBtFilesRef.current);
        const nextDirty = nonBtDesignDirtyRef.current || dirtyPaths.size > 0;
        dirtyLocalBtPathsRef.current = dirtyPaths;
        designDirtyRef.current = nextDirty;
        setDesignDirty(nextDirty);
        setMissionBtFiles(next);
      }}
    />
  ) : null;
  const waypointBtLayer = (
    workspaceStage === STAGE_AUTHORING &&
    selectedBtLayerSpot
  ) ? {
      spot: selectedBtLayerSpot,
      editor: waypointBtEditor,
    }
    : null;
  // While the runner is executing a waypoint's BT, surface a read-only view of
  // that tree beside the map with the ticking node glowing.
  const runActiveSpot = (
    workspaceStage === STAGE_RUN
    && missionRunner.status === RunnerStatus.RUNNING_BT
    && missionRunner.activeSpotId
  )
    ? visibleSpots.find((spot) => spot.id === missionRunner.activeSpotId) || null
    : null;
  const runBtLayer = runActiveSpot ? {
    spot: runActiveSpot,
    editor: (
      <MissionBtRunView
        xml={runMissionBtFiles[localBtPathForSpot(runActiveSpot)] || defaultLocalBtXml(runActiveSpot)}
        activeNodeNames={btActiveNodeNames}
      />
    ),
  } : null;
  const activeBtLayer = waypointBtLayer || runBtLayer;
  const runBtViewActive = !!runActiveSpot;

  useEffect(() => {
    setRunBtVisualizationActive(runBtViewActive);
  }, [runBtViewActive]);

  useEffect(() => {
    if (workspaceStage !== STAGE_AUTHORING) return;
    setMissionFlowNodes((current) => syncMissionFlowNodesWithSpots(current, visibleSpots));
    setMissionFlowEdges((current) => filterMissionFlowEdges(current, visibleSpots));
  }, [setMissionFlowEdges, setMissionFlowNodes, visibleSpots, workspaceStage]);

  useEffect(() => {
    if (workspaceStage === STAGE_AUTHORING && designMapAvailable) {
      return;
    }
    setMissionRouteMode(false);
    setMissionRouteSourceId("");
  }, [designMapAvailable, workspaceStage]);

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
  const topicRows = useMemo(() => {
    const liveByTopic = {
      "/map": !!map,
      "/scan": !!scan,
      "/pose": !!slamPose,
      "/odom": !!odometry,
      "/amcl_pose": !!amclPose,
      "/tf": !!(tf?.transforms?.length),
      "/tf_static": !!(tfStatic?.transforms?.length),
      "/local_costmap/published_footprint": !!(footprint?.polygon?.points?.length),
      "/global_costmap/costmap": !!globalCostmap,
      "/local_costmap/costmap": !!localCostmap,
      "/plan": !!plan,
      "/bt/status": hasTopicMessage(btStatusData) || btNodeIsUp,
      "/bt/active_nodes": hasTopicMessage(btActiveNodesData) || btNodeIsUp,
    };
    const selectedTopics = new Set(STAGE_EXTRA_TOPIC_IDS[workspaceStage] || []);
    (STAGE_LAYER_IDS[workspaceStage] || []).forEach((layerId) => {
      if (!activeLayers[layerId]) return;
      (LAYER_TOPIC_IDS[layerId] || []).forEach((topic) => selectedTopics.add(topic));
    });
    const robotPoseLayerActive = (
      !!activeLayers.scan || !!activeLayers.robotModel || !!activeLayers.tf
    );
    if (workspaceStage === STAGE_MAPPING && robotPoseLayerActive) {
      selectedTopics.add("/pose");
      selectedTopics.add("/odom");
    }
    if (runFamilyStage && robotPoseLayerActive) {
      selectedTopics.add("/amcl_pose");
    }
    if (workspaceStage === STAGE_AUTHORING && !designLocalizationActive) {
      selectedTopics.delete("/map");
      selectedTopics.delete("/scan");
      selectedTopics.delete("/amcl_pose");
      selectedTopics.delete("/tf");
      selectedTopics.delete("/tf_static");
      selectedTopics.delete("/local_costmap/published_footprint");
    }
    if (designLocalizationActive) {
      ["/scan", "/amcl_pose", "/tf", "/tf_static", "/local_costmap/published_footprint"].forEach((topic) => {
        selectedTopics.add(topic);
      });
    }
    return TOPIC_ORDER.filter((topic) => selectedTopics.has(topic)).map((topic) => ({
      topic,
      isLive: !!liveByTopic[topic],
    }));
  }, [
    activeLayers,
    amclPose,
    btActiveNodesData,
    btStatusData,
    btNodeIsUp,
    footprint,
    globalCostmap,
    localCostmap,
    map,
    odometry,
    plan,
    scan,
    slamPose,
    tf,
    tfStatic,
    workspaceStage,
    designLocalizationActive,
  ]);
  const teleopDisabled = !!busy || mappingEditorActive;

  const loadStatus = useCallback(async () => {
    if (
      runShutdownPending
      || statusLoadingRef.current
      || document.visibilityState === "hidden"
    ) {
      return;
    }
    statusLoadingRef.current = true;
    try {
      const nextStatus = await getServiceStatus();
      const statusMode = navigationRuntimeModeFromStatus(nextStatus);
      setStatus(nextStatus);
      if (statusMode) {
        setNavigationRuntimeMode(statusMode);
        if (statusMode === "idle") setDesignPoseInitialized(false);
        if (statusMode === "mapping" || statusMode === "localization") {
          setRunRuntimeOwned(false);
        }
      }
    } catch {
      setStatus((current) => current);
    } finally {
      statusLoadingRef.current = false;
    }
  }, [runShutdownPending]);

  const refreshBtNodeStatus = useCallback(async ({ quiet = false } = {}) => {
    try {
      const nextStatus = await getBtNodeServiceStatus();
      setBtNodeStatus(nextStatus);
      return nextStatus;
    } catch (error) {
      const nextStatus = {
        state: "unknown",
        raw: error instanceof Error ? error.message : "status failed",
      };
      setBtNodeStatus(nextStatus);
      if (!quiet) {
        setMessage(error instanceof Error
          ? `Task Engine status check failed: ${taskDisplayMessage(error.message)}`
          : "Task Engine status check failed");
      }
      return nextStatus;
    }
  }, []);

  const applySpots = useCallback((nextSpots) => {
    setSpots(nextSpots);
    setSelectedSpotId((current) => (
      nextSpots.some((spot) => spot.id === current) ? current : ""
    ));
    setBtLayerSpotId((current) => (
      nextSpots.some((spot) => spot.id === current) ? current : ""
    ));
  }, []);

  const loadLegacySpotsForMap = useCallback(async (targetMapName, { apply = true } = {}) => {
    const normalizedMapName = String(targetMapName || "").trim() || DEFAULT_MAP_NAME;
    const generation = legacySpotLoadGenerationRef.current + 1;
    legacySpotLoadGenerationRef.current = generation;
    const result = await getNavigationSpots(normalizedMapName);
    const nextSpots = result.spots || [];
    if (apply && legacySpotLoadGenerationRef.current === generation) {
      applySpots(nextSpots);
    }
    return nextSpots;
  }, [applySpots]);

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

  // A keepalive request may still be dropped while a document is unloading.
  // Confirm a pending Run shutdown before status polling is allowed to restore
  // the backend's stale "run" state in the new document.
  useEffect(() => {
    if (!runShutdownPending) {
      runShutdownConfirmationRef.current = null;
      return undefined;
    }
    let cancelled = false;
    if (!runShutdownConfirmationRef.current) {
      runShutdownConfirmationRef.current = stopNavigation();
    }
    const confirmation = runShutdownConfirmationRef.current;
    const confirmRunShutdown = () => {
      confirmation
        .then(() => {
          if (cancelled) return;
          setStatus({ is_up: false, mode: "idle" });
          setNavigationRuntimeMode("idle");
          setRunPoseInitialized(false);
          setRunRuntimeOwned(false);
          setRunShutdownPending(false);
          saveMissionSession({
            navigationRuntimeMode: "idle",
            designPoseInitialized: false,
            runRuntimeOwned: false,
            runShutdownPending: false,
            runShutdownRequestedAt: null,
          });
        })
        .catch((error) => {
          if (cancelled) return;
          setMessage(error instanceof Error
            ? `Failed to stop the previous Run session: ${error.message}`
            : "Failed to stop the previous Run session");
        });
    };
    confirmRunShutdown();
    return () => {
      cancelled = true;
    };
  }, [runShutdownPending]);

  // React unmount cleanup is also used by development StrictMode and SPA page
  // changes, so only a real full-document exit should stop the Run runtime.
  // `keepalive` lets this POST outlive a refresh; the pending marker above is
  // the fallback when the browser cannot deliver it.
  useEffect(() => {
    const handlePageHide = (event) => {
      if (event.persisted === true || runPageExitStopSentRef.current) return;
      const savedSession = readMissionSession();
      const knownNonRunRuntime = (
        status?.is_up === true
        && navigationRuntimeMode !== "run"
        && savedSession.navigationRuntimeMode !== "run"
      );
      const ownsRunRuntime = (
        recentRunShutdownMarker(savedSession)
        || (!knownNonRunRuntime && savedSession.runRuntimeOwned === true)
        || (
          !knownNonRunRuntime
          && savedSession.runRuntimeOwned === undefined
          && (runRuntimeOwned || runShutdownPending)
        )
      );
      if (!ownsRunRuntime) return;
      runPageExitStopSentRef.current = true;
      saveMissionSession({
        navigationRuntimeMode: "idle",
        designPoseInitialized: false,
        runRuntimeOwned: true,
        runShutdownPending: true,
        runShutdownRequestedAt: Date.now(),
      });
      void stopNavigation({ keepalive: true }).catch(() => {});
    };
    window.addEventListener("pagehide", handlePageHide);
    return () => window.removeEventListener("pagehide", handlePageHide);
  }, [navigationRuntimeMode, runRuntimeOwned, runShutdownPending, status]);

  useEffect(() => {
    if (!needsBtTopics || document.visibilityState === "hidden") return undefined;
    void refreshBtNodeStatus({ quiet: true });
    const interval = window.setInterval(() => {
      void refreshBtNodeStatus({ quiet: true });
    }, BT_NODE_STATUS_POLL_MS);
    return () => {
      window.clearInterval(interval);
    };
  }, [needsBtTopics, refreshBtNodeStatus]);

  useEffect(() => {
    if (!btLayerSpotId) return;
    if (
      workspaceStage !== STAGE_AUTHORING ||
      !visibleSpots.some((spot) => spot.id === btLayerSpotId)
    ) {
      setBtLayerSpotId("");
    }
  }, [btLayerSpotId, visibleSpots, workspaceStage]);

  useEffect(() => {
    if (!selectedBtLayerSpot || !selectedBtLayerPath) return undefined;
    if (missionBtFiles[selectedBtLayerPath] !== undefined) return undefined;
    let cancelled = false;
    setMissionBtLoadingPath(selectedBtLayerPath);
    getNavigationMissionBtFile(
      currentMapName,
      selectedBtLayerPath,
      missionRequestName(missionName),
    )
      .then((response) => {
        if (cancelled) return;
        setMissionBtFiles((current) => ({
          ...current,
          [selectedBtLayerPath]: response?.exists && typeof response.content === "string"
            ? response.content
            : defaultLocalBtXml(selectedBtLayerSpot),
        }));
      })
      .catch((error) => {
        if (cancelled) return;
        setMessage(error instanceof Error
          ? `Failed to load ${selectedBtLayerPath}: ${taskDisplayMessage(error.message)}`
          : `Failed to load ${selectedBtLayerPath}`);
      })
      .finally(() => {
        if (!cancelled) setMissionBtLoadingPath("");
      });
    return () => {
      cancelled = true;
      // A cancelled fetch can no longer clear its own flag, and the re-run may
      // early-return (content seeded by another writer) — clear it here so the
      // editor can never be stranded on "Loading BT XML...".
      setMissionBtLoadingPath((current) => (current === selectedBtLayerPath ? "" : current));
    };
  }, [currentMapName, missionBtFiles, missionName, selectedBtLayerPath, selectedBtLayerSpot]);

  useEffect(() => {
    currentPoseRef.current = currentPose;
  }, [currentPose]);

  useEffect(() => {
    amclPoseRef.current = amclPose;
  }, [amclPose]);

  useEffect(() => {
    btStatusRef.current = btStatusText;
  }, [btStatusText]);

  // Localization does not survive a nav restart; require a fresh pose each time.
  useEffect(() => {
    if (!runRuntimeActive) setRunPoseInitialized(false);
  }, [runRuntimeActive]);

  // Drop live Run/Mapping maps when the backend goes down. Design uses the
  // selected PGM file, so stopping the temporary At Robot localization must
  // not unload that static map.
  useEffect(() => {
    if (
      prevRunningRef.current
      && !running
      && workspaceStage !== STAGE_AUTHORING
    ) {
      setMissionMapLoaded(false);
    }
    prevRunningRef.current = running;
  }, [running, workspaceStage]);

  useEffect(() => {
    if (runPageExitStopSentRef.current) return;
    const savedShutdownRequestedAt = Number(
      readMissionSession().runShutdownRequestedAt,
    );
    saveMissionSession({
      mapName,
      workspaceStage,
      designMapPath,
      navigationRuntimeMode,
      designPoseInitialized,
      runRuntimeOwned,
      runShutdownPending,
      runShutdownRequestedAt: runShutdownPending
        ? (
          Number.isFinite(savedShutdownRequestedAt) && savedShutdownRequestedAt > 0
            ? savedShutdownRequestedAt
            : Date.now()
        )
        : null,
      missionName,
      runMissionName,
    });
  }, [designMapPath, designPoseInitialized, mapName, missionName, navigationRuntimeMode, runMissionName, runRuntimeOwned, runShutdownPending, workspaceStage]);

  useEffect(() => {
    if (!designLocalizationActive || !designPoseInitialized) {
      return undefined;
    }
    let cancelled = false;
    const tick = async () => {
      if (cancelled || nomotionUpdateBusyRef.current) return;
      nomotionUpdateBusyRef.current = true;
      try {
        await requestNoMotionUpdate();
      } catch (error) {
        console.warn("No-motion AMCL update failed:", error);
      } finally {
        nomotionUpdateBusyRef.current = false;
      }
    };
    void tick();
    const interval = window.setInterval(tick, NOMOTION_UPDATE_INTERVAL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [designLocalizationActive, designPoseInitialized]);

  useEffect(() => {
    if (updateTfBuffer(tfBufferRef.current, latestTf)) {
      setTfBufferRevision((value) => value + 1);
    }
  }, [latestTf]);

  const clearLocalizationPoseCache = useCallback(() => {
    tfBufferRef.current.clear();
    currentPoseRef.current = null;
    amclPoseRef.current = null;
    setTfBufferRevision((value) => value + 1);
  }, []);

  useEffect(() => {
    if (!mappingEditorActive || !mapEditor.selectedPath) return;
    const loadedMapName = mapNameFromPgmPath(mapEditor.selectedPath);
    if (loadedMapName !== currentMapName) {
      setMapName(loadedMapName);
    }
  }, [currentMapName, mapEditor.selectedPath, mappingEditorActive]);

  const runCommand = useCallback(async (label, action) => {
    setBusy(label);
    try {
      const result = await action();
      if (typeof result === "string") {
        setMessage(taskDisplayMessage(result));
      } else {
        setMessage(taskDisplayMessage(result?.message) || `${label} complete`);
      }
    } catch (error) {
      setMessage(error instanceof Error ? taskDisplayMessage(error.message) : `${label} failed`);
    } finally {
      setBusy("");
      void loadStatus();
    }
  }, [loadStatus]);

  const publishTeleopCommand = useCallback((motion) => (
    publishRosTopic(TELEOP_TOPIC, TELEOP_MESSAGE_TYPE, teleopTwist(motion))
  ), [publishRosTopic]);

  const loadSavedDesignForMap = useCallback((targetMapName) => {
    const savedNodes = savedBehaviorNodesForMap(targetMapName);
    if (!savedNodes) return false;
    setBehaviorNodes((current) => [
      ...current.filter((node) => node.map_name !== targetMapName),
      ...savedNodes,
    ]);
    behaviorNodeSerialRef.current = Math.max(
      behaviorNodeSerialRef.current,
      behaviorNodeSerialFromNodes(savedNodes),
    );
    return true;
  }, []);

  const loadMissionBtFileOrDefault = useCallback(async (
    targetMapName,
    targetMissionName,
    path,
    fallback,
    expectedRevision,
  ) => {
    const response = await getNavigationMissionBtFile(
      targetMapName,
      path,
      missionRequestName(targetMissionName),
    );
    if (
      Number.isInteger(expectedRevision)
      && Number.isInteger(response?.revision)
      && response.revision !== expectedRevision
    ) {
      throw new Error(
        `Mission changed while loading ${path}; reload the mission before editing or running it`,
      );
    }
    if (response?.exists && typeof response.content === "string") {
      return response.content;
    }
    return fallback;
  }, []);

  const loadMissionBtFilesForSpots = useCallback(async (
    targetMapName,
    targetMissionName,
    spotsForMission,
    manifest = {},
    routeSpots = spotsForMission,
  ) => {
    const defaults = missionBtFileDefaultsForSpots(spotsForMission);
    const globalPath = manifest.global_bt || "global.xml";
    const expectedRevision = Number.isInteger(manifest.revision) ? manifest.revision : 0;
    defaults[globalPath] = buildGlobalMissionXml(routeSpots);
    const loadedEntries = await Promise.all(
      Object.entries(defaults).map(async ([path, fallback]) => [
        path,
        await loadMissionBtFileOrDefault(
          targetMapName,
          targetMissionName,
          path,
          fallback,
          expectedRevision,
        ),
      ]),
    );
    return Object.fromEntries(loadedEntries);
  }, [loadMissionBtFileOrDefault]);

  // Server truth only — no phantom "default" injection. An empty list means the
  // map has no missions yet; dialogs then offer a "default (new)" starter.
  const fetchMissionNames = useCallback(async (targetMapName) => {
    const response = await getNavigationMissions(targetMapName);
    return Array.isArray(response?.missions) ? response.missions : [];
  }, []);

  const loadMissionForMap = useCallback(async (
    targetMapName,
    { loadLegacyDesign = false, targetMissionName = missionName } = {},
  ) => {
    const normalizedMapName = String(targetMapName || "").trim() || DEFAULT_MAP_NAME;
    const normalizedMissionName = String(targetMissionName || DEFAULT_MISSION_NAME).trim()
      || DEFAULT_MISSION_NAME;
    const generation = designMissionLoadGenerationRef.current + 1;
    designMissionLoadGenerationRef.current = generation;
    try {
      const mission = await getNavigationMission(
        normalizedMapName,
        missionRequestName(normalizedMissionName),
      );
      if (mission?.exists) {
        const missionSpots = spotsFromMissionWaypoints(
          normalizedMapName,
          mission.waypoints,
        );
        const missionFlow = normalizeMissionFlow(missionSpots, mission.metadata?.mission_flow);
        const loadedBtFiles = await loadMissionBtFilesForSpots(
          normalizedMapName,
          normalizedMissionName,
          missionSpots,
          mission,
          missionStepSpotsFromMissionFlow(missionSpots, missionFlow.nodes, missionFlow.edges),
        );
        if (designMissionLoadGenerationRef.current !== generation) {
          return { exists: true, loadedDesign: false, spotCount: missionSpots.length, stale: true };
        }
        // Commit the manifest and all of its BT files as one in-memory snapshot.
        // A transient read error must not substitute one empty fallback that a
        // later Save can write over the server's real tree.
        legacySpotLoadGenerationRef.current += 1;
        applySpots(missionSpots);
        setMissionFlowNodes(missionFlow.nodes);
        setMissionFlowEdges(missionFlow.edges);
        missionBtFilesRef.current = loadedBtFiles;
        persistedMissionBtFilesRef.current = loadedBtFiles;
        persistedMissionRevisionRef.current = Number.isInteger(mission.revision)
          ? mission.revision
          : 0;
        persistedLocalBtPathsRef.current = new Set(
          missionSpots.flatMap((spot) => localBtPathsForSpot(spot)),
        );
        dirtyLocalBtPathsRef.current = new Set();
        nonBtDesignDirtyRef.current = false;
        designBtRevisionRef.current = 0;
        designNonBtRevisionRef.current = 0;
        designDirtyRef.current = false;
        setMissionBtFiles(loadedBtFiles);
        setEditingLocalBtPathBySpotId({});
        setDesignDirty(false);
        setDeletedMissionBtPaths([]);
        return {
          exists: true,
          loadedDesign: false,
          spotCount: missionSpots.length,
        };
      }
      const legacySpots = await loadLegacySpotsForMap(normalizedMapName, { apply: false });
      if (designMissionLoadGenerationRef.current !== generation) {
        return { exists: false, loadedDesign: false, spotCount: legacySpots.length, stale: true };
      }
      const loadedDesign = loadLegacyDesign
        ? loadSavedDesignForMap(normalizedMapName)
        : false;
      const missionFlow = normalizeMissionFlow(orderedMissionSpots(legacySpots));
      legacySpotLoadGenerationRef.current += 1;
      applySpots(legacySpots);
      setMissionFlowNodes(missionFlow.nodes);
      setMissionFlowEdges(missionFlow.edges);
      const defaultBtFiles = missionBtFileDefaultsForSpots(legacySpots);
      missionBtFilesRef.current = defaultBtFiles;
      persistedMissionBtFilesRef.current = {};
      persistedMissionRevisionRef.current = Number.isInteger(mission?.revision)
        ? mission.revision
        : 0;
      persistedLocalBtPathsRef.current = new Set();
      dirtyLocalBtPathsRef.current = new Set();
      nonBtDesignDirtyRef.current = false;
      designBtRevisionRef.current = 0;
      designNonBtRevisionRef.current = 0;
      designDirtyRef.current = false;
      setMissionBtFiles(defaultBtFiles);
      setEditingLocalBtPathBySpotId({});
      setDesignDirty(false);
      setDeletedMissionBtPaths([]);
      return {
        exists: false,
        loadedDesign,
        spotCount: legacySpots.length,
      };
    } catch (error) {
      // A late failure from an older selection must not poison the newer
      // mission's successfully loaded snapshot or disable its Save button.
      if (designMissionLoadGenerationRef.current !== generation) {
        return { exists: false, loadedDesign: false, spotCount: 0, stale: true };
      }
      throw error;
    }
  }, [
    applySpots,
    loadLegacySpotsForMap,
    loadMissionBtFilesForSpots,
    loadSavedDesignForMap,
    missionName,
    setMissionFlowEdges,
    setMissionFlowNodes,
  ]);
  const loadRunMissionForMap = useCallback(async (targetMapName, targetMissionName) => {
    const normalizedMapName = String(targetMapName || "").trim() || DEFAULT_MAP_NAME;
    const normalizedMissionName = String(targetMissionName || DEFAULT_MISSION_NAME).trim()
      || DEFAULT_MISSION_NAME;
    const generation = runMissionLoadGenerationRef.current + 1;
    runMissionLoadGenerationRef.current = generation;
    const mission = await getNavigationMission(
      normalizedMapName,
      missionRequestName(normalizedMissionName),
    );
    let sessionSpots;
    let sessionFlow;
    let sessionBtFiles;
    const exists = Boolean(mission?.exists);
    if (exists) {
      sessionSpots = spotsFromMissionWaypoints(normalizedMapName, mission.waypoints);
      sessionFlow = normalizeMissionFlow(sessionSpots, mission.metadata?.mission_flow);
      // Run consumes only local_bt. Alternate Design files must not make an
      // otherwise valid mission unloadable when one unused XML read fails.
      const defaults = missionBtFileDefaultsForRunSpots(sessionSpots);
      const globalPath = mission.global_bt || "global.xml";
      const expectedRevision = Number.isInteger(mission.revision) ? mission.revision : 0;
      defaults[globalPath] = buildGlobalMissionXml(
        missionStepSpotsFromMissionFlow(sessionSpots, sessionFlow.nodes, sessionFlow.edges),
      );
      const entries = await Promise.all(Object.entries(defaults).map(async ([path, fallback]) => [
        path,
        await loadMissionBtFileOrDefault(
          normalizedMapName,
          normalizedMissionName,
          path,
          fallback,
          expectedRevision,
        ),
      ]));
      sessionBtFiles = Object.fromEntries(entries);
    } else {
      sessionSpots = await loadLegacySpotsForMap(normalizedMapName, { apply: false });
      sessionFlow = normalizeMissionFlow(orderedMissionSpots(sessionSpots));
      sessionBtFiles = missionBtFileDefaultsForRunSpots(sessionSpots);
    }
    if (runMissionLoadGenerationRef.current !== generation) {
      return { exists, loadedDesign: false, spotCount: sessionSpots.length, stale: true };
    }
    setRunSpots(sessionSpots);
    setRunMissionFlowNodes(sessionFlow.nodes);
    setRunMissionFlowEdges(sessionFlow.edges);
    setRunMissionBtFiles(sessionBtFiles);
    return { exists, loadedDesign: false, spotCount: sessionSpots.length };
  }, [loadLegacySpotsForMap, loadMissionBtFileOrDefault]);


  const handleOpenDesignMapDialog = useCallback(() => {
    setWorkspaceStage(STAGE_AUTHORING);
    setShowWaypointOptions(false);
    setShowDesignMapDialog(true);
    setPendingDesignMapPath(designMapPath);
    setDesignMapBusy(true);
    setMessage("Loading saved missions");
    getPgmFiles()
      .then(async (response) => {
        const files = response.files || [];
        const existing = files.find((file) => file.path === designMapPath);
        const preferred = existing
          || files.find((file) => mapNameFromPgmPath(file.path) === currentMapName)
          || files[0];
        setDesignMapFiles(files);
        setPendingDesignMapPath(preferred?.path || "");
        if (preferred?.path) {
          const selectedMapName = mapNameFromPgmPath(preferred.path);
          const available = await fetchMissionNames(selectedMapName);
          setDesignMissionNames(available);
          setPendingDesignMissionName(
            selectedMapName === currentMapName && available.includes(missionName)
              ? missionName
              : available[0] ?? DEFAULT_MISSION_NAME,
          );
        } else {
          setDesignMissionNames([]);
          setPendingDesignMissionName("");
        }
        if (!files.length) {
          setMessage("No PGM files found");
        }
      })
      .catch((error) => {
        setMessage(error instanceof Error ? error.message : "Failed to list PGM files");
      })
      .finally(() => setDesignMapBusy(false));
  }, [currentMapName, designMapPath, fetchMissionNames, missionName]);

  const handleDesignMapChange = useCallback((nextPath) => {
    setPendingDesignMapPath(nextPath);
    const selectedMapName = mapNameFromPgmPath(nextPath);
    if (!selectedMapName) {
      setDesignMissionNames([]);
      setPendingDesignMissionName("");
      return;
    }
    setDesignMapBusy(true);
    fetchMissionNames(selectedMapName)
      .then((available) => {
        setDesignMissionNames(available);
        setPendingDesignMissionName(available[0] ?? DEFAULT_MISSION_NAME);
      })
      .catch((error) => {
        setDesignMissionNames([]);
        setPendingDesignMissionName("");
        setMessage(error instanceof Error ? error.message : "Failed to list missions");
      })
      .finally(() => setDesignMapBusy(false));
  }, [fetchMissionNames]);

  const handleConfirmDesignMap = useCallback(() => {
    if (!pendingDesignMapPath) {
      setMessage("Map file required");
      return;
    }
    const selectedMapName = mapNameFromPgmPath(pendingDesignMapPath);
    if (!selectedMapName) {
      setMessage("Map file required");
      return;
    }
    if (!pendingDesignMissionName) {
      setMessage("Mission file required");
      return;
    }
    setMapName(selectedMapName);
    setDesignMapPath(pendingDesignMapPath);
    setMissionMapLoaded(true);
    setShowDesignMapDialog(false);
    setWorkspaceStage(STAGE_AUTHORING);
    setInteractionMode("view");
    setMissionRouteMode(false);
    setMissionRouteSourceId("");
    setBtLayerSpotId("");
    setDesignMapReloadToken((value) => value + 1);
    setMissionName(pendingDesignMissionName);
    setDesignCatalog({ mapName: selectedMapName, names: designMissionNames });
    saveMissionSession({
      mapName: selectedMapName,
      workspaceStage: STAGE_AUTHORING,
      designMapPath: pendingDesignMapPath,
      navigationRuntimeMode,
    });
    setDesignMapBusy(true);
    setDesignMissionLoadError("");
    designDirtyRef.current = false;
    setDesignDirty(false);
    loadMissionForMap(selectedMapName, {
      loadLegacyDesign: true,
      targetMissionName: pendingDesignMissionName,
    })
      .then((result) => {
        if (result.stale) return;
        setDesignMissionLoadError("");
        if (result.exists) {
          setMessage(`Loaded mission ${pendingDesignMissionName} for ${selectedMapName}`);
        } else {
          setMessage(result.loadedDesign
            ? `Loaded design for ${selectedMapName}`
            : `Started new mission ${pendingDesignMissionName} for ${selectedMapName}`);
        }
        setDesignMapBusy(false);
      })
      .catch((error) => {
        const detail = error instanceof Error ? error.message : "Failed to load mission";
        setDesignMissionLoadError(detail);
        setMessage(`${detail}. Reload the mission before saving.`);
        setDesignMapBusy(false);
      });
  }, [
    designMissionNames,
    loadMissionForMap,
    navigationRuntimeMode,
    pendingDesignMapPath,
    pendingDesignMissionName,
  ]);

  const saveDesignMission = useCallback((targetMissionName) => runCommand(
    "Save mission",
    async () => {
      if (designMissionLoadError) {
        throw new Error("Waypoint Task files did not finish loading. Reload the mission before saving.");
      }
      let savedManifestRevision = persistedMissionRevisionRef.current;
      const targetIsKnown = designCatalog.mapName === currentMapName
        && designCatalog.names.includes(targetMissionName);
      if (!targetIsKnown) {
        // A deleted mission name keeps a tombstone revision outside its old
        // directory. Read that generation before the first XML upload so a
        // stale tab cannot resurrect revision 0, while still allowing an
        // operator to deliberately reuse the name as a fresh mission.
        const targetSnapshot = await getNavigationMission(
          currentMapName,
          missionRequestName(targetMissionName),
        );
        if (targetSnapshot?.exists) {
          throw new Error(
            `Mission ${targetMissionName} already exists. Reload it before saving.`,
          );
        }
        savedManifestRevision = Number.isInteger(targetSnapshot?.revision)
          ? targetSnapshot.revision
          : 0;
        persistedMissionRevisionRef.current = savedManifestRevision;
      }
      saveBehaviorNodesForMap(currentMapName, activeBehaviorNodes);
      const canonicalDirectories = localBtDirectoriesForSpots(visibleSpots);
      const canonicalMissionSpots = visibleSpots.map((spot) => withLocalBtLibrary(
        spot,
        canonicalLocalBtPathForSpot(spot, canonicalDirectories.get(spot.id)),
        canonicalLocalBtPathsForSpot(spot, canonicalDirectories.get(spot.id)),
      ));
      const syncedMissionFlowNodes = syncMissionFlowNodesWithSpots(
        missionFlowNodes,
        canonicalMissionSpots,
      );
      const syncedMissionFlowEdges = filterMissionFlowEdges(
        missionFlowEdges,
        canonicalMissionSpots,
      );
      const routeMissionSpots = missionStepSpotsFromMissionFlow(
        canonicalMissionSpots,
        syncedMissionFlowNodes,
        syncedMissionFlowEdges,
      );
      const globalPath = "global.xml";
      const globalXml = buildGlobalMissionXml(routeMissionSpots);
      const savedBtRevision = designBtRevisionRef.current;
      const savedNonBtRevision = designNonBtRevisionRef.current;
      // Snapshot every authored local tree from the synchronous editor ref.
      // Paths remain stable across ordinary saves and waypoint label changes.
      const { files: nextBtFiles, stalePaths: uniqueStaleLocalBtPaths } =
        assembleMissionBtFilesForSave(
          visibleSpots,
          missionBtFilesRef.current,
          deletedMissionBtPaths,
          globalPath,
          globalXml,
        );
      const waypointOwnerByPath = new Map();
      canonicalMissionSpots.forEach((spot) => {
        localBtPathsForSpot(spot).forEach((path) => {
          waypointOwnerByPath.set(path, spot.id);
        });
      });
      let uploadRevision = savedManifestRevision;
      // Each XML content mutation advances the mission revision. Upload in a
      // deterministic chain so a concurrent editor is detected between any
      // two files instead of letting parallel writes share one stale revision.
      for (const [path, content] of Object.entries(nextBtFiles)) {
        const waypointId = waypointOwnerByPath.get(path);
        let response;
        if (waypointId && persistedLocalBtPathsRef.current.has(path)) {
          response = await saveNavigationMissionBtFile(
            currentMapName,
            path,
            content,
            missionRequestName(targetMissionName),
            {
              waypointId,
              expectedRevision: uploadRevision,
            },
          );
        } else {
          response = await saveNavigationMissionBtFile(
            currentMapName,
            path,
            content,
            missionRequestName(targetMissionName),
            { expectedRevision: uploadRevision },
          );
        }
        if (Number.isInteger(response?.revision)) {
          uploadRevision = response.revision;
          persistedMissionRevisionRef.current = uploadRevision;
        }
        // Each successful PUT is a durable checkpoint even if a later file or
        // the manifest commit fails. Keep the retry baseline aligned with the
        // server without clearing the overall Design dirty state yet.
        persistedMissionBtFilesRef.current = {
          ...persistedMissionBtFilesRef.current,
          [path]: content,
        };
      }
      // The server prunes orphan local files when it commits the manifest.
      // Upload every referenced BT first so a failed replacement cannot leave
      // the newly committed manifest pointing at a file that does not exist.
      const savedMission = await saveNavigationMission(currentMapName, {
        expected_revision: uploadRevision,
        global_bt: globalPath,
        waypoints: missionWaypointsFromSpots(canonicalMissionSpots),
        metadata: {
          source: "mission_canvas",
          behavior_node_count: activeBehaviorNodes.length,
          mission_flow: serializeMissionFlow(syncedMissionFlowNodes, syncedMissionFlowEdges),
        },
      }, missionRequestName(targetMissionName));
      persistedMissionBtFilesRef.current = nextBtFiles;
      persistedMissionRevisionRef.current = Number.isInteger(savedMission?.revision)
        ? savedMission.revision
        : uploadRevision + 1;
      persistedLocalBtPathsRef.current = new Set(
        canonicalMissionSpots.flatMap((spot) => localBtPathsForSpot(spot)),
      );
      let cleanupRevision = persistedMissionRevisionRef.current;
      for (const path of uniqueStaleLocalBtPaths) {
        const deleted = await deleteNavigationMissionBtFile(
          currentMapName,
          path,
          missionRequestName(targetMissionName),
          { expectedRevision: cleanupRevision },
        );
        if (Number.isInteger(deleted?.revision)) {
          cleanupRevision = deleted.revision;
          persistedMissionRevisionRef.current = cleanupRevision;
        }
      }
      const hasNewerBtEdits = designBtRevisionRef.current !== savedBtRevision;
      const hasNewerNonBtEdits = designNonBtRevisionRef.current !== savedNonBtRevision;
      let currentBtFiles = missionBtFilesRef.current;
      if (hasNewerBtEdits || hasNewerNonBtEdits) {
        currentBtFiles = migrateCanonicalLocalBtFileKeys(visibleSpots, currentBtFiles);
        missionBtFilesRef.current = currentBtFiles;
        setMissionBtFiles(currentBtFiles);
      }
      const dirtyPaths = hasNewerBtEdits
        ? changedLocalBtPaths(
          currentBtFiles,
          persistedMissionBtFilesRef.current,
        )
        : new Set();
      nonBtDesignDirtyRef.current = hasNewerNonBtEdits;
      dirtyLocalBtPathsRef.current = dirtyPaths;
      const hasNewerEdits = hasNewerNonBtEdits || dirtyPaths.size > 0;
      if (!hasNewerEdits) {
        setMissionBtFiles(nextBtFiles);
        missionBtFilesRef.current = nextBtFiles;
      }
      setDeletedMissionBtPaths((current) => current.filter((path) => (
        !uniqueStaleLocalBtPaths.includes(path)
      )));
      setSpots((current) => current.map((spot) => {
        const savedSpot = canonicalMissionSpots.find(({ id }) => id === spot.id);
        if (savedSpot) {
          return withLocalBtLibrary(
            spot,
            localBtPathForSpot(savedSpot),
            localBtPathsForSpot(savedSpot),
          );
        }
        const directory = canonicalDirectories.get(spot.id);
        const defaultPath = canonicalLocalBtPathForSpot(spot, directory);
        return withLocalBtLibrary(
          spot,
          defaultPath,
          canonicalLocalBtPathsForSpot(spot, directory),
        );
      }));
      setMissionName(targetMissionName);
      designDirtyRef.current = hasNewerEdits;
      setDesignDirty(hasNewerEdits);
      // A successful save establishes a new persistent baseline. Historical
      // snapshots before that boundary describe a different server document
      // and must not be restored as clean state.
      resetDesignHistory();
      // The mission is already durable even if the best-effort catalog refresh
      // below fails. Keep local XML actions available immediately.
      setDesignCatalog((current) => ({
        mapName: currentMapName,
        names: current.mapName === currentMapName
          ? [...new Set([...current.names, targetMissionName])]
          : [targetMissionName],
      }));
      try {
        const available = await fetchMissionNames(currentMapName);
        setDesignCatalog({ mapName: currentMapName, names: available });
      } catch {
        // Catalog refresh is best-effort; the save itself succeeded.
      }
      return hasNewerEdits
        ? `Saved ${targetMissionName}; newer edits remain unsaved`
        : `Saved ${targetMissionName} for ${currentMapName}`;
    },
  ), [
    activeBehaviorNodes,
    currentMapName,
    deletedMissionBtPaths,
    designCatalog.mapName,
    designCatalog.names,
    designMissionLoadError,
    fetchMissionNames,
    missionFlowEdges,
    missionFlowNodes,
    resetDesignHistory,
    runCommand,
    visibleSpots,
  ]);

  useEffect(() => {
    saveDesignMissionRef.current = saveDesignMission;
  }, [saveDesignMission]);

  const markDesignDirty = useCallback(() => {
    captureDesignHistory();
    designNonBtRevisionRef.current += 1;
    nonBtDesignDirtyRef.current = true;
    designDirtyRef.current = true;
    setDesignDirty(true);
  }, [captureDesignHistory]);

  const clearDesignDirty = useCallback(() => {
    nonBtDesignDirtyRef.current = false;
    dirtyLocalBtPathsRef.current = new Set();
    designDirtyRef.current = false;
    setDesignDirty(false);
  }, []);

  // Destructive design-session actions (switch/new/load) go through here so
  // unsaved manifest edits are never silently discarded.
  const runGuardedDesignAction = useCallback((action) => {
    if (!designDirtyRef.current) {
      action();
      return;
    }
    pendingGuardActionRef.current = action;
    setShowUnsavedDialog(true);
  }, []);

  // Existing missions save in place — Rename/Duplicate cover name changes, so
  // prompting on every save only added friction. Only a not-yet-saved mission
  // opens the name dialog, mirroring the unsaved-changes guard's asymmetry
  // ("Save & continue" for catalog missions, "name it first" otherwise).
  const handleSaveMission = useCallback(() => {
    if (designCatalog.names.includes(missionName)) {
      void saveDesignMission(missionName);
      return;
    }
    setSaveMissionName(missionName);
    setShowSaveMissionDialog(true);
  }, [designCatalog.names, missionName, saveDesignMission]);

  const handleConfirmSaveMission = useCallback(() => {
    const target = saveMissionName.trim();
    if (!isValidMissionName(target)) return;
    setShowSaveMissionDialog(false);
    void saveDesignMission(target);
  }, [saveMissionName, saveDesignMission]);

  const startNewMission = useCallback(() => {
    const name = uniqueMissionName("untitled", designCatalog.names);
    setMissionName(name);
    setPendingDesignMissionName(name);
    // In-memory canvas reset only — server spots are shared per map and must
    // survive; the manifest written on Save is what defines this mission.
    applySpots([]);
    setMissionFlowNodes([]);
    setMissionFlowEdges([]);
    setEditingLocalBtPathBySpotId({});
    setMissionBtFiles({ "global.xml": buildGlobalMissionXml([]) });
    missionBtFilesRef.current = { "global.xml": buildGlobalMissionXml([]) };
    persistedMissionBtFilesRef.current = {};
    persistedMissionRevisionRef.current = 0;
    persistedLocalBtPathsRef.current = new Set();
    dirtyLocalBtPathsRef.current = new Set();
    nonBtDesignDirtyRef.current = false;
    designBtRevisionRef.current = 0;
    designNonBtRevisionRef.current = 0;
    setDeletedMissionBtPaths([]);
    setMissionRouteMode(false);
    setMissionRouteSourceId("");
    setEditingSpotId("");
    setEditingSpotLabel("");
    clearDesignDirty();
    setDesignMissionLoadError("");
    setMessage("Started new mission — Save Mission to name it");
  }, [applySpots, clearDesignDirty, designCatalog.names]);

  const resolveUnsavedDialog = useCallback(async (mode) => {
    const action = pendingGuardActionRef.current;
    if (!action) {
      setShowUnsavedDialog(false);
      return;
    }
    if (mode === "discard") {
      pendingGuardActionRef.current = null;
      setShowUnsavedDialog(false);
      clearDesignDirty();
      action();
      return;
    }
    if (mode === "save") {
      await saveDesignMission(missionName);
      // saveDesignMission clears the dirty ref on success; a failed save keeps the
      // edits (and the dirty flag) so the prompt remains available to retry or
      // cancel. Keeping it open also prevents the suspended Load dialog from
      // resurfacing while the save is still in flight.
      if (!designDirtyRef.current) {
        pendingGuardActionRef.current = null;
        setShowUnsavedDialog(false);
        action();
      }
    }
  }, [clearDesignDirty, missionName, saveDesignMission]);

  // Step 1 of a run: bring the nav stack up (AMCL included) and enter pose-set
  // mode so the operator can tell AMCL where the robot actually is. Localization
  // must happen before the route runs — a lost robot ignores nav goals.
  const handleLocalize = useCallback(() => {
    const missionSnapshotRequired = workspaceStageRef.current !== STAGE_NAVIGATE;
    if (runMapBusy || (missionSnapshotRequired && runMapSnapshotInvalid)) {
      setMessage(missionSnapshotRequired
        ? "Wait for the selected mission to finish loading"
        : "Wait for the selected map to finish loading");
      return;
    }
    // Toggle: a second click while pose-set mode is armed just disarms it —
    // an accidental re-click must not force the operator to re-localize.
    if (interactionMode === "initial") {
      setInteractionMode("view");
      return;
    }
    // A completed localization stays valid until a NEW pose is actually
    // clicked; only a runtime (re)start invalidates it.
    const runtimeAlreadyUp = running && navigationRuntimeMode === "run";
    return runCommand(
      "Localize",
      async () => {
        const runMapName = currentMapName;
        setWorkspaceStage(runFamilyStageTarget());
        setNavigationRuntimeMode("run");
        setDesignPoseInitialized(false);
        if (!runtimeAlreadyUp) setRunPoseInitialized(false);
        setRunRuntimeOwned(true);
        setRunShutdownPending(false);
        saveMissionSession({
          mapName,
          workspaceStage: runFamilyStageTarget(),
          navigationRuntimeMode: "run",
          designPoseInitialized: false,
          runRuntimeOwned: true,
          runShutdownPending: false,
          runShutdownRequestedAt: null,
        });
        let navigationStartAttempted = false;
        try {
          if (!running || navigationRuntimeMode !== "run") {
            navigationStartAttempted = true;
            await startNavigation("nav", runMapName);
          }
        } catch (error) {
          // pagehide has already persisted a pending shutdown; never overwrite
          // that marker when an in-flight start settles during document exit.
          if (!runPageExitStopSentRef.current) {
            setNavigationRuntimeMode("idle");
            setRunRuntimeOwned(false);
            saveMissionSession({
              navigationRuntimeMode: "idle",
              runRuntimeOwned: false,
              runShutdownPending: false,
              runShutdownRequestedAt: null,
            });
          }
          throw error;
        } finally {
          // The first pagehide stop can race an already-running start request.
          // Once that request settles (successfully or partially), issue an
          // ordered second stop. The new page still confirms the shutdown.
          if (navigationStartAttempted && runPageExitStopSentRef.current) {
            void stopNavigation({ keepalive: true }).catch(() => {});
          }
        }
        if (runPageExitStopSentRef.current) return "Run session stopping";
        setInteractionMode("initial");
        return "Click and drag the robot pose on the map";
      },
    );
  }, [
    currentMapName,
    interactionMode,
    mapName,
    navigationRuntimeMode,
    runCommand,
    runMapBusy,
    runMapSnapshotInvalid,
    running,
  ]);

  // Step 2: with the robot localized, run the route. This only executes the
  // waypoint sequence — navigation is already up from the localize step.
  const handleRunMission = useCallback(() => {
    if (runMapBusy || !missionMapLoaded || runMapSnapshotInvalid) {
      setMessage("Wait for the selected mission to finish loading");
      return;
    }
    if (!runPoseInitialized) {
      setMessage("Localize the robot first");
      return;
    }
    if (!missionRouteOrderedSpots.length) {
      setMessage("No route to run — connect waypoints in Design first");
      return;
    }
    missionRunner.start();
  }, [
    missionMapLoaded,
    missionRouteOrderedSpots.length,
    missionRunner,
    runMapBusy,
    runMapSnapshotInvalid,
    runPoseInitialized,
  ]);

  const handleOpenEditMapDialog = useCallback(() => {
    // useMapEditor already listed the PGM files on stage entry; preselect the
    // current map (or the first file) the way the Design/Run dialogs do.
    setPendingEditMapPath(mapEditor.selectedPath || mapEditor.files[0]?.path || "");
    setShowEditMapDialog(true);
  }, [mapEditor.files, mapEditor.selectedPath]);

  const handleConfirmEditMap = useCallback(() => {
    mapEditor.setSelectedPath(pendingEditMapPath);
    setShowEditMapDialog(false);
  }, [mapEditor.setSelectedPath, pendingEditMapPath]);

  const handleOpenRunMapDialog = useCallback(() => {
    const dialogStage = runFamilyStageTarget();
    const mapOnly = dialogStage === STAGE_NAVIGATE;
    const requestId = runMapDialogRequestRef.current + 1;
    runMapDialogRequestRef.current = requestId;
    // A stopped Run has no active map/mission identity, but keep the picker on
    // its last choice so restarting the same session does not require finding
    // both files again. Picker state is separate from the cleared snapshot.
    const preferredRunMapName = (
      runMapName
      || mapNameFromPgmPath(runMapPath)
      || mapName
      || DEFAULT_MAP_NAME
    );
    const preferredRunMissionName = runMapName
      ? runMissionName
      : runMapPath ? pendingRunMissionName : missionName;
    setRunMapDialogStage(dialogStage);
    setWorkspaceStage(dialogStage);
    setShowRunMapDialog(true);
    setRunMapBusy(true);
    setMessage(mapOnly ? "Loading saved maps" : "Loading saved missions");
    getPgmFiles()
      .then(async (response) => {
        if (runMapDialogRequestRef.current !== requestId) return;
        const files = response.files || [];
        const preferred = files.find((file) => mapNameFromPgmPath(file.path) === preferredRunMapName)
          || files[0];
        setRunMapFiles(files);
        setRunMapPath(preferred?.path || "");
        if (mapOnly) {
          // Navigate consumes only the selected floor map. Mission inventory
          // remains a Run concern and must not be fetched as a side effect.
          setRunMissionNames([]);
        } else if (preferred?.path) {
          const selectedMapName = mapNameFromPgmPath(preferred.path);
          const available = await fetchMissionNames(selectedMapName);
          if (runMapDialogRequestRef.current !== requestId) return;
          setRunMissionNames(available);
          setPendingRunMissionName(
            available.includes(preferredRunMissionName)
              ? preferredRunMissionName
              : available[0] ?? DEFAULT_MISSION_NAME,
          );
        } else {
          setRunMissionNames([]);
          setPendingRunMissionName("");
        }
        if (!files.length) {
          setMessage("No PGM files found");
        }
      })
      .catch((error) => {
        if (runMapDialogRequestRef.current !== requestId) return;
        setMessage(error instanceof Error ? error.message : "Failed to list PGM files");
      })
      .finally(() => {
        if (runMapDialogRequestRef.current === requestId) setRunMapBusy(false);
      });
  }, [
    fetchMissionNames,
    mapName,
    missionName,
    pendingRunMissionName,
    runMapName,
    runMapPath,
    runMissionName,
  ]);

  const handleRunMapChange = useCallback((nextPath) => {
    const requestId = runMapDialogRequestRef.current + 1;
    runMapDialogRequestRef.current = requestId;
    setRunMapPath(nextPath);
    if (runMapDialogStage === STAGE_NAVIGATE) {
      setRunMissionNames([]);
      return;
    }
    const selectedMapName = mapNameFromPgmPath(nextPath);
    if (!selectedMapName) {
      setRunMissionNames([]);
      setPendingRunMissionName("");
      return;
    }
    setRunMapBusy(true);
    fetchMissionNames(selectedMapName)
      .then((available) => {
        if (runMapDialogRequestRef.current !== requestId) return;
        setRunMissionNames(available);
        setPendingRunMissionName(available[0] ?? DEFAULT_MISSION_NAME);
      })
      .catch((error) => {
        if (runMapDialogRequestRef.current !== requestId) return;
        setRunMissionNames([]);
        setPendingRunMissionName("");
        setMessage(error instanceof Error ? error.message : "Failed to list missions");
      })
      .finally(() => {
        if (runMapDialogRequestRef.current === requestId) setRunMapBusy(false);
      });
  }, [fetchMissionNames, runMapDialogStage]);

  const handleConfirmRunMap = useCallback(() => {
    const selectedMapName = mapNameFromPgmPath(runMapPath);
    if (!selectedMapName) {
      setMessage("Map file required");
      return;
    }
    if (runMapDialogStage === STAGE_NAVIGATE) {
      const preservesRunMission = (
        !runMapSnapshotInvalid
        && runCatalog.mapName === selectedMapName
      );
      setShowRunMapDialog(false);
      setWorkspaceStage(STAGE_NAVIGATE);
      setInteractionMode("view");
      setRunMapName(selectedMapName);
      setMissionMapLoaded(true);
      if (!preservesRunMission) {
        // A mission snapshot is map-scoped. Loading a different Navigate map
        // must not let Run later overlay or execute the previous map's route.
        setRunMissionName("");
        setRunCatalog({ mapName: "", names: [] });
        setRunSpots([]);
        setRunMissionFlowNodes([]);
        setRunMissionFlowEdges([]);
        setRunMissionBtFiles({});
        setRunMapSnapshotInvalid(true);
        setRunPoseInitialized(false);
        setNavGoalPose(null);
        setNavGoalStatus("idle");
      }
      setMessage(`Loaded map ${selectedMapName}`);
      return;
    }
    if (!pendingRunMissionName) {
      setMessage("Mission file required");
      return;
    }
    const selectedMissionName = pendingRunMissionName;
    // Invalidate the previous map snapshot immediately. Identity and content
    // are committed together only after every manifest/BT file has loaded.
    setRunMapSnapshotInvalid(true);
    setMissionMapLoaded(false);
    setRunSpots([]);
    setRunMissionFlowNodes([]);
    setRunMissionFlowEdges([]);
    setRunMissionBtFiles({});
    setShowRunMapDialog(false);
    setWorkspaceStage(runFamilyStageTarget());
    setInteractionMode("view");
    setRunMapBusy(true);
    loadRunMissionForMap(selectedMapName, selectedMissionName)
      .then((result) => {
        if (result.stale) return;
        setRunMapName(selectedMapName);
        setRunMissionName(selectedMissionName);
        setRunCatalog({ mapName: selectedMapName, names: runMissionNames });
        setMissionMapLoaded(true);
        setRunMapSnapshotInvalid(false);
        setMessage(result.exists
          ? `Loaded mission ${selectedMissionName} for ${selectedMapName}`
          : `Started new mission for ${selectedMapName}`);
      })
      .catch((error) => {
        setRunMapSnapshotInvalid(true);
        setMessage(error instanceof Error ? error.message : "Failed to load mission");
      })
      .finally(() => setRunMapBusy(false));
  }, [
    loadRunMissionForMap,
    pendingRunMissionName,
    runCatalog.mapName,
    runMapDialogStage,
    runMapPath,
    runMissionNames,
    runMapSnapshotInvalid,
  ]);

  const handleMissionChange = useCallback((nextMissionName) => {
    const selectedMissionName = String(nextMissionName || "").trim();
    if (!selectedMissionName || selectedMissionName === runMissionName) return;
    setRunMapBusy(true);
    loadRunMissionForMap(currentMapName, selectedMissionName)
      .then((result) => {
        if (result.stale) return;
        setRunMissionName(selectedMissionName);
        setMessage(result.exists
          ? `Loaded mission ${selectedMissionName}`
          : `Started new mission ${selectedMissionName}`);
      })
      .catch((error) => {
        setMessage(error instanceof Error ? error.message : "Failed to load mission");
      })
      .finally(() => setRunMapBusy(false));
  }, [currentMapName, loadRunMissionForMap, runMissionName]);

  const handleDesignMissionChange = useCallback((nextMissionName) => {
    const selectedMissionName = String(nextMissionName || "").trim();
    if (!selectedMissionName || selectedMissionName === missionName || !currentMapName) return;
    setMissionName(selectedMissionName);
    setPendingDesignMissionName(selectedMissionName);
    setSelectedSpotId("");
    setSelectedBehaviorNodeId("");
    setBtLayerSpotId("");
    setMissionRouteMode(false);
    setMissionRouteSourceId("");
    designDirtyRef.current = false;
    setDesignDirty(false);
    setDesignMapBusy(true);
    setDesignMissionLoadError("");
    loadMissionForMap(currentMapName, {
      loadLegacyDesign: true,
      targetMissionName: selectedMissionName,
    })
      .then((result) => {
        if (result.stale) return;
        setDesignMissionLoadError("");
        setMessage(result.exists
          ? `Loaded mission ${selectedMissionName}`
          : `Started new mission ${selectedMissionName}`);
        setDesignMapBusy(false);
      })
      .catch((error) => {
        const detail = error instanceof Error ? error.message : "Failed to load mission";
        setDesignMissionLoadError(detail);
        setMessage(`${detail}. Reload the mission before saving.`);
        setDesignMapBusy(false);
      });
  }, [currentMapName, loadMissionForMap, missionName]);

  const handleOpenRenameMissionDialog = useCallback(() => {
    setRenameMissionName(missionName);
    setShowRenameMissionDialog(true);
  }, [missionName]);

  const handleConfirmRenameMission = useCallback(() => {
    const target = renameMissionName.trim();
    if (!isValidMissionName(target)) return;
    setShowRenameMissionDialog(false);
    if (target === missionName) return;
    if (designCatalog.names.includes(target)) return;
    const previousName = missionName;
    void runCommand("Rename mission", async () => {
      const renamed = await renameNavigationMission(
        currentMapName,
        previousName,
        target,
        { expectedRevision: persistedMissionRevisionRef.current },
      );
      if (Number.isInteger(renamed?.revision)) {
        persistedMissionRevisionRef.current = renamed.revision;
      }
      // Same mission, new identity — keep the canvas and any unsaved edits.
      setMissionName(target);
      setPendingDesignMissionName(target);
      const optimisticNames = designCatalog.names.map((name) => (
        name === previousName ? target : name
      ));
      setDesignCatalog({ mapName: currentMapName, names: optimisticNames });
      try {
        const available = await fetchMissionNames(currentMapName);
        setDesignCatalog({ mapName: currentMapName, names: available });
      } catch {
        // Rename already succeeded; retain the usable optimistic catalog.
      }
      return `Renamed ${previousName} to ${target}`;
    });
  }, [
    currentMapName,
    designCatalog.names,
    fetchMissionNames,
    missionName,
    renameMissionName,
    runCommand,
  ]);

  const handleOpenDuplicateMissionDialog = useCallback(() => {
    setDuplicateMissionName(uniqueMissionName(`${missionName}-copy`, designCatalog.names));
    setShowDuplicateMissionDialog(true);
  }, [designCatalog.names, missionName]);

  const handleConfirmDuplicateMission = useCallback(() => {
    const target = duplicateMissionName.trim();
    if (!isValidMissionName(target) || designCatalog.names.includes(target)) return;
    setShowDuplicateMissionDialog(false);
    void runCommand("Duplicate mission", async () => {
      await duplicateNavigationMission(
        currentMapName,
        missionName,
        target,
        { expectedRevision: persistedMissionRevisionRef.current },
      );
      setDesignCatalog({
        mapName: currentMapName,
        names: [...new Set([...designCatalog.names, target])],
      });
      try {
        const available = await fetchMissionNames(currentMapName);
        setDesignCatalog({ mapName: currentMapName, names: available });
      } catch {
        // Duplicate already succeeded; retain the optimistic catalog entry.
      }
      return `Duplicated ${missionName} as ${target}`;
    });
  }, [currentMapName, designCatalog.names, duplicateMissionName, fetchMissionNames, missionName, runCommand]);

  const handleConfirmDeleteMission = useCallback(() => {
    setShowDeleteMissionDialog(false);
    const deletedName = missionName;
    void runCommand("Delete mission", async () => {
      await deleteNavigationMission(currentMapName, deletedName, {
        expectedRevision: persistedMissionRevisionRef.current,
      });
      let available = designCatalog.names.filter((name) => name !== deletedName);
      setDesignCatalog({ mapName: currentMapName, names: available });
      try {
        available = await fetchMissionNames(currentMapName);
        setDesignCatalog({ mapName: currentMapName, names: available });
      } catch {
        // Delete already succeeded; the optimistic list is authoritative
        // enough to leave the removed mission safely.
      }
      // The deleted mission's unsaved edits are moot — no guard on the switch.
      clearDesignDirty();
      if (available.length > 0) {
        handleDesignMissionChange(available[0]);
      } else {
        startNewMission();
      }
      return `Deleted mission ${deletedName}`;
    });
  }, [
    clearDesignDirty,
    currentMapName,
    designCatalog.names,
    fetchMissionNames,
    handleDesignMissionChange,
    missionName,
    runCommand,
    startNewMission,
  ]);

  const handleStartMapping = useCallback(() => runCommand(
    "Mapping",
    async () => {
      setWorkspaceStage(STAGE_MAPPING);
      clearLocalizationPoseCache();
      resetMappingPoseSync();
      await startNavigation("map", mapName.trim() || DEFAULT_MAP_NAME);
      setNavigationRuntimeMode("mapping");
      setDesignPoseInitialized(false);
      setRunRuntimeOwned(false);
      setRunShutdownPending(false);
      saveMissionSession({
        mapName: mapName.trim() || DEFAULT_MAP_NAME,
        workspaceStage: STAGE_MAPPING,
        navigationRuntimeMode: "mapping",
        designPoseInitialized: false,
        runRuntimeOwned: false,
        runShutdownPending: false,
        runShutdownRequestedAt: null,
      });
    },
  ), [clearLocalizationPoseCache, mapName, resetMappingPoseSync, runCommand]);

  const handleOpenSaveMapDialog = useCallback(() => {
    setSaveMapName(currentMapName);
    setShowSaveMapDialog(true);
  }, [currentMapName]);

  const handleConfirmSaveMap = useCallback(() => {
    const targetMapName = saveMapName.trim();
    if (!targetMapName) {
      setMessage("Map name required");
      return;
    }
    void runCommand(
      "Save map",
      async () => {
        const result = await saveNavigationMap(targetMapName);
        setMapName(targetMapName);
        setWorkspaceStage(STAGE_MAPPING);
        setInteractionMode("view");
        setMapEditorReloadToken((value) => value + 1);
        setShowSaveMapDialog(false);
        return result;
      },
    );
  }, [runCommand, saveMapName]);

  const stopMissionRunner = missionRunner.stop;
  const stopActiveNavigationSession = useCallback(async ({
    clearRunSnapshot = workspaceStageRef.current === STAGE_RUN,
  } = {}) => {
    // This cleanup is shared by Mapping, Design localization, Navigation, and
    // Run. Only a session leaving Run owns the loaded mission snapshot.
    // Start cancelling the active goal before taking Nav2 down, and keep the
    // outer Stop command busy until that cancellation settles. Local UI state
    // is invalidated immediately so a late goal result cannot revive it.
    const runnerCleanup = stopMissionRunner();
    navGoalSeqRef.current += 1;
    setNavGoalPose(null);
    setNavGoalStatus("idle");
    setInteractionMode("view");
    if (clearRunSnapshot) {
      // Clear the operator-facing session immediately. Supervisor shutdown
      // may take a while (or its HTTP response may be lost after the backend
      // already stopped), so the old mission must not linger behind a map
      // that has already disappeared.
      runMissionLoadGenerationRef.current += 1;
      setMissionMapLoaded(false);
      setRunMapName("");
      setRunMissionName("");
      setRunCatalog({ mapName: "", names: [] });
      setRunSpots([]);
      setRunMissionFlowNodes([]);
      setRunMissionFlowEdges([]);
      setRunMissionBtFiles({});
      setRunMapSnapshotInvalid(true);
      setRunPoseInitialized(false);
      saveMissionSession({ runMissionName: "" });
    }
    // Shut the supervisor runtime down immediately, but do not unlock this
    // Stop command until the cancel-all request has also settled. That keeps
    // a late cancellation away from any newly started navigation session.
    const [, navigationStopResult] = await Promise.allSettled([
      runnerCleanup,
      stopNavigation(),
    ]);
    if (navigationStopResult.status === "rejected") {
      throw navigationStopResult.reason;
    }
    const result = navigationStopResult.value;
    clearLocalizationPoseCache();
    resetMappingPoseSync();
    setStatus({ is_up: false, mode: "idle" });
    setNavigationRuntimeMode("idle");
    setDesignPoseInitialized(false);
    setRunPoseInitialized(false);
    setRunRuntimeOwned(false);
    setRunShutdownPending(false);
    saveMissionSession({
      navigationRuntimeMode: "idle",
      designPoseInitialized: false,
      runRuntimeOwned: false,
      runShutdownPending: false,
      runShutdownRequestedAt: null,
      ...(clearRunSnapshot ? { runMissionName: "" } : {}),
    });
    return result;
  }, [clearLocalizationPoseCache, resetMappingPoseSync, stopMissionRunner]);

  const handleStopNavigation = useCallback(() => runCommand(
    "Stop",
    () => stopActiveNavigationSession(),
  ), [runCommand, stopActiveNavigationSession]);

  const cancelPendingDesignLocalization = useCallback(() => {
    if (
      workspaceStage !== STAGE_AUTHORING
      || interactionMode !== "initial"
      || !designLocalizationActive
    ) {
      return false;
    }
    void handleStopNavigation();
    return true;
  }, [designLocalizationActive, handleStopNavigation, interactionMode, workspaceStage]);

  const handleSelectSpot = useCallback((spotId) => {
    setSelectedSpotId(spotId);
    setSelectedBehaviorNodeId("");
    setPendingBehaviorNodeTag("");
    setEditingSpotId("");
    setEditingSpotLabel("");
    setShowWaypointOptions(false);
    setInteractionMode("view");
  }, []);

  const handleOpenWaypointBt = useCallback((spotId) => {
    const spot = visibleSpots.find((item) => item.id === spotId);
    if (!spot) return;
    cancelPendingDesignLocalization();
    setSelectedSpotId(spotId);
    setSelectedBehaviorNodeId("");
    setPendingBehaviorNodeTag("");
    setEditingSpotId("");
    setEditingSpotLabel("");
    setShowWaypointOptions(false);
    setMissionRouteMode(false);
    setMissionRouteSourceId("");
    setInteractionMode("view");
    setBtLayerSpotId(spotId);
    setMessage(`Editing ${spot.label || spot.id} Waypoint Task`);
  }, [cancelPendingDesignLocalization, visibleSpots]);

  const handleSetMissionRouteOrder = useCallback((orderedIds) => {
    if (routeMutationLockRef.current || busy) return false;
    const validSpotIds = new Set(visibleSpots.map((spot) => spot.id));
    const validIds = orderedIds.filter((id, index) => (
      validSpotIds.has(id) && orderedIds.indexOf(id) === index
    ));
    const currentIds = missionRouteTreeSpots.map((spot) => spot.id);
    if (
      currentIds.length === validIds.length
      && currentIds.every((id, index) => id === validIds[index])
    ) {
      return false;
    }
    markDesignDirty();
    setMissionFlowNodes((current) => syncMissionFlowNodesWithSpots(current, visibleSpots));
    const keepClosed = missionRouteClosed && validIds.length > 1;
    setMissionFlowEdges(missionFlowEdgesForRouteOrder(validIds, keepClosed));
    setMissionRouteSourceId(
      !keepClosed && validIds.length > 1 ? validIds[validIds.length - 1] : "",
    );
    return true;
  }, [busy, markDesignDirty, missionRouteClosed, missionRouteTreeSpots, visibleSpots]);

  const handleAppendMissionRouteSpot = useCallback((spotId) => {
    if (!missionRouteMode || routeMutationLockRef.current || busy) return false;
    const spot = visibleSpots.find((item) => item.id === spotId);
    if (!spot) return false;
    const currentIds = missionRouteTreeSpots.map((item) => item.id);
    if (currentIds.includes(spotId)) {
      setMessage(`${spot.label || spot.id} is already in the route`);
      return false;
    }
    setSelectedSpotId(spotId);
    setSelectedBehaviorNodeId("");
    if (currentIds.length === 0) {
      setMissionRouteSourceId(spotId);
      setMessage(`Route start: ${spot.label || spot.id}`);
      return true;
    }
    if (!handleSetMissionRouteOrder([...currentIds, spotId])) return false;
    setMessage(`${spot.label || spot.id} added to route`);
    return true;
  }, [
    busy,
    handleSetMissionRouteOrder,
    missionRouteMode,
    missionRouteTreeSpots,
    visibleSpots,
  ]);

  const handleToggleMissionRouteMode = useCallback(() => {
    if (routeMutationLockRef.current || busy) return;
    if (!designMapAvailable) {
      setMessage("Load a mission before editing mission route");
      return;
    }
    cancelPendingDesignLocalization();
    setWorkspaceStage(STAGE_AUTHORING);
    setPendingBehaviorNodeTag("");
    setShowWaypointOptions(false);
    setBtLayerSpotId("");
    setInteractionMode("view");
    setMissionRouteMode((value) => {
      const next = !value;
      setMissionRouteSourceId("");
      setMessage(next
        ? "Click a waypoint to append it to the mission route"
        : "Mission route editing finished");
      return next;
    });
  }, [
    busy,
    cancelPendingDesignLocalization,
    designMapAvailable,
  ]);

  const handleMissionRouteSpotClick = useCallback((spotId) => {
    if (!missionRouteMode || routeMutationLockRef.current || busy) return;
    const spot = visibleSpots.find((item) => item.id === spotId);
    if (!spot) return;
    setSelectedSpotId(spotId);
    setSelectedBehaviorNodeId("");
    setPendingBehaviorNodeTag("");
    setEditingSpotId("");
    setEditingSpotLabel("");
    setBtLayerSpotId("");
    setShowWaypointOptions(false);
    setInteractionMode("view");

    const routeIds = missionRouteTreeSpots.map((item) => item.id);
    const targetIndex = routeIds.indexOf(spotId);
    if (targetIndex < 0) {
      handleAppendMissionRouteSpot(spotId);
      return;
    }

    const sourceSpot = visibleSpots.find((item) => item.id === missionRouteSourceId);
    const closesOpenRoute = (
      !missionRouteClosed
      && routeIds.length > 1
      && missionRouteSourceId === routeIds[routeIds.length - 1]
      && targetIndex === 0
    );
    if (closesOpenRoute) {
      markDesignDirty();
      setMissionFlowEdges(missionFlowEdgesForRouteOrder(routeIds, true));
      setMissionRouteSourceId("");
      setMessage(`Route closed: ${sourceSpot?.label || missionRouteSourceId} -> ${spot.label || spot.id}`);
      return;
    }

    if (!missionRouteClosed && targetIndex === routeIds.length - 1) {
      setMissionRouteSourceId(spotId);
      setMessage(`Route end: ${spot.label || spot.id}`);
      return;
    }

    setMessage(`${spot.label || spot.id} is already in the route`);
  }, [
    busy,
    handleAppendMissionRouteSpot,
    markDesignDirty,
    missionRouteClosed,
    missionRouteMode,
    missionRouteSourceId,
    missionRouteTreeSpots,
    visibleSpots,
  ]);

  const handleMissionRouteMapClick = useCallback(() => {
    if (!missionRouteMode) return;
    setMissionRouteSourceId("");
    setMessage("Route selection cleared");
  }, [missionRouteMode]);

  // Remove every route edge (waypoints stay).
  const handleClearMissionRoute = useCallback(() => {
    if (!missionRouteMode || routeMutationLockRef.current || busy || !missionFlowEdges.length) return;
    markDesignDirty();
    setMissionFlowEdges([]);
    setMissionRouteSourceId("");
    setMessage("Route cleared");
  }, [busy, markDesignDirty, missionFlowEdges.length, missionRouteMode]);

  const handleOpenMissionRouteLoop = useCallback(() => {
    if (!missionRouteMode || routeMutationLockRef.current || busy || !missionRouteClosed) return;
    const routeIds = missionRouteTreeSpots.map((spot) => spot.id);
    if (routeIds.length < 2) return;
    markDesignDirty();
    setMissionFlowEdges(missionFlowEdgesForRouteOrder(routeIds, false));
    setMissionRouteSourceId(routeIds[routeIds.length - 1]);
    setMessage("Loop opened");
  }, [busy, markDesignDirty, missionRouteClosed, missionRouteMode, missionRouteTreeSpots]);

  const handleMoveRouteSpot = useCallback((spotId, direction) => {
    if (!missionRouteMode || routeMutationLockRef.current || busy) return;
    const currentIds = missionRouteTreeSpots.map((spot) => spot.id);
    const index = currentIds.indexOf(spotId);
    const nextIndex = index + direction;
    if (index < 0 || nextIndex < 0 || nextIndex >= currentIds.length) return;
    const nextIds = [...currentIds];
    [nextIds[index], nextIds[nextIndex]] = [nextIds[nextIndex], nextIds[index]];
    handleSetMissionRouteOrder(nextIds);
  }, [busy, handleSetMissionRouteOrder, missionRouteMode, missionRouteTreeSpots]);

  // Take a waypoint out of the route only — the spot itself stays. Neighbors
  // are stitched back together (and a closed loop stays closed).
  const handleRemoveRouteSpot = useCallback((spotId) => {
    if (!missionRouteMode || routeMutationLockRef.current || busy) return;
    const currentIds = missionRouteTreeSpots.map((spot) => spot.id);
    if (!currentIds.includes(spotId)) return;
    const spot = missionRouteTreeSpots.find((item) => item.id === spotId);
    if (handleSetMissionRouteOrder(currentIds.filter((id) => id !== spotId))) {
      setMessage(`${spot?.label || spotId} removed from route`);
    }
  }, [busy, handleSetMissionRouteOrder, missionRouteMode, missionRouteTreeSpots]);

  const handleClearMapSelection = useCallback(() => {
    if (btLayerSpotId) {
      setBtLayerSpotId("");
      return;
    }
    setSelectedSpotId("");
    setSelectedBehaviorNodeId("");
    setPendingBehaviorNodeTag("");
    setEditingSpotId("");
    setEditingSpotLabel("");
  }, [btLayerSpotId]);

  const handleSelectBehaviorNode = useCallback((nodeId) => {
    cancelPendingDesignLocalization();
    setSelectedBehaviorNodeId(nodeId);
    setSelectedSpotId("");
    setEditingSpotId("");
    setEditingSpotLabel("");
    setPendingBehaviorNodeTag("");
    setShowWaypointOptions(false);
    setBtLayerSpotId("");
    setInteractionMode("view");
  }, [cancelPendingDesignLocalization]);

  const handleSelectBehaviorPaletteNode = useCallback((tag) => {
    cancelPendingDesignLocalization();
    setWorkspaceStage(STAGE_AUTHORING);
    setPendingBehaviorNodeTag(tag);
    setSelectedSpotId("");
    setEditingSpotId("");
    setEditingSpotLabel("");
    setBtLayerSpotId("");
    setShowWaypointOptions(false);
    setMissionRouteMode(false);
    setMissionRouteSourceId("");
    setInteractionMode("behavior");
    setMessage(`${tag} selected`);
  }, [cancelPendingDesignLocalization]);

  const handleToggleWaypointOptions = useCallback(() => {
    cancelPendingDesignLocalization();
    setWorkspaceStage(STAGE_AUTHORING);
    setShowWaypointOptions((value) => !value);
  }, [cancelPendingDesignLocalization]);

  const handleToggleSpotMode = useCallback(() => {
    cancelPendingDesignLocalization();
    setWorkspaceStage(STAGE_AUTHORING);
    setPendingBehaviorNodeTag("");
    setSelectedBehaviorNodeId("");
    setBtLayerSpotId("");
    setEditingSpotId("");
    setEditingSpotLabel("");
    setShowWaypointOptions(false);
    setInteractionMode((value) => (value === "spot" ? "view" : "spot"));
  }, [cancelPendingDesignLocalization]);

  const waitForAutoLocalizedPose = useCallback(async () => {
    let latestPose = null;
    for (let attempt = 0; attempt < AUTO_LOCALIZE_MAX_UPDATES; attempt += 1) {
      await requestNoMotionUpdate();
      await delay(AUTO_LOCALIZE_UPDATE_DELAY_MS);
      const amclPoseMessage = amclPoseRef.current;
      const pose = amclPoseMessage?.pose?.pose;
      if (pose?.position) {
        latestPose = pose;
        if (
          attempt + 1 >= AUTO_LOCALIZE_MIN_UPDATES &&
          amclPoseLooksLocalized(amclPoseMessage)
        ) {
          return pose;
        }
      }
    }
    if (latestPose?.position) return latestPose;
    throw new Error("Robot pose unavailable after automatic localization");
  }, []);

  // Run stage: the operator clicks/drags the robot's real pose on the map. The
  // backend /initial-pose publishes /initialpose and fires AMCL no-motion
  // updates; we then verify covariance convergence before unblocking the
  // mission runner. map_name is intentionally omitted so the endpoint can never
  // switch the running nav stack into localize-only mode.
  const handleRunPoseEstimate = useCallback((x, y, yaw) => {
    setInteractionMode("view");
    return runCommand(
      "Set robot pose",
      async () => {
        clearLocalizationPoseCache();
        await sendInitialPoseEstimate({ x, y, yaw, frameId: "map" });
        setMessage("Localizing robot");
        await waitForAutoLocalizedPose();
        setRunPoseInitialized(true);
        return "Robot localized";
      },
    );
  }, [clearLocalizationPoseCache, runCommand, waitForAutoLocalizedPose]);

  const commitCreatedDesignWaypoint = useCallback((createdSpot) => {
    // Establish ownership before the waypoint enters the UI. Falling back to
    // a path derived from one spot in isolation can alias an existing renamed
    // waypoint after the readable ID suffix is normalized away.
    const reservedPaths = [
      ...Object.keys(missionBtFilesRef.current),
      ...persistedLocalBtPathsRef.current,
      ...deletedMissionBtPaths,
    ];
    const initialized = initializeCreatedWaypointLocalBt(
      spots,
      createdSpot,
      reservedPaths,
    );
    const emptyXml = defaultLocalBtXml(initialized.spot);
    const nextBtFiles = { ...missionBtFilesRef.current };
    initialized.paths.forEach((path) => {
      nextBtFiles[path] = emptyXml;
    });

    markDesignDirty();
    missionBtFilesRef.current = nextBtFiles;
    designBtRevisionRef.current += 1;
    dirtyLocalBtPathsRef.current = changedLocalBtPaths(
      nextBtFiles,
      persistedMissionBtFilesRef.current,
    );
    setMissionBtFiles(nextBtFiles);
    setSpots((current) => [...current, initialized.spot]);
    setSelectedSpotId(initialized.spot.id);
    setSelectedBehaviorNodeId("");
    return initialized.spot;
  }, [deletedMissionBtPaths, markDesignDirty, spots]);

  const handleCreateSpotAtPose = useCallback(async (x, y, yaw) => {
    if (workspaceStage === STAGE_NAVIGATE) {
      if (interactionMode === "initial") {
        void handleRunPoseEstimate(x, y, yaw);
      } else if (interactionMode === "goal") {
        void handleSendNavGoal(x, y, yaw);
      }
      return;
    }
    if (workspaceStage === STAGE_RUN) {
      // The BT node being up is expected here; run pose estimation must not
      // fall through to the design-stage guards below.
      if (interactionMode === "initial") void handleRunPoseEstimate(x, y, yaw);
      return;
    }
    if (
      interactionMode === "initial"
      && (mappingRuntimeActive || runRuntimeActive || missionRunnerActive)
    ) {
      setInteractionMode("view");
      setMessage("Stop the active navigation session before using At Robot");
      return;
    }
    if (interactionMode === "initial") {
      if (waypointCreatePendingRef.current) return;
      waypointCreatePendingRef.current = true;
      setInteractionMode("view");
      setShowWaypointOptions(false);
      void runCommand(
        "At Robot",
        async () => {
          clearLocalizationPoseCache();
          await sendInitialPoseEstimate({
            x,
            y,
            yaw,
            frameId: "map",
            mapName: currentMapName,
          });
          setDesignPoseInitialized(true);
          saveMissionSession({ designPoseInitialized: true });
          const localizedPose = await waitForAutoLocalizedPose();
          const position = localizedPose.position;
          const localizedX = Number(position.x ?? 0);
          const localizedY = Number(position.y ?? 0);
          const localizedYaw = yawFromPose(localizedPose);
          const label = nextWaypointLabel(spots);
          const created = await createNavigationSpot({
            map_name: currentMapName,
            label,
            pose: spotPoseFromMapPose(localizedX, localizedY, localizedYaw),
            metadata: { source: "mission_canvas", coordinate_space: "map" },
          });
          const initialized = commitCreatedDesignWaypoint(created);
          await stopNavigation();
          setNavigationRuntimeMode("idle");
          setDesignPoseInitialized(false);
          setRunRuntimeOwned(false);
          setRunShutdownPending(false);
          saveMissionSession({
            mapName: currentMapName,
            workspaceStage: STAGE_AUTHORING,
            designMapPath,
            navigationRuntimeMode: "idle",
            designPoseInitialized: false,
            runRuntimeOwned: false,
            runShutdownPending: false,
            runShutdownRequestedAt: null,
          });
          return `Created ${initialized.label} at robot`;
        },
      ).finally(() => {
        waypointCreatePendingRef.current = false;
      });
      return;
    }
    if (interactionMode === "behavior" && pendingBehaviorNodeTag) {
      const definition = behaviorNodeDefinition(pendingBehaviorNodeTag);
      behaviorNodeSerialRef.current += 1;
      const index = behaviorNodeSerialRef.current;
      const node = {
        id: behaviorNodeId(pendingBehaviorNodeTag, index),
        map_name: currentMapName,
        tag: pendingBehaviorNodeTag,
        label: pendingBehaviorNodeTag,
        category: definition.category || "action",
        pose: spotPoseFromMapPose(x, y, yaw),
        metadata: { source: "mission_canvas" },
      };
      markDesignDirty();
      setBehaviorNodes((current) => [...current, node]);
      setSelectedBehaviorNodeId(node.id);
      setSelectedSpotId("");
      setPendingBehaviorNodeTag("");
      setInteractionMode("view");
      setMessage(`Placed ${node.tag}`);
      return;
    }
    if (interactionMode !== "spot") return;
    if (waypointCreatePendingRef.current) return;
    waypointCreatePendingRef.current = true;
    setShowWaypointOptions(false);
    setInteractionMode("view");
    const label = nextWaypointLabel(spots);
    try {
      const targetMapName = currentMapName;
      const targetMissionName = designMissionNameRef.current;
      const targetGeneration = designMissionLoadGenerationRef.current;
      await runCommand("Create Waypoint", async () => {
        const created = await createNavigationSpot({
          map_name: targetMapName,
          label,
          pose: spotPoseFromMapPose(x, y, yaw),
          metadata: { source: "mission_canvas", coordinate_space: "map" },
        });
        if (
          designMapNameRef.current !== targetMapName
          || designMissionNameRef.current !== targetMissionName
          || designMissionLoadGenerationRef.current !== targetGeneration
        ) {
          try {
            await deleteNavigationSpot(created.id, targetMapName);
          } catch {
            // The stale result must never enter the newly selected document;
            // orphan cleanup can be retried through the legacy spot store.
          }
          throw new Error("Map or mission changed while the waypoint was being created");
        }
        const initialized = commitCreatedDesignWaypoint(created);
        return `Created ${initialized.label}`;
      });
    } finally {
      waypointCreatePendingRef.current = false;
    }
  }, [handleSendNavGoal, 
    currentMapName,
    clearLocalizationPoseCache,
    commitCreatedDesignWaypoint,
    designMapPath,
    handleRunPoseEstimate,
    interactionMode,
    mappingRuntimeActive,
    missionRunnerActive,
    pendingBehaviorNodeTag,
    runCommand,
    runRuntimeActive,
    spots,
    waitForAutoLocalizedPose,
    workspaceStage,
  ]);

  const handleCreateSpotAtRobot = useCallback(() => {
    if (mappingRuntimeActive || runRuntimeActive || missionRunnerActive) {
      setMessage("Stop the active navigation session before using At Robot");
      return;
    }
    if (!designMapAvailable || !designMapPath) {
      setMessage("Load a map before creating a waypoint");
      return;
    }
    const resolvedDesignMapPath = designMapPath;
    setWorkspaceStage(STAGE_AUTHORING);
    setPendingBehaviorNodeTag("");
    setSelectedBehaviorNodeId("");
    setSelectedSpotId("");
    setMissionRouteMode(false);
    setMissionRouteSourceId("");
    setShowWaypointOptions(false);
    setDesignPoseInitialized(false);
    clearLocalizationPoseCache();
    void runCommand(
      "At Robot",
      async () => {
        await startNavigation("localize", currentMapName);
        await configureDesignLocalizationAmcl();
        setNavigationRuntimeMode("localization");
        setRunRuntimeOwned(false);
        setRunShutdownPending(false);
        saveMissionSession({
          mapName: currentMapName,
          workspaceStage: STAGE_AUTHORING,
          designMapPath: resolvedDesignMapPath,
          navigationRuntimeMode: "localization",
          designPoseInitialized: false,
          runRuntimeOwned: false,
          runShutdownPending: false,
          runShutdownRequestedAt: null,
        });
        setInteractionMode("initial");
        return "Click and drag the robot pose on the map";
      },
    );
  }, [
    currentMapName,
    clearLocalizationPoseCache,
    designMapAvailable,
    designMapPath,
    mappingRuntimeActive,
    missionRunnerActive,
    runCommand,
    runRuntimeActive,
  ]);

  const handleMoveSpot = useCallback(async (spotId, x, y, yaw) => {
    const spot = spots.find((item) => item.id === spotId);
    if (!spot) return;
    const nextPose = spotPoseFromMapPose(x, y, yaw ?? spot.pose?.yaw ?? 0);
    markDesignDirty();
    setSpots((current) => current.map((item) => (
      item.id === spotId ? { ...item, pose: nextPose } : item
    )));
    if (isMissionManifestSpot(spot)) {
      setMessage(`Moved ${spot.label || spot.id}`);
      return;
    }
    try {
      const updated = await updateNavigationSpot(spotId, {
        map_name: spot.map_name,
        pose: nextPose,
        metadata: {
          ...(spot.metadata ?? {}),
          coordinate_space: "map",
        },
      });
      setSpots((current) => current.map((item) => (
        item.id === updated.id ? updated : item
      )));
      setMessage(`Moved ${updated.label || spot.label}`);
    } catch (error) {
      setSpots((current) => current.map((item) => (
        item.id === spotId ? spot : item
      )));
      setMessage(error instanceof Error ? error.message : "Failed to move waypoint");
    }
  }, [markDesignDirty, spots]);

  const handleMoveBehaviorNode = useCallback((nodeId, x, y, yaw) => {
    markDesignDirty();
    setBehaviorNodes((current) => current.map((node) => (
      node.id === nodeId
        ? {
          ...node,
          pose: spotPoseFromMapPose(x, y, yaw ?? node.pose?.yaw ?? 0),
        }
        : node
    )));
    const node = behaviorNodes.find((item) => item.id === nodeId);
    setMessage(`Moved ${node?.tag || "node"}`);
  }, [behaviorNodes, markDesignDirty]);

  const handleStartRenameSpot = useCallback((spot) => {
    if (!spot) return;
    setSelectedSpotId(spot.id);
    setSelectedBehaviorNodeId("");
    setPendingBehaviorNodeTag("");
    setShowWaypointOptions(false);
    setInteractionMode("view");
    setEditingSpotId(spot.id);
    setEditingSpotLabel(spot.label || spot.id);
  }, []);

  const handleCancelSpotRename = useCallback(() => {
    setEditingSpotId("");
    setEditingSpotLabel("");
  }, []);

  const handleCommitSpotRename = useCallback(async (spot) => {
    if (!spot) return;
    const label = editingSpotLabel.trim() || spot.label || spot.id;
    setEditingSpotId("");
    setEditingSpotLabel("");
    if (label === spot.label) return;

    const previousSpot = spot;
    markDesignDirty();
    // The label is display metadata. A waypoint's BT library and its current
    // default are persistent identities and must survive a rename unchanged.
    setSpots((current) => current.map((item) => (
      item.id === previousSpot.id ? { ...item, label } : item
    )));
    if (isMissionManifestSpot(previousSpot)) {
      setMessage(`Renamed ${label}`);
      return;
    }
    try {
      const updated = await updateNavigationSpot(previousSpot.id, {
        map_name: previousSpot.map_name,
        label,
      });
      setSpots((current) => current.map((item) => (
        item.id === updated.id
          ? withLocalBtLibrary(
            {
              ...item,
              ...updated,
              label: updated.label || label,
              metadata: {
                ...(item.metadata ?? {}),
                ...(updated.metadata ?? {}),
              },
            },
            localBtPathForSpot(item),
            localBtPathsForSpot(item),
          )
          : item
      )));
      setMessage(`Renamed ${updated.label || label}`);
    } catch (error) {
      setSpots((current) => current.map((item) => (
        item.id === previousSpot.id
          ? { ...item, label: previousSpot.label }
          : item
      )));
      setMessage(error instanceof Error ? error.message : "Failed to update waypoint");
    }
  }, [editingSpotLabel, markDesignDirty]);

  const handleDeleteSpot = useCallback(async (spot) => {
    if (!spot || busy || routeMutationLockRef.current) return;
    routeMutationLockRef.current = true;
    setBusy("Delete Waypoint");
    const routeIds = missionRouteTreeSpots.map((item) => item.id);
    const wasInRoute = routeIds.includes(spot.id);
    try {
      const localBtPaths = localBtPathsForSpot(spot);
      if (!isMissionManifestSpot(spot)) {
        await deleteNavigationSpot(spot.id, spot.map_name);
      }
      markDesignDirty();
      setSpots((current) => current.filter((item) => item.id !== spot.id));
      if (wasInRoute) {
        const remainingRouteIds = routeIds.filter((id) => id !== spot.id);
        const keepClosed = missionRouteClosed && remainingRouteIds.length > 1;
        setMissionFlowEdges(missionFlowEdgesForRouteOrder(remainingRouteIds, keepClosed));
        setMissionRouteSourceId(
          !keepClosed && remainingRouteIds.length > 1
            ? remainingRouteIds[remainingRouteIds.length - 1]
            : "",
        );
      }
      setDeletedMissionBtPaths((current) => ([
        ...new Set([...current, ...localBtPaths]),
      ]));
      setEditingLocalBtPathBySpotId((current) => {
        const next = { ...current };
        delete next[spot.id];
        return next;
      });
      setSelectedSpotId((current) => (current === spot.id ? "" : current));
      setBtLayerSpotId((current) => (current === spot.id ? "" : current));
      setEditingSpotId((current) => (current === spot.id ? "" : current));
      setEditingSpotLabel((current) => (editingSpotId === spot.id ? "" : current));
      setMessage(`Deleted ${spot.label || spot.id}`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Failed to delete waypoint");
    } finally {
      routeMutationLockRef.current = false;
      setBusy((current) => (current === "Delete Waypoint" ? "" : current));
    }
  }, [
    busy,
    editingSpotId,
    markDesignDirty,
    missionRouteClosed,
    missionRouteTreeSpots,
  ]);

  const handleDeleteBehaviorNode = useCallback((node) => {
    if (!node) return;
    markDesignDirty();
    setBehaviorNodes((current) => current.filter((item) => (
      item.id !== node.id
    )));
    setSelectedBehaviorNodeId((current) => (current === node.id ? "" : current));
    setMessage(`Deleted ${node.tag}`);
  }, [markDesignDirty]);

  const waypointBtLayerOpen = !!waypointBtLayer;
  const designHistoryLocked = (
    workspaceStage !== STAGE_AUTHORING ||
    !designMapAvailable ||
    !!busy ||
    designMapBusy ||
    waypointBtLayerOpen
  );

  const handleUndoDesign = useCallback(() => {
    if (designHistoryLocked || !canUndoDesign) return;
    undoDesignHistory();
    setMessage("Undid design change");
  }, [canUndoDesign, designHistoryLocked, undoDesignHistory]);

  const handleRedoDesign = useCallback(() => {
    if (designHistoryLocked || !canRedoDesign) return;
    redoDesignHistory();
    setMessage("Redid design change");
  }, [canRedoDesign, designHistoryLocked, redoDesignHistory]);

  useEffect(() => {
    if (workspaceStage !== STAGE_AUTHORING || waypointBtLayerOpen) return undefined;
    const handleKeyDown = (event) => {
      if (!(event.ctrlKey || event.metaKey) || isTextInputTarget(event.target)) return;
      const key = event.key.toLowerCase();
      if (key === "z") {
        event.preventDefault();
        if (event.shiftKey) handleRedoDesign();
        else handleUndoDesign();
      } else if (key === "y" && !event.shiftKey) {
        event.preventDefault();
        handleRedoDesign();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [handleRedoDesign, handleUndoDesign, waypointBtLayerOpen, workspaceStage]);

  // Same shortcuts in the Map Edit stage, wired to the pixel/area history —
  // the HUD tooltips advertise them, so they must actually work here too.
  // Suspended while the Load Map dialog is open: the overlay has no focus
  // trap, so the shortcut would silently edit the map behind the modal.
  useEffect(() => {
    if (workspaceStage !== STAGE_MAP_EDIT || showEditMapDialog) return undefined;
    const handleKeyDown = (event) => {
      if (!(event.ctrlKey || event.metaKey) || isTextInputTarget(event.target)) return;
      if (mapEditor.busy) return;
      const key = event.key.toLowerCase();
      if (key === "z") {
        event.preventDefault();
        if (event.shiftKey) mapEditor.redo();
        else mapEditor.undo();
      } else if (key === "y" && !event.shiftKey) {
        event.preventDefault();
        mapEditor.redo();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [mapEditor.busy, mapEditor.redo, mapEditor.undo, showEditMapDialog, workspaceStage]);

  const workspaceExitBlockReason = (
    busy
    || btNodeBusy
    || designMapBusy
    || runMapBusy
    || mapEditor.busy
  )
    ? "Wait for the current operation to finish before going back"
    : (mapEditor.dirty || designMapEditor.dirty)
      ? "Save the current map edits before going back"
      : (
        mappingRuntimeActive
        || runRuntimeActive
        || designLocalizationActive
        || navigationRuntimeMode !== "idle"
        || missionRunnerActive
        || runShutdownPending
      )
        ? "Stop the active runtime before going back"
        : "";

  // The shell renders the app bar, so publish the block reason before paint:
  // the back button must already show it when the next click lands.
  useLayoutEffect(() => {
    if (typeof onExitStateChange === "function") {
      onExitStateChange({ blockReason: workspaceExitBlockReason });
    }
  }, [onExitStateChange, workspaceExitBlockReason]);

  // Leaving the workspace goes through the unsaved-Design dialog, which lives
  // here, so the shell asks for the exit instead of unmounting on its own.
  useImperativeHandle(exitHandleRef, () => ({
    requestExit(onExit) {
      if (workspaceExitBlockReason) return false;
      runGuardedDesignAction(onExit);
      return true;
    },
  }), [runGuardedDesignAction, workspaceExitBlockReason]);

  const handleSelectStageTab = (stageId) => {
    if (stageId === workspaceStage) return;

    const applyStageSelection = () => {
      // Run and Navigate share the nav runtime AND the loaded map snapshot:
      // an idle switch between them may retain the loaded map. Active runtime
      // switches are stopped before this cleanup runs.
      const runFamilySwitch = (
        (stageId === STAGE_RUN || stageId === STAGE_NAVIGATE)
        && (workspaceStage === STAGE_RUN || workspaceStage === STAGE_NAVIGATE)
      );
      cancelPendingDesignLocalization();
      if (!runFamilySwitch) setMissionMapLoaded(false);
      setInteractionMode("view");
      setPendingBehaviorNodeTag("");
      setShowWaypointOptions(false);
      setMissionRouteMode(false);
      setMissionRouteSourceId("");
      setBtLayerSpotId("");
      setMapEditToolsOpen(false);
      setLabelToolsOpen(false);
      setWorkspaceStage(stageId);
    };

    const leavingRunFamilyStage = (
      workspaceStage === STAGE_RUN || workspaceStage === STAGE_NAVIGATE
    );
    const runFamilyRuntimeNeedsStop = (
      navigationRuntimeMode === "run"
      || runRuntimeActive
      || runRuntimeOwned
      || runShutdownPending
      || missionRunnerActive
      || navGoalDriving
    );

    if (leavingRunFamilyStage && runFamilyRuntimeNeedsStop) {
      const clearRunSnapshot = workspaceStage === STAGE_RUN;
      void runCommand("Stop", async () => {
        const result = await stopActiveNavigationSession({ clearRunSnapshot });
        applyStageSelection();
        return result;
      });
      return;
    }

    applyStageSelection();
  };

  return (
    <>
      <SaveMapDialog
        open={showSaveMapDialog}
        value={saveMapName}
        busy={!!busy}
        onChange={setSaveMapName}
        onCancel={() => setShowSaveMapDialog(false)}
        onSubmit={handleConfirmSaveMap}
      />
      <SaveMissionDialog
        open={showSaveMissionDialog}
        value={saveMissionName}
        existingNames={designCatalog.names}
        currentName={missionName}
        disallowExisting
        busy={!!busy}
        onChange={setSaveMissionName}
        onCancel={() => setShowSaveMissionDialog(false)}
        onSubmit={handleConfirmSaveMission}
      />
      <SaveMissionDialog
        open={showRenameMissionDialog}
        title="Rename Mission"
        fieldLabel="New mission name"
        inputAriaLabel="Rename mission name"
        submitLabel="Rename"
        value={renameMissionName}
        existingNames={designCatalog.names.filter((name) => name !== missionName)}
        currentName=""
        disallowExisting
        busy={!!busy}
        onChange={setRenameMissionName}
        onCancel={() => setShowRenameMissionDialog(false)}
        onSubmit={handleConfirmRenameMission}
      />
      <SaveMissionDialog
        open={showDuplicateMissionDialog}
        title="Duplicate Mission"
        fieldLabel="New mission name"
        inputAriaLabel="Duplicate mission name"
        submitLabel="Duplicate"
        value={duplicateMissionName}
        existingNames={designCatalog.names}
        currentName=""
        disallowExisting
        hint="Duplicates the last saved state."
        busy={!!busy}
        onChange={setDuplicateMissionName}
        onCancel={() => setShowDuplicateMissionDialog(false)}
        onSubmit={handleConfirmDuplicateMission}
      />
      <ConfirmDialog
        open={showDeleteMissionDialog}
        title="Delete Mission"
        body={`Delete mission "${missionName}"? This permanently removes its waypoints, route, and Waypoint Tasks.`}
        confirmLabel="Delete"
        busy={!!busy}
        onConfirm={handleConfirmDeleteMission}
        onCancel={() => setShowDeleteMissionDialog(false)}
      />
      <ConfirmDialog
        open={showUnsavedDialog}
        title="Unsaved changes"
        body={`"${missionName}" has unsaved changes.`}
        confirmLabel="Discard"
        altLabel={designCatalog.names.includes(missionName) ? "Save & continue" : ""}
        hint={designCatalog.names.includes(missionName)
          ? ""
          : "Use Save Mission to name this mission first."}
        busy={!!busy}
        onConfirm={() => resolveUnsavedDialog("discard")}
        onAlt={() => resolveUnsavedDialog("save")}
        onCancel={() => {
          pendingGuardActionRef.current = null;
          setShowUnsavedDialog(false);
        }}
      />
      <LoadMapDialog
        open={showDesignMapDialog && !showUnsavedDialog}
        files={designMapFiles}
        selectedPath={pendingDesignMapPath}
        missionNames={designMissionNames}
        selectedMissionName={pendingDesignMissionName}
        busy={designMapBusy}
        title="Load Map"
        fieldLabel="Map"
        selectAriaLabel="Design mission map file"
        missionSelectAriaLabel="Design mission file"
        onChange={handleDesignMapChange}
        onMissionChange={setPendingDesignMissionName}
        onCancel={() => {
          setPendingDesignMapPath(designMapPath);
          setPendingDesignMissionName(missionName);
          setShowDesignMapDialog(false);
        }}
        onSubmit={() => runGuardedDesignAction(handleConfirmDesignMap)}
      />
      <LoadMapDialog
        open={showRunMapDialog}
        files={runMapFiles}
        selectedPath={runMapPath}
        missionNames={runMapDialogStage === STAGE_NAVIGATE ? null : runMissionNames}
        selectedMissionName={pendingRunMissionName}
        busy={runMapBusy}
        title="Load Map"
        fieldLabel="Map"
        selectAriaLabel={runMapDialogStage === STAGE_NAVIGATE
          ? "Navigation map file"
          : "Run mission map file"}
        missionSelectAriaLabel="Run mission file"
        onChange={handleRunMapChange}
        onMissionChange={setPendingRunMissionName}
        onCancel={() => {
          runMapDialogRequestRef.current += 1;
          setRunMapBusy(false);
          if (runMapDialogStage !== STAGE_NAVIGATE) {
            setPendingRunMissionName(runMissionName);
          }
          setShowRunMapDialog(false);
        }}
        onSubmit={handleConfirmRunMap}
      />
      <LoadMapDialog
        open={showEditMapDialog}
        files={mapEditor.files}
        selectedPath={pendingEditMapPath}
        busy={mapEditor.busy}
        title="Load Map"
        fieldLabel="Map"
        selectAriaLabel="PGM map"
        onChange={setPendingEditMapPath}
        onCancel={() => setShowEditMapDialog(false)}
        onSubmit={handleConfirmEditMap}
      />
      <div className="flex flex-1 min-h-0 overflow-hidden">
      {/* ── LEFT RAIL — stage navigation ── */}
        <aside
          className="shrink-0 flex flex-col p-4 border-r"
          style={{ width: 210, backgroundColor: MISSION_RAIL_BG, borderColor: MISSION_BORDER }}
        >
          <nav className="grid gap-1" role="tablist" aria-label="Mission Canvas stages">
            {WORKSPACE_NAV_GROUPS.map((group, groupIndex) => (
              <div key={group.caption} className={`grid gap-1 ${groupIndex === 0 ? "" : "mt-4"}`}>
                <div className="px-1 pb-1.5 text-[11px] font-mono font-semibold tracking-[0.14em]" style={{ color: MISSION_TEXT_MUTED }}>
                  {group.caption}
                </div>
                {group.stageIds.map((stageId) => {
                  const stage = WORKSPACE_STAGES.find((item) => item.id === stageId);
                  const selected = workspaceStage === stage.id;
                  // SLAM may rewrite the saved PGM while it is being edited.
                  // Run/Navigation sessions use the ordinary stage-exit stop,
                  // so Map Edit must stay clickable to initiate that shutdown.
                  const editLocked = stage.id === STAGE_MAP_EDIT && !selected && mappingRuntimeActive;
                  return (
                    <button
                      key={stage.id}
                      type="button"
                      role="tab"
                      aria-selected={selected}
                      disabled={!!busy || editLocked}
                      title={editLocked ? "Stop mapping before editing saved maps" : undefined}
                      onClick={() => handleSelectStageTab(stage.id)}
                      className="flex items-center gap-3 px-3 py-2.5 text-[13px] font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50"
                      style={{
                        borderRadius: 10,
                        color: selected ? MISSION_TEXT : MISSION_TEXT_MUTED,
                        backgroundColor: selected ? MISSION_STAGE_EMPTY : "transparent",
                        border: `1px solid ${selected ? MISSION_BORDER : "transparent"}`,
                        boxShadow: selected ? "var(--mc-shadow)" : "none",
                      }}
                    >
                      <StageIcon id={stage.id} active={selected} />
                      {stage.label}
                    </button>
                  );
                })}
              </div>
            ))}
          </nav>
        </aside>

      {/* WORKSPACE */}
      <div className="flex-1 min-w-0 flex flex-col">
        {/* TOP BAR — stage title + contextual actions + status */}
        <header
          className="shrink-0 h-14 flex items-center justify-between gap-4 px-6 border-b"
          style={{ borderColor: MISSION_BORDER, backgroundColor: MISSION_SURFACE }}
        >
          {workspaceStage === STAGE_AUTHORING && waypointBtLayer ? (
            <>
              <div className="flex items-center gap-2.5 min-w-0 text-[14px]">
                <span className="font-bold tracking-tight">Design</span>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--mc-text-subtle)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m9 18 6-6-6-6" /></svg>
                <span className="font-semibold truncate" style={{ color: MISSION_TEXT_MUTED }}>{waypointBtLayer.spot.label || waypointBtLayer.spot.id}</span>
                <span className="text-[11px] font-mono shrink-0" style={{ color: "var(--mc-text-subtle)" }}>· Waypoint Task</span>
              </div>
              <ActionButton
                onClick={() => setBtLayerSpotId("")}
                title="Return to the Design map"
                variant="secondary"
              >
                ← Back to Map
              </ActionButton>
            </>
          ) : workspaceStage === STAGE_RUN && runBtLayer ? (
            <>
              <div className="flex items-center gap-2.5 min-w-0 text-[14px]">
                <span className="font-bold tracking-tight">Run</span>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--mc-text-subtle)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m9 18 6-6-6-6" /></svg>
                <span className="font-semibold truncate" style={{ color: MISSION_TEXT_MUTED }}>{runBtLayer.spot.label || runBtLayer.spot.id}</span>
                <span className="text-[11px] font-mono shrink-0" style={{ color: "var(--mc-text-subtle)" }}>· Waypoint {missionRunner.currentIndex + 1} / {missionRunner.total}</span>
              </div>
              <div className="flex items-center gap-2.5">
                <div className="flex items-center gap-2 px-3 py-1.5" style={{ borderRadius: 999, backgroundColor: "color-mix(in srgb, var(--mc-success) 14%, transparent)", border: "1px solid color-mix(in srgb, var(--mc-success) 35%, transparent)" }}>
                  <span className="w-2 h-2 rounded-full" style={{ backgroundColor: "var(--mc-success)" }} />
                  <span className="text-[12px] font-semibold" style={{ color: "var(--mc-success)" }}>Task running</span>
                </div>
              </div>
            </>
          ) : (
            <>
          <div className="flex items-center gap-3 min-w-0">
            <span className="text-[16px] font-bold tracking-tight" style={{ color: MISSION_TEXT }}>
              {WORKSPACE_STAGES.find((stage) => stage.id === workspaceStage)?.label}
            </span>
          </div>

          <div className="flex items-center gap-2">
            {workspaceStage === STAGE_MAPPING && (
              // Stop / Save Map live on the map canvas as the mapping HUD;
              // the header keeps only the session-level Start Mapping.
              <ActionButton active={busy === "Mapping" || mappingRuntimeActive} disabled={!!busy || mappingRuntimeActive || runRuntimeActive || runShutdownPending} onClick={handleStartMapping} variant="secondary">Start Mapping</ActionButton>
            )}
            {workspaceStage === STAGE_MAP_EDIT && (
              // The PGM picker moved out of the editor panel; the header keeps
              // the session-level Load Map like the Design and Run stages.
              <ActionButton active={showEditMapDialog || mapEditor.busy} disabled={!!busy || mapEditor.busy} onClick={handleOpenEditMapDialog} variant="secondary">Load Map</ActionButton>
            )}
            {workspaceStage === STAGE_AUTHORING && (
              // Undo/Redo moved into the design HUD on the map; the header
              // keeps only the session-level Load Map.
              <ActionButton active={showDesignMapDialog || designMapBusy} disabled={!!busy || designMapBusy} onClick={handleOpenDesignMapDialog} variant="secondary">Load Map</ActionButton>
            )}
            {runFamilyStage && (
              // Localize / actions live on the map HUD; the header keeps only
              // the session-level Load Map (shared by Run and Navigate).
              <ActionButton active={showRunMapDialog || runMapBusy} disabled={!!busy || running || missionRunnerActive || !!btNodeBusy || runMapBusy || runShutdownPending} onClick={handleOpenRunMapDialog} variant="secondary">Load Map</ActionButton>
            )}
            <div
              className="h-9 flex items-center gap-2 px-3 border shrink-0"
              style={{ borderRadius: 999, borderColor: MISSION_BORDER, backgroundColor: MISSION_STAGE_EMPTY }}
            >
              <span
                className="w-2 h-2 rounded-full shrink-0"
                style={{ backgroundColor: running ? "var(--mc-success)" : "var(--mc-text-subtle)" }}
                title={running ? "Navigation running" : "Navigation idle"}
                aria-label={running ? "Navigation running" : "Navigation idle"}
              />
              <span className="text-[12px] font-semibold whitespace-nowrap" style={{ color: running ? "var(--mc-success)" : MISSION_TEXT_MUTED }}>Status: {running ? "running" : "idle"}</span>
            </div>
          </div>
            </>
          )}
        </header>

        {/* content: map + inspector */}
        {/* Map Edit has no aside — every control lives on the map HUD, so the
            canvas takes the full width. */}
        <div className={`flex-1 min-h-0 grid grid-cols-1 ${waypointBtLayer || mappingEditorActive ? "" : "xl:grid-cols-[minmax(460px,1fr)_380px]"}`}>
          <section className="min-h-0 overflow-hidden relative" style={{ backgroundColor: "var(--mc-surface)", borderRight: "1px solid var(--mc-border)" }}>
          <MapViewer
            map={displayedMap}
            globalCostmap={mappingEditorActive ? null : needsGlobalCostmap ? globalCostmap : null}
            localCostmap={mappingEditorActive ? null : needsLocalCostmap ? localCostmap : null}
            scan={mappingEditorActive ? null : needsScan ? scan : null}
            scanPose={
              mappingEditorActive
                ? null
                : mappingTopicsActive
                  ? mappingPoseSync.scanPose
                  : runTopicsActive
                    ? runPoseSync.scanPose
                    : null
            }
            pose={mappingEditorActive ? null : (designLocalizationActive || stageNavigationTopicsActive) ? currentPose : null}
            goalPose={workspaceStage === STAGE_NAVIGATE ? navGoalPose : null}
            showGoalPose={workspaceStage === STAGE_NAVIGATE && !!navGoalPose && navGoalStatus !== "reached"}
            plan={mappingEditorActive ? null : needsPlan ? plan : null}
            footprint={mappingEditorActive ? null : needsRobotModel ? footprint : null}
            tf={mappingEditorActive ? null : (needsTf || needsRobotModel) ? displayTf : null}
            spots={missionOverlayActive ? visibleSpots : []}
            selectedSpotId={missionOverlayActive && workspaceStage === STAGE_AUTHORING ? selectedSpotId : ""}
            activeWaypointId={workspaceStage === STAGE_RUN ? missionRunner.activeSpotId : ""}
            missionFollowRobot={missionFollowRobot}
            behaviorNodes={missionOverlayActive ? activeBehaviorNodes : []}
            selectedBehaviorNodeId={missionOverlayActive ? selectedBehaviorNodeId : ""}
            behaviorPreviewNode={missionOverlayActive ? behaviorPreviewNode : null}
            missionRouteOrder={missionOverlayActive ? missionRouteOrder : []}
            missionRouteClosed={missionOverlayActive && missionRouteClosed}
            missionRouteMode={workspaceStage === STAGE_AUTHORING && missionRouteMode}
            selectedMissionRouteSourceId={missionRouteSourceId}
            mapAnnotations={
              mappingEditorActive
                ? mapEditor.annotations
                : workspaceStage === STAGE_AUTHORING && designMapActive && activeLayers.mapAreas
                  ? designMapEditor.annotations
                  : runFamilyStage && missionMapLoaded && activeLayers.mapAreas
                    ? runDisplayMapEditor.annotations
                    : []
            }
            selectedMapAnnotationId={mappingEditorActive ? mapEditor.selectedAnnotationId : ""}
            /* Every stage shows the raw occupancy grid — the beautified
               floor-plan rendering is disabled across Mission Canvas. */
            mapRefined={false}
            editorBrush={
              mappingEditorActive && mapEditor.map && EDITOR_BRUSH_RING_COLORS[mapEditor.tool]
                ? {
                  sizeCells: mapEditor.brushSize,
                  color: EDITOR_BRUSH_RING_COLORS[mapEditor.tool],
                }
                : null
            }
            btLayer={workspaceStage === STAGE_AUTHORING ? waypointBtLayer : runBtLayer}
            showMap={mappingEditorActive ? true : activeLayers.map}
            showGlobalCostmap={mappingEditorActive ? false : needsGlobalCostmap}
            showLocalCostmap={mappingEditorActive ? false : needsLocalCostmap}
            showScan={mappingEditorActive ? false : needsScan}
            showGlobalPlan={mappingEditorActive ? false : needsPlan}
            showTf={mappingEditorActive ? false : needsTf && activeLayers.tf}
            showRobotModel={mappingEditorActive ? false : needsRobotModel}
            interactionDisabled={
              !!busy ||
              (mappingEditorActive && mapEditor.busy) ||
              (designMapActive && designMapEditor.busy)
            }
            interactionMode={mappingEditorActive ? "view" : interactionMode}
            editorActive={mappingEditorActive && !!mapEditor.map && mapEditor.tool !== "view"}
            editorPaintOnDrag
            editorAreaSelection={mappingEditorActive && mapEditor.tool === "label_marker"}
            fitContainer
            viewKey={mappingEditorActive
              ? `mission-editor:${mapEditor.selectedPath || "none"}`
              : workspaceStage === STAGE_AUTHORING
                ? designMapActive
                  ? `mission-design:${designMapEditor.selectedPath || designMapPath || "none"}`
                  : "mission-design:none"
                : `mission:${mapName}:${displayedMap ? "ready" : "wait"}`}
            waitingLabel={mappingEditorActive
              ? "Load a map"
              : workspaceStage === STAGE_AUTHORING
                ? designMapActive ? "Loading selected map" : "Load a map"
                : running
                  ? "Waiting for /map"
                  : runDisplayMapEditor.busy ? "Loading map" : "Load a mission to view the map"}
            /* Selection is an authoring gesture; Run waypoints ignore clicks. */
            onSpotClick={workspaceStage === STAGE_AUTHORING && !waypointBtLayer ? (missionRouteMode ? handleMissionRouteSpotClick : handleSelectSpot) : undefined}
            onBehaviorNodeClick={workspaceStage === STAGE_AUTHORING && !waypointBtLayer ? handleSelectBehaviorNode : undefined}
            onMissionRouteSpotClick={handleMissionRouteSpotClick}
            onMissionRouteMapClick={handleMissionRouteMapClick}
            /* Waypoints are editable in Design only — Run must not even start
               a drag (a Run drag would just snap back, but shouldn't begin). */
            onSpotPoseChange={workspaceStage === STAGE_AUTHORING && !missionRouteMode && !waypointBtLayer ? handleMoveSpot : undefined}
            onBehaviorNodePoseChange={workspaceStage === STAGE_AUTHORING && !missionRouteMode && !waypointBtLayer ? handleMoveBehaviorNode : undefined}
            onEditorMapPoint={
              mapEditor.tool === "extend_area" || mapEditor.tool === "erase_area"
                ? mapEditor.editAreaAtMapPoint
                : mapEditor.editAtMapPoint
            }
            onEditorMapArea={mapEditor.tool === "label_marker" ? mapEditor.placeAnnotationAtMapArea : undefined}
            onMapClick={waypointBtLayer ? undefined : handleClearMapSelection}
            onMapPose={waypointBtLayer ? undefined : handleCreateSpotAtPose}
            onBtLayerClose={workspaceStage === STAGE_AUTHORING ? () => setBtLayerSpotId("") : undefined}
          />

          {workspaceStage === STAGE_AUTHORING && !waypointBtLayer && (
            <div className="absolute top-5 left-5 z-10 flex flex-col items-start gap-2">
              {/* HUD toolbar — top-left (glass): Create Waypoint + Edit Route.
                  z-20 keeps the waypoint options popover above the mission hub
                  below (both blur → stacking contexts, so DOM order would
                  otherwise paint the hub over the popover). */}
              <div
                className="relative z-20 flex items-center gap-2 p-2"
                style={{ borderRadius: 14, backgroundColor: "color-mix(in srgb, var(--mc-surface) 88%, transparent)", border: "1px solid var(--mc-border)", boxShadow: "var(--mc-shadow)", backdropFilter: "blur(8px)" }}
              >
                <div className="relative">
                  <button
                    type="button"
                    onClick={handleToggleWaypointOptions}
                    disabled={!designMapAvailable || missionRouteMode}
                    aria-label="Create Waypoint"
                    aria-pressed={(showWaypointOptions || interactionMode === "spot") ? true : undefined}
                    title={missionRouteMode ? "Turn off Edit Route first" : "Add a waypoint"}
                    className="h-8 w-8 inline-flex items-center justify-center disabled:opacity-45"
                    style={{ borderRadius: 9, border: "none", backgroundColor: (showWaypointOptions || interactionMode === "spot") ? "var(--mc-accent)" : "var(--mc-text)", color: (showWaypointOptions || interactionMode === "spot") ? "var(--mc-accent-fg)" : "var(--mc-bg)" }}
                  >
                    <MdAddLocationAlt size={17} aria-hidden="true" />
                  </button>
                  {showWaypointOptions && (
                    <div className="absolute left-0 top-[calc(100%+6px)] flex items-center gap-2 p-2" role="menu" aria-label="Waypoint creation options" style={{ borderRadius: 12, backgroundColor: "var(--mc-surface)", border: "1px solid var(--mc-border-strong)", boxShadow: "var(--mc-shadow)" }}>
                      <WaypointOptionButton active={interactionMode === "spot"} disabled={!designMapAvailable || missionRouteMode} onClick={handleToggleSpotMode}>On Map</WaypointOptionButton>
                      <WaypointOptionButton
                        active={interactionMode === "initial" || busy === "At Robot"}
                        disabled={!!busy || !designMapAvailable || missionRouteMode || runShutdownPending || mappingRuntimeActive || runRuntimeActive || missionRunnerActive}
                        onClick={handleCreateSpotAtRobot}
                      >
                        At Robot
                      </WaypointOptionButton>
                    </div>
                  )}
                </div>
                <button
                  type="button"
                  onClick={handleToggleMissionRouteMode}
                  disabled={!!busy || !designMapAvailable}
                  aria-label="Edit On Map"
                  aria-pressed={missionRouteMode ? true : undefined}
                  title="Edit the mission route on the map"
                  className="h-8 w-8 inline-flex items-center justify-center disabled:opacity-45"
                  style={{ borderRadius: 9, border: `1px solid ${missionRouteMode ? "var(--mc-accent)" : "var(--mc-border-strong)"}`, backgroundColor: missionRouteMode ? "var(--mc-accent-soft)" : "var(--mc-surface)", color: "var(--mc-text)" }}
                >
                  <MdRoute size={17} aria-hidden="true" />
                </button>
                <span className="h-5 w-px shrink-0" style={{ backgroundColor: "var(--mc-border)" }} aria-hidden="true" />
                <button
                  type="button"
                  onClick={handleUndoDesign}
                  disabled={designHistoryLocked || !canUndoDesign}
                  aria-label="Undo"
                  title="Undo (Ctrl+Z)"
                  className="h-8 w-8 inline-flex items-center justify-center disabled:opacity-45"
                  style={{ borderRadius: 9, border: "1px solid var(--mc-border-strong)", backgroundColor: "var(--mc-surface)", color: "var(--mc-text)" }}
                >
                  <MdUndo size={17} aria-hidden="true" />
                </button>
                <button
                  type="button"
                  onClick={handleRedoDesign}
                  disabled={designHistoryLocked || !canRedoDesign}
                  aria-label="Redo"
                  title="Redo (Ctrl+Shift+Z)"
                  className="h-8 w-8 inline-flex items-center justify-center disabled:opacity-45"
                  style={{ borderRadius: 9, border: "1px solid var(--mc-border-strong)", backgroundColor: "var(--mc-surface)", color: "var(--mc-text)" }}
                >
                  <MdRedo size={17} aria-hidden="true" />
                </button>
              </div>

              {/* Mission hub — create/save/rename/duplicate/delete, right under
                  the authoring tools so mission management sits with editing. */}
              {designMapActive && (
                <div
                  className="w-[210px] grid gap-1.5 p-2.5"
                  style={{ borderRadius: 14, backgroundColor: "color-mix(in srgb, var(--mc-surface) 88%, transparent)", border: "1px solid var(--mc-border)", boxShadow: "var(--mc-shadow)", backdropFilter: "blur(8px)" }}
                >
                  {/* The rail session card is gone; the loaded map is named here.
                      Mono per the page's data-typography rule (names/paths). */}
                  <div className="text-[11px] font-mono truncate" style={{ color: "var(--mc-text-muted)" }}>
                    {currentMapName}
                  </div>
                  <label className="grid gap-1">
                    {/* Mono styling stays on the caption span only, so the select
                        inherits the page's Hanken Grotesk instead of fighting it. */}
                    <span className="text-[10px] font-mono tracking-[0.12em]" style={{ color: "var(--mc-text-subtle)" }}>
                      MISSION
                    </span>
                    <select
                      aria-label="Active mission"
                      value={missionName}
                      disabled={designMapBusy || !!busy}
                      onChange={(event) => {
                        const name = event.currentTarget.value;
                        runGuardedDesignAction(() => handleDesignMissionChange(name));
                      }}
                      className="w-full h-7 px-2 text-xs font-medium"
                      style={{ borderRadius: 8, color: "var(--mc-text)", backgroundColor: "var(--mc-surface-2)", border: "1px solid var(--mc-border-strong)" }}
                    >
                      {(designCatalog.names.includes(missionName)
                        ? designCatalog.names
                        : [...designCatalog.names, missionName]
                      ).map((name) => (
                        <option key={name} value={name}>
                          {designCatalog.names.includes(name) ? name : `${name} (unsaved)`}
                        </option>
                      ))}
                    </select>
                  </label>
                  <button
                    type="button"
                    aria-label="Save Mission"
                    title={designMissionLoadError
                      ? "Reload the mission before saving"
                      : "Save Mission"}
                    disabled={!!busy || designMapBusy || !!designMissionLoadError}
                    onClick={handleSaveMission}
                    className="w-full h-7 text-[11px] font-semibold disabled:opacity-40"
                    style={{ borderRadius: 8, border: "1px solid transparent", backgroundColor: "var(--mc-accent)", color: "var(--mc-accent-fg)" }}
                  >
                    Save
                  </button>
                  <div className="flex gap-1.5">
                    {[
                      {
                        label: "New Mission",
                        Icon: MdAdd,
                        onClick: () => runGuardedDesignAction(startNewMission),
                        disabled: !!busy || designMapBusy,
                      },
                      { label: "Rename mission", Icon: MdEdit, onClick: handleOpenRenameMissionDialog },
                      { label: "Duplicate mission", Icon: MdContentCopy, onClick: handleOpenDuplicateMissionDialog },
                      { label: "Delete mission", Icon: MdDelete, onClick: () => setShowDeleteMissionDialog(true) },
                    ].map(({ label, Icon, onClick, disabled }) => (
                      <button
                        key={label}
                        type="button"
                        aria-label={label}
                        title={label}
                        disabled={disabled ?? (
                          !!busy ||
                          designMapBusy ||
                          missionRunnerActive ||
                          !designCatalog.names.includes(missionName)
                        )}
                        onClick={onClick}
                        className="flex-1 flex items-center justify-center h-7 disabled:opacity-40"
                        style={{ borderRadius: 8, border: "1px solid var(--mc-border-strong)", backgroundColor: "var(--mc-surface-2)", color: "var(--mc-text-muted)" }}
                      >
                        <Icon size={13} />
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Mapping HUD — Save Map / Stop float over the map as icon
              buttons while recording; Start Mapping stays in the header. */}
          {workspaceStage === STAGE_MAPPING && (
            <div
              className="absolute top-5 left-5 z-10 flex items-center gap-2 p-2"
              style={{ borderRadius: 14, backgroundColor: "color-mix(in srgb, var(--mc-surface) 88%, transparent)", border: "1px solid var(--mc-border)", boxShadow: "var(--mc-shadow)", backdropFilter: "blur(8px)" }}
            >
              <button
                type="button"
                onClick={handleOpenSaveMapDialog}
                disabled={!!busy || !mappingRuntimeActive}
                aria-label="Save Map"
                aria-pressed={(showSaveMapDialog || busy === "Save map") ? true : undefined}
                title="Save the mapped floor plan"
                className="h-8 w-8 inline-flex items-center justify-center disabled:opacity-45"
                style={{
                  borderRadius: 9,
                  border: `1px solid ${(showSaveMapDialog || busy === "Save map") ? "var(--mc-accent)" : "var(--mc-border-strong)"}`,
                  backgroundColor: (showSaveMapDialog || busy === "Save map") ? "var(--mc-accent-soft)" : "var(--mc-surface)",
                  color: "var(--mc-text)",
                }}
              >
                <MdSave size={17} aria-hidden="true" />
              </button>
              <button
                type="button"
                onClick={handleStopNavigation}
                disabled={!!busy || !mappingRuntimeActive}
                aria-label="Stop"
                aria-pressed={busy === "Stop" ? true : undefined}
                title="Stop mapping"
                className="h-8 w-8 inline-flex items-center justify-center disabled:opacity-45"
                style={{
                  borderRadius: 9,
                  border: "1px solid var(--mc-danger-border)",
                  backgroundColor: busy === "Stop" ? "var(--mc-danger)" : "var(--mc-surface)",
                  color: busy === "Stop" ? "var(--mc-accent-fg)" : "var(--mc-danger)",
                }}
              >
                <MdStop size={18} aria-hidden="true" />
              </button>
              <span className="h-5 w-px shrink-0" style={{ backgroundColor: "var(--mc-border)" }} aria-hidden="true" />
              {/* Deleting saved maps also lives here — maps are created in
                  this stage, so this is where they are removed too. Only a
                  map the navigation runtime is actively using is locked;
                  designMapPath is restored from storage and would otherwise
                  pin the last-designed map forever. */}
              <MapDeleteControl
                files={savedMaps}
                disabled={!!busy}
                protectedPaths={
                  (running || missionRunnerActive || runShutdownPending) && runMapPath
                    ? [runMapPath]
                    : []
                }
                onDelete={handleDeleteSavedMap}
                dialogHost={dialogHost}
              />
            </div>
          )}

          {/* Map Edit HUD — View / Map Edit / Add Label / Undo / Redo / Save
              icons on one glass row; Map Edit and Add Label open text-button
              popovers below (the Design HUD's waypoint-options idiom). */}
          {workspaceStage === STAGE_MAP_EDIT && (
            <div
              className="absolute top-5 left-5 z-20 flex items-center gap-2 p-2"
              style={{ borderRadius: 14, backgroundColor: "color-mix(in srgb, var(--mc-surface) 88%, transparent)", border: "1px solid var(--mc-border)", boxShadow: "var(--mc-shadow)", backdropFilter: "blur(8px)" }}
            >
              <MapEditToolButton
                label="View"
                active={mapEditor.tool === "view"}
                disabled={mapEditor.busy || !mapEditor.image}
                onClick={() => {
                  mapEditor.setTool("view");
                  setMapEditToolsOpen(false);
                  setLabelToolsOpen(false);
                }}
              >
                <MdVisibility size={17} aria-hidden="true" />
              </MapEditToolButton>
              <div className="relative">
                <MapEditToolButton
                  label="Map Edit"
                  active={mapEditToolsOpen || MAP_EDIT_PIXEL_TOOL_IDS.includes(mapEditor.tool)}
                  disabled={mapEditor.busy || !mapEditor.image}
                  onClick={() => {
                    setMapEditToolsOpen((open) => !open);
                    setLabelToolsOpen(false);
                  }}
                >
                  <MdEdit size={16} aria-hidden="true" />
                </MapEditToolButton>
                {mapEditToolsOpen && (
                  <div
                    className="absolute left-0 top-[calc(100%+6px)] grid gap-2 p-2"
                    role="menu"
                    aria-label="Map edit tools"
                    style={{ borderRadius: 12, backgroundColor: "var(--mc-surface)", border: "1px solid var(--mc-border-strong)", boxShadow: "var(--mc-shadow)" }}
                  >
                    <div className="flex items-center gap-2">
                      {EDIT_TOOLS.map((editTool) => (
                        <WaypointOptionButton
                          key={editTool.id}
                          active={mapEditor.tool === editTool.id}
                          disabled={mapEditor.busy}
                          onClick={() => mapEditor.setTool(editTool.id)}
                        >
                          {editTool.label}
                        </WaypointOptionButton>
                      ))}
                    </div>
                    <MapEditBrushRow brushSize={mapEditor.brushSize} setBrushSize={mapEditor.setBrushSize} disabled={mapEditor.busy} />
                  </div>
                )}
              </div>
              <div className="relative">
                <MapEditToolButton
                  label="Add Label"
                  active={labelToolsOpen || MAP_EDIT_AREA_TOOL_IDS.includes(mapEditor.tool)}
                  disabled={mapEditor.busy || !mapEditor.image}
                  onClick={() => {
                    setLabelToolsOpen((open) => !open);
                    setMapEditToolsOpen(false);
                  }}
                >
                  <MdLabel size={16} aria-hidden="true" />
                </MapEditToolButton>
                {labelToolsOpen && (
                  <div
                    className="absolute left-0 top-[calc(100%+6px)] z-30 isolate grid w-80 max-w-[calc(100vw-2rem)] gap-2 p-2 pointer-events-auto"
                    role="menu"
                    aria-label="Map labeling tools"
                    onPointerDown={(event) => event.stopPropagation()}
                    onClick={(event) => event.stopPropagation()}
                    style={{ borderRadius: 12, backgroundColor: "var(--mc-surface)", border: "1px solid var(--mc-border-strong)", boxShadow: "var(--mc-shadow)" }}
                  >
                    <div className="flex items-center gap-2">
                      {MAP_EDIT_AREA_TOOLS.map((areaTool) => (
                        <WaypointOptionButton
                          key={areaTool.id}
                          active={mapEditor.tool === areaTool.id}
                          disabled={mapEditor.busy}
                          onClick={() => mapEditor.setTool(areaTool.id)}
                        >
                          {areaTool.label}
                        </WaypointOptionButton>
                      ))}
                    </div>
                    {/* Contextual rows: Area drags a rectangle (no brush) and
                        gets the name input; Extend/Erase stroke with the
                        shared brush and pick their target in the list, which
                        every area tool shares. */}
                    {(mapEditor.tool === ANNOTATION_EXTEND_TOOL.id || mapEditor.tool === ANNOTATION_ERASE_TOOL.id) && (
                      <MapEditBrushRow brushSize={mapEditor.brushSize} setBrushSize={mapEditor.setBrushSize} disabled={mapEditor.busy} />
                    )}
                    {MAP_EDIT_AREA_TOOL_IDS.includes(mapEditor.tool) && (
                      <MapAreaManager mapEditor={mapEditor} showNameInput={mapEditor.tool === ANNOTATION_TOOL.id} />
                    )}
                  </div>
                )}
              </div>
              <span className="h-5 w-px shrink-0" style={{ backgroundColor: "var(--mc-border)" }} aria-hidden="true" />
              <button
                type="button"
                onClick={mapEditor.undo}
                disabled={mapEditor.busy || !mapEditor.canUndo}
                aria-label="Undo"
                title="Undo (Ctrl+Z)"
                className="h-8 w-8 inline-flex items-center justify-center disabled:opacity-45"
                style={{ borderRadius: 9, border: "1px solid var(--mc-border-strong)", backgroundColor: "var(--mc-surface)", color: "var(--mc-text)" }}
              >
                <MdUndo size={17} aria-hidden="true" />
              </button>
              <button
                type="button"
                onClick={mapEditor.redo}
                disabled={mapEditor.busy || !mapEditor.canRedo}
                aria-label="Redo"
                title="Redo (Ctrl+Shift+Z)"
                className="h-8 w-8 inline-flex items-center justify-center disabled:opacity-45"
                style={{ borderRadius: 9, border: "1px solid var(--mc-border-strong)", backgroundColor: "var(--mc-surface)", color: "var(--mc-text)" }}
              >
                <MdRedo size={17} aria-hidden="true" />
              </button>
              <span className="h-5 w-px shrink-0" style={{ backgroundColor: "var(--mc-border)" }} aria-hidden="true" />
              <button
                type="button"
                onClick={mapEditor.save}
                disabled={mapEditor.busy || !mapEditor.dirty}
                aria-label="Save"
                title="Save map changes"
                className="h-8 w-8 inline-flex items-center justify-center disabled:opacity-45"
                style={{ borderRadius: 9, border: "1px solid var(--mc-border-strong)", backgroundColor: "var(--mc-surface)", color: "var(--mc-text)" }}
              >
                <MdSave size={17} aria-hidden="true" />
              </button>
            </div>
          )}

          {/* Loaded-file chip — the Map Edit aside is gone, so the current
              PGM and its unsaved state surface here (top-right, where the
              other stages put the Layers popover). */}
          {workspaceStage === STAGE_MAP_EDIT && mapEditor.selectedPath && (
            <div
              className="absolute top-5 right-5 z-10 flex h-9 items-center gap-1.5 px-3.5 text-[11px] font-mono"
              style={{ borderRadius: 999, backgroundColor: "color-mix(in srgb, var(--mc-surface) 88%, transparent)", border: "1px solid var(--mc-border)", boxShadow: "var(--mc-shadow)", backdropFilter: "blur(8px)", color: "var(--mc-text-muted)" }}
            >
              <span className="max-w-[260px] truncate">{mapEditor.selectedPath}</span>
              {mapEditor.image && (
                <span className="shrink-0" style={{ color: "var(--mc-text-subtle)" }}>
                  {mapEditor.image.width} × {mapEditor.image.height}
                </span>
              )}
              {mapEditor.dirty && <span className="shrink-0" style={{ color: "var(--mc-accent)" }}>· unsaved</span>}
            </div>
          )}

          {/* Run HUD — Localize / Run Mission / Stop float over the map as
              icon buttons (same glass idiom as the Design HUD). Stays visible
              during the BT split view so Stop is always reachable. */}
          {workspaceStage === STAGE_RUN && (
            <div
              className="absolute top-5 left-5 z-10 flex items-center gap-2 p-2"
              style={{ borderRadius: 14, backgroundColor: "color-mix(in srgb, var(--mc-surface) 88%, transparent)", border: "1px solid var(--mc-border)", boxShadow: "var(--mc-shadow)", backdropFilter: "blur(8px)" }}
            >
              <button
                type="button"
                onClick={handleLocalize}
                disabled={!!busy || runMapBusy || !missionMapLoaded || runMapSnapshotInvalid || runShutdownPending}
                aria-label="Localize"
                aria-pressed={(interactionMode === "initial" || busy === "Localize" || busy === "Set robot pose") ? true : undefined}
                title="Bring navigation up and set the robot pose"
                className="h-8 w-8 inline-flex items-center justify-center disabled:opacity-45"
                style={{
                  borderRadius: 9,
                  border: `1px solid ${(interactionMode === "initial" || busy === "Localize" || busy === "Set robot pose") ? "var(--mc-accent)" : "var(--mc-border-strong)"}`,
                  backgroundColor: (interactionMode === "initial" || busy === "Localize" || busy === "Set robot pose") ? "var(--mc-accent-soft)" : "var(--mc-surface)",
                  color: "var(--mc-text)",
                }}
              >
                <MdMyLocation size={17} aria-hidden="true" />
              </button>
              <button
                type="button"
                onClick={handleRunMission}
                disabled={!!busy || !!btNodeBusy || runMapBusy || !missionMapLoaded || runMapSnapshotInvalid || !runPoseInitialized || missionRunnerActive || runShutdownPending}
                aria-label="Run Mission"
                aria-pressed={(busy === "Run mission" || missionRunnerActive) ? true : undefined}
                title="Run the mission route"
                className="h-8 w-8 inline-flex items-center justify-center disabled:opacity-45"
                style={{ borderRadius: 9, border: "none", backgroundColor: "var(--mc-success)", color: "var(--mc-accent-fg)" }}
              >
                <MdPlayArrow size={19} aria-hidden="true" />
              </button>
              <button
                type="button"
                onClick={handleStopNavigation}
                disabled={!!busy || missionRunnerStopping || (!running && !missionRunnerActive && !runShutdownPending)}
                aria-label="Stop"
                aria-pressed={(busy === "Stop" || runShutdownPending) ? true : undefined}
                title="Stop the mission and navigation"
                className="h-8 w-8 inline-flex items-center justify-center disabled:opacity-45"
                style={{
                  borderRadius: 9,
                  border: "1px solid var(--mc-danger-border)",
                  backgroundColor: (busy === "Stop" || runShutdownPending) ? "var(--mc-danger)" : "var(--mc-surface)",
                  color: (busy === "Stop" || runShutdownPending) ? "var(--mc-accent-fg)" : "var(--mc-danger)",
                }}
              >
                <MdStop size={18} aria-hidden="true" />
              </button>
            </div>
          )}

          {/* Navigate HUD — Localize / Set Goal / Stop. Set Goal arms the
              map: click (or drag for heading) sends a NavigateToPose goal and
              nav2 plans the path. Stop cancels the current goal and tears the
              navigation runtime down in one operation. */}
          {workspaceStage === STAGE_NAVIGATE && (
            <div
              className="absolute top-5 left-5 z-10 flex items-center gap-2 p-2"
              style={{ borderRadius: 14, backgroundColor: "color-mix(in srgb, var(--mc-surface) 88%, transparent)", border: "1px solid var(--mc-border)", boxShadow: "var(--mc-shadow)", backdropFilter: "blur(8px)" }}
            >
              <button
                type="button"
                onClick={handleLocalize}
                disabled={!!busy || runMapBusy || !missionMapLoaded || runShutdownPending}
                aria-label="Localize"
                aria-pressed={(interactionMode === "initial" || busy === "Localize" || busy === "Set robot pose") ? true : undefined}
                title="Bring navigation up and set the robot pose"
                className="h-8 w-8 inline-flex items-center justify-center disabled:opacity-45"
                style={{
                  borderRadius: 9,
                  border: `1px solid ${(interactionMode === "initial" || busy === "Localize" || busy === "Set robot pose") ? "var(--mc-accent)" : "var(--mc-border-strong)"}`,
                  backgroundColor: (interactionMode === "initial" || busy === "Localize" || busy === "Set robot pose") ? "var(--mc-accent-soft)" : "var(--mc-surface)",
                  color: "var(--mc-text)",
                }}
              >
                <MdMyLocation size={17} aria-hidden="true" />
              </button>
              <button
                type="button"
                onClick={() => setInteractionMode((mode) => (mode === "goal" ? "view" : "goal"))}
                disabled={!!busy || runMapBusy || !missionMapLoaded || !runPoseInitialized || runShutdownPending}
                aria-label="Set Goal"
                aria-pressed={interactionMode === "goal" ? true : undefined}
                title="Click the map to send a navigation goal"
                className="h-8 w-8 inline-flex items-center justify-center disabled:opacity-45"
                style={{
                  borderRadius: 9,
                  border: `1px solid ${interactionMode === "goal" ? "var(--mc-accent)" : "var(--mc-border-strong)"}`,
                  backgroundColor: interactionMode === "goal" ? "var(--mc-accent-soft)" : "var(--mc-surface)",
                  color: "var(--mc-text)",
                }}
              >
                <MdOutlinedFlag size={17} aria-hidden="true" />
              </button>
              <button
                type="button"
                onClick={handleStopNavigation}
                disabled={!!busy || (!running && !navGoalDriving && !runShutdownPending)}
                aria-label="Stop"
                aria-pressed={(busy === "Stop" || runShutdownPending) ? true : undefined}
                title="Stop the current goal and navigation"
                className="h-8 w-8 inline-flex items-center justify-center disabled:opacity-45"
                style={{
                  borderRadius: 9,
                  border: "1px solid var(--mc-danger-border)",
                  backgroundColor: (busy === "Stop" || runShutdownPending) ? "var(--mc-danger)" : "var(--mc-surface)",
                  color: (busy === "Stop" || runShutdownPending) ? "var(--mc-accent-fg)" : "var(--mc-danger)",
                }}
              >
                <MdStop size={18} aria-hidden="true" />
              </button>
            </div>
          )}

          {/* Layers popover — hidden during the BT split view and in the map
              editor, where every live layer is forced off anyway. */}
          {!activeBtLayer && !mappingEditorActive && <LayersPopover layerToggles={layerToggles} />}
        </section>

        {workspaceStage === STAGE_AUTHORING ? (!waypointBtLayer ? (
          <aside className="min-h-0 grid grid-rows-[minmax(0,1fr)_minmax(220px,0.7fr)] gap-4 overflow-hidden p-4">
            {/* Waypoints — LIST ONLY (Create moved to the map HUD) */}
            <div className="min-h-0 overflow-auto" style={{ backgroundColor: "var(--mc-surface)", border: "1px solid var(--mc-border)", borderRadius: 16, boxShadow: "var(--mc-shadow)", padding: 18 }}>
              <div className="flex items-center justify-between mb-3.5">
                <span className="text-[13.5px] font-bold">Waypoints</span>
                <span className="text-[11px] font-mono" style={{ color: "var(--mc-text-subtle)" }}>{designPanelSpots.length}</span>
              </div>
              <div className="grid gap-2">
                {designPanelSpots.map((spot) => {
                  const selected = spot.id === selectedSpotId;
                  const editing = editingSpotId === spot.id;
                  return (
                    <div key={spot.id} className="grid gap-1.5 min-w-0" style={{ padding: 8, borderRadius: 12, border: `1px solid ${selected ? "var(--mc-accent)" : "var(--mc-border)"}`, backgroundColor: selected ? "var(--mc-accent-soft)" : "var(--mc-surface-2)" }}>
                      <div className="flex items-center gap-1.5 min-w-0">
                        {editing ? (
                          <input aria-label="Waypoint name" value={editingSpotLabel} autoFocus
                            onChange={(e) => setEditingSpotLabel(e.currentTarget.value)}
                            onBlur={() => { void handleCommitSpotRename(spot); }}
                            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void handleCommitSpotRename(spot); } if (e.key === "Escape") { e.preventDefault(); handleCancelSpotRename(); } }}
                            className="h-8 flex-1 px-2 text-[13px] min-w-0" style={{ borderRadius: 8, border: "1px solid var(--mc-border-strong)", backgroundColor: "var(--mc-surface)", color: "var(--mc-text)" }} />
                        ) : (
                          <button
                            type="button"
                            onClick={() => (
                              missionRouteMode
                                ? handleMissionRouteSpotClick(spot.id)
                                : handleSelectSpot(spot.id)
                            )}
                            onDoubleClick={missionRouteMode ? undefined : () => handleStartRenameSpot(spot)}
                            className="h-8 flex-1 px-2.5 text-left text-[12.5px] font-semibold min-w-0"
                            style={{ borderRadius: 8, border: "1px solid var(--mc-border)", backgroundColor: "var(--mc-surface)", color: "var(--mc-text)" }}>
                            <span className="block truncate">{spot.label || spot.id}</span>
                          </button>
                        )}
                        <button
                          type="button"
                          aria-label={`Edit Task for ${spot.label || spot.id}`}
                          title={`Edit ${spot.label || spot.id} Waypoint Task`}
                          onClick={() => handleOpenWaypointBt(spot.id)}
                          className="h-8 shrink-0 px-2.5 text-[11.5px] font-semibold active:translate-y-px"
                          style={{ borderRadius: 8, border: "1px solid var(--mc-border-strong)", backgroundColor: "var(--mc-surface)", color: "var(--mc-text-muted)" }}
                        >
                          Edit Task
                        </button>
                        <button type="button" aria-label={`Delete Waypoint ${spot.label || spot.id}`} title={`Delete ${spot.label || spot.id}`} disabled={!!busy} onClick={() => { void handleDeleteSpot(spot); }}
                          className="h-8 w-8 shrink-0 inline-flex items-center justify-center active:translate-y-px disabled:opacity-45"
                          style={{ borderRadius: 8, border: "1px solid var(--mc-border-strong)", backgroundColor: "var(--mc-surface)", color: "var(--mc-danger)" }}>
                          <MdDelete size={15} />
                        </button>
                      </div>
                    </div>
                  );
                })}
                {designPanelSpots.length === 0 && <div className="text-[12px]" style={{ color: "var(--mc-text-muted)" }}>No waypoints for this map yet.</div>}
                {designPanelBehaviorNodes.map((node) => {
                  const selected = node.id === selectedBehaviorNodeId;
                  return (
                    <div key={node.id} className="flex items-center gap-1.5 min-w-0">
                      <button type="button" onClick={() => handleSelectBehaviorNode(node.id)} className="h-8 flex-1 px-2.5 text-left text-[12px] font-semibold min-w-0"
                        style={{ borderRadius: 8, border: `1px solid ${selected ? "var(--mc-accent)" : "var(--mc-border)"}`, backgroundColor: selected ? "var(--mc-accent-soft)" : "var(--mc-surface-2)", color: "var(--mc-text)" }}>
                        <span className="block truncate">{node.tag}</span>
                      </button>
                      <button type="button" aria-label={`Delete Node ${node.tag}`} title={`Delete ${node.tag}`} onClick={() => handleDeleteBehaviorNode(node)}
                        className="h-8 w-8 shrink-0 inline-flex items-center justify-center active:translate-y-px"
                        style={{ borderRadius: 8, border: "1px solid var(--mc-border-strong)", backgroundColor: "var(--mc-surface)", color: "var(--mc-danger)" }}>
                        <MdDelete size={15} />
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Mission Route — LIST ONLY (Edit/Clear moved to the map HUD) */}
            {/* Route-edit mode is signalled by the card itself (accent border +
                title dot) instead of a third header chip, so the header stays
                one clean row: title · closed-loop chip · Clear Route. */}
            <div
              className="min-h-0 overflow-hidden"
              aria-label={missionRouteMode ? "Mission Route (editing on map)" : "Mission Route"}
              style={{ backgroundColor: "var(--mc-surface)", border: `1px solid ${missionRouteMode ? "var(--mc-accent)" : "var(--mc-border)"}`, borderRadius: 16, boxShadow: "var(--mc-shadow)", padding: 18 }}
            >
              <div className="h-full min-h-0 grid grid-rows-[auto_minmax(0,1fr)] gap-2.5">
                <div className="flex items-center justify-between">
                  <span className="inline-flex items-center gap-2 text-[13.5px] font-bold" style={{ color: missionRouteMode ? "var(--mc-accent-hover)" : "var(--mc-text)" }}>
                    {missionRouteMode && (
                      <span aria-hidden="true" className="inline-block shrink-0" style={{ width: 8, height: 8, borderRadius: 999, backgroundColor: "var(--mc-accent)" }} />
                    )}
                    Mission Route
                  </span>
                  <div className="flex items-center gap-1.5">
                    {designPanelRouteClosed && <span className="text-[10.5px] font-mono px-2 py-1" style={{ borderRadius: 6, backgroundColor: "color-mix(in srgb, var(--mc-success) 14%, transparent)", color: "var(--mc-success)" }}>closed loop</span>}
                    {/* Only while a route exists — map clicks can only ADD
                        edges, so this is the sole way to discard a route (or a
                        closed loop) without deleting waypoints. */}
                    {missionRouteMode && designDocumentReady && missionFlowEdges.length > 0 && (
                      <button
                        type="button"
                        onClick={handleClearMissionRoute}
                        disabled={!!busy}
                        aria-label="Clear Route"
                        title="Remove all route connections (waypoints stay)"
                        className="h-7 px-2.5 text-[11px] font-semibold disabled:opacity-45 active:translate-y-px"
                        style={{ borderRadius: 7, border: "1px solid var(--mc-border-strong)", backgroundColor: "var(--mc-surface)", color: "var(--mc-danger)" }}
                      >
                        Clear Route
                      </button>
                    )}
                  </div>
                </div>
                <div className="min-h-0 overflow-auto pr-1">
                  <div className="grid gap-0">
                    {designPanelRouteSpots.map((spot, index) => {
                      const selected = spot.id === selectedSpotId;
                      const routeEnd = index === designPanelRouteSpots.length - 1;
                      const last = routeEnd && !designPanelRouteClosed;
                      return (
                        <div key={spot.id}>
                          <div className="flex gap-3 items-stretch">
                            <div className="flex flex-col items-center" style={{ width: 26 }}>
                              <span className="h-[26px] w-[26px] shrink-0 rounded-full inline-flex items-center justify-center text-[11px] font-semibold font-mono" style={{ color: "var(--mc-accent-fg)", backgroundColor: "var(--mc-accent)" }}>{index + 1}</span>
                              {!last && <span className="flex-1 my-0.5" style={{ width: 2, backgroundColor: "var(--mc-border)" }} />}
                            </div>
                            <div className="flex-1 mb-2 grid grid-cols-[1fr_auto] items-center gap-2 min-w-0" style={{ padding: 10, borderRadius: 11, border: `1px solid ${selected ? "var(--mc-accent)" : "var(--mc-border)"}`, backgroundColor: selected ? "var(--mc-accent-soft)" : "var(--mc-surface-2)" }}>
                              <button
                                type="button"
                                onClick={() => (
                                  missionRouteMode
                                    ? handleMissionRouteSpotClick(spot.id)
                                    : handleSelectSpot(spot.id)
                                )}
                                className="min-w-0 text-left"
                              >
                                <span className="block truncate text-[12.5px] font-semibold" style={{ color: "var(--mc-text)" }}>{spot.label || spot.id}</span>
                                <span className="block truncate text-[10px] font-mono" style={{ color: "var(--mc-text-subtle)" }}>{localBtPathForSpot(spot)}</span>
                              </button>
                              {missionRouteMode && <div className="flex items-center gap-1">
                                <button type="button" aria-label={`Move ${spot.label || spot.id} up`} disabled={!!busy || index === 0} onClick={() => handleMoveRouteSpot(spot.id, -1)} className="h-7 w-7 text-[12px] font-semibold disabled:opacity-40" style={{ borderRadius: 7, border: "1px solid var(--mc-border-strong)", backgroundColor: "var(--mc-surface)", color: "var(--mc-text-muted)" }}>↑</button>
                                <button type="button" aria-label={`Move ${spot.label || spot.id} down`} disabled={!!busy || routeEnd} onClick={() => handleMoveRouteSpot(spot.id, 1)} className="h-7 w-7 text-[12px] font-semibold disabled:opacity-40" style={{ borderRadius: 7, border: "1px solid var(--mc-border-strong)", backgroundColor: "var(--mc-surface)", color: "var(--mc-text-muted)" }}>↓</button>
                                {/* Route membership only — deleting the spot
                                    itself lives in the Waypoints panel. */}
                                <button type="button" aria-label={`Remove ${spot.label || spot.id} from route`} title="Remove from route (waypoint stays)" disabled={!!busy} onClick={() => handleRemoveRouteSpot(spot.id)}
                                  className="h-7 w-7 shrink-0 inline-flex items-center justify-center text-[13px] leading-none active:translate-y-px disabled:opacity-40"
                                  style={{ borderRadius: 7, border: "1px solid var(--mc-border-strong)", backgroundColor: "var(--mc-surface)", color: "var(--mc-danger)" }}>
                                  ×
                                </button>
                              </div>}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                    {designPanelRouteClosed && designPanelRouteSpots.length > 1 && (
                      <div className="flex gap-3 items-stretch" aria-label={`Return to ${designPanelRouteSpots[0].label || designPanelRouteSpots[0].id}`}>
                        <div className="flex flex-col items-center" style={{ width: 26 }}>
                          <span className="h-[26px] w-[26px] shrink-0 rounded-full inline-flex items-center justify-center text-[13px] font-semibold" style={{ color: "var(--mc-success)", backgroundColor: "color-mix(in srgb, var(--mc-success) 14%, transparent)", border: "1px solid var(--mc-success)" }}>↻</span>
                        </div>
                        <div className="flex-1 mb-2 grid grid-cols-[1fr_auto] items-center gap-2 min-w-0" style={{ padding: 10, borderRadius: 11, border: "1px solid var(--mc-success)", backgroundColor: "color-mix(in srgb, var(--mc-success) 10%, transparent)" }}>
                          <div className="min-w-0">
                            <span className="block truncate text-[12.5px] font-semibold" style={{ color: "var(--mc-success)" }}>
                              Return to {designPanelRouteSpots[0].label || designPanelRouteSpots[0].id}
                            </span>
                            <span className="block truncate text-[10px] font-mono" style={{ color: "var(--mc-text-subtle)" }}>Loop closure</span>
                          </div>
                          {missionRouteMode && (
                            <button type="button" aria-label="Open loop" title="Remove the loop closure so the route can be edited again"
                              disabled={!!busy}
                              onClick={handleOpenMissionRouteLoop}
                              className="h-7 w-7 shrink-0 inline-flex items-center justify-center text-[13px] leading-none active:translate-y-px disabled:opacity-40"
                              style={{ borderRadius: 7, border: "1px solid var(--mc-border-strong)", backgroundColor: "var(--mc-surface)", color: "var(--mc-danger)" }}>
                              ×
                            </button>
                          )}
                        </div>
                      </div>
                    )}
                    {designPanelRouteSpots.length === 0 && (
                      <div className="text-[12px]" style={{ color: "var(--mc-text-muted)" }}>
                        {missionRouteMode
                          ? "Click waypoints on the map or in the list to build the route."
                          : "Turn on Edit Route to build the mission route."}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </aside>
        ) : null) : mappingEditorActive ? null : (
          <aside className="min-h-0 grid gap-4 overflow-auto p-4 content-start">
            {/* Teleop drives the robot while recording, so it's mapping-only. */}
            {workspaceStage === STAGE_MAPPING && (
              <MappingTeleopPanel
                disabled={teleopDisabled}
                onPublish={publishTeleopCommand}
                onMessage={setMessage}
              />
            )}
            {workspaceStage === STAGE_MAPPING ? (
              <MappingSessionPanel />
            ) : workspaceStage === STAGE_NAVIGATE ? (
              <NavigateSessionPanel
                mapName={currentMapName}
                poseReady={runPoseInitialized}
                goalStatus={navGoalStatus}
              />
            ) : (
              // Run Mission activates a missing BT node on demand and only
              // releases a process it started itself, so this panel needs no
              // manual Activate/Deactivate controls.
              <RunSessionPanel
                mapName={missionMapLoaded && !runMapSnapshotInvalid ? runMapName : ""}
                running={running}
                runner={missionRunner}
                poseReady={runPoseInitialized}
                missionName={runMissionName}
                missionNames={runCatalog.names}
                missionSelectDisabled={!!busy || missionRunnerActive || runMapBusy || !missionMapLoaded}
                onMissionChange={handleMissionChange}
              />
            )}
            <TopicStatusPanel topicRows={topicRows} />
          </aside>
        )}
      </div>
      </div>
      </div>
    </>
  );
}
