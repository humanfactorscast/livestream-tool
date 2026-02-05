#!/usr/bin/env python3
"""Livestream Copilot local launcher.

Starts a local static web server for this folder and optionally opens the default browser.
Can also be bundled as a single executable via PyInstaller.
"""

from __future__ import annotations

import argparse
import contextlib
import http.server
import os
import socket
import socketserver
import threading
import time
import webbrowser
from pathlib import Path


class ReusableTCPServer(socketserver.TCPServer):
    allow_reuse_address = True


def find_open_port(preferred_port: int) -> int:
    """Return preferred_port if available; otherwise ask OS for an open port."""
    with contextlib.closing(socket.socket(socket.AF_INET, socket.SOCK_STREAM)) as sock:
        if sock.connect_ex(("127.0.0.1", preferred_port)) != 0:
            return preferred_port

    with contextlib.closing(socket.socket(socket.AF_INET, socket.SOCK_STREAM)) as sock:
        sock.bind(("127.0.0.1", 0))
        return int(sock.getsockname()[1])


def run_server(port: int, open_browser: bool, run_seconds: int | None) -> None:
    root = Path(__file__).resolve().parent
    os.chdir(root)

    handler = http.server.SimpleHTTPRequestHandler
    with ReusableTCPServer(("0.0.0.0", port), handler) as httpd:
        url = f"http://127.0.0.1:{port}"
        print(f"Livestream Copilot is running at {url}")
        print("Press Ctrl+C to stop.")

        if open_browser:
            threading.Timer(0.4, lambda: webbrowser.open(url)).start()

        if run_seconds is not None:
            worker = threading.Thread(target=httpd.serve_forever, kwargs={'poll_interval': 0.2}, daemon=True)
            worker.start()
            time.sleep(max(run_seconds, 0))
            httpd.shutdown()
            worker.join(timeout=2)
            return

        try:
            httpd.serve_forever(poll_interval=0.4)
        except KeyboardInterrupt:
            print("\nStopping Livestream Copilot...")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Run Livestream Copilot locally.")
    parser.add_argument("--port", type=int, default=4173, help="Preferred local port (default: 4173)")
    parser.add_argument("--no-browser", action="store_true", help="Do not auto-open browser")
    parser.add_argument("--run-seconds", type=int, default=None, help="Run for N seconds then exit (for smoke tests)")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    port = find_open_port(args.port)
    run_server(port=port, open_browser=not args.no_browser, run_seconds=args.run_seconds)


if __name__ == "__main__":
    main()
