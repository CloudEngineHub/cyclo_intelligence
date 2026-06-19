import os
import subprocess
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[1]


def test_start_pulls_main_and_policy_images(tmp_path):
    log_path = tmp_path / "docker.log"
    docker_stub = tmp_path / "docker"
    docker_stub.write_text(
        "#!/bin/sh\n"
        "printf '%s\\n' \"$*\" >> \"$DOCKER_STUB_LOG\"\n"
        "case \" $* \" in\n"
        "  *' config --format json '*)\n"
        "    printf '%s\\n' '{\"services\":{\"lerobot\":{\"image\":\"robotis/lerobot-zenoh:1.3.0-arm64\"},\"groot\":{\"image\":\"robotis/groot-zenoh:1.3.0-arm64\"},\"rldx\":{\"image\":\"robotis/rldx-zenoh:0.1.1-arm64\"}}}'\n"
        "    ;;\n"
        "esac\n"
        "if [ \"$1\" = image ] && [ \"$2\" = inspect ]; then\n"
        "  printf '%s\\n' 'sha256:current'\n"
        "fi\n"
        "exit 0\n"
    )
    docker_stub.chmod(0o755)

    env = {
        **os.environ,
        "PATH": f"{tmp_path}:{os.environ['PATH']}",
        "DOCKER_STUB_LOG": str(log_path),
        "CYCLO_AGENT_SOCKETS_DIR": str(tmp_path / "agent_sockets"),
        "CYCLO_STORAGE_MODE": "local",
        "CYCLO_LOCAL_WORKSPACE_DIR": str(tmp_path / "workspace"),
        "CYCLO_LOCAL_HUGGINGFACE_DIR": str(tmp_path / "huggingface"),
    }

    subprocess.run(
        [str(REPO_ROOT / "docker" / "container.sh"), "start"],
        cwd=REPO_ROOT,
        env=env,
        check=True,
        text=True,
        capture_output=True,
    )

    docker_calls = log_path.read_text().splitlines()
    assert any(
        "pull --ignore-pull-failures cyclo_intelligence lerobot groot rldx" in call
        for call in docker_calls
    )
    assert any(
        "up -d cyclo_intelligence rldx" in call
        for call in docker_calls
    )


def test_start_removes_policy_container_with_stale_workspace_mount(tmp_path):
    log_path = tmp_path / "docker.log"
    docker_stub = tmp_path / "docker"
    docker_stub.write_text(
        "#!/bin/sh\n"
        "printf '%s\\n' \"$*\" >> \"$DOCKER_STUB_LOG\"\n"
        "case \" $* \" in\n"
        "  *' config --format json '*)\n"
        "    printf '%s\\n' '{\"services\":{\"lerobot\":{\"image\":\"robotis/lerobot-zenoh:1.3.0-arm64\"},\"groot\":{\"image\":\"robotis/groot-zenoh:1.3.0-arm64\"},\"rldx\":{\"image\":\"robotis/rldx-zenoh:0.1.1-arm64\"}}}'\n"
        "    exit 0\n"
        "    ;;\n"
        "esac\n"
        "if [ \"$1\" = image ] && [ \"$2\" = inspect ]; then\n"
        "  printf '%s\\n' 'sha256:current'\n"
        "  exit 0\n"
        "fi\n"
        "if [ \"$1\" = inspect ] && [ \"$2\" = -f ] && [ \"$3\" = '{{.Image}}' ]; then\n"
        "  printf '%s\\n' 'sha256:current'\n"
        "  exit 0\n"
        "fi\n"
        "if [ \"$1\" = inspect ] && [ \"$2\" = -f ]; then\n"
        "  case \"$3\" in\n"
        "    *'.Destination \"/workspace\"'*)\n"
        "      if [ \"$4\" = lerobot_server ]; then\n"
        "        printf '%s\\n' '/old/workspace'\n"
        "      else\n"
        "        printf '%s\\n' \"$CYCLO_LOCAL_WORKSPACE_DIR\"\n"
        "      fi\n"
        "      exit 0\n"
        "      ;;\n"
        "  esac\n"
        "fi\n"
        "exit 0\n"
    )
    docker_stub.chmod(0o755)

    env = {
        **os.environ,
        "PATH": f"{tmp_path}:{os.environ['PATH']}",
        "DOCKER_STUB_LOG": str(log_path),
        "CYCLO_AGENT_SOCKETS_DIR": str(tmp_path / "agent_sockets"),
        "CYCLO_STORAGE_MODE": "local",
        "CYCLO_LOCAL_WORKSPACE_DIR": str(tmp_path / "workspace"),
        "CYCLO_LOCAL_HUGGINGFACE_DIR": str(tmp_path / "huggingface"),
    }

    subprocess.run(
        [str(REPO_ROOT / "docker" / "container.sh"), "start"],
        cwd=REPO_ROOT,
        env=env,
        check=True,
        text=True,
        capture_output=True,
    )

    docker_calls = log_path.read_text().splitlines()
    assert any(
        call == "rm -f lerobot_server"
        for call in docker_calls
    )


