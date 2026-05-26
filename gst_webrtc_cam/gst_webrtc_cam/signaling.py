import asyncio
import itertools
import json
import logging

from aiohttp import web
from gi.repository import GLib


logger = logging.getLogger(__name__)


class SignalingServer:
    """Small aiohttp server for camera listing and per-camera WebRTC signaling."""

    def __init__(self, host: str, port: int, pipeline_map: dict):
        self.host = host
        self.port = port
        self.pipelines = pipeline_map
        self._app = None
        self._runner = None
        self._loop = None
        self._ws_connections = {}
        self._connection_ids = itertools.count(1)

    async def _handle_cam_list(self, _request):
        return web.json_response(list(self.pipelines.keys()))

    async def _handle_ws(self, request):
        cam_label = request.match_info['cam_label']
        if cam_label not in self.pipelines:
            return web.Response(status=404, text=f"Camera '{cam_label}' not found")

        conn_id = next(self._connection_ids)
        ws = web.WebSocketResponse(heartbeat=15)
        await ws.prepare(request)
        peer = request.remote or 'unknown'
        user_agent = request.headers.get('User-Agent', 'unknown')
        logger.info(
            '[signaling] browser connected for %s conn=%s peer=%s ua="%s"',
            cam_label,
            conn_id,
            peer,
            user_agent,
        )

        old_ws = self._ws_connections.get(cam_label)
        if old_ws is not None and not old_ws.closed:
            logger.info(
                '[signaling] replacing existing browser connection for %s conn=%s',
                cam_label,
                conn_id,
            )
            await old_ws.close()
            self.pipelines[cam_label].stop()

        self._ws_connections[cam_label] = ws
        pipeline = self.pipelines[cam_label]
        loop = asyncio.get_event_loop()

        def ws_send(msg_dict):
            asyncio.run_coroutine_threadsafe(self._safe_ws_send(ws, msg_dict), loop)

        GLib.idle_add(pipeline.start, ws_send)

        try:
            async for raw_msg in ws:
                if raw_msg.type == web.WSMsgType.TEXT:
                    msg = json.loads(raw_msg.data)
                    msg_type = msg.get('type')
                    if msg_type == 'answer':
                        GLib.idle_add(pipeline.handle_sdp_answer, msg['sdp'])
                    elif msg_type == 'ice':
                        GLib.idle_add(
                            pipeline.handle_ice,
                            int(msg['sdpMLineIndex']),
                            msg['candidate'],
                        )
                elif raw_msg.type == web.WSMsgType.ERROR:
                    logger.error('[signaling] websocket error for %s: %s', cam_label, ws.exception())
        finally:
            logger.info(
                '[signaling] browser disconnected from %s conn=%s close_code=%s exception=%s',
                cam_label,
                conn_id,
                ws.close_code,
                ws.exception(),
            )
            if self._ws_connections.get(cam_label) is ws:
                GLib.idle_add(pipeline.stop)
                self._ws_connections.pop(cam_label, None)

        return ws

    async def _safe_ws_send(self, ws, msg_dict):
        if not ws.closed:
            await ws.send_json(msg_dict)

    def run_in_thread(self):
        self._loop = asyncio.new_event_loop()
        asyncio.set_event_loop(self._loop)
        self._loop.run_until_complete(self._start())
        self._loop.run_forever()

    async def _start(self):
        self._app = web.Application()
        self._app.router.add_get('/api/cameras', self._handle_cam_list)
        self._app.router.add_get('/ws/{cam_label}', self._handle_ws)
        self._runner = web.AppRunner(self._app)
        await self._runner.setup()
        site = web.TCPSite(self._runner, self.host, self.port)
        await site.start()
        logger.info('[signaling] server running on http://%s:%s', self.host, self.port)

    def shutdown(self):
        if self._loop is None:
            return
        if self._runner is not None:
            asyncio.run_coroutine_threadsafe(self._runner.cleanup(), self._loop)
        self._loop.call_soon_threadsafe(self._loop.stop)
