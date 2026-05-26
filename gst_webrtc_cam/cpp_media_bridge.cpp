#include <gst/app/gstappsrc.h>
#include <gst/gst.h>
#include <gst/sdp/gstsdpmessage.h>
#include <gst/webrtc/webrtc.h>

#include <algorithm>
#include <functional>
#include <map>
#include <memory>
#include <mutex>
#include <cctype>
#include <optional>
#include <sstream>
#include <stdexcept>
#include <string>
#include <thread>
#include <tuple>
#include <unordered_set>
#include <utility>
#include <vector>

#include <rclcpp/rclcpp.hpp>
#include <rclcpp/qos.hpp>
#include <sensor_msgs/msg/image.hpp>
#include <std_msgs/msg/string.hpp>

namespace
{

struct EncodingInfo
{
  std::string gst_format;
  int bytes_per_pixel;
};

const std::map<std::string, EncodingInfo> kEncodingMap = {
  {"rgb8", {"RGB", 3}},
  {"bgr8", {"BGR", 3}},
  {"rgba8", {"RGBA", 4}},
  {"bgra8", {"BGRx", 4}},
};

const std::unordered_set<std::string> kNvvidconvInputs = {"BGRx", "RGBA"};

std::string lower(std::string value)
{
  std::transform(value.begin(), value.end(), value.begin(), [](unsigned char c) {
    return static_cast<char>(std::tolower(c));
  });
  return value;
}

std::string compact_ws(const std::string & value)
{
  std::istringstream in(value);
  std::ostringstream out;
  std::string token;
  bool first = true;
  while (in >> token) {
    if (!first) {
      out << ' ';
    }
    first = false;
    out << token;
  }
  return out.str();
}

std::string json_escape(const std::string & value)
{
  std::ostringstream out;
  for (const auto c : value) {
    switch (c) {
      case '\\':
        out << "\\\\";
        break;
      case '"':
        out << "\\\"";
        break;
      case '\n':
        out << "\\n";
        break;
      case '\r':
        out << "\\r";
        break;
      case '\t':
        out << "\\t";
        break;
      default:
        out << c;
        break;
    }
  }
  return out.str();
}

std::string json_object(
  const std::string & type,
  int conn,
  const std::vector<std::pair<std::string, std::string>> & string_fields,
  const std::vector<std::pair<std::string, int>> & int_fields = {})
{
  std::ostringstream out;
  out << "{\"type\":\"" << json_escape(type) << "\",\"conn\":" << conn;
  for (const auto & [key, value] : string_fields) {
    out << ",\"" << json_escape(key) << "\":\"" << json_escape(value) << "\"";
  }
  for (const auto & [key, value] : int_fields) {
    out << ",\"" << json_escape(key) << "\":" << value;
  }
  out << "}";
  return out.str();
}

size_t find_json_value(const std::string & data, const std::string & key)
{
  const auto key_token = "\"" + key + "\"";
  auto pos = data.find(key_token);
  if (pos == std::string::npos) {
    return std::string::npos;
  }
  pos = data.find(':', pos + key_token.size());
  if (pos == std::string::npos) {
    return std::string::npos;
  }
  ++pos;
  while (pos < data.size() && std::isspace(static_cast<unsigned char>(data[pos]))) {
    ++pos;
  }
  return pos;
}

std::string json_get_string(const std::string & data, const std::string & key)
{
  auto pos = find_json_value(data, key);
  if (pos == std::string::npos || pos >= data.size() || data[pos] != '"') {
    return "";
  }
  ++pos;
  std::ostringstream out;
  bool escaping = false;
  for (; pos < data.size(); ++pos) {
    const auto c = data[pos];
    if (escaping) {
      switch (c) {
        case 'n':
          out << '\n';
          break;
        case 'r':
          out << '\r';
          break;
        case 't':
          out << '\t';
          break;
        default:
          out << c;
          break;
      }
      escaping = false;
    } else if (c == '\\') {
      escaping = true;
    } else if (c == '"') {
      break;
    } else {
      out << c;
    }
  }
  return out.str();
}

int json_get_int(const std::string & data, const std::string & key, int default_value = 0)
{
  auto pos = find_json_value(data, key);
  if (pos == std::string::npos) {
    return default_value;
  }
  try {
    return std::stoi(data.substr(pos));
  } catch (const std::exception &) {
    return default_value;
  }
}

void free_frame_vector(gpointer data)
{
  delete static_cast<std::vector<uint8_t> *>(data);
}

}  // namespace

