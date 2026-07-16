import asyncio
import importlib.util
import json
import sys
import types
from pathlib import Path
from types import SimpleNamespace

APP_PATH = Path(__file__).resolve().with_name("app.py")
REPO_ROOT = APP_PATH.parents[2]

docker_stub = types.ModuleType("docker")
docker_errors_stub = types.ModuleType("docker.errors")


class DockerException(Exception):
    pass


class ImageNotFound(DockerException):
    pass


class NotFound(DockerException):
    pass


docker_stub.from_env = lambda: None
docker_errors_stub.DockerException = DockerException
docker_errors_stub.ImageNotFound = ImageNotFound
docker_errors_stub.NotFound = NotFound
sys.modules["docker"] = docker_stub
sys.modules["docker.errors"] = docker_errors_stub

original_path = list(sys.path)
sys.path = [
    path for path in sys.path
    if Path(path or ".").resolve() != REPO_ROOT
]
try:
    spec = importlib.util.spec_from_file_location("supervisor_api_app", APP_PATH)
    app = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = app
    spec.loader.exec_module(app)
finally:
    sys.path = original_path

_missing_required_mounts = app._missing_required_mounts
_mount_source_for_destination = app._mount_source_for_destination
_backend_container_image_mismatch = app._backend_container_image_mismatch
_backend_container_stale_reason = app._backend_container_stale_reason
_compose_env = app._compose_env
_host_workspace_dir = app._host_workspace_dir
_require_known_service = app._require_known_service
_validate_bt_robot_type = app._validate_bt_robot_type
_validate_robot_type = app._validate_robot_type
_write_bt_robot_type = app._write_bt_robot_type
_resolve_groot_trt_paths = app._resolve_groot_trt_paths
_trt_status = app._trt_status
_BACKENDS = app._BACKENDS
_USER_SERVICES = app._USER_SERVICES
navigation = sys.modules["supervisor_api.navigation"]
navigation_grid_cache = sys.modules["supervisor_api.navigation_grid_cache"]
navigation_spots = sys.modules["supervisor_api.navigation_spots"]
_GROOT_REQUIRED_MOUNTS = app._REQUIRED_BACKEND_MOUNTS["groot"]
_LEROBOT_REQUIRED_MOUNTS = app._REQUIRED_BACKEND_MOUNTS["lerobot"]


def test_navigation_parses_binary_pgm():
    data = b"P5\n# map\n2 2\n255\n" + bytes([0, 127, 254, 255])

    assert navigation._parse_pgm(data) == (
        2,
        2,
        255,
        [0, 127, 254, 255],
    )


def test_navigation_parses_map_yaml_metadata():
    metadata = navigation._parse_map_yaml_metadata(
        b"image: factory.pgm\nresolution: 0.05\norigin: [-1.2, 2.4, 1.570796]\n"
    )

    assert metadata["resolution"] == 0.05
    assert metadata["origin"]["position"] == {"x": -1.2, "y": 2.4, "z": 0.0}
    assert metadata["origin"]["orientation"]["z"] != 0


def test_navigation_get_pgm_includes_yaml_metadata(monkeypatch):
    files = {
        navigation.MAPS_DIR / "factory.pgm": b"P5\n2 2\n255\n" + bytes([0, 127, 254, 255]),
        navigation.MAPS_DIR / "factory.yaml": b"resolution: 0.05\norigin: [-1.0, -2.0, 0.0]\n",
    }

    monkeypatch.setattr(navigation, "_read_container_file", lambda path: files[path])

    result = navigation.get_pgm("factory.pgm")

    assert result["resolution"] == 0.05
    assert result["origin"]["position"] == {"x": -1.0, "y": -2.0, "z": 0.0}
    assert result["width"] == 2
    assert result["height"] == 2


def test_navigation_rejects_map_path_escape():
    import pytest
    from fastapi import HTTPException

    with pytest.raises(HTTPException):
        navigation._resolve_pgm_path("../../outside.pgm")


def test_navigation_validates_map_name():
    import pytest
    from fastapi import HTTPException

    assert navigation._validate_map_name("factory-1") == "factory-1"
    with pytest.raises(HTTPException):
        navigation._validate_map_name("factory; reboot")


def test_navigation_save_map_waits_for_artifacts(monkeypatch):
    calls = []
    signatures = [
        {"yaml": None, "pgm": None},
        {"yaml": "yaml:1", "pgm": "pgm:1"},
    ]

    monkeypatch.setattr(
        navigation,
        "_map_artifact_signatures",
        lambda map_name: signatures.pop(0),
    )
    monkeypatch.setattr(
        navigation,
        "_save_map_with_cli",
        lambda map_name: calls.append(map_name) or "map saver complete",
    )

    result = navigation.save_map(
        navigation.MapSaveRequest(map_name="factory")
    )

    assert calls == ["factory"]
    assert result.ok
    assert result.message == "Saved map 'factory' as factory.yaml and factory.pgm"
    assert "map_saver" not in result.message


