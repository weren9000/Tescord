from pathlib import Path
import re

from fastapi import FastAPI, HTTPException
from fastapi.responses import JSONResponse, FileResponse
from fastapi.staticfiles import StaticFiles

from .store import snapshot, database_path

PREFIX = "/plugins/game-calendar"
app = FastAPI(title="KvaChat Game Calendar", docs_url=None, redoc_url=None, openapi_url=None)


@app.middleware("http")
async def security_headers(request, call_next):
    response = await call_next(request)
    response.headers["Content-Security-Policy"] = "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'self'"
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["Referrer-Policy"] = "no-referrer"
    response.headers.setdefault("Cache-Control", "no-cache")
    return response


@app.get(PREFIX + "/api/events")
def events():
    try:
        return snapshot()
    except Exception:
        return JSONResponse({"detail": "Календарь временно недоступен. Попробуйте позже."}, status_code=503)


@app.get(PREFIX + "/health")
def health():
    return {"status": "ok", "plugin": "game-calendar"}


@app.get(PREFIX + "/images/{filename}")
def image_file(filename: str):
    if not re.fullmatch(r"[a-f0-9]{64}\.webp", filename):
        raise HTTPException(404)
    path = database_path().parent / "images" / filename
    if not path.is_file():
        raise HTTPException(404)
    return FileResponse(path, media_type="image/webp", headers={"Cache-Control": "public, max-age=31536000, immutable"})


app.mount(PREFIX, StaticFiles(directory=Path(__file__).parent / "web", html=True), name="calendar")
