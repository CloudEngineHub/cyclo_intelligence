const CAMERA_LABEL_BY_TOPIC = {
  '/zed/zed_node/left/image_rect_color/compressed': 'cam_head_left',
  '/zed/zed_node/right/image_rect_color/compressed': 'cam_head_right',
  '/camera_left/camera_left/color/image_rect_raw/compressed': 'cam_wrist_left',
  '/camera_right/camera_right/color/image_rect_raw/compressed': 'cam_wrist_right',
  '/robot/camera/cam_left_head/image_raw/compressed': 'cam_head_left',
  '/robot/camera/cam_right_head/image_raw/compressed': 'cam_head_right',
  '/robot/camera/cam_left_wrist/image_raw/compressed': 'cam_wrist_left',
  '/robot/camera/cam_right_wrist/image_raw/compressed': 'cam_wrist_right',
};

export const toBaseImageTopic = (topic) => (
  topic && topic.endsWith('/compressed') ? topic.slice(0, -11) : topic
);

export const toWebRtcCameraLabel = (topic) => {
  if (!topic) return '';
  const direct = CAMERA_LABEL_BY_TOPIC[topic];
  if (direct) return direct;

  const baseTopic = toBaseImageTopic(topic);
  const baseMatch = Object.entries(CAMERA_LABEL_BY_TOPIC).find(
    ([candidate]) => toBaseImageTopic(candidate) === baseTopic
  );
  return baseMatch ? baseMatch[1] : '';
};

export const buildWebRtcWsUrl = (cameraLabel) => {
  if (!cameraLabel || typeof window === 'undefined') return '';
  const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
  return `${protocol}://${window.location.host}/webrtc_cam/ws/${cameraLabel}`;
};
