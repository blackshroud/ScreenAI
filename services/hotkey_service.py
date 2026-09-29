"""Global hotkeys for ScreenCopilot.

Uses pynput's GlobalHotKeys so the overlay can be controlled without ever
taking focus. Window actions (hide/show, ghost mode, opacity, movement) are
handled directly by the OverlayService. UI actions (screenshots, mute, reset,
scrolling) are executed in the page through a `run_js` callable, which main.py
wires to `window.evaluate_js`.

Default bindings (all Alt+):
    Z  hide/show           X  ghost mode (click-through)
    1/2/3  overlay opacity 40% / 70% / 100%
    S  capture screenshot  P  process screenshot queue   R  clear queue
    M  mute microphone     U  pause/resume all audio     O  reset session
    Left/Right/I/J  move window      Up/Down  scroll conversation
"""

import os
import threading
import time
from typing import Callable, Dict, Optional

from dotenv import dotenv_values
from pynput import keyboard

_ENV_FILE_VALUES = dotenv_values(".env")


def _env_setting(name: str, default: int, minimum: int) -> int:
    """Read an integer setting from the environment or .env, with a floor."""
    raw = os.environ.get(name) or _ENV_FILE_VALUES.get(name)
    if not raw:
        return default
    try:
        value = int(str(raw).strip())
    except ValueError:
        print(f"Invalid {name}={raw!r} in .env, using default {default}")
        return default
    return max(value, minimum)


SCROLL_AMOUNT_PX = _env_setting("SCROLL_SPEED_PX", 150, 1)
SCROLL_INTERVAL_MS = _env_setting("SCROLL_INTERVAL_MS", 50, 10)
MOVE_STEP_PX = 20

# JavaScript run inside the page for UI-level hotkeys. Every call is guarded so
# a missing function logs a warning instead of raising.
_JS = {
    "capture_screenshot": "window.screenshotService && window.screenshotService.captureScreenshot();",
    "process_screenshots": "window.screenshotService && window.screenshotService.processQueue();",
    "reset_screenshot_queue": "window.screenshotService && window.screenshotService.clearQueue();",
    "toggle_mic_mute": "window.toggleMicMute && window.toggleMicMute();",
    "toggle_universal_mute": "window.toggleUniversalMute && window.toggleUniversalMute();",
    "reset_session": "window.resetSession && window.resetSession();",
}


def _scroll_js(pixels: int) -> str:
    return (
        "var s=document.getElementById('conversation-stream');"
        f"if(s){{s.scrollBy({{top:{pixels},left:0,behavior:'smooth'}});}}"
    )


class HotkeyService:
    """Registers global hotkeys and routes them to the overlay or the page."""

    def __init__(self):
        self._overlay = None
        self._run_js: Optional[Callable[[str], object]] = None
        self._hotkeys: Optional[keyboard.GlobalHotKeys] = None
        self._release_listener: Optional[keyboard.Listener] = None
        self._scroll_direction = 0  # -1 up, 0 idle, 1 down
        self._scroll_lock = threading.Lock()
        self._scroll_thread: Optional[threading.Thread] = None

    # ------------------------------------------------------------------
    # Dispatch helpers
    # ------------------------------------------------------------------
    def _js(self, name: str) -> Callable[[], None]:
        def action():
            self._exec_js(_JS[name])
        return action

    def _exec_js(self, code: str) -> None:
        if self._run_js is None:
            return
        try:
            self._run_js(code)
        except Exception as exc:
            print(f"Hotkey JS execution failed: {exc}")

    def _opacity(self, level: str) -> Callable[[], None]:
        def action():
            # Only the 40% preset also turns on click-through; the others restore it.
            self._overlay.set_opacity_level(level)
            self._overlay.set_ghost_mode(level == "ghost")
        return action

    def _move(self, dx: int, dy: int) -> Callable[[], None]:
        def action():
            self._overlay.move_window(dx, dy)
        return action

    # ------------------------------------------------------------------
    # Continuous scrolling (Alt+Up / Alt+Down, stops on key release)
    # ------------------------------------------------------------------
    def _start_scroll(self, direction: int) -> Callable[[], None]:
        def action():
            with self._scroll_lock:
                self._scroll_direction = direction
                if self._scroll_thread and self._scroll_thread.is_alive():
                    return
                self._scroll_thread = threading.Thread(target=self._scroll_loop, daemon=True)
                self._scroll_thread.start()
        return action

    def _scroll_loop(self) -> None:
        while True:
            with self._scroll_lock:
                direction = self._scroll_direction
            if direction == 0:
                return
            self._exec_js(_scroll_js(direction * SCROLL_AMOUNT_PX))
            time.sleep(SCROLL_INTERVAL_MS / 1000.0)

    def _on_key_release(self, key) -> None:
        if key in (keyboard.Key.up, keyboard.Key.down):
            with self._scroll_lock:
                self._scroll_direction = 0

    # ------------------------------------------------------------------
    # Lifecycle
    # ------------------------------------------------------------------
    def _bindings(self) -> Dict[str, Callable[[], None]]:
        o = self._overlay
        return {
            "<alt>+z": o.toggle_visibility,
            "<alt>+x": o.toggle_ghost_mode,
            "<alt>+1": self._opacity("ghost"),
            "<alt>+2": self._opacity("semi"),
            "<alt>+3": self._opacity("opaque"),
            "<alt>+s": self._js("capture_screenshot"),
            "<alt>+p": self._js("process_screenshots"),
            "<alt>+r": self._js("reset_screenshot_queue"),
            "<alt>+m": self._js("toggle_mic_mute"),
            "<alt>+u": self._js("toggle_universal_mute"),
            "<alt>+o": self._js("reset_session"),
            "<alt>+<left>": self._move(-MOVE_STEP_PX, 0),
            "<alt>+<right>": self._move(MOVE_STEP_PX, 0),
            "<alt>+i": self._move(0, -MOVE_STEP_PX),
            "<alt>+j": self._move(0, MOVE_STEP_PX),
            "<alt>+<up>": self._start_scroll(-1),
            "<alt>+<down>": self._start_scroll(1),
        }

    def start(self, overlay_service, run_js: Callable[[str], object]) -> None:
        """Start listening. `run_js` executes JavaScript in the UI window."""
        if self._hotkeys is not None:
            return
        self._overlay = overlay_service
        self._run_js = run_js
        self._hotkeys = keyboard.GlobalHotKeys(self._bindings())
        self._hotkeys.daemon = True
        self._hotkeys.start()
        self._release_listener = keyboard.Listener(on_release=self._on_key_release)
        self._release_listener.daemon = True
        self._release_listener.start()
        print("Global hotkeys active")

    def stop(self) -> None:
        with self._scroll_lock:
            self._scroll_direction = 0
        for listener in (self._hotkeys, self._release_listener):
            if listener is not None:
                listener.stop()
        self._hotkeys = None
        self._release_listener = None


hotkey_service = HotkeyService()