def test_start_lerobot_removes_stale_workspace_mount(tmp_path):
    log_path = tmp_path / "docker.log"
    docker_stub = tmp_path / "docker"
    docker_stub.write_text(
        "#!/bin/sh\n"
        "printf '%s\\n' \"$*\" >> \"$DOCKER_STUB_LOG\"\n"
        "case \" $* \" in\n"
        "  *' config --format json '*)\n"
        "    printf '%s\\n' '{\"services\":{\"lerobot\":{\"image\":\"robotis/lerobot-zenoh:1.3.0-arm64\"},\"groot\":{\"image\":\"robotis/groot-zenoh:1.3.0-arm64\"}}}'\n"
        "    exit 0\n"
        "    ;;\n"
        "esac\n"
        "if [ \"$1\" = image ] && [ \"$2\" = inspect ]; then\n"
        "  printf '%s\\n' 'sha256:current'\n"
        "  exit 0\n"
        "fi\n"
        "if [ \"$1\" = inspect ] && [ \"$2\" = -f ] && [ \"$3\" = '{{.Image}}' ]; then\n"
        "  printf '%s\\n' 'sha256:current'\n"
        "  exit 0\n"
        "fi\n"
        "if [ \"$1\" = inspect ] && [ \"$2\" = -f ]; then\n"
        "  case \"$3\" in\n"
        "    *'.Destination \"/workspace\"'*)\n"
        "      printf '%s\\n' '/old/workspace'\n"
        "      exit 0\n"
        "      ;;\n"
        "  esac\n"
        "fi\n"
        "exit 0\n"
    )
    docker_stub.chmod(0o755)

    env = {
        **os.environ,
        "PATH": f"{tmp_path}:{os.environ['PATH']}",
        "DOCKER_STUB_LOG": str(log_path),
        "CYCLO_AGENT_SOCKETS_DIR": str(tmp_path / "agent_sockets"),
        "CYCLO_STORAGE_MODE": "local",
        "CYCLO_LOCAL_WORKSPACE_DIR": str(tmp_path / "workspace"),
        "CYCLO_LOCAL_HUGGINGFACE_DIR": str(tmp_path / "huggingface"),
    }

    subprocess.run(
        [str(REPO_ROOT / "docker" / "container.sh"), "start-lerobot"],
        cwd=REPO_ROOT,
        env=env,
        check=True,
        text=True,
        capture_output=True,
    )

    docker_calls = log_path.read_text().splitlines()
    assert any(
        call == "rm -f lerobot_server"
        for call in docker_calls
    )


