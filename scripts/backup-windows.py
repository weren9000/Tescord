"""Encrypted off-server backups. Requires paramiko and cryptography on Windows.

--create-key creates a DPAPI-protected restricted SSH key and prints its public key.
Without arguments downloads a backup using that key. --decrypt FILE --output FILE
decrypts an archive for recovery. Keep this Windows account's recovery credentials.
"""
import argparse
import base64
import ctypes
from ctypes import wintypes
from datetime import datetime, timezone
import hashlib
import io
import json
import os
from pathlib import Path
import struct

import paramiko
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes

ROOT = Path.home() / '.kva-recovery'
MAGIC = b'KVABACK1'


class Blob(ctypes.Structure):
    _fields_ = [('size', wintypes.DWORD), ('data', ctypes.POINTER(ctypes.c_char))]


def dpapi(data, decrypt=False):
    buffer = ctypes.create_string_buffer(data)
    source = Blob(len(data), ctypes.cast(buffer, ctypes.POINTER(ctypes.c_char)))
    result = Blob()
    function = ctypes.windll.crypt32.CryptUnprotectData if decrypt else ctypes.windll.crypt32.CryptProtectData
    if not function(ctypes.byref(source), None, None, None, None, 1, ctypes.byref(result)):
        raise ctypes.WinError()
    try:
        return ctypes.string_at(result.data, result.size)
    finally:
        ctypes.windll.kernel32.LocalFree(result.data)


def create_key():
    target = ROOT / 'backup-key.dpapi'
    if target.exists():
        raise RuntimeError('Backup key already exists')
    key = Ed25519PrivateKey.generate()
    private = key.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.OpenSSH, serialization.NoEncryption())
    target.write_bytes(dpapi(private))
    print(key.public_key().public_bytes(serialization.Encoding.OpenSSH, serialization.PublicFormat.OpenSSH).decode() + ' kva-windows-backup')


def download():
    stamp = datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')
    target = ROOT / f'backup-{stamp}.kva'
    partial = target.with_suffix('.partial')
    private = dpapi((ROOT / 'backup-key.dpapi').read_bytes(), decrypt=True)
    key = paramiko.Ed25519Key.from_private_key(io.StringIO(private.decode()))
    del private
    client = paramiko.SSHClient()
    client.load_system_host_keys()
    client.set_missing_host_key_policy(paramiko.RejectPolicy())
    encrypted_key = os.urandom(32)
    nonce = os.urandom(12)
    header = json.dumps({'key': base64.b64encode(dpapi(encrypted_key)).decode(), 'nonce': base64.b64encode(nonce).decode(), 'created_at': stamp, 'host': '155.212.247.117'}).encode()
    encryptor = Cipher(algorithms.AES(encrypted_key), modes.GCM(nonce)).encryptor()
    encryptor.authenticate_additional_data(header)
    digest = hashlib.sha256()
    total = 0
    try:
        client.connect('155.212.247.117', username='root', pkey=key, look_for_keys=False, allow_agent=False, timeout=20)
        client.get_transport().set_keepalive(20)
        _, stdout, stderr = client.exec_command('backup', timeout=900)
        with partial.open('xb') as file:
            file.write(MAGIC + struct.pack('!I', len(header)) + header)
            while chunk := stdout.read(1024 * 1024):
                digest.update(chunk)
                total += len(chunk)
                file.write(encryptor.update(chunk))
            if stdout.channel.recv_exit_status() != 0 or total < 10240:
                raise RuntimeError('Server backup failed; encrypted partial retained for diagnosis')
            file.write(encryptor.finalize() + encryptor.tag)
        partial.replace(target)
        (ROOT / 'last-success.json').write_text(json.dumps({'created_at': stamp, 'file': target.name, 'plaintext_bytes': total, 'plaintext_sha256': digest.hexdigest()}, indent=2), encoding='utf-8')
        # Retain the newest 30 completed backups; pre-hardening copies are separate.
        for old in sorted(ROOT.glob('backup-*.kva'), reverse=True)[30:]:
            old.unlink()
        print(f'Backup saved: {target.name} ({total} bytes before encryption)')
    finally:
        client.close()


def decrypt(source, output):
    source, output = Path(source), Path(output)
    with source.open('rb') as file:
        if file.read(8) != MAGIC:
            raise ValueError('Unknown backup format')
        size = struct.unpack('!I', file.read(4))[0]
        if size > 65536:
            raise ValueError('Invalid header')
        header = file.read(size)
        metadata = json.loads(header)
        key = dpapi(base64.b64decode(metadata['key']), decrypt=True)
        offset = file.tell()
        file.seek(-16, 2)
        end = file.tell()
        tag = file.read(16)
        decryptor = Cipher(algorithms.AES(key), modes.GCM(base64.b64decode(metadata['nonce']), tag)).decryptor()
        decryptor.authenticate_additional_data(header)
        file.seek(offset)
        plain = output.open('xb')
        try:
            with plain:
                while file.tell() < end:
                    plain.write(decryptor.update(file.read(min(1024 * 1024, end - file.tell()))))
                plain.write(decryptor.finalize())
        except Exception:
            output.unlink(missing_ok=True)
            raise
    print(f'Decrypted and authenticated: {output}')


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--create-key', action='store_true')
    parser.add_argument('--decrypt')
    parser.add_argument('--output')
    args = parser.parse_args()
    if args.create_key:
        create_key()
    elif args.decrypt and args.output:
        decrypt(args.decrypt, args.output)
    else:
        download()
