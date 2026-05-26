"""Tests for LeRobot video grid synchronisation."""

from __future__ import annotations

from pathlib import Path
import shutil
import subprocess
import sys
import tempfile

import numpy as np
import pytest


_REPO_ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(_REPO_ROOT / "cyclo_data"))

from cyclo_data.converter.video_sync import remux_selected_frames  # noqa: E402


pytestmark = pytest.mark.skipif(
    shutil.which("ffmpeg") is None or shutil.which("ffprobe") is None,
    reason="ffmpeg/ffprobe unavailable",
)


def _make_mjpeg_mp4(path: Path, colors: list[int], *, w: int = 64, h: int = 48) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory() as tmp:
        tdir = Path(tmp)
        try:
            from PIL import Image
        except Exception as exc:
            pytest.skip(f"PIL unavailable: {exc}")
        for i, color in enumerate(colors):
            arr = np.full((h, w, 3), color, dtype=np.uint8)
            Image.fromarray(arr).save(tdir / f"f_{i:06d}.jpg", quality=95)
        subprocess.run(
            [
                "ffmpeg", "-hide_banner", "-loglevel", "error", "-y",
                "-framerate", "30",
                "-i", str(tdir / "f_%06d.jpg"),
                "-c:v", "copy",
                str(path),
            ],
            check=True,
        )


def _frame_count(path: Path) -> int:
    res = subprocess.run(
        [
            "ffprobe", "-v", "error", "-select_streams", "v:0",
            "-count_frames",
            "-show_entries", "stream=nb_read_frames",
            "-of", "default=noprint_wrappers=1:nokey=1",
            str(path),
        ],
        capture_output=True,
        text=True,
        check=True,
    )
    return int(res.stdout.strip())


def _dimensions(path: Path) -> tuple[int, int]:
    res = subprocess.run(
        [
            "ffprobe", "-v", "error", "-select_streams", "v:0",
            "-show_entries", "stream=width,height",
            "-of", "csv=p=0",
            str(path),
        ],
        capture_output=True,
        text=True,
        check=True,
    )
    w, h = res.stdout.strip().split(",")
    return int(w), int(h)


def _mean_values(path: Path) -> list[float]:
    cv2 = pytest.importorskip("cv2")
    cap = cv2.VideoCapture(str(path))
    values = []
    while True:
        ret, frame = cap.read()
        if not ret:
            break
        values.append(float(frame.mean()))
    cap.release()
    return values


def test_streaming_sync_preserves_duplicates_and_returns_stats(tmp_path):
    src = tmp_path / "src.mp4"
    dst = tmp_path / "synced.mp4"
    _make_mjpeg_mp4(src, [0, 60, 120, 180])

    result = remux_selected_frames(src, [0, 1, 1, 3], dst, target_fps=10)

    assert result.frame_count == 4
    assert result.used_fallback is False
    assert result.stats is not None
    assert _frame_count(dst) == 4
    means = _mean_values(dst)
    assert len(means) == 4
    assert means[1] == pytest.approx(means[2], abs=3.0)
    assert means[0] < means[1] < means[3]


def test_streaming_sync_rotation_resize(tmp_path):
    src = tmp_path / "src.mp4"
    dst = tmp_path / "rotated.mp4"
    _make_mjpeg_mp4(src, [20, 40], w=64, h=48)

    result = remux_selected_frames(
        src, [0, 1], dst, target_fps=15, rotation_deg=90, image_resize=(24, 32)
    )

    assert result.frame_count == 2
    assert _frame_count(dst) == 2
    assert _dimensions(dst) == (32, 24)


def test_forced_fallback_still_matches_frame_count(tmp_path, monkeypatch):
    src = tmp_path / "src.mp4"
    dst = tmp_path / "fallback.mp4"
    _make_mjpeg_mp4(src, [0, 80, 160])
    monkeypatch.setenv("CYCLO_VIDEO_SYNC_FORCE_FALLBACK", "1")

    result = remux_selected_frames(src, [0, 2], dst, target_fps=10)

    assert result.used_fallback is True
    assert result.frame_count == 2
    assert _frame_count(dst) == 2