def test_navigation_save_map_errors_when_artifacts_missing(monkeypatch):
    import pytest
    from fastapi import HTTPException

    monkeypatch.setattr(navigation, "SAVE_MAP_WAIT_SECONDS", 0)
    monkeypatch.setattr(
        navigation,
        "_map_artifact_signatures",
        lambda map_name: {"yaml": None, "pgm": None},
    )
    monkeypatch.setattr(navigation, "_save_map_with_cli", lambda map_name: "")

    with pytest.raises(HTTPException) as exc:
        navigation.save_map(navigation.MapSaveRequest(map_name="factory"))

    assert exc.value.status_code == 503
    assert "factory.yaml" in exc.value.detail


def test_navigation_save_map_cli_does_not_forward_launch_args(monkeypatch):
    captured = {}

    def fake_exec(command, *, environment=None, timeout=None):
        captured["command"] = command
        captured["environment"] = environment
        return 0, "saved"

    monkeypatch.setattr(navigation, "_exec", fake_exec)
    monkeypatch.setenv("ROS_DOMAIN_ID", "30")
    monkeypatch.setenv("RMW_IMPLEMENTATION", "rmw_fastrtps_cpp")

    result = navigation._save_map_with_cli("test_2")

    assert result == "saved"
    assert captured["command"][:4] == [
        "bash", "--noprofile", "--norc", "-c"
    ]
    command_text = captured["command"][-1]
    assert "map_saver_cli" in command_text
    assert "/root/ros2_ws/src/ai_worker/ffw_navigation/maps/test_2" in command_text
    assert "map_name:=" not in command_text
    assert captured["environment"] == {
        "ROS_DOMAIN_ID": "30",
        "RMW_IMPLEMENTATION": "rmw_fastrtps_cpp",
    }


def test_navigation_start_clears_stale_runtime_before_up(monkeypatch):
    events = []

    monkeypatch.setattr(
        navigation,
        "_request_s6_service_down",
        lambda service: events.append(("request_down", service))
        or f"{service} down requested",
    )
    monkeypatch.setattr(
        navigation,
        "_clear_navigation_runtime_files",
        lambda: events.append("clear"),
    )
    monkeypatch.setattr(
        navigation,
        "_force_stop_navigation_processes",
        lambda: events.append("force") or "",
    )
    monkeypatch.setattr(
        navigation,
        "_write_runtime_file",
        lambda path, content: events.append(("write", path, content)),
    )
    monkeypatch.setitem(
        navigation.GRID_CACHES,
        "/map",
        SimpleNamespace(clear=lambda: events.append("clear_map_cache")),
    )
    monkeypatch.setattr(
        navigation,
        "_s6_command",
        lambda service, action, **kwargs: events.append(("s6", service, action))
        or f"{service} {action}",
    )

    result = navigation.navigation_start(
        navigation.NavigationStartRequest(mode="map", map_name="factory")
    )

    assert result.ok
    assert result.message == "ai_worker_navigation up"
    assert events == [
        ("request_down", "ai_worker_navigation"),
        "force",
        ("s6", "ai_worker_navigation", "down"),
        "clear",
        "clear_map_cache",
        ("write", "/run/navigation_type", "map"),
        ("write", "/run/launch_args/ai_worker_navigation", "map_name:=factory"),
        ("s6", "ai_worker_navigation", "up"),
    ]


def test_navigation_start_keeps_map_cache_for_nav_mode(monkeypatch):
    events = []

    monkeypatch.setattr(
        navigation,
        "_request_s6_service_down",
        lambda service: events.append(("request_down", service))
        or f"{service} down requested",
    )
    monkeypatch.setattr(
        navigation,
        "_clear_navigation_runtime_files",
        lambda: events.append("clear"),
    )
    monkeypatch.setattr(
        navigation,
        "_force_stop_navigation_processes",
        lambda: events.append("force") or "",
    )
    monkeypatch.setattr(
        navigation,
        "_write_runtime_file",
        lambda path, content: events.append(("write", path, content)),
    )
    monkeypatch.setitem(
        navigation.GRID_CACHES,
        "/map",
        SimpleNamespace(clear=lambda: events.append("clear_map_cache")),
    )
    monkeypatch.setattr(
        navigation,
        "_s6_command",
        lambda service, action, **kwargs: events.append(("s6", service, action))
        or f"{service} {action}",
    )

    result = navigation.navigation_start(
        navigation.NavigationStartRequest(mode="nav", map_name="factory")
    )

    assert result.ok
    assert "clear_map_cache" not in events


def test_navigation_start_launches_localization_only(monkeypatch):
    events = []

    monkeypatch.setattr(
        navigation,
        "_request_s6_service_down",
        lambda service: events.append(("request_down", service))
        or f"{service} down requested",
    )
    monkeypatch.setattr(
        navigation,
        "_clear_navigation_runtime_files",
        lambda: events.append("clear"),
    )
    monkeypatch.setattr(
        navigation,
        "_force_stop_navigation_processes",
        lambda: events.append("force") or "",
    )
    monkeypatch.setattr(
        navigation,
        "_write_runtime_file",
        lambda path, content: events.append(("write", path, content)),
    )
    monkeypatch.setattr(
        navigation,
        "_s6_command",
        lambda service, action, **kwargs: events.append(("s6", service, action))
        or f"{service} {action}",
    )
    monkeypatch.setattr(
        navigation,
        "_start_localization_process",
        lambda map_name: events.append(("localize", map_name))
        or "localization launched",
    )

    result = navigation.navigation_start(
        navigation.NavigationStartRequest(mode="localize", map_name="factory")
    )

    assert result.ok
    assert result.message == "localization launched"
    assert events == [
        ("request_down", "ai_worker_navigation"),
        "force",
        ("s6", "ai_worker_navigation", "down"),
        "clear",
        ("write", "/run/navigation_type", "localize"),
        ("write", "/run/launch_args/ai_worker_navigation", "map_name:=factory"),
        ("localize", "factory"),
    ]


