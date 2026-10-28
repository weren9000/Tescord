"""Server-side VK community artwork; no credentials or CDN URLs in public responses."""
from __future__ import annotations

import hashlib
import io
import json
import os
import re
import ssl
import time
import tempfile
import urllib.request
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor
from urllib.parse import urlencode, urlsplit

from PIL import Image, ImageOps
import certifi

from .store import metadata, put_meta, writer

PREFIX = "/plugins/game-calendar/images/"
MAX_BYTES = 8_000_000


def group_key(value: object) -> str | None:
    if not isinstance(value, str):
        return None
    value = value.strip()
    if "://" in value:
        try:
            url = urlsplit(value)
            if url.scheme not in {"http", "https"} or url.hostname not in {"vk.com", "vk.ru", "www.vk.com", "www.vk.ru", "m.vk.com", "m.vk.ru"} or url.username or url.password:
                return None
            value = url.path.strip("/")
        except ValueError:
            return None
    match = re.fullmatch(r"(?:club|public|event)?([1-9][0-9]*)", value)
    if match:
        return match[1]
    return value.lower() if re.fullmatch(r"[a-zA-Z][a-zA-Z0-9_.]{1,99}", value) else None


def token() -> str:
    value = os.environ.get("KVA_CALENDAR_VK_TOKEN", "").strip()
    if not value and os.environ.get("KVA_CALENDAR_VK_TOKEN_FILE"):
        value = Path(os.environ["KVA_CALENDAR_VK_TOKEN_FILE"]).read_text(encoding="utf-8-sig").strip()
    return value


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def download(url: str) -> bytes:
    parsed = urlsplit(url)
    host = parsed.hostname or ""
    # VK's image CDN only. No arbitrary URL proxy, redirects, or local addresses.
    if parsed.scheme != "https" or parsed.username or parsed.password or parsed.port not in {None, 443} or not host.endswith(".userapi.com"):
        raise ValueError("Unsupported image host")
    request = urllib.request.Request(url, headers={"User-Agent": "KvaChatCalendar/0.1"})
    context = ssl.create_default_context(cafile=certifi.where())
    with urllib.request.build_opener(NoRedirect, urllib.request.HTTPSHandler(context=context)).open(request, timeout=20) as response:
        data = response.read(MAX_BYTES + 1)
    if len(data) > MAX_BYTES:
        raise ValueError("Image too large")
    return data


def save_image(data: bytes, directory: Path) -> str:
    if len(data) > MAX_BYTES:
        raise ValueError("Image too large")
    with Image.open(io.BytesIO(data)) as original:
        if original.width * original.height > 20_000_000:
            raise ValueError("Image dimensions too large")
        image = ImageOps.exif_transpose(original).convert("RGB")
        image.thumbnail((1600, 900))
        output = io.BytesIO()
        image.save(output, format="WEBP", quality=85)
    content = output.getvalue()
    name = hashlib.sha256(content).hexdigest() + ".webp"
    directory.mkdir(parents=True, exist_ok=True)
    target = directory / name
    if not target.exists():
        with tempfile.NamedTemporaryFile(dir=directory, suffix=".tmp", delete=False) as file:
            temporary = Path(file.name)
            file.write(content)
        try:
            temporary.replace(target)
        finally:
            temporary.unlink(missing_ok=True)
    return name


def candidates(group: dict) -> list[tuple[str, str]]:
    if group.get("deactivated") or group.get("is_closed", 0):
        return []
    cover = group.get("cover") or {}
    images = sorted(cover.get("images") or [], key=lambda i: int(i.get("width", 0)), reverse=True) if cover.get("enabled") else []
    choices = [(item["url"], "cover") for item in images if item.get("url")][:1]
    if group.get("photo_200"):
        choices.append((group["photo_200"], "avatar"))
    return choices


class VK:
    def __init__(self, access_token: str):
        self.access_token = access_token

    def groups(self, keys: list[str]) -> list[dict]:
        body = urlencode({"access_token": self.access_token, "v": "5.199", "group_ids": ",".join(keys), "fields": "cover,photo_200"}).encode()
        request = urllib.request.Request("https://api.vk.com/method/groups.getById", data=body)
        try:
            with urllib.request.build_opener(NoRedirect).open(request, timeout=25) as response:
                data = response.read(5_000_001)
            if len(data) > 5_000_000:
                raise ValueError()
            result = json.loads(data)
            if "error" in result:
                # VK errors can echo request_params containing the credential.
                raise ValueError()
            groups = result["response"]["groups"]
            if not isinstance(groups, list) or any(not isinstance(g, dict) or not isinstance(g.get("id"), int) for g in groups):
                raise ValueError()
            return groups
        except Exception:
            raise RuntimeError("VK community lookup failed") from None


def cached_artwork(group: dict, old: dict, directory: Path, fetch) -> dict | None:
    choices = candidates(group)
    if not choices:
        return None
    for url, kind in choices:
        if old.get("origin") == url and re.fullmatch(r"[a-f0-9]{64}\.webp", old.get("file", "")) and (directory / old["file"]).is_file():
            return old
        try:
            name = save_image(fetch(url), directory)
            return {"file": name, "kind": kind, "origin": url, "source_url": f"https://vk.com/club{group['id']}"}
        except Exception:
            continue
    raise RuntimeError("VK artwork unavailable")


def refresh(path: Path, client=None, fetch=download) -> dict:
    if client is None:
        access_token = token()
        if not access_token:
            return {"status": "disabled", "images": 0}
        client = VK(access_token)
    db = writer(path)
    try:
        db.execute("BEGIN IMMEDIATE")
        events = [json.loads(row[0]) for row in db.execute("SELECT payload FROM events")]
        keys = sorted({e["vk_group"] for e in events if e.get("vk_group")})
        previous = metadata(db).get("vk_media", {})
        media = {key: previous[key] for key in keys if key in previous}
        errors = 0
        for offset in range(0, len(keys), 50):
            batch = keys[offset:offset + 50]
            try:
                groups = client.groups(batch)
            except Exception:
                errors += len(batch)
                continue
            lookup = {}
            for group in groups:
                lookup[str(group["id"])] = group
                lookup[str(group.get("screen_name", "")).lower()] = group
            with ThreadPoolExecutor(max_workers=4) as pool:
                pending = {key: pool.submit(cached_artwork, lookup[key], media.get(key, {}), path.parent / "images", fetch)
                           for key in batch if key in lookup}
                errors += len(batch) - len(pending)
                for key, future in pending.items():
                    try:
                        artwork = future.result()
                        if artwork:
                            media[key] = artwork
                        else:
                            media.pop(key, None)
                    except Exception:
                        errors += 1
            print(f"VK artwork checked: {min(offset + 50, len(keys))}/{len(keys)}", flush=True)
            time.sleep(0.35)
        put_meta(db, "vk_media", media)
        put_meta(db, "vk_image_errors", errors)
        db.commit()
        return {"status": "partial" if errors else "ok", "groups": len(keys), "images": len(media), "errors": errors}
    finally:
        db.close()
