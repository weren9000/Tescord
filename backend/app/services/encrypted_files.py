"""Bounded authenticated storage with random access for HTTP Range requests.

v1: fixed header (magic, key id, random 256-bit salt, size), authenticated
with nonce 0; 1 MiB chunks authenticated with nonces 1..N. HKDF derives a
fresh file key. The complete header and logical filename are AAD. The exact
container length is checked before reading, and no unauthenticated chunk is
released. A .kvaenc path MUST contain this format; it never falls back to raw.
"""
from __future__ import annotations

import hashlib
import io
import math
import os
import re
import struct
from pathlib import Path
from uuid import uuid4

from cryptography.exceptions import InvalidTag
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from starlette.responses import Response, StreamingResponse, FileResponse

from app.services.data_encryption import EncryptionUnavailable, derive_key, keyring, required_keyring

CHUNK = 1024 * 1024
SUFFIX = '.kvaenc'
HEADER = struct.Struct('>8s16s32sQ')
MAGIC = b'KVAFILE1'
HEADER_SIZE = HEADER.size + 16
MAX_FILE = 1024 ** 4  # format/application safety bound, not the upload quota


def encrypted_path(path: Path) -> Path:
    return Path(str(path) + SUFFIX)


def is_encrypted(path: Path) -> bool:
    return path.name.endswith(SUFFIX)


def _aad(header: bytes, name: str) -> bytes:
    return header + b'\x00' + name.encode('utf-8')


def write_file(source, destination: Path, *, max_bytes: int, close_source=False) -> tuple[int, str]:
    """Atomic write. The caller selects the final (possibly encrypted) path."""
    destination.parent.mkdir(parents=True, exist_ok=True)
    temporary = destination.with_name(destination.name + '.' + uuid4().hex + '.part')
    total, digest = 0, hashlib.sha256()
    encrypt = is_encrypted(destination)
    try:
        # UploadFile and BytesIO are seekable; size is authenticated in the header.
        start = source.tell()
        source.seek(0, io.SEEK_END)
        size = source.tell() - start
        source.seek(start)
        if size < 0 or size > min(max_bytes, MAX_FILE):
            raise FileTooLarge()
        with temporary.open('xb') as target:
            if encrypt:
                ring = required_keyring()
                salt = os.urandom(32)
                header = HEADER.pack(MAGIC, bytes.fromhex(ring.active), salt, size)
                cipher = AESGCM(derive_key(ring.key(ring.active), salt, b'kvachat/file/v1'))
                aad = _aad(header, destination.name)
                target.write(header + cipher.encrypt(bytes(12), b'', aad))
            index = 1
            while total < size:
                # Fill a complete chunk even when a file-like object has short reads.
                needed = min(CHUNK, size-total)
                data = bytearray()
                while len(data) < needed:
                    part = source.read(needed-len(data))
                    if not part:
                        raise OSError('Upload ended early')
                    data.extend(part)
                block = bytes(data)
                total += len(block)
                digest.update(block)
                target.write(cipher.encrypt(index.to_bytes(12, 'big'), block, aad) if encrypt else block)
                index += 1
            if source.read(1):
                raise OSError('Upload size changed')
            target.flush()
            os.fsync(target.fileno())
        if close_source:
            source.close()
        temporary.replace(destination)
    finally:
        temporary.unlink(missing_ok=True)
    return total, digest.hexdigest()


class FileTooLarge(ValueError):
    pass


