# Nav + BT Manager Integration README

## Purpose

This document summarizes the proposed software direction for integrating the
Navigation UI and BT Manager in Cyclo Intelligence.

The target product shape is:

```text
ai_worker            = fixed Nav2 runtime engine
cyclo_intelligence   = UX, Spot model, BT editing, BT execution orchestration
```

The long-term UI goal is not two loosely connected pages. The final product
should feel like one spatial behavior workspace where the user can edit both
the map/spot layer and the behavior tree layer without mentally switching
tools.

```text
Final UX target:
  Mission Canvas = one integrated Spatial Behavior Workspace
```

`Mission Canvas` is the product-facing page name. `Spatial Behavior Workspace`
is the internal architecture name used in this document.

The main design goal is to stop growing `ai_worker` feature code and move the
new application logic into `cyclo_intelligence`, while continuing to use
`ai_worker` as the robot navigation stack provider.

## Current Runtime Contract

Cyclo Intelligence already controls Navigation through `supervisor_api`.
The current contract with `ai_worker` is:

```text
ai_worker container
├─ service: ai_worker_navigation
│  └─ owns mapping/navigation Nav2 launch
├─ service: ai_worker_map_save
│  └─ saves map files
├─ maps directory
│  └─ /root/ros2_ws/src/ai_worker/ffw_navigation/maps
└─ ROS graph
   ├─ /map
   ├─ /global_costmap/costmap
   ├─ /local_costmap/costmap
   ├─ /scan
   ├─ /amcl_pose
   ├─ /plan
   ├─ /tf
   ├─ /tf_static
   ├─ /initialpose
   └─ /navigate_to_pose
```

Cyclo Intelligence currently uses this contract through:

```text
Browser UI
  ↓
nginx
  ↓
supervisor_api /navigation/*
  ↓
Docker SDK exec/archive into ai_worker
  ↓
ai_worker s6 services and ROS graph
```

Large OccupancyGrid topics are streamed through a supervisor-side WebSocket:

```text
/map, /global_costmap/costmap
  → supervisor_api rclpy subscriber
  → CRC-filtered cache
  → /api/navigation/topics/ws
  → Browser
```

Other live topics continue through rosbridge:

```text
/scan, /amcl_pose, /plan, /goal_pose, /tf, /tf_static
  → rosbridge
  → Browser
```

## Final Software Structure

The completed structure should look like this:

```text
Browser UI
├─ Mission Canvas / Spatial Behavior Workspace
│  ├─ Map Surface
│  │  ├─ map viewer
│  │  ├─ spot marker overlay
│  │  ├─ BT spatial node overlay
│  │  ├─ active BT node highlight
│  │  └─ robot / plan / costmap / scan layers
│  │
│  ├─ Behavior Surface
│  │  ├─ embedded BT graph editor
│  │  ├─ node palette
│  │  ├─ graph layout controls
│  │  └─ active BT node highlight
│  │
│  ├─ Inspector
│  │  ├─ selected Spot editor
│  │  ├─ selected BT node parameters
│  │  ├─ spot-to-BT binding controls
│  │  └─ run controls
│  │
│  ├─ Runtime Bar
│  │  ├─ Navigation lifecycle
│  │  ├─ BT node lifecycle
│  │  ├─ tree execution state
│  │  └─ logs/status shortcuts
│  │
│  └─ Layout modes
│     ├─ Map-first mode
│     ├─ Graph-first mode
│     ├─ Split mode
│     └─ Runtime mode
│
├─ Legacy routes during migration
│  ├─ Navigation Page
│  └─ BT Manager Page
│
└─ Shared workspace state
   ├─ selected map
   ├─ selected spot
   ├─ selected BT tree
   ├─ selected BT node
   ├─ graph edit history
   └─ current BT runtime status
```

