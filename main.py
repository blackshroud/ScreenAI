"""ScreenCopilot - a floating, capture-hidden AI assistant overlay.

Architecture: pywebview owns the main thread; FastAPI/uvicorn and the other
asyncio services run in a background thread. Window behaviour lives in
services/overlay_service.py and global hotkeys in services/hotkey_service.py.
"""

import asyncio
import os
import shutil
import socket
import threading
import time
from pathlib import Path

# --- Auto-create .env from .env.example if missing ---
# Must run BEFORE first-party imports: core.config and hotkey_service read .env
# at import time.
_env_path = Path(".env")
_env_example_path = Path(".env.example")

if not _env_path.exists() and _env_example_path.exists():
    shutil.copy2(_env_example_path, _env_path)
    print("Created .env from .env.example - please fill in your API keys!")
elif not _env_path.exists():
    print("No .env or .env.example found. The app may fail to start without a .env file.")

import uvicorn
import webview
from fastapi import FastAPI, Request
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from api import websocket, config_api
from api.session_manager import session_manager
from core.config import settings, print_config_debug
from services.hotkey_service import hotkey_service
from services.overlay_service import overlay_service

APP_TITLE = "ScreenCopilot"


def find_free_port(preferred: int = 8002) -> int:
    """Check if the preferred port is available; if not, find a free one."""
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        try:
            s.bind(("127.0.0.1", preferred))
            return preferred
        except OSError:
            pass
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind(("127.0.0.1", 0))
        port = s.getsockname()[1]
    print(f"Port {preferred} is busy, using port {port} instead")
    return port


# DEV_MODE is controlled via .env - see core/config.py. When True the window is
# NOT hidden from screen capture, so it can be inspected while developing.
DEV_MODE = settings.DEV_MODE
print_config_debug()

# --- FastAPI app ---
app = FastAPI()
app.include_router(websocket.router)
app.include_router(config_api.router)

# Serve web/css and web/js under /static
app.mount("/static", StaticFiles(directory="web"), name="static")


@app.get("/")
async def read_index(request: Request):
    """Serve the main index.html file."""
    return FileResponse(os.path.join("web", "index.html"))


# --- Async services (run in a background thread) ---
class AsyncioServiceThread:
    """Runs uvicorn and the session cleanup task on a dedicated event loop."""

    def __init__(self, app: FastAPI, port: int):
        self.app = app
        self.port = port
        self.thread = None
        self.loop = None
        self.server = None
        self.shutdown_event = threading.Event()

    def start(self):
        self.thread = threading.Thread(target=self._run, daemon=True)
        self.thread.start()

    def stop(self):
        self.shutdown_event.set()
        if self.thread and self.thread.is_alive():
            self.thread.join(timeout=10)

    def _run(self):
        self.loop = asyncio.new_event_loop()
        asyncio.set_event_loop(self.loop)
        try:
            self.loop.run_until_complete(self._serve())
        except Exception as exc:
            print(f"Error in asyncio thread: {exc}")
        finally:
            pending = asyncio.all_tasks(self.loop)
            for task in pending:
                task.cancel()
            if pending:
                self.loop.run_until_complete(asyncio.gather(*pending, return_exceptions=True))
            self.loop.close()

    async def _serve(self):
        config = uvicorn.Config(
            self.app, host="127.0.0.1", port=self.port, log_level="warning", loop="asyncio"
        )
        self.server = uvicorn.Server(config)
        server_task = asyncio.create_task(self.server.serve())
        session_manager.start_cleanup_task()
        print(f"Server started on http://127.0.0.1:{self.port}")

        while not self.shutdown_event.is_set() and not server_task.done():
            await asyncio.sleep(0.1)

        self.server.should_exit = True
        try:
            await asyncio.wait_for(server_task, timeout=5.0)
        except asyncio.TimeoutError:
            server_task.cancel()


# --- Webview (main thread) ---
def run_js_in_window(window):
    """Build the callable the hotkey service uses to run JavaScript in the UI."""
    def run(code: str):
        return window.evaluate_js(code)
    return run


def setup_webview_window(port: int) -> webview.Window:
    window = webview.create_window(
        APP_TITLE,
        f"http://127.0.0.1:{port}",
        width=1000,
        height=750,
        resizable=True,
    )

    def on_shown():
        # Give the native window time to finish registering with the OS.
        time.sleep(1.0)
        if overlay_service.attach(window):
            overlay_service.hide_from_taskbar()
            overlay_service.set_always_on_top(True)
            if DEV_MODE:
                print("DEV_MODE is True: capture protection skipped, window is visible in recordings")
            elif overlay_service.apply_capture_protection(window):
                print("Window is hidden from screen capture")
            else:
                print("WARNING: capture protection failed - window may be visible in recordings")
        else:
            print("WARNING: native window not found; overlay features unavailable")

        hotkey_service.start(overlay_service, run_js_in_window(window))

    def on_closing():
        hotkey_service.stop()
        return True

    window.events.shown += on_shown
    window.events.closing += on_closing
    return window


def main():
    print(f"Starting {APP_TITLE}...")
    port = find_free_port()
    services = AsyncioServiceThread(app, port)

    try:
        services.start()
        time.sleep(2)  # let the server come up before the window loads it
        setup_webview_window(port)
        webview.start(debug=DEV_MODE)
    except KeyboardInterrupt:
        print("Interrupted by user")
    except Exception as exc:
        print(f"Application error: {exc}")
    finally:
        hotkey_service.stop()
        services.stop()
        print("Shutdown complete")


if __name__ == "__main__":
    main()