class StoredReader(io.RawIOBase):
    """Seekable plaintext view. Only ciphertext lives in the persistent file."""
    def __init__(self, path: Path):
        self._file = path.open('rb')
        self._position = 0
        self._cached_index = -1
        self._cached_data = b''
        self._encrypted = is_encrypted(path)
        try:
            disk_size = os.fstat(self._file.fileno()).st_size
            if not self._encrypted:
                self.size = disk_size
                return
            header = self._file.read(HEADER.size)
            magic, key_id, salt, size = HEADER.unpack(header)
            if magic != MAGIC or size > MAX_FILE or disk_size != HEADER_SIZE + size + math.ceil(size / CHUNK)*16:
                raise ValueError()
            self._cipher = AESGCM(derive_key(required_keyring().key(key_id.hex()), salt, b'kvachat/file/v1'))
            self._aad = _aad(header, path.name)
            self._cipher.decrypt(bytes(12), self._file.read(16), self._aad)
            self.size = size
        except (ValueError, struct.error, InvalidTag, EncryptionUnavailable):
            self._file.close()
            raise EncryptionUnavailable() from None

    def readable(self):
        return True

    def seekable(self):
        return True

    def tell(self):
        return self._position

    def seek(self, offset, whence=io.SEEK_SET):
        if whence not in (io.SEEK_SET, io.SEEK_CUR, io.SEEK_END):
            raise ValueError('Invalid seek mode')
        position = offset + (self._position if whence == io.SEEK_CUR else self.size if whence == io.SEEK_END else 0)
        if position < 0:
            raise ValueError('Negative seek')
        self._position = position
        return position

    def read(self, size=-1):
        if self.closed:
            raise ValueError('Closed reader')
        count = max(0, self.size-self._position) if size is None or size < 0 else min(size, max(0, self.size-self._position))
        if not self._encrypted:
            self._file.seek(self._position)
            data = self._file.read(count)
            self._position += len(data)
            return data
        result = bytearray()
        while count:
            index, within = divmod(self._position, CHUNK)
            if self._cached_index != index:
                plain_size = min(CHUNK, self.size-index*CHUNK)
                self._file.seek(HEADER_SIZE + index*(CHUNK+16))
                try:
                    self._cached_data = self._cipher.decrypt((index+1).to_bytes(12, 'big'), self._file.read(plain_size+16), self._aad)
                except InvalidTag:
                    raise EncryptionUnavailable() from None
                self._cached_index = index
            part = self._cached_data[within:within+count]
            result.extend(part)
            count -= len(part)
            self._position += len(part)
        return bytes(result)

    def readinto(self, buffer):
        data = self.read(len(buffer))
        buffer[:len(data)] = data
        return len(data)

    def close(self):
        self._cached_data = b''
        self._file.close()
        super().close()


class StoredFileResponse(Response):
    """Serve both legacy and encrypted storage with GET/HEAD and one byte range."""
    def __init__(self, path, *, media_type=None, headers=None, filename=None):
        self.path = Path(path)
        self.filename = filename
        super().__init__(media_type=media_type, headers=headers)
        if not headers or not any(key.lower() == 'content-length' for key in headers):
            del self.headers['content-length']

    async def __call__(self, scope, receive, send):
        if not is_encrypted(self.path):
            return await FileResponse(self.path, media_type=self.media_type, headers=dict(self.headers), filename=self.filename)(scope, receive, send)
        from starlette.concurrency import run_in_threadpool
        from urllib.parse import quote
        reader = await run_in_threadpool(StoredReader, self.path)
        try:
            size = reader.size
            start, end, status = 0, size-1, 200
            headers = dict(self.headers)
            headers['accept-ranges'] = 'bytes'
            headers['cache-control'] = 'private, no-store'
            if self.filename:
                headers['content-disposition'] = "attachment; filename*=UTF-8''" + quote(self.filename)
            request_headers = dict(scope.get('headers', []))
            value = request_headers.get(b'range') if scope['method'] != 'HEAD' else None
            # Without a stable representation validator, If-Range means full response.
            if value and b'if-range' not in request_headers:
                match = re.fullmatch(rb'bytes=(\d{0,20})-(\d{0,20})', value)
                if not match or not any(match.groups()) or size == 0:
                    await Response(status_code=416, headers={'Content-Range':f'bytes */{size}'})(scope, receive, send)
                    return
                left, right = match.groups()
                if left:
                    start, end = int(left), min(int(right), size-1) if right else size-1
                else:
                    start, end = max(0, size-int(right)), size-1
                if start > end or start >= size:
                    await Response(status_code=416, headers={'Content-Range':f'bytes */{size}'})(scope, receive, send)
                    return
                status = 206
                headers['content-range'] = f'bytes {start}-{end}/{size}'
            length = max(0, end-start+1)
            headers['content-length'] = str(length)
            if scope['method'] == 'HEAD':
                await Response(status_code=status, headers=headers, media_type=self.media_type)(scope, receive, send)
                return
            reader.seek(start)
            # Authenticate the first block before HTTP headers are sent.
            first = await run_in_threadpool(reader.read, min(CHUNK, length))
            def chunks():
                remaining = length-len(first)
                if first:
                    yield first
                while remaining:
                    chunk = reader.read(min(CHUNK, remaining))
                    remaining -= len(chunk)
                    yield chunk
            await StreamingResponse(chunks(), status_code=status, headers=headers, media_type=self.media_type)(scope, receive, send)
        finally:
            reader.close()
