"""Socket.IO server (same events the website already listens for)."""
import asyncio
import json

import socketio

from . import config as cfg
from .util import json_default

sio = socketio.AsyncServer(async_mode="asgi", cors_allowed_origins=cfg.SOCKET_ORIGINS, logger=False, engineio_logger=False)
_loop = None


def set_loop(loop):
    global _loop
    _loop = loop


def emit(event, data=None):
    """Thread-safe, fire-and-forget broadcast (works from request threads and import jobs)."""
    if _loop is None or not _loop.is_running():
        return
    try:
        payload = json.loads(json.dumps(data, default=json_default))
        asyncio.run_coroutine_threadsafe(sio.emit(event, payload), _loop)
    except Exception as e:  # never let a notification break a request
        print(f"[io] emit {event} failed: {e}")


@sio.event
async def connect(sid, environ, auth=None):
    print(f"[io] client {sid} connected")
