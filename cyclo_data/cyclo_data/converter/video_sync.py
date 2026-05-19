# Copyright 2026 ROBOTIS CO., LTD.
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0

"""Convert a recorded MP4 + frame index list into a synced MP4.

LeRobot's dataset format assumes a 1:1 mapping between parquet rows and
MP4 frames per episode. The recorder writes one frame per camera publish
event (variable rate), so the convert step has to re-pack the MP4 with
exactly one frame per resampled grid timestamp.

Strategy: stream-decode the input MP4 once, write selected frames directly
to a H.264 encoder, and fall back to the older JPEG-temp implementation if
the streaming path cannot handle the input. This avoids materialising every
source frame on disk in the common recording-v2 path.
"""

from __future__ import annotations

from dataclasses import dataclass
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
from typing import Any, Optional, Sequence

import numpy as np


_VIDEO_SYNC_TMPDIR_ENV = "CYCLO_VIDEO_SYNC_TMPDIR"
_VIDEO_SYNC_MIN_FREE_MB_ENV = "CYCLO_VIDEO_SYNC_MIN_FREE_MB"
_VIDEO_SYNC_FORCE_FALLBACK_ENV = "CYCLO_VIDEO_SYNC_FORCE_FALLBACK"


@dataclass
class VideoSyncResult:
    """Summary returned by :func:`remux_selected_frames`."""

    frame_count: int
    stats: Optional[dict[str, Any]] = None
    used_fallback: bool = False


def _ffmpeg() -> str:
    bin_ = shutil.which("ffmpeg")
    if bin_ is None:
        raise RuntimeError("ffmpeg not found on PATH")
    return bin_


_H264_ENCODER_CACHE: "list[str] | None" = None


def _ffmpeg_threads_arg() -> list[str]:
    """Return ``["-threads", "N"]`` to cap per-process ffmpeg threading.

    libx264 (and most SW encoders) default to auto-threads = min(cpu_count, 16),
    so a single ffmpeg can balloon to 8 cores on a Jetson Orin. Combined
    with multiple parallel conversion workers, the host gets oversubscribed
    and the ROS control loop starves. We cap to 2 threads per ffmpeg by
    default; override with ``CYCLO_FFMPEG_THREADS`` (e.g. 1 on hot/thermal-
    limited boxes, 4 on a dedicated conversion host).

    NVENC / v4l2m2m encoders ignore ``-threads`` (they're H/W accelerated),
    so the flag is a no-op when those are selected — but we always pass it
    so libx264 fallback is safe.
    """
    raw = os.environ.get("CYCLO_FFMPEG_THREADS", "2")
    try:
        n = max(1, int(raw))
    except ValueError:
        n = 2
    return ["-threads", str(n)]


def _resolve_tmp_parent(output_mp4: Path) -> tuple[Path, bool]:
    override = os.environ.get(_VIDEO_SYNC_TMPDIR_ENV)
    if override:
        parent = Path(override)
        cleanup_when_empty = False
    else:
        parent = output_mp4.parent / ".video_sync_tmp"
        cleanup_when_empty = True
    parent.mkdir(parents=True, exist_ok=True)
    return parent, cleanup_when_empty


def _resolve_min_free_mb() -> int:
    raw = os.environ.get(_VIDEO_SYNC_MIN_FREE_MB_ENV, "0")
    try:
        return max(0, int(raw))
    except ValueError:
        return 0


def _check_tmp_free_space(tmp_parent: Path) -> None:
    min_free_mb = _resolve_min_free_mb()
    if min_free_mb <= 0:
        return
    free_mb = shutil.disk_usage(tmp_parent).free / (1024 * 1024)
    if free_mb < min_free_mb:
        raise RuntimeError(
            f"video_sync temp dir {tmp_parent} has {free_mb:.1f} MB free; "
            f"requires at least {min_free_mb} MB "
            f"({_VIDEO_SYNC_MIN_FREE_MB_ENV})"
        )


def _cleanup_tmp_parent(tmp_parent: Path, cleanup_when_empty: bool) -> None:
    if not cleanup_when_empty:
        return
    try:
        tmp_parent.rmdir()
    except OSError:
        pass


