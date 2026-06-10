#!/usr/bin/env python3
"""SFTP helper for the game server, driven by GitHub Actions.

Reads connection details from environment variables:
  SFTP_HOST, SFTP_PORT, SFTP_USERNAME, SFTP_PASSWORD

Commands (via CMD env var or first CLI argument):
  list  - recursively list REMOTE_PATH down to DEPTH levels
  get   - download REMOTE_PATH (file or directory) into ./sftp_download/,
          printing small text files inline so they show up in the job log
  put   - upload LOCAL_PATH (file or directory in the repo) to REMOTE_PATH
"""

import os
import posixpath
import stat
import sys

import paramiko

TEXT_PRINT_LIMIT = 100_000  # bytes; don't dump huge files into the log


def connect() -> paramiko.SFTPClient:
    host = os.environ["SFTP_HOST"]
    port = int(os.environ["SFTP_PORT"])
    transport = paramiko.Transport((host, port))
    transport.connect(
        username=os.environ["SFTP_USERNAME"],
        password=os.environ["SFTP_PASSWORD"],
    )
    return paramiko.SFTPClient.from_transport(transport)


def is_dir(sftp: paramiko.SFTPClient, path: str) -> bool:
    return stat.S_ISDIR(sftp.stat(path).st_mode)


def cmd_list(sftp: paramiko.SFTPClient, path: str, depth: int) -> None:
    entries = sorted(sftp.listdir_attr(path), key=lambda e: e.filename.lower())
    dirs = [e for e in entries if stat.S_ISDIR(e.st_mode)]
    files = [e for e in entries if not stat.S_ISDIR(e.st_mode)]
    for e in files:
        print(f"{posixpath.join(path, e.filename)}  ({e.st_size} bytes)")
    for e in dirs:
        sub = posixpath.join(path, e.filename)
        print(f"{sub}/")
        if depth > 1:
            try:
                cmd_list(sftp, sub, depth - 1)
            except IOError as err:
                print(f"{sub}/ <unreadable: {err}>")


def print_if_text(local: str, remote: str) -> None:
    size = os.path.getsize(local)
    if size > TEXT_PRINT_LIMIT:
        print(f"--- {remote} ({size} bytes, too large to print) ---")
        return
    try:
        with open(local, encoding="utf-8") as f:
            content = f.read()
    except (UnicodeDecodeError, OSError):
        print(f"--- {remote} ({size} bytes, binary, not printed) ---")
        return
    print(f"----- BEGIN {remote} -----")
    print(content)
    print(f"----- END {remote} -----")


def cmd_get(sftp: paramiko.SFTPClient, remote: str, dest_root: str) -> None:
    local = os.path.join(dest_root, remote.strip("/").replace("/", os.sep))
    if is_dir(sftp, remote):
        os.makedirs(local, exist_ok=True)
        for e in sftp.listdir_attr(remote):
            cmd_get(sftp, posixpath.join(remote, e.filename), dest_root)
    else:
        os.makedirs(os.path.dirname(local) or ".", exist_ok=True)
        sftp.get(remote, local)
        print_if_text(local, remote)


def ensure_remote_dir(sftp: paramiko.SFTPClient, path: str) -> None:
    parts = [p for p in path.split("/") if p]
    cur = ""
    for part in parts:
        cur = f"{cur}/{part}" if cur else part
        try:
            sftp.stat(cur)
        except IOError:
            sftp.mkdir(cur)


def cmd_put(sftp: paramiko.SFTPClient, local: str, remote: str) -> None:
    if os.path.isdir(local):
        ensure_remote_dir(sftp, remote)
        for name in sorted(os.listdir(local)):
            cmd_put(sftp, os.path.join(local, name), posixpath.join(remote, name))
    else:
        parent = posixpath.dirname(remote)
        if parent:
            ensure_remote_dir(sftp, parent)
        sftp.put(local, remote)
        print(f"uploaded {local} -> {remote}")


def main() -> None:
    cmd = os.environ.get("CMD") or (sys.argv[1] if len(sys.argv) > 1 else "list")
    remote_path = os.environ.get("REMOTE_PATH", ".") or "."
    sftp = connect()
    try:
        if cmd == "list":
            depth = int(os.environ.get("DEPTH", "3") or "3")
            cmd_list(sftp, remote_path, depth)
        elif cmd == "get":
            cmd_get(sftp, remote_path, "sftp_download")
        elif cmd == "put":
            local_path = os.environ["LOCAL_PATH"]
            cmd_put(sftp, local_path, remote_path)
        else:
            sys.exit(f"unknown command: {cmd}")
    finally:
        sftp.close()


if __name__ == "__main__":
    main()
