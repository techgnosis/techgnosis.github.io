#!/usr/bin/env python
"""Load the game headlessly, capture console errors, drive it, and screenshot.

Usage:
    .py3env/bin/python tools/shoot.py [seed]

Serves the project root on an ephemeral port, opens index.html in headless
Chromium, records any console.error / pageerror, holds W to accelerate, takes
shots at rest and while moving, then steers and shoots again. Exits non-zero if
any page errors were seen.
"""
import functools
import http.server
import socket
import socketserver
import sys
import threading
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "tools" / "shots"
OUT.mkdir(exist_ok=True)


def serve(root: Path):
    handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=str(root))
    handler.log_message = lambda *a, **k: None  # quiet
    # Pick a free port.
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        port = s.getsockname()[1]
    httpd = socketserver.TCPServer(("127.0.0.1", port), handler)
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    return httpd, port


def main():
    seed = sys.argv[1] if len(sys.argv) > 1 else "12345"
    engine = sys.argv[2] if len(sys.argv) > 2 else "chromium"
    httpd, port = serve(ROOT)
    url = f"http://127.0.0.1:{port}/index.html?seed={seed}"
    print(f"serving -> {url}  (engine: {engine})")

    errors, warnings = [], []
    with sync_playwright() as p:
        if engine == "firefox":
            browser = p.firefox.launch(headless=True)
            suffix = "_ff"
        else:
            browser = p.chromium.launch(
                headless=True,
                args=["--use-gl=swiftshader", "--enable-unsafe-swiftshader",
                      "--ignore-gpu-blocklist", "--enable-webgl"],
            )
            suffix = ""
        page = browser.new_page(viewport={"width": 1280, "height": 720})
        page.on("pageerror", lambda e: errors.append(str(e)))
        page.on("console", lambda m: (errors if m.type == "error" else warnings).append(m.text))

        page.goto(url, wait_until="load")
        page.wait_for_timeout(1500)  # let three.js + first frames run
        page.screenshot(path=str(OUT / f"1_rest{suffix}.png"))

        # Accelerate for ~2.5s.
        page.keyboard.down("w")
        page.wait_for_timeout(2500)
        page.screenshot(path=str(OUT / f"2_throttle{suffix}.png"))

        # Steer left while still moving.
        page.keyboard.down("a")
        page.wait_for_timeout(1200)
        page.screenshot(path=str(OUT / f"3_steer{suffix}.png"))
        page.keyboard.up("a")
        page.keyboard.up("w")

        browser.close()
    httpd.shutdown()

    print(f"\nconsole errors: {len(errors)}")
    for e in errors[:30]:
        print("  ERR ", e)
    if warnings:
        print(f"console warnings: {len(warnings)}")
        for w in warnings[:10]:
            print("  warn", w)
    print(f"\nshots in {OUT}")
    sys.exit(1 if errors else 0)


if __name__ == "__main__":
    main()
