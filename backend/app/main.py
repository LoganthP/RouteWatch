"""RouteWatch API (FastAPI + Socket.IO).   Start:  uvicorn app.main:app --host localhost --port 5000"""
import asyncio
import traceback
from contextlib import asynccontextmanager

import socketio
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from starlette.exceptions import HTTPException as StarletteHTTPException
from starlette.concurrency import run_in_threadpool

from . import config as cfg
from . import db, realtime
from .util import HttpError, jresp


def _startup():
    try:
        db.connect()
    except Exception as e:
        print("\n[db] connection failed:", str(e)[:300])
        print("    Check MONGODB_URI in backend/.env, that MongoDB is running, and (Atlas) that your IP is allowed under Network Access.\n")
        raise
    db.ensure_indexes()
    from .datasets import importer, files
    importer.recover_jobs()
    files.sweep()


@asynccontextmanager
async def lifespan(_app):
    realtime.set_loop(asyncio.get_running_loop())
    if not __import__("os").getenv("JWT_SECRET"):
        print("[warn] JWT_SECRET is missing: using an insecure development secret.")
    await run_in_threadpool(_startup)
    print(f"[api] RouteWatch API ready, interactive docs at /api/docs")
    yield
    db.close()


api = FastAPI(title="RouteWatch API", version="2.0.0", docs_url="/api/docs", redoc_url=None, openapi_url="/api/openapi.json", lifespan=lifespan)
api.add_middleware(CORSMiddleware, allow_origins=cfg.CLIENT_ORIGINS, allow_methods=["*"], allow_headers=["*"], expose_headers=["Content-Disposition"])


@api.exception_handler(HttpError)
async def _http_error(_r: Request, e: HttpError):
    return jresp({"message": e.message, **e.extra}, e.status)


@api.exception_handler(StarletteHTTPException)
async def _starlette_error(r: Request, e: StarletteHTTPException):
    if e.status_code == 404:
        return jresp({"message": f"No route for {r.method} {r.url.path}"}, 404)
    return jresp({"message": str(e.detail)}, e.status_code)


@api.exception_handler(Exception)
async def _unhandled(_r: Request, e: Exception):
    traceback.print_exception(e)
    return jresp({"message": f"Server error: {e}"}, 500)


@api.get("/api/health")
def health():
    return jresp({"ok": True, "db": "connected" if db.ping() else "disconnected"})


from . import auth, routes_incidents, routes_misc, routes_ml  # noqa: E402
from .datasets import routes as routes_datasets  # noqa: E402

for _r in (auth.router, routes_incidents.router, routes_misc.router, routes_datasets.router, routes_ml.router):
    api.include_router(_r)

# Socket.IO wraps the API: websocket / polling on /socket.io, everything else goes to FastAPI
app = socketio.ASGIApp(realtime.sio, other_asgi_app=api, socketio_path="socket.io")
