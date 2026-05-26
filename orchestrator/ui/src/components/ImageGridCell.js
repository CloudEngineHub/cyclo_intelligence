// Copyright 2025 ROBOTIS CO., LTD.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.
//
// Author: Kiwoong Park

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import clsx from 'clsx';
import { MdClose, MdScreenRotation } from 'react-icons/md';
import { buildWebRtcWsUrl, toWebRtcCameraLabel } from '../utils/cameraStreamTopics';

const classCell = (topic) =>
  clsx(
    'relative',
    'bg-gray-100',
    'rounded-3xl',
    'overflow-hidden',
    'flex',
    'items-center',
    'justify-center',
    'transition-all',
    'duration-300',
    'w-full',
    {
      'border-2 border-dashed border-gray-300 hover:border-gray-400': !topic,
      'bg-white': topic,
    }
  );

const classCloseBtn = clsx(
  'absolute', 'top-2', 'right-2',
  'w-8', 'h-8',
  'bg-black', 'bg-opacity-50', 'text-white',
  'rounded-full', 'flex', 'items-center', 'justify-center',
  'hover:bg-opacity-70', 'z-20'
);

const classRotateBtn = clsx(
  'absolute', 'top-2', 'left-2',
  'w-8', 'h-8',
  'bg-black', 'bg-opacity-50', 'text-white',
  'rounded-full', 'flex', 'items-center', 'justify-center',
  'hover:bg-opacity-70', 'z-20'
);

const classStatus = clsx(
  'absolute', 'bottom-2', 'right-2',
  'text-[10px]', 'text-white',
  'bg-black', 'bg-opacity-50',
  'px-2', 'py-1', 'rounded', 'z-10'
);

const isWebRtcStatsDebugEnabled = () => {
  try {
    return typeof window !== 'undefined'
      && window.localStorage?.getItem('cyclo_webrtc_debug') === '1';
  } catch (_error) {
    return false;
  }
};

