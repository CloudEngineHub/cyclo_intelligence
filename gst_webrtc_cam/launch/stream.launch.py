import os

from ament_index_python.packages import get_package_share_directory
from launch import LaunchDescription
from launch.actions import DeclareLaunchArgument
from launch.substitutions import LaunchConfiguration
from launch_ros.actions import Node


def generate_launch_description():
    pkg_share = get_package_share_directory('gst_webrtc_cam')
    default_config = os.path.join(pkg_share, 'config', 'stream_params.yaml')

    return LaunchDescription([
        DeclareLaunchArgument(
            'config',
            default_value=default_config,
            description='YAML config for WebRTC camera topics, labels, encoder, and signaling.',
        ),
        Node(
            package='gst_webrtc_cam',
            executable='cpp_media_bridge',
            name='gst_webrtc_cpp_media_bridge',
            output='screen',
            parameters=[LaunchConfiguration('config')],
        ),
        Node(
            package='gst_webrtc_cam',
            executable='bridge_proxy_node',
            name='gst_webrtc_bridge_proxy',
            output='screen',
            parameters=[LaunchConfiguration('config')],
        ),
    ])