def test_navigation_stop_clears_runtime_and_forces_process_group(monkeypatch):
    events = []

    monkeypatch.setattr(
        navigation,
        "_request_s6_service_down",
        lambda service: events.append(("request_down", service))
        or "down requested",
    )
    monkeypatch.setattr(
        navigation,
        "_clear_navigation_runtime_files",
        lambda: events.append("clear"),
    )
    monkeypatch.setattr(
        navigation,
        "_s6_command",
        lambda service, action, **kwargs: events.append(("s6", service, action))
        or "s6 down",
    )
    monkeypatch.setattr(
        navigation,
        "_force_stop_navigation_processes",
        lambda: events.append("force") or "forced",
    )

    result = navigation.navigation_stop()

    assert result.ok
    assert result.message == "down requested\nforced\ns6 down"
    assert events == [
        ("request_down", "ai_worker_navigation"),
        "force",
        ("s6", "ai_worker_navigation", "down"),
        "clear",
    ]


def test_navigation_force_stop_kills_process_group_with_separator(monkeypatch):
    captured = {}

    def fake_exec(command, *, environment=None, timeout=None):
        captured["command"] = command
        return 0, "forced"

    monkeypatch.setattr(navigation, "_exec", fake_exec)
    monkeypatch.setattr(navigation, "_stop_localization_processes", lambda: "")

    assert navigation._force_stop_navigation_processes() == "forced"
    script = captured["command"][-1]
    assert 'kill -TERM -"${PGID}"' in script
    assert 'kill -KILL -"${PGID}"' in script
    assert 'kill -TERM -- -"${PGID}"' not in script
    assert "pkill" not in script


def test_navigation_localization_status_uses_dash_compatible_process_group_check(monkeypatch):
    captured = {}

    def fake_exec(command, *, environment=None, timeout=None):
        captured["command"] = command
        return 0, "up (pid 123 pgid 123) 7 seconds"

    monkeypatch.setattr(navigation, "_exec", fake_exec)

    status = navigation._localization_status()

    assert status.is_up
    assert status.pid == 123
    assert status.uptime_seconds == 7
    script = captured["command"][-1]
    assert 'kill -0 -"${PGID}"' in script
    assert 'kill -0 -- -"${PGID}"' not in script


def test_navigation_stop_defers_busy_s6_lock(monkeypatch):
    from fastapi import HTTPException

    events = []

    monkeypatch.setattr(
        navigation,
        "_request_s6_service_down",
        lambda service: events.append(("request_down", service))
        or "down requested",
    )
    monkeypatch.setattr(
        navigation,
        "_force_stop_navigation_processes",
        lambda: events.append("force") or "forced",
    )
    monkeypatch.setattr(
        navigation,
        "_clear_navigation_runtime_files",
        lambda: events.append("clear"),
    )
    monkeypatch.setattr(
        navigation,
        "_s6_command",
        lambda service, action, **kwargs: events.append(("s6", service, action))
        or (_ for _ in ()).throw(
            HTTPException(503, "s6-rc: fatal: unable to take locks: Resource busy")
        ),
    )

    result = navigation.navigation_stop()

    assert result.ok
    assert "down requested" in result.message
    assert "forced" in result.message
    assert "down sync deferred" in result.message
    assert events == [
        ("request_down", "ai_worker_navigation"),
        "force",
        ("s6", "ai_worker_navigation", "down"),
        "clear",
    ]


def test_navigation_routes_are_registered():
    paths = {route.path for route in app.app.routes if hasattr(route, "path")}

    assert "/navigation/status" in paths
    assert "/navigation/start" in paths
    assert "/navigation/initial-pose" in paths
    assert "/navigation/nomotion-update" in paths
    assert "/navigation/global-localization" in paths
    assert "/navigation/amcl/design-localization-params" in paths
    assert "/navigation/maps/pgm/save" in paths
    assert "/navigation/topics/ws" in paths
    assert "/navigation/spots" in paths


def test_navigation_spots_crud(monkeypatch, tmp_path):
    monkeypatch.setattr(navigation_spots, "SPOTS_ROOT", tmp_path)

    created = navigation_spots.create_spot(
        navigation_spots.SpotCreateRequest(
            id="table_a",
            map_name="factory",
            label="Table A",
            pose=navigation_spots.SpotPose(x=1.0, y=2.0, yaw=0.5),
        )
    )
    assert created.id == "table_a"

    listed = navigation_spots.list_spots("factory")
    assert listed.map_name == "factory"
    assert [spot.id for spot in listed.spots] == ["table_a"]

    updated = navigation_spots.update_spot(
        "table_a",
        navigation_spots.SpotUpdateRequest(
            map_name="factory",
            label="Prep Table",
            linked_bt_tree="prep_table.xml",
        )
    )
    assert updated.label == "Prep Table"
    assert updated.linked_bt_tree == "prep_table.xml"

    deleted = navigation_spots.delete_spot("table_a", map_name="factory")
    assert deleted.ok
    assert navigation_spots.list_spots("factory").spots == []