class CppHWPipeline
{
public:
  using PublishFn = std::function<void(const std::string &)>;

  CppHWPipeline(
    std::string cam_label,
    int bitrate,
    int iframeinterval,
    int idrinterval,
    int preset,
    int framerate,
    PublishFn publish)
  : cam_label_(std::move(cam_label)),
    bitrate_(bitrate),
    iframeinterval_(iframeinterval),
    idrinterval_(idrinterval),
    preset_(preset),
    framerate_(framerate),
    publish_(std::move(publish))
  {
  }

  ~CppHWPipeline()
  {
    stop();
  }

  void start(int conn)
  {
    std::lock_guard<std::recursive_mutex> lock(lock_);
    stop_locked();
    conn_ = conn;
    if (!raw_caps_) {
      pending_start_ = true;
      RCLCPP_INFO(logger(), "[%s] waiting for first raw frame before C++ pipeline start", cam_label_.c_str());
      return;
    }
    start_pipeline_locked();
  }

  void stop()
  {
    std::lock_guard<std::recursive_mutex> lock(lock_);
    pending_start_ = false;
    stop_locked();
  }

  void handle_answer(const std::string & sdp_text)
  {
    std::lock_guard<std::recursive_mutex> lock(lock_);
    if (webrtc_ == nullptr) {
      return;
    }

    GstSDPMessage * sdp = nullptr;
    if (gst_sdp_message_new(&sdp) != GST_SDP_OK) {
      RCLCPP_ERROR(logger(), "[%s] failed to allocate SDP answer", cam_label_.c_str());
      return;
    }
    const auto * sdp_data = reinterpret_cast<const guint8 *>(sdp_text.data());
    if (gst_sdp_message_parse_buffer(sdp_data, sdp_text.size(), sdp) != GST_SDP_OK) {
      gst_sdp_message_free(sdp);
      RCLCPP_ERROR(logger(), "[%s] failed to parse SDP answer", cam_label_.c_str());
      return;
    }

    auto * answer = gst_webrtc_session_description_new(GST_WEBRTC_SDP_TYPE_ANSWER, sdp);
    g_signal_emit_by_name(webrtc_, "set-remote-description", answer, gst_promise_new());
    gst_webrtc_session_description_free(answer);
  }

  void handle_ice(int mline_index, const std::string & candidate)
  {
    std::lock_guard<std::recursive_mutex> lock(lock_);
    if (webrtc_ != nullptr) {
      g_signal_emit_by_name(webrtc_, "add-ice-candidate", mline_index, candidate.c_str());
    }
  }