```text
cyclo_intelligence backend
├─ docker/supervisor_api
│  ├─ navigation.py
│  │  ├─ ai_worker_navigation start/stop/status
│  │  ├─ map save
│  │  ├─ NavigateToPose REST bridge for UI/manual use
│  │  ├─ logs
│  │  └─ PGM read/write
│  │
│  ├─ navigation_grid_cache.py
│  │  └─ CRC-filtered OccupancyGrid WebSocket cache
│  │
│  └─ navigation_spots.py
│     ├─ map spot CRUD
│     ├─ spot pose persistence
│     ├─ spot-to-BT binding persistence
│     └─ map/spot metadata validation
│
├─ orchestrator/orchestrator/bt
│  ├─ bt_node.py
│  │  ├─ /bt/load_and_run
│  │  ├─ /bt/set_running
│  │  ├─ /bt/status
│  │  └─ /bt/active_nodes
│  │
│  └─ actions
│     ├─ ensure_navigation_running.py
│     ├─ navigate_to_spot.py
│     ├─ navigate_to_pose.py
│     ├─ cancel_navigation.py
│     └─ existing actions
│
└─ storage
   ├─ map files
   ├─ spot metadata
   └─ BT XML trees
```

```text
ai_worker container
├─ ai_worker_navigation
│  └─ Nav2 stack
│     ├─ mapping mode
│     ├─ navigation mode
│     ├─ map publication
│     ├─ localization
│     └─ /navigate_to_pose action server
│
└─ ai_worker_map_save
   └─ map saver
```

## Core Domain Model

The integration should be centered on a `MapSpot` domain object.

```json
{
  "id": "spot_table_a",
  "map_name": "factory_1",
  "label": "Table A",
  "pose": {
    "frame_id": "map",
    "x": 1.25,
    "y": -0.4,
    "yaw": 1.57
  },
  "linked_bt_tree": "table_a_pick.xml",
  "metadata": {
    "color": "#22c55e",
    "icon": "table",
    "note": ""
  }
}
```

Important coordinate rule:

```text
Spot pose       = real map-frame metric pose
BT graph x/y    = BT Manager canvas position
Map overlay     = rendered from spot_id or explicit pose
```

Do not convert BT graph coordinates into map coordinates. A BT node appears on
the map only when it references a `spot_id` or carries an explicit map pose.

## Unified Workspace Model

The final UI should be a single workspace with multiple views over the same
state, rather than two separate products.

```text
WorkspaceState
├─ map
│  ├─ map_name
│  ├─ live layers
│  └─ map metadata
│
├─ spots
│  ├─ MapSpot[]
│  └─ selected_spot_id
│
├─ behavior
│  ├─ selected_tree_id
│  ├─ graph nodes / edges / params
│  ├─ selected_bt_node_id
│  └─ dirty / undo / redo state
│
└─ runtime
   ├─ navigation status
   ├─ bt_node process status
   ├─ tree execution status
   └─ active node ids
```

The layout can change, but the state should not:

```text
Map-first mode:
  Map takes most of the screen. Graph is shown as a compact side panel.

Graph-first mode:
  BT graph takes most of the screen. Map appears as context/preview.

Split mode:
  Map and BT graph are both primary. Best for authoring spatial behavior.

Runtime mode:
  Editing is de-emphasized. Active map/BT status, logs, and run controls are
  emphasized.
```

## Spot and BT Relationship

Recommended relationship:

```text
MapSpot = place
BT Tree = behavior logic
NavigateToSpot = BT action that consumes a MapSpot pose
```

This gives the unified workspace clean internal ownership:

```text
Map Surface      = spatial editor and operation surface
Behavior Surface = logic editor
Spot             = bridge between space and logic
```

Example BT tree:

```xml
<root main_tree_to_execute="MainTree">
  <BehaviorTree ID="MainTree">
    <Sequence name="ServeAtTableA">
      <EnsureNavigationRunning mode="nav" map_name="factory_1" />
      <NavigateToSpot spot_id="spot_table_a" timeout_s="120" />
      <SendCommand command="LOAD" model="lerobot:act" policy_path="/workspace/model/..." />
      <SendCommand command="RESUME" />
      <Wait seconds="2" />
      <SendCommand command="STOP" />
    </Sequence>
  </BehaviorTree>
</root>
```