export default function ImageGridCell({
  topic,
  aspect,
  rotationDegrees = 0,
  onRotateClick,
  idx,
  onClose,
  onPlusClick,
  isActive = true,
  style = {},
}) {
  const rotate = rotationDegrees !== 0;
  const videoRef = useRef(null);
  const wsRef = useRef(null);
  const pcRef = useRef(null);
  const retryTimerRef = useRef(null);
  const statsTimerRef = useRef(null);
  const previousStatsRef = useRef(null);
  const reconnectCountRef = useRef(0);
  const streamIdRef = useRef(0);
  const [status, setStatus] = useState('');
  const cameraLabel = useMemo(() => toWebRtcCameraLabel(topic), [topic]);

  const cleanupStream = useCallback(() => {
    streamIdRef.current += 1;

    if (retryTimerRef.current) {
      clearTimeout(retryTimerRef.current);
      retryTimerRef.current = null;
    }

    if (statsTimerRef.current) {
      clearInterval(statsTimerRef.current);
      statsTimerRef.current = null;
      previousStatsRef.current = null;
    }

    if (wsRef.current) {
      wsRef.current.onclose = null;
      wsRef.current.onerror = null;
      wsRef.current.onmessage = null;
      wsRef.current.close();
      wsRef.current = null;
    }

    if (pcRef.current) {
      pcRef.current.onicecandidate = null;
      pcRef.current.oniceconnectionstatechange = null;
      pcRef.current.ontrack = null;
      pcRef.current.close();
      pcRef.current = null;
    }

    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
  }, []);

  const connectStream = useCallback(() => {
    if (!topic || !isActive || !cameraLabel) {
      cleanupStream();
      setStatus(cameraLabel ? '' : 'unmapped');
      return;
    }

    cleanupStream();
    setStatus('connecting');
    const streamId = streamIdRef.current + 1;
    streamIdRef.current = streamId;

    const wsUrl = buildWebRtcWsUrl(cameraLabel);
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;
    const isStaleStream = () => streamIdRef.current !== streamId || wsRef.current !== ws;

    const scheduleReconnect = () => {
      if (isStaleStream() || !isActive || !topic || !cameraLabel) return;
      const attempt = reconnectCountRef.current + 1;
      reconnectCountRef.current = attempt;
      const delay = Math.min(1000 * Math.pow(2, attempt - 1), 8000);
      setStatus(`retry ${attempt}`);
      retryTimerRef.current = setTimeout(connectStream, delay);
    };

    const startStatsLogging = (pc) => {
      if (!isWebRtcStatsDebugEnabled()) return;

      previousStatsRef.current = null;
      statsTimerRef.current = setInterval(async () => {
        if (isStaleStream() || pcRef.current !== pc) return;

        try {
          const reports = await pc.getStats();
          let inboundVideo = null;
          let selectedPair = null;

          reports.forEach((report) => {
            if (report.type === 'inbound-rtp'
                && (report.kind === 'video' || report.mediaType === 'video')
                && !report.isRemote) {
              inboundVideo = report;
            }
            if (report.type === 'candidate-pair'
                && (report.selected || (report.nominated && report.state === 'succeeded'))) {
              selectedPair = report;
            }
          });

          if (!inboundVideo) return;

          const previous = previousStatsRef.current;
          previousStatsRef.current = {
            packetsReceived: inboundVideo.packetsReceived || 0,
            packetsLost: inboundVideo.packetsLost || 0,
            framesDecoded: inboundVideo.framesDecoded || 0,
            framesDropped: inboundVideo.framesDropped || 0,
            freezeCount: inboundVideo.freezeCount || 0,
          };

          const delta = previous
            ? {
                packetsReceived: (inboundVideo.packetsReceived || 0) - previous.packetsReceived,
                packetsLost: (inboundVideo.packetsLost || 0) - previous.packetsLost,
                framesDecoded: (inboundVideo.framesDecoded || 0) - previous.framesDecoded,
                framesDropped: (inboundVideo.framesDropped || 0) - previous.framesDropped,
                freezeCount: (inboundVideo.freezeCount || 0) - previous.freezeCount,
              }
            : {};

          console.info(`[webrtc-stats:${cameraLabel}]`, {
            jitterMs: inboundVideo.jitter != null ? Math.round(inboundVideo.jitter * 1000) : undefined,
            packetsLost: inboundVideo.packetsLost,
            framesPerSecond: inboundVideo.framesPerSecond,
            framesDecoded: inboundVideo.framesDecoded,
            framesDropped: inboundVideo.framesDropped,
            freezeCount: inboundVideo.freezeCount,
            keyFramesDecoded: inboundVideo.keyFramesDecoded,
            roundTripTimeMs: selectedPair?.currentRoundTripTime != null
              ? Math.round(selectedPair.currentRoundTripTime * 1000)
              : undefined,
            delta,
          });
        } catch (error) {
          console.warn(`[webrtc-stats:${cameraLabel}] failed`, error);
        }
      }, 1000);
    };

    ws.onmessage = async (event) => {
      if (isStaleStream()) return;

      let msg;
      try {
        msg = JSON.parse(event.data);
      } catch (_error) {
        setStatus('signal error');
        return;
      }

      if (msg.type === 'offer') {
        if (statsTimerRef.current) {
          clearInterval(statsTimerRef.current);
          statsTimerRef.current = null;
          previousStatsRef.current = null;
        }
        if (pcRef.current) {
          pcRef.current.close();
        }
        const pc = new RTCPeerConnection();
        pcRef.current = pc;
        startStatsLogging(pc);

        pc.ontrack = (trackEvent) => {
          if (isStaleStream() || pcRef.current !== pc) return;
          if (videoRef.current) {
            videoRef.current.srcObject = trackEvent.streams[0];
          }
          reconnectCountRef.current = 0;
          setStatus('streaming');
        };

        pc.onicecandidate = (candidateEvent) => {
          if (!isStaleStream() && candidateEvent.candidate && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({
              type: 'ice',
              candidate: candidateEvent.candidate.candidate,
              sdpMLineIndex: candidateEvent.candidate.sdpMLineIndex,
            }));
          }
        };

        pc.oniceconnectionstatechange = () => {
          if (isStaleStream() || pcRef.current !== pc) return;
          if (pc.iceConnectionState === 'connected' || pc.iceConnectionState === 'completed') {
            reconnectCountRef.current = 0;
            setStatus('streaming');
          } else if (pc.iceConnectionState === 'failed' || pc.iceConnectionState === 'disconnected') {
            setStatus(pc.iceConnectionState);
          }
        };

        try {
          await pc.setRemoteDescription({ type: 'offer', sdp: msg.sdp });
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          if (!isStaleStream() && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'answer', sdp: answer.sdp }));
          }
        } catch (_error) {
          if (!isStaleStream()) {
            setStatus('signal error');
          }
        }
      } else if (msg.type === 'ice' && pcRef.current) {
        try {
          await pcRef.current.addIceCandidate({
            candidate: msg.candidate,
            sdpMLineIndex: msg.sdpMLineIndex,
          });
        } catch (_error) {
          if (!isStaleStream()) {
            setStatus('ice error');
          }
        }
      }
    };

    ws.onopen = () => {
      if (isStaleStream()) return;
      setStatus('signaling');
    };
    ws.onerror = () => {
      if (isStaleStream()) return;
      setStatus('error');
    };
    ws.onclose = () => {
      scheduleReconnect();
    };
  }, [cameraLabel, cleanupStream, isActive, topic]);

  useEffect(() => {
    reconnectCountRef.current = 0;
    connectStream();
    return cleanupStream;
  }, [connectStream, cleanupStream]);

  const handleClose = (e) => {
    e.stopPropagation();
    cleanupStream();
    onClose(idx);
  };

  const mediaWrapperStyle = rotate
    ? {
        position: 'absolute',
        width: '133.33%',
        height: '75%',
        top: '50%',
        left: '50%',
        transform: `translate(-50%, -50%) rotate(${rotationDegrees}deg)`,
        transformOrigin: 'center center',
      }
    : {
        position: 'absolute',
        width: '100%',
        height: '100%',
        inset: 0,
      };

  const videoStyle = {
    width: '100%',
    height: '100%',
    objectFit: 'cover',
    display: 'block',
  };

  return (
    <div
      className={classCell(topic)}
      onClick={!topic ? () => onPlusClick(idx) : undefined}
      style={{
        cursor: !topic ? 'pointer' : 'default',
        aspectRatio: aspect,
        contain: 'layout paint style',
        willChange: 'transform',
        transform: 'translateZ(0)',
        isolation: 'isolate',
        ...style,
      }}
    >
      {topic && topic.trim() !== '' && (
        <>
          <button
            type="button"
            className={classRotateBtn}
            onClick={(e) => { e.stopPropagation(); onRotateClick?.(idx); }}
            title={rotate ? 'View horizontally' : 'View vertically'}
          >
            <MdScreenRotation size={20} />
          </button>
          <button type="button" className={classCloseBtn} onClick={handleClose}>
            <MdClose size={20} />
          </button>
          {status && <div className={classStatus}>{status}</div>}
        </>
      )}
      <div className="w-full h-full relative overflow-hidden rounded-3xl flex items-center justify-center bg-gray-100">
        {topic && cameraLabel && isActive ? (
          <div style={mediaWrapperStyle}>
            <video
              ref={videoRef}
              className="bg-black"
              style={videoStyle}
              autoPlay
              playsInline
              muted
            />
          </div>
        ) : (
          <div className="text-6xl text-gray-400 font-light">+</div>
        )}
      </div>
    </div>
  );
}