  void push_image(const sensor_msgs::msg::Image::SharedPtr msg)
  {
    const auto encoding = lower(msg->encoding);
    const auto it = kEncodingMap.find(encoding);
    if (it == kEncodingMap.end()) {
      if (unsupported_encodings_.insert(encoding).second) {
        RCLCPP_ERROR(
          logger(),
          "[%s] unsupported raw image encoding \"%s\"; C++ stream disabled for this encoding",
          cam_label_.c_str(),
          msg->encoding.c_str());
      }
      return;
    }

    const auto & info = it->second;
    const auto width = static_cast<int>(msg->width);
    const auto height = static_cast<int>(msg->height);
    if (width <= 0 || height <= 0) {
      RCLCPP_ERROR(
        logger(),
        "[%s] invalid raw image dimensions %dx%d",
        cam_label_.c_str(),
        width,
        height);
      return;
    }

    const auto expected_step = width * info.bytes_per_pixel;
    const auto actual_step = static_cast<int>(msg->step);
    if (actual_step < expected_step) {
      RCLCPP_ERROR(
        logger(),
        "[%s] invalid raw image step=%d for %dx%d %s",
        cam_label_.c_str(),
        actual_step,
        width,
        height,
        msg->encoding.c_str());
      return;
    }

    const auto required_size =
      static_cast<size_t>(height - 1) * static_cast<size_t>(actual_step) +
      static_cast<size_t>(expected_step);
    if (msg->data.size() < required_size) {
      RCLCPP_ERROR(
        logger(),
        "[%s] raw image data too small: got=%zu required=%zu for %dx%d %s",
        cam_label_.c_str(),
        msg->data.size(),
        required_size,
        width,
        height,
        msg->encoding.c_str());
      return;
    }

    std::lock_guard<std::recursive_mutex> lock(lock_);
    RawCaps new_caps{width, height, info.gst_format};
    if (!raw_caps_ || *raw_caps_ != new_caps) {
      const auto had_caps = raw_caps_.has_value();
      raw_caps_ = new_caps;
      if (had_caps) {
        RCLCPP_INFO(logger(), "[%s] raw caps changed; restarting C++ pipeline", cam_label_.c_str());
      }
      if (started_) {
        stop_locked();
        start_pipeline_locked();
      } else if (pending_start_) {
        start_pipeline_locked();
      }
    }

    if (!started_ || appsrc_ == nullptr) {
      return;
    }

    auto frame = make_frame_data(*msg, height, expected_step, actual_step);
    const auto frame_size = frame->size();
    auto * frame_ptr = frame.release();
    GstBuffer * buffer = gst_buffer_new_wrapped_full(
      static_cast<GstMemoryFlags>(0),
      frame_ptr->data(),
      frame_size,
      0,
      frame_size,
      frame_ptr,
      free_frame_vector);

    const auto ret = gst_app_src_push_buffer(appsrc_, buffer);
    if (ret != GST_FLOW_OK) {
      RCLCPP_WARN(logger(), "[%s] appsrc push failed: %s", cam_label_.c_str(), gst_flow_get_name(ret));
    }
  }

private:
  struct RawCaps
  {
    int width;
    int height;
    std::string gst_format;

    bool operator!=(const RawCaps & other) const
    {
      return width != other.width || height != other.height || gst_format != other.gst_format;
    }
  };

  rclcpp::Logger logger() const
  {
    return rclcpp::get_logger("gst_webrtc_cpp");
  }

  std::unique_ptr<std::vector<uint8_t>> make_frame_data(
    const sensor_msgs::msg::Image & msg,
    int height,
    int expected_step,
    int actual_step)
  {
    const auto expected_size = static_cast<size_t>(height * expected_step);
    auto frame = std::make_unique<std::vector<uint8_t>>(expected_size);
    if (actual_step == expected_step) {
      std::copy_n(msg.data.begin(), expected_size, frame->begin());
      return frame;
    }

    for (int row = 0; row < height; ++row) {
      const auto src_start = static_cast<size_t>(row * actual_step);
      const auto dst_start = static_cast<size_t>(row * expected_step);
      std::copy_n(msg.data.begin() + src_start, expected_step, frame->begin() + dst_start);
    }
    return frame;
  }

  std::string conversion_chain(const std::string & gst_format) const
  {
    if (kNvvidconvInputs.count(gst_format) > 0) {
      return "! nvvidconv ";
    }
    return "! videoconvert ! video/x-raw,format=RGBA ! nvvidconv ";
  }

  void start_pipeline_locked()
  {
    if (!raw_caps_) {
      return;
    }
    build_pipeline_locked(*raw_caps_);
    gst_element_set_state(pipeline_, GST_STATE_PLAYING);
    started_ = true;
    pending_start_ = false;
    RCLCPP_INFO(
      logger(),
      "[%s] C++ pipeline PLAYING: raw %dx%d %s -> NVENC H.264",
      cam_label_.c_str(),
      raw_caps_->width,
      raw_caps_->height,
      raw_caps_->gst_format.c_str());
  }