## User Experience Target

Primary workflow:

```text
1. User opens Mission Canvas.
2. User starts mapping or navigation.
3. User clicks on the map and creates a Spot.
4. User names the Spot in the Inspector.
5. User creates or links a BT tree from the same Inspector.
6. The Behavior Surface opens the linked tree in-place.
7. User edits the behavior using NavigateToSpot and normal BT nodes.
8. User saves the Spot and BT tree together or independently.
9. User clicks the Spot and chooses:
   - Navigate
   - Run BT
   - Navigate + Run BT
10. Active BT nodes are highlighted in both the Behavior Surface and map overlay.
```

Map overlay behavior:

```text
Spot marker
├─ click: open Spot inspector
├─ double click or command button: run linked behavior
└─ active state: highlight when current BT node references this spot

BT spatial node marker
├─ rendered when node has spot_id or map pose
├─ shows active/running state from /bt/active_nodes
└─ opens node/BT context in side panel
```

## Backend Ownership

### Stays in ai_worker

`ai_worker` should remain responsible for:

```text
- Nav2 launch files
- mapping/navigation stack internals
- map saving implementation
- localization and planning topics
- /navigate_to_pose action server
```

### Moves to Cyclo Intelligence

Cyclo Intelligence should own:

```text
- Spot model and persistence
- Spot-to-BT links
- map overlay UX
- BT node overlay UX
- BT action nodes for navigation
- Navigation lifecycle orchestration
- BT runtime integration
- API layer for UI-facing navigation metadata
```

## Development Phases

### Current Implementation Baseline

As of the first Mission Canvas implementation slice, the repository contains:

```text
- Mission Canvas route and sidebar entry in the UI.
- Spot CRUD API in supervisor_api under /navigation/spots.
- JSON Spot persistence at /workspace/navigation/maps/<map_name>/spots.json
  by default, overrideable with CYCLO_NAVIGATION_DATA_DIR.
- MapViewer Spot marker overlay with click selection.
- Mission Canvas Spot creation, selection, rename, and delete UI.
- Mission Canvas stage tabs:
  - Mapping
  - Spot / BT
  - Run
- Stage-specific layer presets and shared Topics diagnostics.
- Frontend API utilities and focused tests for the new page/API client.
- Backend unit coverage for Spot CRUD added to docker/supervisor_api/test_app.py.
```

This is intentionally a foundation slice:

```text
Implemented:
  Phase 0 contract documentation and route registration hardening
  Phase 1 Spot persistence API
  Early Phase 2 Spot overlay and Inspector UI
  Early Mission Canvas stage layout

Deferred:
  BT graph embedding
  NavigateToSpot runtime action node
  active BT node overlay
  runtime ownership/session policy
  full replacement of the legacy Navigation and BT Manager pages
```

### Phase 0: Contract Hardening

Goal: document and protect the current `ai_worker` contract.

Tasks:

```text
- Keep ai_worker container name configurable via CYCLO_NAVIGATION_CONTAINER.
- Keep service names centralized:
  - ai_worker_navigation
  - ai_worker_map_save
- Document expected ROS topics/actions.
- Add tests around navigation start/stop/goal/map-file behavior.
- Decide where map-specific metadata lives.
```

Output:

```text
- Stable ai_worker runtime contract
- No feature dependency on new ai_worker code
```

### Phase 1: Spot Persistence API

Goal: add map spot storage under Cyclo Intelligence.

Recommended storage shape:

```text
/workspace/navigation/
└─ maps/
   └─ <map_name>/
      ├─ spots.json
      └─ bt/
         └─ *.xml
```

Potential API:

```text
GET    /api/navigation/spots?map_name=<map>
POST   /api/navigation/spots
PATCH  /api/navigation/spots/{spot_id}
DELETE /api/navigation/spots/{spot_id}
POST   /api/navigation/spots/{spot_id}/link-bt
GET    /api/navigation/spots/{spot_id}/bt
```