def test_navigation_spots_rejects_path_like_names(monkeypatch, tmp_path):
    import pytest
    from fastapi import HTTPException

    monkeypatch.setattr(navigation_spots, "SPOTS_ROOT", tmp_path)

    with pytest.raises(HTTPException):
        navigation_spots.list_spots("../factory")


def test_navigation_grid_data_crc32_uses_only_map_data():
    first = {"info": {"width": 2}, "data": [-1, 0, 100, 0]}
    same_data = {"info": {"width": 4}, "data": [-1, 0, 100, 0]}
    changed = {"info": {"width": 2}, "data": [-1, 0, 99, 0]}

    marker = navigation_grid_cache.occupancy_grid_data_crc32(first)
    assert navigation_grid_cache.occupancy_grid_data_crc32(same_data) == marker
    assert navigation_grid_cache.occupancy_grid_data_crc32(changed) != marker


def test_navigation_grid_cache_serializes_only_changed_data():
    cache = navigation_grid_cache.OccupancyGridCache("/map")

    cache.cache_ros_message({"info": {"width": 2}, "data": [0, 1]})
    marker, payload = cache.serialized_if_changed(None)
    assert json.loads(payload) == {
        "available": True,
        "data": {"info": {"width": 2}, "data": [0, 1]},
    }
    assert cache.serialized_if_changed(marker) == (marker, None)

    cache.cache_ros_message({"info": {"width": 99}, "data": [0, 1]})
    metadata_marker, metadata_payload = cache.serialized_if_changed(marker)
    assert metadata_marker != marker
    assert json.loads(metadata_payload)["data"]["info"]["width"] == 99

    cache.cache_ros_message({"info": {"width": 2}, "data": [0, 2]})
    changed_marker, changed_payload = cache.serialized_if_changed(metadata_marker)
    assert changed_marker != metadata_marker
    assert json.loads(changed_payload)["data"]["data"] == [0, 2]

    cache.clear()
    cleared_marker, cleared_payload = cache.serialized_if_changed(changed_marker)
    assert cleared_marker != changed_marker
    assert json.loads(cleared_payload) == {"available": False}

    cache.cache_ros_message({"info": {"width": 2}, "data": [0, 2]})
    restored_marker, restored_payload = cache.serialized_if_changed(cleared_marker)
    assert restored_marker != cleared_marker
    assert json.loads(restored_payload)["data"]["data"] == [0, 2]


def test_navigation_grid_websocket_sends_cached_original_topic(monkeypatch):
    cache = navigation_grid_cache.OccupancyGridCache("/map")
    cache.cache_ros_message({"info": {"width": 2}, "data": [0, 100]})
    monkeypatch.setitem(navigation_grid_cache.GRID_CACHES, "/map", cache)

    started = []
    monkeypatch.setattr(
        navigation,
        "ensure_ros_grid_subscriber_started",
        lambda: started.append(True),
    )

    class FakeWebSocket:
        def __init__(self):
            self.accepted = False
            self.messages = []

        async def accept(self):
            self.accepted = True

        async def send_text(self, payload):
            self.messages.append(json.loads(payload))

        async def receive(self):
            return {"type": "websocket.disconnect"}

    websocket = FakeWebSocket()
    asyncio.run(asyncio.wait_for(
        navigation.navigation_grid_websocket(websocket, "/map"),
        timeout=1.0,
    ))

    assert websocket.accepted is True
    assert started == [True]
    assert websocket.messages == [{
        "available": True,
        "data": {"info": {"width": 2}, "data": [0, 100]},
    }]


def test_navigation_ros_exec_environment_matches_server(monkeypatch):
    monkeypatch.setenv("ROS_DOMAIN_ID", "30")
    monkeypatch.setenv("RMW_IMPLEMENTATION", "rmw_fastrtps_cpp")

    assert navigation._ros_exec_environment() == {
        "ROS_DOMAIN_ID": "30",
        "RMW_IMPLEMENTATION": "rmw_fastrtps_cpp",
    }


def test_navigation_goal_passes_ros_environment(monkeypatch):
    captured = {}

    def fake_exec(command, *, environment=None, timeout=None):
        captured["command"] = command
        captured["environment"] = environment
        return 0, "Goal accepted"

    monkeypatch.setattr(navigation, "_exec", fake_exec)
    monkeypatch.setenv("ROS_DOMAIN_ID", "30")
    monkeypatch.setenv("RMW_IMPLEMENTATION", "rmw_fastrtps_cpp")

    result = navigation.send_goal(
        navigation.NavigateGoalRequest(
            pose={
                "header": {"frame_id": "map"},
                "pose": {
                    "position": {"x": 1.0, "y": 2.0, "z": 0.0},
                    "orientation": {
                        "x": 0.0, "y": 0.0, "z": 0.0, "w": 1.0,
                    },
                },
            }
        )
    )

    assert result.ok
    assert captured["command"][:4] == [
        "bash", "--noprofile", "--norc", "-c"
    ]
    assert captured["environment"] == {
        "ROS_DOMAIN_ID": "30",
        "RMW_IMPLEMENTATION": "rmw_fastrtps_cpp",
    }