  void build_pipeline_locked(const RawCaps & caps)
  {
    const auto convert = conversion_chain(caps.gst_format);
    RCLCPP_INFO(
      logger(),
      "[%s] using C++ raw image pipeline; input=%s conversion=\"%s\"",
      cam_label_.c_str(),
      caps.gst_format.c_str(),
      compact_ws(convert).c_str());

    std::ostringstream pipe;
    pipe
      << "appsrc name=src is-live=true do-timestamp=true block=false "
      << "max-buffers=1 max-bytes=0 max-time=0 leaky-type=downstream emit-signals=false "
      << "format=time caps=video/x-raw,format=" << caps.gst_format
      << ",width=" << caps.width
      << ",height=" << caps.height
      << ",framerate=" << framerate_ << "/1 "
      << "! queue max-size-buffers=1 max-size-bytes=0 max-size-time=0 leaky=downstream "
      << convert
      << "! video/x-raw(memory:NVMM),format=NV12 "
      << "! nvv4l2h264enc bitrate=" << bitrate_
      << " preset-level=" << preset_
      << " control-rate=1 iframeinterval=" << iframeinterval_
      << " idrinterval=" << idrinterval_
      << " insert-sps-pps=true maxperf-enable=true "
      << "! h264parse config-interval=-1 "
      << "! rtph264pay aggregate-mode=zero-latency config-interval=-1 pt=96 mtu=1200 "
      << "! application/x-rtp,media=video,encoding-name=H264,payload=96 "
      << "! webrtcbin name=webrtc bundle-policy=max-bundle";

    GError * error = nullptr;
    pipeline_ = gst_parse_launch(pipe.str().c_str(), &error);
    if (pipeline_ == nullptr) {
      std::string message = error ? error->message : "unknown error";
      if (error) {
        g_error_free(error);
      }
      throw std::runtime_error("failed to create GStreamer pipeline: " + message);
    }

    appsrc_ = GST_APP_SRC(gst_bin_get_by_name(GST_BIN(pipeline_), "src"));
    webrtc_ = gst_bin_get_by_name(GST_BIN(pipeline_), "webrtc");
    g_signal_connect(webrtc_, "on-negotiation-needed", G_CALLBACK(&CppHWPipeline::on_negotiation_needed), this);
    g_signal_connect(webrtc_, "on-ice-candidate", G_CALLBACK(&CppHWPipeline::on_ice_candidate), this);

    auto * bus = gst_element_get_bus(pipeline_);
    gst_bus_add_signal_watch(bus);
    g_signal_connect(bus, "message::error", G_CALLBACK(&CppHWPipeline::on_bus_error), this);
    g_signal_connect(bus, "message::warning", G_CALLBACK(&CppHWPipeline::on_bus_warning), this);
    gst_object_unref(bus);
  }

  void stop_locked()
  {
    started_ = false;
    if (appsrc_ != nullptr) {
      gst_app_src_end_of_stream(appsrc_);
      gst_object_unref(appsrc_);
      appsrc_ = nullptr;
    }
    if (webrtc_ != nullptr) {
      gst_object_unref(webrtc_);
      webrtc_ = nullptr;
    }
    if (pipeline_ != nullptr) {
      gst_element_set_state(pipeline_, GST_STATE_NULL);
      gst_object_unref(pipeline_);
      pipeline_ = nullptr;
      RCLCPP_INFO(logger(), "[%s] C++ pipeline stopped", cam_label_.c_str());
    }
  }

  void publish(const std::string & payload)
  {
    publish_(payload);
  }

  static void on_negotiation_needed(GstElement * webrtc, gpointer user_data)
  {
    auto * self = static_cast<CppHWPipeline *>(user_data);
    RCLCPP_INFO(self->logger(), "[%s] C++ negotiation needed", self->cam_label_.c_str());
    auto * promise = gst_promise_new_with_change_func(&CppHWPipeline::on_offer_created, self, nullptr);
    g_signal_emit_by_name(webrtc, "create-offer", nullptr, promise);
  }