Output:

```text
- MapSpot schema
- Spot CRUD API
- Persistent spot-to-BT binding
```

### Phase 2: Navigation UI Spot Overlay

Goal: make Spots visible and editable on the map.

Tasks:

```text
- Render Spot markers on MapViewer.
- Add create/edit/delete Spot mode.
- Add Spot inspector panel.
- Convert map click into map-frame pose.
- Store yaw from drag/heading UI or a simple direction handle.
- Load/save Spots through supervisor_api.
```

Output:

```text
- User can create and edit named spots on a map.
- Spots survive page reload and container restart.
```

### Phase 3: BT Editor Spot Context

Goal: allow the existing BT Manager concepts to operate from a Spot context.
This phase may still use page navigation, but it should prepare the code for a
single final workspace.

Tasks:

```text
- Add "Create BT for Spot" entry point from Nav UI.
- Add "Edit linked BT" from Spot inspector.
- Add spot selector UI for NavigateToSpot nodes.
- Preserve normal BT XML save/load flow.
- Add optional mini map preview in BT node parameter panel.
- Start extracting reusable BT editor components from BTManagerPage:
  - graph canvas
  - node palette
  - parameter panel
  - tree save/load helpers
```

Output:

```text
- BT Manager can edit behaviors linked to a selected Spot.
- NavigateToSpot node can select a Spot by id.
- BT graph editing is componentized enough to embed later.
```

### Phase 4: Navigation BT Action Nodes

Goal: make BT runtime able to control navigation directly.

Initial action nodes:

```text
EnsureNavigationRunning
├─ checks ai_worker_navigation status
├─ optionally starts navigation mode
└─ returns SUCCESS when Nav2 is ready enough to accept goals

NavigateToSpot
├─ reads spot_id
├─ resolves pose from SpotStore
├─ sends /navigate_to_pose action goal
├─ waits for result
└─ returns SUCCESS/FAILURE

NavigateToPose
├─ direct x/y/yaw BT port variant
└─ useful for debugging or non-Spot flows

CancelNavigation
└─ cancels active NavigateToPose goal
```

Implementation note:

```text
Prefer rclpy.action.ActionClient for BT runtime execution.
Keep supervisor_api REST goal endpoint for manual UI commands and debugging.
```

Dependency note:

```text
orchestrator/package.xml and Dockerfile may need explicit nav2_msgs/action_msgs
runtime dependencies if BT Python imports nav2_msgs.action.NavigateToPose.
```

Output:

```text
- BT tree can navigate to a Spot before running manipulation/inference nodes.
```

### Phase 5: BT Overlay on Map

Goal: show BT context directly on the map and prepare the first integrated
workspace layout.

Tasks:

```text
- Subscribe to /bt/status and /bt/active_nodes from Nav UI.
- Parse or load current linked BT metadata.
- Render spatial BT nodes on the map when they reference spot_id or pose.
- Highlight active spatial nodes during execution.
- Show non-spatial nodes in side panel or compact timeline.
- Add a split layout prototype:
  - left/top: Map Surface
  - right/bottom: embedded Behavior Surface
- Keep selection synchronized:
  - selecting a Spot highlights related BT nodes
  - selecting a NavigateToSpot node highlights its Spot
```

Output:

```text
- User can see where the current BT is acting in the physical map.
- Active BT state appears in both the Map Surface and Behavior Surface.
- The first integrated map/BT workspace exists behind the current routes.
```

### Phase 6: Runtime Lifecycle Policy

Goal: prevent UI page changes from stopping runtime that BT still needs.

Current issue:

```text
Navigation Page leave currently calls stopNavigation().
This conflicts with BT-driven navigation.
```

Needed policy:

```text
- Separate UI page lifecycle from navigation runtime lifecycle.
- Stop navigation only when user explicitly stops it, or when no owner remains.
- Track runtime owner:
  - manual Nav UI
  - BT execution
  - optional autonomous session
```

Output:

```text
- Navigation stack remains alive while BT needs it.
- Leaving the Navigation Page does not break an active BT run.
```