def test_navigation_initial_pose_publishes_from_ai_worker(monkeypatch):
    captured = {}

    def fake_exec(command, *, environment=None, timeout=None):
        captured["command"] = command
        captured["environment"] = environment
        return 0, "Published initial pose"

    monkeypatch.setattr(navigation, "_exec", fake_exec)
    monkeypatch.setattr(navigation, "_initialpose_subscription_count", lambda: 1)
    monkeypatch.setenv("ROS_DOMAIN_ID", "30")
    monkeypatch.setenv("RMW_IMPLEMENTATION", "rmw_fastrtps_cpp")

    result = navigation.send_initial_pose(
        navigation.InitialPoseRequest(x=1.25, y=-0.5, yaw=0.75)
    )

    assert result.ok
    command_text = captured["command"][-1]
    assert "python3 -c" in command_text
    assert "/initialpose" in command_text
    assert "/request_nomotion_update" in command_text
    assert "Duration(seconds=0.2)" in command_text
    assert "PoseWithCovarianceStamped" in command_text
    assert "std_srvs.srv import Empty" in command_text
    assert captured["environment"] == {
        "ROS_DOMAIN_ID": "30",
        "RMW_IMPLEMENTATION": "rmw_fastrtps_cpp",
    }


def test_navigation_initial_pose_filters_zenoh_warning(monkeypatch):
    def fake_exec(command, *, environment=None, timeout=None):
        return 0, (
            "\x1b[2m2026-07-16T02:40:40.578237Z\x1b[0m "
            "\x1b[33m WARN\x1b[0m zenoh: Scouting delay elapsed\n"
            "Published initial pose to /initialpose "
            "(-2.351, 0.168, yaw=3.142, subscribers=1)"
        )

    monkeypatch.setattr(navigation, "_exec", fake_exec)
    monkeypatch.setattr(navigation, "_initialpose_subscription_count", lambda: 1)

    result = navigation.send_initial_pose(
        navigation.InitialPoseRequest(x=-2.351, y=0.168, yaw=3.142)
    )

    assert result.ok
    assert result.message == (
        "Published initial pose to /initialpose "
        "(-2.351, 0.168, yaw=3.142, subscribers=1)"
    )
    assert "WARN" not in result.message


def test_navigation_nomotion_update_calls_amcl_service(monkeypatch):
    captured = {}

    def fake_exec(command, *, environment=None, timeout=None):
        captured["command"] = command
        captured["environment"] = environment
        return 0, "response:\nstd_srvs.srv.Empty_Response()"

    monkeypatch.setattr(navigation, "_exec", fake_exec)
    monkeypatch.setenv("ROS_DOMAIN_ID", "30")
    monkeypatch.setenv("RMW_IMPLEMENTATION", "rmw_fastrtps_cpp")

    result = navigation.request_nomotion_update()

    assert result.ok
    command_text = captured["command"][-1]
    assert "ros2 service call" in command_text
    assert "/request_nomotion_update" in command_text
    assert "std_srvs/srv/Empty" in command_text
    assert captured["environment"] == {
        "ROS_DOMAIN_ID": "30",
        "RMW_IMPLEMENTATION": "rmw_fastrtps_cpp",
    }


def test_navigation_global_localization_calls_amcl_service(monkeypatch):
    captured = {}

    def fake_exec(command, *, environment=None, timeout=None):
        captured["command"] = command
        captured["environment"] = environment
        return 0, "response:\nstd_srvs.srv.Empty_Response()"

    monkeypatch.setattr(navigation, "_exec", fake_exec)
    monkeypatch.setenv("ROS_DOMAIN_ID", "30")
    monkeypatch.setenv("RMW_IMPLEMENTATION", "rmw_fastrtps_cpp")

    result = navigation.request_global_localization()

    assert result.ok
    command_text = captured["command"][-1]
    assert "ros2 service call" in command_text
    assert "/reinitialize_global_localization" in command_text
    assert "std_srvs/srv/Empty" in command_text
    assert captured["environment"] == {
        "ROS_DOMAIN_ID": "30",
        "RMW_IMPLEMENTATION": "rmw_fastrtps_cpp",
    }


def test_navigation_design_localization_sets_amcl_parameters(monkeypatch):
    captured = []

    def fake_exec(command, *, environment=None, timeout=None):
        captured.append((command, environment))
        return 0, "Set parameter successful"

    monkeypatch.setattr(navigation, "_exec", fake_exec)
    monkeypatch.setenv("ROS_DOMAIN_ID", "30")
    monkeypatch.setenv("RMW_IMPLEMENTATION", "rmw_fastrtps_cpp")

    result = navigation.set_design_localization_amcl_parameters()

    assert result.ok
    assert "laser_likelihood_max_dist=2.0" in result.message
    assert "max_beams=80" in result.message
    assert "resample_interval=1" in result.message
    command_text = "\n".join(command[-1] for command, _environment in captured)
    assert "ros2 param set /amcl laser_likelihood_max_dist 2.0" in command_text
    assert "ros2 param set /amcl max_beams 80" in command_text
    assert "ros2 param set /amcl resample_interval 1" in command_text
    assert {tuple(environment.items()) for _command, environment in captured} == {
        (
            ("ROS_DOMAIN_ID", "30"),
            ("RMW_IMPLEMENTATION", "rmw_fastrtps_cpp"),
        )
    }