  static void on_offer_created(GstPromise * promise, gpointer user_data)
  {
    auto * self = static_cast<CppHWPipeline *>(user_data);
    gst_promise_wait(promise);
    const auto * reply = gst_promise_get_reply(promise);
    GstWebRTCSessionDescription * offer = nullptr;
    gst_structure_get(reply, "offer", GST_TYPE_WEBRTC_SESSION_DESCRIPTION, &offer, nullptr);
    gst_promise_unref(promise);
    if (offer == nullptr) {
      RCLCPP_ERROR(self->logger(), "[%s] failed to create SDP offer", self->cam_label_.c_str());
      return;
    }

    g_signal_emit_by_name(self->webrtc_, "set-local-description", offer, gst_promise_new());
    gchar * sdp_text = gst_sdp_message_as_text(offer->sdp);
    self->publish(json_object("offer", self->conn_, {{"sdp", std::string(sdp_text)}}));
    g_free(sdp_text);
    gst_webrtc_session_description_free(offer);
  }

  static void on_ice_candidate(
    GstElement * /* webrtc */,
    guint mline_index,
    gchar * candidate,
    gpointer user_data)
  {
    auto * self = static_cast<CppHWPipeline *>(user_data);
    self->publish(json_object(
      "ice",
      self->conn_,
      {{"candidate", std::string(candidate)}},
      {{"sdpMLineIndex", static_cast<int>(mline_index)}}));
  }

  static void on_bus_error(GstBus * /* bus */, GstMessage * msg, gpointer user_data)
  {
    auto * self = static_cast<CppHWPipeline *>(user_data);
    GError * err = nullptr;
    gchar * dbg = nullptr;
    gst_message_parse_error(msg, &err, &dbg);
    RCLCPP_ERROR(
      self->logger(),
      "[%s] GStreamer ERROR: %s debug=%s",
      self->cam_label_.c_str(),
      err ? err->message : "unknown",
      dbg ? dbg : "");
    if (err) {
      g_error_free(err);
    }
    if (dbg) {
      g_free(dbg);
    }
  }

  static void on_bus_warning(GstBus * /* bus */, GstMessage * msg, gpointer user_data)
  {
    auto * self = static_cast<CppHWPipeline *>(user_data);
    GError * err = nullptr;
    gchar * dbg = nullptr;
    gst_message_parse_warning(msg, &err, &dbg);
    RCLCPP_WARN(
      self->logger(),
      "[%s] GStreamer WARNING: %s debug=%s",
      self->cam_label_.c_str(),
      err ? err->message : "unknown",
      dbg ? dbg : "");
    if (err) {
      g_error_free(err);
    }
    if (dbg) {
      g_free(dbg);
    }
  }

  std::string cam_label_;
  int bitrate_;
  int iframeinterval_;
  int idrinterval_;
  int preset_;
  int framerate_;
  PublishFn publish_;

  std::recursive_mutex lock_;
  GstElement * pipeline_{nullptr};
  GstAppSrc * appsrc_{nullptr};
  GstElement * webrtc_{nullptr};
  std::optional<RawCaps> raw_caps_;
  bool started_{false};
  bool pending_start_{false};
  int conn_{0};
  std::unordered_set<std::string> unsupported_encodings_;
};

