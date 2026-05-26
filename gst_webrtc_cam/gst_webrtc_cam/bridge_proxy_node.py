#!/usr/bin/env python3
import json
import logging
import threading

import gi
import rclpy
from rclpy.node import Node
from std_msgs.msg import String

from gst_webrtc_cam.signaling import SignalingServer


gi.require_version('GLib', '2.0')
from gi.repository import GLib


logging.basicConfig(level=logging.INFO, format='[%(levelname)s] %(name)s: %(message)s')
logger = logging.getLogger('gst_webrtc_proxy')


def _string_array_param(node: Node, name: str) -> list[str]:
    value = node.get_parameter(name).value
    return list(value or [])


def _int_param(node: Node, name: str) -> int:
    return int(node.get_parameter(name).value)


class ProxyPipeline:
    """Signaling-compatible shim for the C++ media bridge.

    The aiohttp signaling server stays in Python so the browser API and nginx
    routing remain unchanged. Media work happens in gst_webrtc_cam_cpp, with
    JSON signaling messages moved over local ROS topics.
    """

    def __init__(self, node: Node, cam_label: str):
        self.node = node
        self.cam_label = cam_label
        self._ws_send = None
        self._connection_id = 0
        self._lock = threading.RLock()
        self._pub = node.create_publisher(
            String,
            f'/gst_webrtc_cam/signaling/in/{cam_label}',
            10,
        )
        self._sub = node.create_subscription(
            String,
            f'/gst_webrtc_cam/signaling/out/{cam_label}',
            self._on_media_message,
            10,
        )

    def start(self, ws_send_callback):
        with self._lock:
            self._connection_id += 1
            self._ws_send = ws_send_callback
            conn = self._connection_id
        self._publish({'type': 'start', 'conn': conn})
        logger.info('[%s] requested C++ media pipeline start conn=%s', self.cam_label, conn)

    def stop(self):
        with self._lock:
            conn = self._connection_id
            self._ws_send = None
        self._publish({'type': 'stop', 'conn': conn})
        logger.info('[%s] requested C++ media pipeline stop conn=%s', self.cam_label, conn)

    def handle_sdp_answer(self, sdp_text: str):
        with self._lock:
            conn = self._connection_id
        self._publish({'type': 'answer', 'conn': conn, 'sdp': sdp_text})

    def handle_ice(self, mline_index: int, candidate: str):
        with self._lock:
            conn = self._connection_id
        self._publish({
            'type': 'ice',
            'conn': conn,
            'sdpMLineIndex': int(mline_index),
            'candidate': candidate,
        })

    def _publish(self, payload: dict):
        msg = String()
        msg.data = json.dumps(payload)
        self._pub.publish(msg)

    def _on_media_message(self, msg: String):
        try:
            payload = json.loads(msg.data)
        except json.JSONDecodeError:
            logger.warning('[%s] ignored invalid media JSON', self.cam_label)
            return

        with self._lock:
            ws_send = self._ws_send
            conn = self._connection_id

        if payload.get('conn') not in (None, conn):
            return

        msg_type = payload.get('type')
        if msg_type in ('offer', 'ice') and ws_send is not None:
            payload.pop('conn', None)
            ws_send(payload)
        elif msg_type == 'log':
            logger.info('[%s] media: %s', self.cam_label, payload.get('message', ''))


class BridgeProxyNode(Node):
    def __init__(self):
        super().__init__('gst_webrtc_bridge_proxy')

        self.declare_parameter('cam_labels', [
            'cam_head_left',
            'cam_head_right',
            'cam_wrist_left',
            'cam_wrist_right',
        ])
        self.declare_parameter('signaling_host', '0.0.0.0')
        self.declare_parameter('signaling_port', 8443)

        labels = _string_array_param(self, 'cam_labels')
        sig_host = self.get_parameter('signaling_host').value
        sig_port = _int_param(self, 'signaling_port')

        self.pipelines = {
            label: ProxyPipeline(self, label)
            for label in labels
        }

        self._glib_loop = GLib.MainLoop()
        self._glib_thread = threading.Thread(target=self._glib_loop.run, daemon=True)
        self._glib_thread.start()

        self.signaling = SignalingServer(
            host=sig_host,
            port=sig_port,
            pipeline_map=self.pipelines,
        )
        self._sig_thread = threading.Thread(target=self.signaling.run_in_thread, daemon=True)
        self._sig_thread.start()
        self.get_logger().info(f'WebRTC signaling proxy ready on port {sig_port}')

    def destroy_node(self):
        for pipeline in self.pipelines.values():
            pipeline.stop()
        if hasattr(self, '_glib_loop'):
            self._glib_loop.quit()
        if hasattr(self, 'signaling'):
            self.signaling.shutdown()
        super().destroy_node()


def main(args=None):
    rclpy.init(args=args)
    node = BridgeProxyNode()
    try:
        rclpy.spin(node)
    except KeyboardInterrupt:
        pass
    finally:
        node.destroy_node()
        rclpy.shutdown()


if __name__ == '__main__':
    main()