def _try_encoder(ffmpeg: str, encoder: str, opts: list[str]) -> bool:
    """Smoke-test an encoder by running a 1-frame null-out encode.

    ffmpeg lists encoders that are *compiled in* regardless of whether
    the runtime can actually use them (e.g. h264_nvenc inside a
    container without nvidia-uvm / GPU passthrough). The only reliable
    check is to try a tiny encode and see if the process exits 0.
    """
    cmd = [
        ffmpeg, "-hide_banner", "-loglevel", "error", "-y",
        "-f", "lavfi", "-i", "color=c=black:s=64x64:r=15:d=0.1",
        "-c:v", encoder, *opts,
        "-pix_fmt", "yuv420p",
        "-f", "null", "-",
    ]
    try:
        res = subprocess.run(cmd, capture_output=True, timeout=10)
        return res.returncode == 0
    except Exception:
        return False


def _h264_encoder(ffmpeg: str) -> tuple[str, list[str]]:
    """Pick the fastest *runtime-usable* H.264 encoder + its options.

    ffmpeg's ``-encoders`` listing only tells us what's compiled in, not
    what works on this host (containerised nvenc commonly fails with
    "Operation not permitted"). We try candidates in preference order
    with a 1-frame smoke encode and cache the first that succeeds.

    Preference: h264_nvenc → h264_v4l2m2m → libx264 (always works).
    """
    global _H264_ENCODER_CACHE
    if _H264_ENCODER_CACHE is not None:
        name, *opts = _H264_ENCODER_CACHE
        return name, opts

    candidates: list[tuple[str, list[str]]] = [
        ("h264_nvenc", ["-preset", "p4", "-tune", "ll", "-rc", "vbr", "-cq", "23"]),
        ("h264_v4l2m2m", ["-b:v", "5M"]),
        ("libx264", ["-preset", "ultrafast", "-crf", "23"]),
    ]
    probe = subprocess.run(
        [ffmpeg, "-hide_banner", "-encoders"],
        capture_output=True, text=True, check=False,
    )
    listed = probe.stdout
    for name, opts in candidates:
        if name not in listed:
            continue
        if _try_encoder(ffmpeg, name, opts):
            _H264_ENCODER_CACHE = [name, *opts]
            return name, opts
    # Should never fall through (libx264 is bundled with our ffmpeg) —
    # but raise rather than silently fall back to copy.
    raise RuntimeError("No usable H.264 encoder found on this ffmpeg")


def _rotation_transpose(rotation_deg: int) -> str | None:
    """Map ``rotation_deg`` (0/90/180/270) to ffmpeg ``-vf transpose`` value."""
    deg = int(rotation_deg or 0) % 360
    if deg == 0:
        return None
    if deg == 90:
        return "transpose=1"
    if deg == 180:
        return "transpose=2,transpose=2"
    if deg == 270:
        return "transpose=2"
    return None


def _video_filter_args(
    rotation_deg: int,
    image_resize: "tuple[int, int] | None",
) -> list[str]:
    """Build ffmpeg ``-vf`` args for rotation then resize."""
    vf_filters: list[str] = []
    rot_filter = _rotation_transpose(rotation_deg)
    if rot_filter:
        vf_filters.append(rot_filter)
    if image_resize is not None:
        h, w = int(image_resize[0]), int(image_resize[1])
        if h > 0 and w > 0:
            vf_filters.append(f"scale={w}:{h}")
    return ["-vf", ",".join(vf_filters)] if vf_filters else []


def _video_frame_count(video_path: Path) -> Optional[int]:
    """Return decoded frame count using ffprobe, or None if unknown."""
    try:
        cmd = [
            "ffprobe", "-v", "error",
            "-select_streams", "v:0",
            "-count_frames",
            "-show_entries", "stream=nb_read_frames,nb_frames",
            "-of", "default=noprint_wrappers=1",
            str(video_path),
        ]
        res = subprocess.run(cmd, capture_output=True, text=True, timeout=60)
        if res.returncode != 0:
            return None
        values: dict[str, str] = {}
        for line in res.stdout.splitlines():
            if "=" not in line:
                continue
            k, v = line.split("=", 1)
            values[k.strip()] = v.strip()
        for key in ("nb_read_frames", "nb_frames"):
            raw = values.get(key)
            if raw and raw != "N/A":
                return int(raw)
    except Exception:
        return None
    return None


