# gst_webrtc_cam

GStreamer WebRTC camera bridge for Cyclo Intelligence UI monitoring.

The bridge is split into two ROS nodes:

- `cpp_media_bridge`: subscribes to raw ROS image topics, encodes H.264 with
  `nvv4l2h264enc`, and publishes WebRTC signaling messages.
- `bridge_proxy_node`: serves the WebSocket signaling endpoint used by the UI
  and forwards SDP/ICE messages to the C++ media bridge over ROS topics.

## Configuration

Runtime stream settings live in `config/stream_params.yaml`.

Important encoder fields:

- `bitrate`: H.264 target bitrate per active camera, in bits per second. This
  affects only the UI WebRTC preview stream, not ROS topics or rosbag recording.
- `framerate`: expected WebRTC output framerate.
- `iframeinterval`: intra-frame interval for the encoder.
- `idrinterval`: IDR interval. Lower values recover faster after RTP packet
  loss because the browser receives a fresh decoder restart point sooner.

Current default tuning is `bitrate: 1800000`, `framerate: 15`,
`iframeinterval: 5`, and `idrinterval: 5`, which gives about three IDR frames per
second at 15 FPS.

Use a custom config with:

```bash
ros2 launch gst_webrtc_cam stream.launch.py config:=/path/to/stream_params.yaml
```

## Browser Stats

The UI includes an opt-in WebRTC stats logger for diagnosing stream freezes.
Open Chrome DevTools on the Cyclo UI page and run:

```js
localStorage.setItem('cyclo_webrtc_debug', '1'); location.reload();
```

Console logs named `[webrtc-stats:<camera_label>]` will show packet loss,
jitter, decoded frames, dropped frames, and freeze count. Disable it with:

```js
localStorage.removeItem('cyclo_webrtc_debug'); location.reload();
```