class MediaBridgeNode : public rclcpp::Node
{
public:
  MediaBridgeNode()
  : Node("gst_webrtc_cpp_media_bridge")
  {
    declare_parameter<std::vector<std::string>>(
      "cameras",
      {
        "/zed/zed_node/left/image_rect_color",
        "/zed/zed_node/right/image_rect_color",
        "/camera_left/camera_left/color/image_rect_raw",
        "/camera_right/camera_right/color/image_rect_raw",
      });
    declare_parameter<std::vector<std::string>>(
      "cam_labels",
      {"cam_head_left", "cam_head_right", "cam_wrist_left", "cam_wrist_right"});
    declare_parameter<int>("bitrate", 1500000);
    declare_parameter<int>("iframeinterval", 5);
    declare_parameter<int>("idrinterval", 5);
    declare_parameter<int>("preset", 1);
    declare_parameter<int>("framerate", 15);

    const auto topics = get_parameter("cameras").as_string_array();
    const auto labels = get_parameter("cam_labels").as_string_array();
    if (topics.size() != labels.size()) {
      throw std::runtime_error("cameras and cam_labels parameters must have the same length");
    }

    const auto bitrate = get_parameter("bitrate").as_int();
    const auto iframe = get_parameter("iframeinterval").as_int();
    const auto idr = get_parameter("idrinterval").as_int();
    const auto preset = get_parameter("preset").as_int();
    const auto framerate = get_parameter("framerate").as_int();

    gst_init(nullptr, nullptr);
    glib_loop_ = g_main_loop_new(nullptr, FALSE);
    glib_thread_ = std::thread([this]() {
      g_main_loop_run(glib_loop_);
    });

    for (size_t i = 0; i < labels.size(); ++i) {
      const auto & label = labels[i];
      image_topics_[label] = topics[i];
      out_pubs_[label] = create_publisher<std_msgs::msg::String>(
        "/gst_webrtc_cam/signaling/out/" + label,
        10);

      pipelines_[label] = std::make_shared<CppHWPipeline>(
        label,
        bitrate,
        iframe,
        idr,
        preset,
        framerate,
        [this, label](const std::string & payload) {
          std_msgs::msg::String msg;
          msg.data = payload;
          out_pubs_.at(label)->publish(msg);
        });

      signal_subs_.push_back(create_subscription<std_msgs::msg::String>(
        "/gst_webrtc_cam/signaling/in/" + label,
        10,
        [this, label](std_msgs::msg::String::SharedPtr msg) {
          handle_signal(label, msg->data);
        }));
    }

    RCLCPP_INFO(get_logger(), "C++ WebRTC media bridge ready; image subscriptions are lazy");
  }

  ~MediaBridgeNode() override
  {
    image_subs_.clear();
    pipelines_.clear();
    if (glib_loop_ != nullptr) {
      g_main_loop_quit(glib_loop_);
    }
    if (glib_thread_.joinable()) {
      glib_thread_.join();
    }
    if (glib_loop_ != nullptr) {
      g_main_loop_unref(glib_loop_);
      glib_loop_ = nullptr;
    }
  }

private:
  void handle_signal(const std::string & label, const std::string & data)
  {
    const auto type = json_get_string(data, "type");
    const auto conn = json_get_int(data, "conn", 0);
    auto pipeline = pipelines_.at(label);
    if (type == "start") {
      subscribe_image(label);
      pipeline->start(conn);
    } else if (type == "stop") {
      pipeline->stop();
      unsubscribe_image(label);
    } else if (type == "answer") {
      pipeline->handle_answer(json_get_string(data, "sdp"));
    } else if (type == "ice") {
      pipeline->handle_ice(
        json_get_int(data, "sdpMLineIndex", 0),
        json_get_string(data, "candidate"));
    }
  }

  void subscribe_image(const std::string & label)
  {
    if (image_subs_.count(label) > 0) {
      return;
    }

    const auto topic = image_topics_.at(label);
    image_subs_[label] = create_subscription<sensor_msgs::msg::Image>(
      topic,
      rclcpp::SensorDataQoS(),
      [this, label](sensor_msgs::msg::Image::SharedPtr msg) {
        pipelines_.at(label)->push_image(msg);
      });
    RCLCPP_INFO(get_logger(), "C++ media subscribed %s -> %s", topic.c_str(), label.c_str());
  }

  void unsubscribe_image(const std::string & label)
  {
    const auto sub = image_subs_.find(label);
    if (sub == image_subs_.end()) {
      return;
    }

    image_subs_.erase(sub);
    RCLCPP_INFO(get_logger(), "C++ media unsubscribed %s", label.c_str());
  }

  std::map<std::string, std::shared_ptr<CppHWPipeline>> pipelines_;
  std::map<std::string, rclcpp::Publisher<std_msgs::msg::String>::SharedPtr> out_pubs_;
  std::map<std::string, std::string> image_topics_;
  std::map<std::string, rclcpp::Subscription<sensor_msgs::msg::Image>::SharedPtr> image_subs_;
  std::vector<rclcpp::Subscription<std_msgs::msg::String>::SharedPtr> signal_subs_;
  GMainLoop * glib_loop_{nullptr};
  std::thread glib_thread_;
};

int main(int argc, char ** argv)
{
  rclcpp::init(argc, argv);
  auto node = std::make_shared<MediaBridgeNode>();
  rclcpp::spin(node);
  node.reset();
  rclcpp::shutdown();
  return 0;
}