def test_start_rldx_repairs_unwritable_model_parent(tmp_path):
    docker_log_path = tmp_path / "docker.log"
    sudo_log_path = tmp_path / "sudo.log"
    docker_stub = tmp_path / "docker"
    docker_stub.write_text(
        "#!/bin/sh\n"
        "printf '%s\\n' \"$*\" >> \"$DOCKER_STUB_LOG\"\n"
        "case \" $* \" in\n"
        "  *' config --format json '*)\n"
        "    printf '%s\\n' '{\"services\":{\"rldx\":{\"image\":\"robotis/rldx-zenoh:0.1.1-arm64\"}}}'\n"
        "    exit 0\n"
        "    ;;\n"
        "esac\n"
        "if [ \"$1\" = image ] && [ \"$2\" = inspect ]; then\n"
        "  printf '%s\\n' 'sha256:current'\n"
        "  exit 0\n"
        "fi\n"
        "exit 0\n"
    )
    docker_stub.chmod(0o755)

    sudo_stub = tmp_path / "sudo"
    sudo_stub.write_text(
        "#!/bin/sh\n"
        "printf '%s\\n' \"$*\" >> \"$SUDO_STUB_LOG\"\n"
        "exec \"$@\"\n"
    )
    sudo_stub.chmod(0o755)

    workspace = tmp_path / "workspace"
    model_dir = workspace / "model"
    model_dir.mkdir(parents=True)
    model_dir.chmod(0o555)

    env = {
        **os.environ,
        "PATH": f"{tmp_path}:{os.environ['PATH']}",
        "DOCKER_STUB_LOG": str(docker_log_path),
        "SUDO_STUB_LOG": str(sudo_log_path),
        "CYCLO_AGENT_SOCKETS_DIR": str(tmp_path / "agent_sockets"),
        "CYCLO_STORAGE_MODE": "local",
        "CYCLO_LOCAL_WORKSPACE_DIR": str(workspace),
        "CYCLO_LOCAL_HUGGINGFACE_DIR": str(tmp_path / "huggingface"),
    }

    try:
        subprocess.run(
            [str(REPO_ROOT / "docker" / "container.sh"), "start-rldx"],
            cwd=REPO_ROOT,
            env=env,
            check=True,
            text=True,
            capture_output=True,
        )
    finally:
        model_dir.chmod(0o755)

    assert (model_dir / "lerobot").is_dir()
    assert (model_dir / "groot").is_dir()
    assert (model_dir / "rldx").is_dir()
    assert os.access(model_dir / "rldx", os.W_OK)
    assert any(
        call.startswith("chmod u+rwx ") and str(model_dir) in call
        for call in sudo_log_path.read_text().splitlines()
    )


def test_build_ui_falls_back_when_main_ui_dir_is_not_user_accessible(tmp_path):
    log_path = tmp_path / "docker.log"
    ui_dir = tmp_path / "ui"
    ui_cache = ui_dir / "node_modules" / ".cache"
    ui_cache.mkdir(parents=True)
    (ui_dir / "package.json").write_text("{}\n")
    ui_cache.chmod(0o555)

    docker_stub = tmp_path / "docker"
    docker_stub.write_text(
        "#!/bin/sh\n"
        "printf '%s\\n' \"$*\" >> \"$DOCKER_STUB_LOG\"\n"
        "if [ \"$1\" = ps ]; then\n"
        "  printf '%s\\n' 'cyclo_intelligence'\n"
        "  exit 0\n"
        "fi\n"
        "if [ \"$1\" = exec ] && [ \"$2\" = -u ]; then\n"
        "  exit 13\n"
        "fi\n"
        "exit 0\n"
    )
    docker_stub.chmod(0o755)

    env = {
        **os.environ,
        "PATH": f"{tmp_path}:{os.environ['PATH']}",
        "DOCKER_STUB_LOG": str(log_path),
        "CYCLO_UI_DIR": str(ui_dir),
    }

    try:
        subprocess.run(
            [str(REPO_ROOT / "docker" / "container.sh"), "build-ui"],
            cwd=REPO_ROOT,
            env=env,
            check=True,
            text=True,
            capture_output=True,
        )
    finally:
        ui_cache.chmod(0o755)

    docker_calls = log_path.read_text().splitlines()
    assert any(
        call.startswith("run --rm --network none ") and " chown -R " in call and "node_modules" in call
        for call in docker_calls
    )
    assert any(
        call.startswith("run --rm --network host ") and " npm run build" in call
        for call in docker_calls
    )
    assert not any(
        call.startswith("exec -u ") and " npm run build" in call
        for call in docker_calls
    )
    assert any(
        call.startswith("cp ") and " cyclo_intelligence:/usr/share/nginx/html/" in call
        for call in docker_calls
    )
    assert any(
        call.startswith("cp ") and "nginx.conf cyclo_intelligence:/etc/nginx/conf.d/default.conf" in call
        for call in docker_calls
    )
    assert any(
        call == "exec cyclo_intelligence nginx -t"
        for call in docker_calls
    )