def _stats_from_samples(samples_rgb: list[np.ndarray]) -> Optional[dict[str, Any]]:
    if not samples_rgb:
        return None
    frames = np.asarray(samples_rgb, dtype=np.float32) / 255.0
    channels = [frames[:, :, :, i] for i in range(3)]

    def channel_stats(channel: np.ndarray) -> dict[str, float]:
        return {
            "mean": float(np.mean(channel)),
            "std": float(np.std(channel)),
            "min": float(np.min(channel)),
            "max": float(np.max(channel)),
        }

    r_stats, g_stats, b_stats = [channel_stats(channel) for channel in channels]
    return {
        "min": [[[r_stats["min"]]], [[g_stats["min"]]], [[b_stats["min"]]]],
        "max": [[[r_stats["max"]]], [[g_stats["max"]]], [[b_stats["max"]]]],
        "mean": [[[r_stats["mean"]]], [[g_stats["mean"]]], [[b_stats["mean"]]]],
        "std": [[[r_stats["std"]]], [[g_stats["std"]]], [[b_stats["std"]]]],
        "count": [len(samples_rgb)],
    }


def _transform_frame_for_stats(
    frame_bgr: np.ndarray,
    rotation_deg: int,
    image_resize: "tuple[int, int] | None",
) -> np.ndarray:
    """Mirror the ffmpeg filter chain closely enough for cached stats."""
    import cv2

    deg = int(rotation_deg or 0) % 360
    if deg == 90:
        frame_bgr = cv2.rotate(frame_bgr, cv2.ROTATE_90_CLOCKWISE)
    elif deg == 180:
        frame_bgr = cv2.rotate(frame_bgr, cv2.ROTATE_180)
    elif deg == 270:
        frame_bgr = cv2.rotate(frame_bgr, cv2.ROTATE_90_COUNTERCLOCKWISE)
    if image_resize is not None:
        h, w = int(image_resize[0]), int(image_resize[1])
        if h > 0 and w > 0:
            frame_bgr = cv2.resize(frame_bgr, (w, h), interpolation=cv2.INTER_AREA)
    return cv2.cvtColor(frame_bgr, cv2.COLOR_BGR2RGB)


def remux_selected_frames(
    input_mp4: Path,
    frame_indices: Sequence[int],
    output_mp4: Path,
    target_fps: int,
    rotation_deg: int = 0,
    image_resize: "tuple[int, int] | None" = None,
) -> VideoSyncResult:
    """Produce ``output_mp4`` containing the listed frames in order.

    Args:
        input_mp4: source MJPEG-in-MP4 written by VideoRecorder.
        frame_indices: 0-based indices into ``input_mp4`` selected for
            output (one per target grid step). Repeats are allowed and
            simply duplicate the source frame in the output.
        output_mp4: destination path.
        target_fps: container framerate stamped on the output. Each
            entry of ``frame_indices`` becomes one frame at
            ``1/target_fps``.
    """
    input_mp4 = Path(input_mp4)
    output_mp4 = Path(output_mp4)
    output_mp4.parent.mkdir(parents=True, exist_ok=True)

    if not input_mp4.exists():
        raise FileNotFoundError(input_mp4)
    if len(frame_indices) == 0:
        raise ValueError("frame_indices is empty")

    frame_indices = [int(i) for i in frame_indices]
    ffmpeg = _ffmpeg()
    if not os.environ.get(_VIDEO_SYNC_FORCE_FALLBACK_ENV):
        try:
            return _remux_selected_frames_streaming(
                input_mp4=input_mp4,
                frame_indices=frame_indices,
                output_mp4=output_mp4,
                target_fps=target_fps,
                rotation_deg=rotation_deg,
                image_resize=image_resize,
                ffmpeg=ffmpeg,
            )
        except Exception as exc:
            import sys as _sys
            print(
                f"video_sync[{input_mp4.name}]: streaming path failed "
                f"({exc!r}); falling back to JPEG temp path",
                file=_sys.stderr,
            )
            output_mp4.unlink(missing_ok=True)

    tmp_parent, cleanup_tmp_parent = _resolve_tmp_parent(output_mp4)
    try:
        _check_tmp_free_space(tmp_parent)
        with tempfile.TemporaryDirectory(
            prefix="video_sync_", dir=str(tmp_parent)
        ) as tmpdir:
            tmp = Path(tmpdir)
            frames_dir = tmp / "frames"
            frames_dir.mkdir()
            seq_dir = tmp / "seq"
            seq_dir.mkdir()

            _remux_selected_frames_in_tmp(
                input_mp4=input_mp4,
                frame_indices=frame_indices,
                output_mp4=output_mp4,
                target_fps=target_fps,
                rotation_deg=rotation_deg,
                image_resize=image_resize,
                ffmpeg=ffmpeg,
                frames_dir=frames_dir,
                seq_dir=seq_dir,
            )
        produced_frames = _video_frame_count(output_mp4)
        if produced_frames != len(frame_indices):
            output_mp4.unlink(missing_ok=True)
            raise RuntimeError(
                f"video_sync fallback frame count mismatch for "
                f"{output_mp4.name}: expected {len(frame_indices)}, "
                f"got {produced_frames}"
            )
        return VideoSyncResult(
            frame_count=int(produced_frames),
            stats=None,
            used_fallback=True,
        )
    finally:
        _cleanup_tmp_parent(tmp_parent, cleanup_tmp_parent)