def test_navigation_initial_pose_starts_localization_when_amcl_missing(monkeypatch):
    calls = []

    monkeypatch.setattr(
        navigation,
        "_initialpose_subscription_count",
        lambda: calls.append("count") or 0,
    )
    monkeypatch.setattr(
        navigation,
        "_start_localization_mode",
        lambda map_name: calls.append(("localize", map_name)) or "started",
    )
    monkeypatch.setattr(
        navigation,
        "_publish_initial_pose",
        lambda request: calls.append(("publish", request.map_name)) or "published",
    )

    result = navigation.send_initial_pose(
        navigation.InitialPoseRequest(
            x=1.0,
            y=2.0,
            yaw=0.5,
            map_name="factory",
        )
    )

    assert result.ok
    assert result.message == "published"
    assert calls == ["count", ("localize", "factory"), ("publish", "factory")]


def _container_with_mounts(*destinations):
    return SimpleNamespace(
        attrs={
            "Mounts": [
                {"Destination": destination}
                for destination in destinations
            ]
        }
    )


def test_missing_required_mounts_reports_stale_groot_container():
    container = _container_with_mounts("/legacy_model_mount/groot")

    assert _missing_required_mounts("groot", container) == list(_GROOT_REQUIRED_MOUNTS)


def test_missing_required_mounts_accepts_current_groot_container():
    container = _container_with_mounts(*_GROOT_REQUIRED_MOUNTS)

    assert _missing_required_mounts("groot", container) == []


def test_missing_required_mounts_accepts_current_lerobot_container():
    container = _container_with_mounts(*_LEROBOT_REQUIRED_MOUNTS)

    assert _missing_required_mounts("lerobot", container) == []


def test_backend_container_image_mismatch_detects_old_container_image():
    class FakeImages:
        def get(self, image):
            assert image == "robotis/groot-zenoh:1.3.4-arm64"
            return SimpleNamespace(id="sha256:new")

    container = SimpleNamespace(attrs={"Image": "sha256:old"})
    spec = {"image": "robotis/groot-zenoh:1.3.4-arm64"}

    assert _backend_container_image_mismatch(
        SimpleNamespace(images=FakeImages()),
        container,
        spec,
    )


def test_backend_container_image_mismatch_accepts_current_container_image():
    class FakeImages:
        def get(self, image):
            assert image == "robotis/groot-zenoh:1.3.4-arm64"
            return SimpleNamespace(id="sha256:new")

    container = SimpleNamespace(attrs={"Image": "sha256:new"})
    spec = {"image": "robotis/groot-zenoh:1.3.4-arm64"}

    assert not _backend_container_image_mismatch(
        SimpleNamespace(images=FakeImages()),
        container,
        spec,
    )


def test_backend_container_stale_reason_detects_workspace_mount_mismatch():
    class FakeImages:
        def get(self, image):
            assert image == "robotis/groot-zenoh:1.3.4-arm64"
            return SimpleNamespace(id="sha256:new")

    container = SimpleNamespace(
        attrs={
            "Image": "sha256:new",
            "Mounts": [
                {
                    "Destination": "/workspace",
                    "Source": "/home/robot/old_workspace",
                },
                *[
                    {"Destination": destination}
                    for destination in _GROOT_REQUIRED_MOUNTS
                    if destination != "/workspace"
                ],
            ],
        }
    )
    spec = {"image": "robotis/groot-zenoh:1.3.4-arm64"}

    assert _backend_container_stale_reason(
        "groot",
        SimpleNamespace(images=FakeImages()),
        container,
        spec,
        "/mnt/ssd/cyclo_intelligence/workspace",
    ) == "workspace_mount_mismatch"


def test_backend_container_stale_reason_accepts_repo_symlink_workspace_mount(
    monkeypatch,
    tmp_path,
):
    class FakeImages:
        def get(self, image):
            assert image == "robotis/groot-zenoh:1.3.4-arm64"
            return SimpleNamespace(id="sha256:new")

    host_repo = tmp_path / "host_repo"
    container_repo = tmp_path / "container_repo"
    ssd_workspace = tmp_path / "ssd" / "cyclo_intelligence" / "workspace"
    (host_repo / "docker").mkdir(parents=True)
    (container_repo / "docker").mkdir(parents=True)
    ssd_workspace.mkdir(parents=True)
    (container_repo / "docker" / "workspace").symlink_to(ssd_workspace)

    monkeypatch.setattr(app, "_HOST_PROJECT_DIR_CACHE", str(host_repo / "docker"))
    monkeypatch.setattr(app, "_CYCLO_REPO_MOUNT", str(container_repo))

    container = SimpleNamespace(
        attrs={
            "Image": "sha256:new",
            "Mounts": [
                {
                    "Destination": "/workspace",
                    "Source": str(host_repo / "docker" / "workspace"),
                },
                *[
                    {"Destination": destination}
                    for destination in _GROOT_REQUIRED_MOUNTS
                    if destination != "/workspace"
                ],
            ],
        }
    )
    spec = {"image": "robotis/groot-zenoh:1.3.4-arm64"}

    assert _backend_container_stale_reason(
        "groot",
        SimpleNamespace(images=FakeImages()),
        container,
        spec,
        str(ssd_workspace),
    ) is None


