cmake_minimum_required(VERSION 3.16)
project(gst_webrtc_cam)

find_package(ament_cmake REQUIRED)
find_package(ament_cmake_python REQUIRED)
find_package(rclcpp REQUIRED)
find_package(sensor_msgs REQUIRED)
find_package(std_msgs REQUIRED)
find_package(PkgConfig REQUIRED)

pkg_check_modules(GSTREAMER REQUIRED IMPORTED_TARGET
  gstreamer-1.0
  gstreamer-app-1.0
  gstreamer-sdp-1.0
  gstreamer-webrtc-1.0
)

ament_python_install_package(${PROJECT_NAME})

add_executable(cpp_media_bridge cpp_media_bridge.cpp)
target_compile_features(cpp_media_bridge PRIVATE cxx_std_17)
target_compile_definitions(cpp_media_bridge PRIVATE GST_USE_UNSTABLE_API)
ament_target_dependencies(cpp_media_bridge
  rclcpp
  sensor_msgs
  std_msgs
)
target_link_libraries(cpp_media_bridge
  PkgConfig::GSTREAMER
)

install(TARGETS cpp_media_bridge
  DESTINATION lib/${PROJECT_NAME}
)

install(FILES
  bridge_proxy_node
  DESTINATION lib/${PROJECT_NAME}
  PERMISSIONS OWNER_READ OWNER_WRITE OWNER_EXECUTE GROUP_READ GROUP_EXECUTE WORLD_READ WORLD_EXECUTE
)

install(DIRECTORY launch
  DESTINATION share/${PROJECT_NAME}
)

install(DIRECTORY config
  DESTINATION share/${PROJECT_NAME}
)

ament_package()