def _remux_selected_frames_streaming(
    *,
    input_mp4: Path,
    frame_indices: Sequence[int],
    output_mp4: Path,
    target_fps: int,
    rotation_deg: int,
    image_resize: "tuple[int, int] | None",
    ffmpeg: str,
) -> VideoSyncResult:
    """Decode input once and stream selected BGR frames to ffmpeg."""
    if any(i < 0 for i in frame_indices):
        raise ValueError("frame_indices must be non-negative")
    if any(b < a for a, b in zip(frame_indices, frame_indices[1:])):
        raise ValueError("streaming sync requires non-decreasing frame_indices")

    import cv2

    cap = cv2.VideoCapture(str(input_mp4))
    if not cap.isOpened():
        raise RuntimeError(f"failed to open input video: {input_mp4}")

    process: subprocess.Popen | None = None
    last_frame: np.ndarray | None = None
    current_idx = -1
    clamped_count = 0
    sample_positions = set(
        np.linspace(
            0,
            len(frame_indices) - 1,
            min(100, len(frame_indices)),
            dtype=int,
        ).tolist()
    )
    samples_rgb: list[np.ndarray] = []
    stderr = ""

    try:
        for out_idx, requested_idx in enumerate(frame_indices):
            while current_idx < requested_idx:
                ret, frame = cap.read()
                if not ret:
                    if last_frame is None:
                        raise RuntimeError(
                            f"no frames decoded from {input_mp4.name}"
                        )
                    clamped_count += 1
                    break
                current_idx += 1
                last_frame = frame

            if last_frame is None:
                raise RuntimeError(f"no frame available for {input_mp4.name}")

            if process is None:
                height, width = last_frame.shape[:2]
                encoder, enc_opts = _h264_encoder(ffmpeg)
                cmd = [
                    ffmpeg, "-hide_banner", "-loglevel", "warning", "-y",
                    *_ffmpeg_threads_arg(),
                    "-f", "rawvideo",
                    "-pix_fmt", "bgr24",
                    "-s", f"{width}x{height}",
                    "-r", str(int(target_fps)),
                    "-i", "pipe:0",
                    *_video_filter_args(rotation_deg, image_resize),
                    "-c:v", encoder,
                    *enc_opts,
                    "-pix_fmt", "yuv420p",
                    "-r", str(int(target_fps)),
                    "-video_track_timescale", "90000",
                    "-movflags", "+faststart",
                    str(output_mp4),
                ]
                process = subprocess.Popen(
                    cmd,
                    stdin=subprocess.PIPE,
                    stdout=subprocess.DEVNULL,
                    stderr=subprocess.PIPE,
                )

            assert process.stdin is not None
            process.stdin.write(last_frame.tobytes())

            if out_idx in sample_positions:
                samples_rgb.append(
                    _transform_frame_for_stats(
                        last_frame,
                        rotation_deg=rotation_deg,
                        image_resize=image_resize,
                    )
                )

        if process is None or process.stdin is None:
            raise RuntimeError("encoder was not started")
        process.stdin.close()
        if process.stderr is not None:
            stderr = process.stderr.read().decode(errors="replace")
        rc = process.wait(timeout=300)
        if rc != 0:
            raise RuntimeError(f"ffmpeg encode rc={rc}: {stderr[-500:]}")

        produced_frames = _video_frame_count(output_mp4)
        if produced_frames != len(frame_indices):
            output_mp4.unlink(missing_ok=True)
            raise RuntimeError(
                f"streaming frame count mismatch for {output_mp4.name}: "
                f"expected {len(frame_indices)}, got {produced_frames}"
            )

        if clamped_count:
            import sys as _sys
            print(
                f"video_sync[{input_mp4.name}]: clamped {clamped_count} "
                f"selected indices beyond decoded frames to last frame",
                file=_sys.stderr,
            )

        return VideoSyncResult(
            frame_count=int(produced_frames),
            stats=_stats_from_samples(samples_rgb),
            used_fallback=False,
        )
    finally:
        cap.release()
        if process is not None and process.poll() is None:
            try:
                if process.stdin and not process.stdin.closed:
                    process.stdin.close()
            except Exception:
                pass
            process.kill()