def test_mount_source_for_destination_resolves_workspace_host_path():
    mounts = [
        {"Destination": "/root/ros2_ws/src/cyclo_intelligence", "Source": "/repo"},
        {"Destination": "/workspace", "Source": "/mnt/ssd/cyclo_intelligence/workspace"},
    ]

    assert _mount_source_for_destination(mounts, "/workspace") == (
        "/mnt/ssd/cyclo_intelligence/workspace"
    )


def test_host_workspace_dir_prefers_actual_mount_over_legacy_env(monkeypatch):
    container = SimpleNamespace(
        attrs={
            "Mounts": [
                {
                    "Destination": "/workspace",
                    "Source": "/repo/docker/workspace",
                }
            ]
        }
    )
    client = SimpleNamespace(
        containers=SimpleNamespace(get=lambda _name: container)
    )

    monkeypatch.setenv("HOSTNAME", "self")
    monkeypatch.setenv(
        "CYCLO_WORKSPACE_DIR",
        "/mnt/ssd/cyclo_intelligence/workspace",
    )
    monkeypatch.setattr(app, "_docker_client", lambda: client)
    app._HOST_WORKSPACE_DIR_CACHE = None
    try:
        assert _host_workspace_dir() == "/repo/docker/workspace"
    finally:
        app._HOST_WORKSPACE_DIR_CACHE = None


def test_resolve_groot_trt_paths_defaults_engine_inside_model():
    model, engine = _resolve_groot_trt_paths(
        "/workspace/model/groot/example",
        "",
    )

    assert model == "/workspace/model/groot/example"
    assert engine == "/workspace/model/groot/example/dit_model_bf16.trt"


def test_trt_status_reports_ready_engine(tmp_path):
    model = tmp_path / "workspace" / "model" / "groot" / "example"
    model.mkdir(parents=True)
    engine = model / "dit_model_bf16.trt"
    engine.write_bytes(b"engine")

    status = _trt_status(str(model), str(engine))

    assert status.status == "ready"
    assert status.engine_size_bytes == len(b"engine")


def test_trt_status_reports_missing_engine(tmp_path):
    model = tmp_path / "workspace" / "model" / "groot" / "example"
    model.mkdir(parents=True)
    engine = model / "dit_model_bf16.trt"

    status = _trt_status(str(model), str(engine))

    assert status.status == "missing"


def test_trt_status_reports_stale_oom_build_from_log(tmp_path):
    model = tmp_path / "workspace" / "model" / "groot" / "example"
    model.mkdir(parents=True)
    engine = model / "dit_model_bf16.trt"
    (model / "dit_model_bf16.trt.json").write_text(
        '{"status": "building", "started_at": 1.0, "updated_at": 2.0}'
    )
    (model / "dit_model_bf16.trt.build.log").write_text(
        "=== TensorRT build exited rc=137 at 2026-06-19 06:29:02 ===\n"
    )

    status = _trt_status(str(model), str(engine))

    assert status.status == "failed"
    assert status.returncode == 137
    assert "out-of-memory" in status.message


def test_compose_uses_repo_local_workspace_mounts():
    compose = (REPO_ROOT / "docker" / "docker-compose.yml").read_text()

    assert "CYCLO_WORKSPACE_DIR" not in compose
    assert "CYCLO_HUGGINGFACE_DIR" not in compose
    assert compose.count("./workspace:/workspace") == 3
    assert compose.count("./huggingface:/root/.cache/huggingface") == 3


def test_container_helper_does_not_export_workspace_mount_overrides():
    helper = (REPO_ROOT / "docker" / "container.sh").read_text()

    assert "export CYCLO_WORKSPACE_DIR" not in helper
    assert "export CYCLO_HUGGINGFACE_DIR" not in helper
    assert "CYCLO_SSD_ROOT" not in helper
    assert "CYCLO_STORAGE_MODE" not in helper
    assert "setup_storage" not in helper
    assert "prepare_host_mounts" in helper
    assert "rsync " not in helper
    assert "rsync -aHP" not in helper


def test_bt_node_is_known_user_service():
    _require_known_service("bt_node")


def test_bt_node_robot_type_file_is_written(monkeypatch, tmp_path):
    target = tmp_path / "bt_node_robot_type"
    monkeypatch.setattr(app, "_BT_ROBOT_TYPE_FILE", str(target))

    _write_bt_robot_type("ffw_sg2_rev1")

    assert target.read_text() == "ffw_sg2_rev1\n"


def test_bt_node_robot_type_defaults_to_sg2():
    assert _validate_bt_robot_type("") == "ffw_sg2_rev1"


def test_bt_node_robot_type_rejects_other_robots():
    try:
        _validate_bt_robot_type("omy_f3m")
    except app.HTTPException as exc:
        assert exc.status_code == 400
    else:
        raise AssertionError("bt_node should reject unsupported robot types")


