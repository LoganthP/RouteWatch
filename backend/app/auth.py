"""JWT login, password hashing and permission dependencies."""
import re
import time

import bcrypt
import jwt
from bson import ObjectId
from fastapi import APIRouter, Depends, Request

from . import config as cfg
from .db import C, now
from .util import HttpError, body_json, jresp, run_in_threadpool

router = APIRouter(prefix="/api/auth")


def _expires_seconds():
    m = re.fullmatch(r"(\d+)\s*([smhd]?)", str(cfg.JWT_EXPIRES_IN).strip())
    if not m:
        return 7 * 86400
    return int(m.group(1)) * {"": 1, "s": 1, "m": 60, "h": 3600, "d": 86400}[m.group(2)]


def sign(user):
    t = int(time.time())
    return jwt.encode({"id": str(user["_id"]), "role": user.get("role", "user"), "iat": t, "exp": t + _expires_seconds()}, cfg.JWT_SECRET, algorithm="HS256")


def hash_password(pw):
    return bcrypt.hashpw(pw.encode()[:72], bcrypt.gensalt(10)).decode()


def check_password(pw, hashed):
    try:
        return bcrypt.checkpw(pw.encode()[:72], hashed.encode())
    except Exception:
        return False


def safe_user(u):
    return {"id": str(u["_id"]), "name": u.get("name"), "email": u.get("email"), "role": u.get("role", "user")}


def _resolve(request: Request):
    h = request.headers.get("authorization", "")
    token = h[7:] if h.startswith("Bearer ") else None
    if not token:
        return None
    try:
        payload = jwt.decode(token, cfg.JWT_SECRET, algorithms=["HS256"])
        return C.users.find_one({"_id": ObjectId(payload["id"])}, {"password": 0})
    except Exception:
        return None


def protect(request: Request):
    user = _resolve(request)
    if not user:
        raise HttpError(401, "Sign in to continue.")
    return user


def optional_auth(request: Request):
    return _resolve(request)


def admin_only(user=Depends(protect)):
    if user.get("role") != "admin":
        raise HttpError(403, "Only administrators can do this.")
    return user


def _register(body):
    name, email, password = str(body.get("name") or "").strip(), str(body.get("email") or "").strip().lower(), str(body.get("password") or "")
    if not name or not email or not password:
        raise HttpError(400, "Name, email and password are required.")
    if len(password) < 6:
        raise HttpError(400, "Password must be at least 6 characters.")
    if len(name) > 80:
        raise HttpError(400, "Name must be 80 characters or fewer.")
    if not re.fullmatch(r"[^@\s]+@[^@\s]+\.[^@\s]+", email):
        raise HttpError(400, "Enter a valid email address.")
    if C.users.find_one({"email": email}, {"_id": 1}):
        raise HttpError(409, "An account with this email already exists.")
    doc = {"name": name, "email": email, "password": hash_password(password), "role": "user", "createdAt": now(), "updatedAt": now()}  # public sign-up is never admin
    C.users.insert_one(doc)
    return {"token": sign(doc), "user": safe_user(doc)}


def _login(body):
    email, password = str(body.get("email") or "").strip().lower(), str(body.get("password") or "")
    user = C.users.find_one({"email": email})
    if not user or not check_password(password, user.get("password", "")):
        raise HttpError(401, "Email or password is incorrect.")
    return {"token": sign(user), "user": safe_user(user)}


@router.post("/register")
async def register(request: Request):
    return jresp(await run_in_threadpool(_register, await body_json(request)), 201)


@router.post("/login")
async def login(request: Request):
    return jresp(await run_in_threadpool(_login, await body_json(request)))


@router.get("/me")
def me(user=Depends(protect)):
    return jresp({"user": safe_user(user)})