### Phase 7: Packaging Cleanup

Goal: decide whether to keep code in `orchestrator` or split a new package,
after the unified workspace boundaries become clear.

Recommended path:

```text
Phase 1 implementation:
  Keep BT Nav actions in orchestrator/orchestrator/bt/actions.
  Keep spot API in docker/supervisor_api.
  Keep UI in orchestrator/ui.

Later cleanup:
  Extract stable pieces into a cyclo_navigation package if needed.
```

Possible future package:

```text
cyclo_navigation
├─ spots/
│  ├─ schema.py
│  └─ store.py
├─ bt_actions/
│  ├─ navigate_to_spot.py
│  └─ ensure_navigation_running.py
└─ api/
   └─ spots_router.py
```

If this package is created, the BT registry must learn to scan external action
packages, not only `orchestrator.bt.actions`.

### Phase 8: Mission Canvas Migration

Goal: make the integrated workspace the primary product surface.

Tasks:

```text
- Promote the split map/BT workspace to the Mission Canvas route.
- Keep old Navigation and BT Manager routes as compatibility/debug views, or
  remove them once feature parity is reached.
- Move shared route state into one workspace slice:
  - selected map
  - selected spot
  - selected tree
  - selected node
  - runtime status
- Replace page-to-page handoff with in-workspace panel transitions.
- Make save/run controls aware of both layers:
  - Spot dirty state
  - BT dirty state
  - runtime busy state
```

Output:

```text
- User edits spatial context and behavior logic in one page.
- Nav and BT no longer feel like separate applications.
```

## Recommended First Implementation Slice

The smallest valuable slice is:

```text
1. SpotStore JSON persistence
2. /api/navigation/spots CRUD
3. Spot markers on Nav map
4. Link Spot to BT XML filename
5. NavigateToSpot BT node
6. Remove or gate Nav-page-leave auto-stop
```

This slice proves the core product idea without requiring a full plugin system.

The smallest slice should still be designed with the unified workspace in mind:

```text
- Do not bake Spot state into NavigationPage-only local state.
- Do not bake BT graph state into BTManagerPage-only assumptions.
- Extract reusable components when the second call site appears:
  - MapViewer + overlays
  - BT graph canvas
  - node palette
  - parameter inspector
  - runtime status bar
```

## Risks and Design Notes

### ai_worker Contract Drift

Risk:

```text
ai_worker service names or map paths change.
```

Mitigation:

```text
Centralize all ai_worker names/paths in supervisor_api config.
Prefer environment overrides where practical.
```

### Map Versioning

Risk:

```text
Spots become inaccurate when the map is edited or replaced.
```

Mitigation:

```text
Store map_name and optional map metadata/hash with spots.
Warn when PGM/YAML metadata changes.
```

### Coordinate Confusion

Risk:

```text
BT graph coordinates and map coordinates get mixed.
```

Mitigation:

```text
Use spot_id as the bridge.
Never use BT canvas x/y as map pose.
```

### Runtime Ownership

Risk:

```text
Navigation stops while BT is using it.
```

Mitigation:

```text
Introduce explicit runtime owner/session state.
Do not bind navigation lifetime to a React page lifecycle.
```

### ROS Dependency Visibility

Risk:

```text
BT action imports nav2_msgs but the Cyclo image does not install it.
```

Mitigation:

```text
Add explicit package.xml and Dockerfile dependencies.
Add CI/build test coverage for BT Nav action imports.
```

## Final Summary

The intended final architecture is:

```text
Spatial Behavior Workspace = integrated map + BT authoring surface
Mission Canvas             = product-facing page name
Map Surface                = spatial editor and operations view
Behavior Surface           = BT graph editor
MapSpot                    = shared domain object connecting place and behavior
BT Nav nodes               = runtime bridge from behavior tree to Nav2
ai_worker                  = fixed Nav2 runtime engine
```

This lets Cyclo Intelligence own product-level behavior without continuing
feature development inside `ai_worker`.