def test_bt_node_start_defaults_to_sg2(monkeypatch, tmp_path):
    target = tmp_path / "bt_node_robot_type"
    calls = []

    async def fake_run(*args, **kwargs):
        calls.append(args)
        return SimpleNamespace(rc=0, stdout="started", stderr="")

    monkeypatch.setattr(app, "_BT_ROBOT_TYPE_FILE", str(target))
    monkeypatch.setattr(app, "_run", fake_run)

    result = asyncio.run(app.service_start("bt_node"))

    assert result.ok is True
    assert target.read_text() == "ffw_sg2_rev1\n"
    assert calls == [("s6-rc", "-u", "change", "bt_node")]


def test_bt_node_start_rejects_other_robots(monkeypatch, tmp_path):
    target = tmp_path / "bt_node_robot_type"
    calls = []

    async def fake_run(*args, **kwargs):
        calls.append(args)
        return SimpleNamespace(rc=0, stdout="started", stderr="")

    monkeypatch.setattr(app, "_BT_ROBOT_TYPE_FILE", str(target))
    monkeypatch.setattr(app, "_run", fake_run)

    try:
        asyncio.run(app.service_start(
            "bt_node",
            app.ServiceActionRequest(robot_type="omy_f3m"),
        ))
    except app.HTTPException as exc:
        assert exc.status_code == 400
    else:
        raise AssertionError("bt_node should reject unsupported robot types")

    assert not target.exists()
    assert calls == []


def test_robot_type_validation_rejects_shell_metacharacters():
    try:
        _validate_robot_type("omy_f3m;echo bad")
    except app.HTTPException as exc:
        assert exc.status_code == 400
    else:
        raise AssertionError("invalid robot_type should be rejected")


def test_unknown_user_service_is_rejected():
    try:
        _require_known_service("not_a_service")
    except app.HTTPException as exc:
        assert exc.status_code == 404
    else:
        raise AssertionError("unknown service should be rejected")


def test_zenoh_router_is_not_user_managed_service():
    assert "zenoh_router" not in _USER_SERVICES


def test_groot_backend_uses_current_release_image():
    assert (
        _BACKENDS["groot"]["image"]
        == f"robotis/groot-zenoh:1.3.4-{app._BACKEND_ARCH}"
    )


def test_backend_status_model_exposes_stale_image_status():
    status = app.BackendStatus(
        name="groot",
        image="robotis/groot-zenoh:1.3.4-arm64",
        image_pulled=True,
        image_status="stale",
        container_state="exited",
        raw_state="stale_image",
    )

    assert status.image_status == "stale"


def test_host_project_dir_falls_back_to_compose_container_name(monkeypatch):
    class FakeContainers:
        def __init__(self):
            self.requested = []

        def get(self, name):
            self.requested.append(name)
            if name == "cyclo_intelligence":
                return SimpleNamespace(
                    attrs={
                        "Mounts": [
                            {
                                "Destination": app._CYCLO_REPO_MOUNT,
                                "Source": "/home/rc/workspace/cyclo_intelligence",
                            }
                        ]
                    }
                )
            raise NotFound(name)

    fake_containers = FakeContainers()
    fake_client = SimpleNamespace(containers=fake_containers)

    monkeypatch.setenv("HOSTNAME", "ubuntu")
    monkeypatch.setattr(app, "_docker_client", lambda: fake_client)
    app._HOST_PROJECT_DIR_CACHE = None

    try:
        assert (
            app._host_project_dir()
            == "/home/rc/workspace/cyclo_intelligence/docker"
        )
        assert fake_containers.requested == ["ubuntu", "cyclo_intelligence"]
    finally:
        app._HOST_PROJECT_DIR_CACHE = None


def test_compose_env_uses_current_container_mounts(monkeypatch):
    class FakeContainers:
        def __init__(self):
            self.requested = []

        def get(self, name):
            self.requested.append(name)
            if name != "cyclo_intelligence":
                raise NotFound(name)
            return SimpleNamespace(
                attrs={
                    "Mounts": [
                        {
                            "Destination": "/workspace",
                            "Source": "/mnt/ssd/cyclo_intelligence/workspace",
                        },
                        {
                            "Destination": "/root/.cache/huggingface",
                            "Source": "/mnt/ssd/cyclo_intelligence/huggingface",
                        },
                    ]
                }
            )

    fake_containers = FakeContainers()
    fake_client = SimpleNamespace(containers=fake_containers)

    monkeypatch.setenv("HOSTNAME", "container-id")
    monkeypatch.delenv("CYCLO_WORKSPACE_DIR", raising=False)
    monkeypatch.delenv("CYCLO_HUGGINGFACE_DIR", raising=False)
    monkeypatch.setattr(app, "_docker_client", lambda: fake_client)
    app._HOST_WORKSPACE_DIR_CACHE = None
    app._HOST_HUGGINGFACE_DIR_CACHE = None

    try:
        env = _compose_env()
        assert (
            env["CYCLO_WORKSPACE_DIR"]
            == "/mnt/ssd/cyclo_intelligence/workspace"
        )
        assert (
            env["CYCLO_HUGGINGFACE_DIR"]
            == "/mnt/ssd/cyclo_intelligence/huggingface"
        )
        assert env["ARCH"] == app._BACKEND_ARCH
        assert fake_containers.requested == [
            "container-id",
            "cyclo_intelligence",
            "container-id",
            "cyclo_intelligence",
        ]
    finally:
        app._HOST_WORKSPACE_DIR_CACHE = None
        app._HOST_HUGGINGFACE_DIR_CACHE = None
