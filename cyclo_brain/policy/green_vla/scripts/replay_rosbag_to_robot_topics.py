#!/usr/bin/env python3
#
# Copyright 2026 ROBOTIS CO., LTD.
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0

"""Replay a rosbag into the live Cyclo RobotClient topic schema.

The inference runtime subscribes to topics from ``shared/robot_configs``.
Some collected test bags use older camera topic names. This utility reads the
bag CDR payloads and republishes them through zenoh_ros2_sdk with topic remaps.
"""

from __future__ import annotations

import argparse
import signal
import sys
import time
from pathlib import Path

import zenoh
from rosbags.highlevel import AnyReader
from zenoh import Encoding
from zenoh_ros2_sdk import ROS2Publisher


TOPIC_REMAPS = {
    "/robot/camera/cam_left_head/image_raw/compressed": (
        "/zed/zed_node/left/image_rect_color/compressed",
        "sensor_msgs/msg/CompressedImage",
    ),
    "/robot/camera/cam_right_head/image_raw/compressed": (
        "/zed/zed_node/right/image_rect_color/compressed",
        "sensor_msgs/msg/CompressedImage",
    ),
    "/robot/camera/cam_left_wrist/image_raw/compressed": (
        "/camera_left/camera_left/color/image_rect_raw/compressed",
        "sensor_msgs/msg/CompressedImage",
    ),
    "/robot/camera/cam_right_wrist/image_raw/compressed": (
        "/camera_right/camera_right/color/image_rect_raw/compressed",
        "sensor_msgs/msg/CompressedImage",
    ),
    "/joint_states": ("/joint_states", "sensor_msgs/msg/JointState"),
    "/odom": ("/odom", "nav_msgs/msg/Odometry"),
}


def build_arg_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--bag-dir",
        required=True,
        type=Path,
        help="Directory containing metadata.yaml and MCAP/db3 bag files.",
    )
    parser.add_argument("--domain-id", type=int, default=30)
    parser.add_argument("--router-ip", default="127.0.0.1")
    parser.add_argument("--router-port", type=int, default=7447)
    parser.add_argument("--loop", action="store_true", help="Replay forever.")
    parser.add_argument(
        "--rate",
        type=float,
        default=1.0,
        help="Playback speed multiplier. 1.0 means recorded wall time.",
    )
    parser.add_argument(
        "--max-sleep",
        type=float,
        default=0.2,
        help="Cap per-message sleep while preserving coarse timing.",
    )
    parser.add_argument(
        "--status-every",
        type=int,
        default=500,
        help="Print one status line every N republished messages.",
    )
    return parser


def make_publishers(args: argparse.Namespace) -> dict[str, ROS2Publisher]:
    publishers = {}
    for _source_topic, (target_topic, msg_type) in TOPIC_REMAPS.items():
        publishers[target_topic] = ROS2Publisher(
            topic=target_topic,
            msg_type=msg_type,
            node_name="green_vla_rosbag_replay",
            domain_id=args.domain_id,
            router_ip=args.router_ip,
            router_port=args.router_port,
        )
    return publishers


def publish_raw(pub: ROS2Publisher, rawdata: bytes) -> None:
    timestamp_ns = int(time.time() * 1e9)
    attachment = pub._create_attachment(pub.sequence_number, timestamp_ns)
    pub.pub.put(
        bytes(rawdata),
        encoding=Encoding("application/cdr"),
        attachment=zenoh.ZBytes(attachment),
        **getattr(pub, "_put_extra_kwargs", {}),
    )
    pub.sequence_number += 1


def replay_once(
    bag_dir: Path,
    publishers: dict[str, ROS2Publisher],
    *,
    rate: float,
    max_sleep: float,
    status_every: int,
    stop_requested,
) -> int:
    count = 0
    last_timestamp_ns = None
    with AnyReader([bag_dir]) as reader:
        connections = [
            conn for conn in reader.connections if conn.topic in TOPIC_REMAPS
        ]
        if not connections:
            raise RuntimeError(f"No replayable topics found in {bag_dir}")
        for conn, timestamp_ns, rawdata in reader.messages(connections=connections):
            if stop_requested():
                break
            if last_timestamp_ns is not None and rate > 0:
                delay_s = (timestamp_ns - last_timestamp_ns) / 1e9 / rate
                if delay_s > 0:
                    time.sleep(min(delay_s, max_sleep))
            last_timestamp_ns = timestamp_ns

            target_topic, _msg_type = TOPIC_REMAPS[conn.topic]
            publish_raw(publishers[target_topic], rawdata)
            count += 1
            if status_every > 0 and count % status_every == 0:
                print(
                    f"replayed={count} source={conn.topic} target={target_topic}",
                    flush=True,
                )
    return count


def main(argv: list[str] | None = None) -> int:
    args = build_arg_parser().parse_args(argv)
    if not args.bag_dir.exists():
        print(f"bag dir not found: {args.bag_dir}", file=sys.stderr)
        return 2

    stopping = False

    def _stop(_signum, _frame):
        nonlocal stopping
        stopping = True

    signal.signal(signal.SIGINT, _stop)
    signal.signal(signal.SIGTERM, _stop)

    publishers = make_publishers(args)
    try:
        loop_index = 0
        while not stopping:
            loop_index += 1
            count = replay_once(
                args.bag_dir,
                publishers,
                rate=args.rate,
                max_sleep=args.max_sleep,
                status_every=args.status_every,
                stop_requested=lambda: stopping,
            )
            print(f"loop={loop_index} replayed={count}", flush=True)
            if not args.loop:
                break
    finally:
        for pub in publishers.values():
            pub.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