def _remux_selected_frames_in_tmp(
    *,
    input_mp4: Path,
    frame_indices: Sequence[int],
    output_mp4: Path,
    target_fps: int,
    rotation_deg: int,
    image_resize: "tuple[int, int] | None",
    ffmpeg: str,
    frames_dir: Path,
    seq_dir: Path,
) -> None:
    # 1) Extract input frames as JPEGs.
    #
    # Fast path (MJPEG source — pre-transcode recordings): copy
    # each packet's JPEG payload verbatim, no decode/encode, no
    # quality loss.
    #
    # Generic path (H.264 source — post-transcode recordings, or
    # anything else): decode and re-encode each frame as a high-
    # quality JPEG. Slightly slower and not bit-exact, but works
    # for any codec the recorder might produce.
    probe = subprocess.run(
        [
            "ffprobe", "-v", "error", "-select_streams", "v:0",
            "-show_entries", "stream=codec_name", "-of", "csv=p=0",
            str(input_mp4),
        ],
        capture_output=True, text=True, timeout=30,
    )
    src_codec = probe.stdout.strip()

    if src_codec == "mjpeg":
        # ``-c:v copy`` doesn't decode so threads matter little, but
        # we pass the flag anyway for consistency / future codec
        # changes.
        extract_cmd = [
            ffmpeg, "-hide_banner", "-loglevel", "warning", "-y",
            *_ffmpeg_threads_arg(),
            "-i", str(input_mp4),
            "-c:v", "copy",
            "-fps_mode", "passthrough",
            "-f", "image2",
            "-start_number", "0",
            str(frames_dir / "f_%08d.jpg"),
        ]
    else:
        # H.264 source: ffmpeg decodes here, so the auto-thread default
        # (= cpu_count) blows up to 6+ cores per ffmpeg without the
        # cap. Observed 264% CPU per extract before the cap.
        #
        # CRITICAL: image selection is index-based, so we need exactly
        # one JPG per decoded input frame. ``-fps_mode passthrough``
        # avoids CFR duplication from stale container r_frame_rate tags,
        # while ``setpts=N/TB`` regenerates monotonic output PTS for
        # H.264 files whose source PTS/DTS are duplicated or slightly
        # out of order. Without the setpts filter, ffmpeg's image2 muxer
        # can fail with "non monotonically increasing dts" before all
        # frames are extracted.
        extract_cmd = [
            ffmpeg, "-hide_banner", "-loglevel", "warning", "-y",
            *_ffmpeg_threads_arg(),
            "-i", str(input_mp4),
            "-vf", "setpts=N/TB",
            "-q:v", "2",
            "-fps_mode", "passthrough",
            "-f", "image2",
            "-start_number", "0",
            str(frames_dir / "f_%08d.jpg"),
        ]
    subprocess.run(extract_cmd, check=True)

    # The sidecar parquet can list more rows than the MP4 actually
    # contains: ffmpeg's mjpeg demuxer drops the first packet when
    # it lacks an EOI marker (some camera drivers emit truncated
    # initial frames), so a 95-row sidecar maps onto a 94-frame
    # MP4. Clamp selected indices to the actually-extracted range
    # rather than failing — the lost frame would have been the very
    # first one which is rarely a useful anchor anyway.
    extracted_files = sorted(frames_dir.glob("f_*.jpg"))
    if not extracted_files:
        raise RuntimeError(
            f"No frames extracted from {input_mp4.name}; cannot remux"
        )
    extracted_count = len(extracted_files)
    max_idx = max(frame_indices)
    if max_idx >= extracted_count:
        # Clamp every out-of-range index to the last available frame.
        clamped_indices = [
            min(i, extracted_count - 1) for i in frame_indices
        ]
        clamped_count = sum(
            1 for i, c in zip(frame_indices, clamped_indices) if i != c
        )
        # We can't log via a node logger from here (this module is
        # also called from worker processes), so just emit a warning
        # to stderr so the caller's log capture picks it up.
        import sys as _sys
        print(
            f"video_sync[{input_mp4.name}]: clamped {clamped_count} "
            f"selected indices >= {extracted_count} to last frame "
            f"(sidecar/MP4 mismatch)",
            file=_sys.stderr,
        )
        frame_indices = clamped_indices  # type: ignore[assignment]

    # 2) Hard-link selected frames into a fresh sequence so we can
    #    drive ffmpeg's image2 demuxer (sequential, gap-free) and
    #    sidestep concat demuxer's duration quirks. Hard links cost
    #    no extra disk and survive across the second ffmpeg run.
    for out_idx, src_idx in enumerate(frame_indices):
        src = frames_dir / f"f_{src_idx:08d}.jpg"
        dst = seq_dir / f"seq_{out_idx:08d}.jpg"
        try:
            os.link(src, dst)
        except OSError:
            # Fall back to copy if the temp dir is on a filesystem
            # that doesn't support hard links (rare).
            shutil.copy2(src, dst)

    # 3) Re-encode into H.264 MP4 at exactly target_fps. The recorder
    #    keeps frames as raw MJPEG to avoid live CPU/GPU load; the
    #    convert step is the right place to pay for H.264 so the
    #    final LeRobot dataset is universally playable (Chromium /
    #    VSCode webview / browser <video> require H.264). HW encoder
    #    (NVENC / v4l2m2m) is preferred when available.
    # ``-video_track_timescale 90000`` pins the MP4 timebase to a
    # value that exactly represents 1/15s, 1/30s, 1/60s, etc. The
    # ffmpeg default (1/1000) truncates 1/15s = 0.0666...s to 66ms,
    # which makes ffprobe report avg_frame_rate=15.1515 instead of
    # 15. 90000 is the H.264 RTP standard and divides cleanly into
    # every common LeRobot fps.
    encoder, enc_opts = _h264_encoder(ffmpeg)
    # Build the ``-vf`` chain. Order matters: rotation first (because
    # transpose changes width/height), then scale so the user's
    # target dimensions describe the final output, not the
    # pre-rotation orientation. ``image_resize`` is ``(height, width)``
    # to match the orchestrator-side ConversionConfig field.
    mux_cmd = [
        ffmpeg, "-hide_banner", "-loglevel", "warning", "-y",
        *_ffmpeg_threads_arg(),
        "-framerate", str(int(target_fps)),
        "-start_number", "0",
        "-i", str(seq_dir / "seq_%08d.jpg"),
        *_video_filter_args(rotation_deg, image_resize),
        "-c:v", encoder,
        *enc_opts,
        "-pix_fmt", "yuv420p",
        "-r", str(int(target_fps)),
        "-video_track_timescale", "90000",
        "-movflags", "+faststart",
        str(output_mp4),
    ]
    subprocess.run(mux_cmd, check=True)

    # Verify the encoder actually produced a non-empty file.
    # ffmpeg occasionally returns rc=0 with a 0-byte output (e.g.
    # the older "extract MJPEG packets from H.264 source" bug) and
    # we must not silently ship that to the LeRobot dataset.
    if not output_mp4.exists() or output_mp4.stat().st_size == 0:
        output_mp4.unlink(missing_ok=True)
        raise RuntimeError(
            f"video_sync produced an empty file for {output_mp4.name}; "
            f"check input codec ({src_codec}) compatibility"
        )
