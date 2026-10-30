"""python run.py            start the API on http://localhost:5000
   python run.py --reload   restart automatically when code in app/ changes (development)"""
import os
import sys

import uvicorn

from app import config

if __name__ == "__main__":
    # "localhost" binds both IPv4 and IPv6 loopback, so the website's dev proxy always connects
    uvicorn.run("app.main:app", host=os.getenv("HOST", "localhost"), port=config.PORT,
                reload="--reload" in sys.argv, reload_dirs=["app"] if "--reload" in sys.argv else None)
