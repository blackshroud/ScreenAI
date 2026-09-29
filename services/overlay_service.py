"""Overlay window management for ScreenCopilot (Win32).

Responsibilities:
  * Exclude the window from screen capture (WDA_EXCLUDEFROMCAPTURE) so it does
    not show up in Zoom / Teams / OBS captures.
  * Hide the window from the taskbar and Alt+Tab (WS_EX_TOOLWINDOW).
  * Ghost mode: click-through (WS_EX_TRANSPARENT) so mouse input reaches the
    apps underneath.
  * Overlay opacity, always-on-top, show/hide without stealing focus, and
    keyboard-driven window movement.

On non-Windows platforms every operation is a safe no-op that returns False.
"""

import ctypes
import ctypes.wintypes as wintypes
import platform
import time
from typing import Dict, Optional

IS_WINDOWS = platform.system() == "Windows"

# --- Win32 constants ---
WDA_NONE = 0x00000000
WDA_EXCLUDEFROMCAPTURE = 0x00000011

GWL_EXSTYLE = -20
WS_EX_LAYERED = 0x00080000
WS_EX_TRANSPARENT = 0x00000020
WS_EX_TOOLWINDOW = 0x00000080
WS_EX_APPWINDOW = 0x00040000
LWA_ALPHA = 0x00000002

HWND_TOPMOST = -1
HWND_NOTOPMOST = -2
SWP_NOSIZE = 0x0001
SWP_NOMOVE = 0x0002
SWP_NOZORDER = 0x0004
SWP_NOACTIVATE = 0x0010
SWP_FRAMECHANGED = 0x0020

SW_HIDE = 0
SW_SHOWNOACTIVATE = 4

# Named opacity presets (percent). Used by the hotkeys and the UI.
OPACITY_LEVELS: Dict[str, int] = {"ghost": 40, "semi": 70, "opaque": 100}


class _RECT(ctypes.Structure):
    _fields_ = [
        ("left", wintypes.LONG),
        ("top", wintypes.LONG),
        ("right", wintypes.LONG),
        ("bottom", wintypes.LONG),
    ]


def _load_user32():
    """Load user32 with explicit signatures (needed for 64-bit correctness)."""
    user32 = ctypes.WinDLL("user32", use_last_error=True)

    user32.FindWindowW.restype = wintypes.HWND
    user32.FindWindowW.argtypes = (wintypes.LPCWSTR, wintypes.LPCWSTR)
    user32.IsWindow.restype = wintypes.BOOL
    user32.IsWindow.argtypes = (wintypes.HWND,)
    user32.IsWindowVisible.restype = wintypes.BOOL
    user32.IsWindowVisible.argtypes = (wintypes.HWND,)
    user32.ShowWindow.restype = wintypes.BOOL
    user32.ShowWindow.argtypes = (wintypes.HWND, ctypes.c_int)
    user32.GetWindowRect.restype = wintypes.BOOL
    user32.GetWindowRect.argtypes = (wintypes.HWND, ctypes.POINTER(_RECT))
    user32.SetWindowPos.restype = wintypes.BOOL
    user32.SetWindowPos.argtypes = (
        wintypes.HWND, wintypes.HWND, ctypes.c_int, ctypes.c_int,
        ctypes.c_int, ctypes.c_int, wintypes.UINT,
    )
    user32.SetWindowDisplayAffinity.restype = wintypes.BOOL
    user32.SetWindowDisplayAffinity.argtypes = (wintypes.HWND, wintypes.DWORD)
    user32.SetLayeredWindowAttributes.restype = wintypes.BOOL
    user32.SetLayeredWindowAttributes.argtypes = (
        wintypes.HWND, wintypes.COLORREF, ctypes.c_ubyte, wintypes.DWORD,
    )

    # The *Ptr variants only exist on 64-bit Windows; 32-bit uses the plain ones.
    get_long = getattr(user32, "GetWindowLongPtrW", None) or user32.GetWindowLongW
    set_long = getattr(user32, "SetWindowLongPtrW", None) or user32.SetWindowLongW
    get_long.restype = ctypes.c_ssize_t
    get_long.argtypes = (wintypes.HWND, ctypes.c_int)
    set_long.restype = ctypes.c_ssize_t
    set_long.argtypes = (wintypes.HWND, ctypes.c_int, ctypes.c_ssize_t)
    return user32, get_long, set_long


if IS_WINDOWS:
    _user32, _get_long, _set_long = _load_user32()
    _get_display_affinity = getattr(_user32, "GetWindowDisplayAffinity", None)
    if _get_display_affinity is not None:
        _get_display_affinity.restype = wintypes.BOOL
        _get_display_affinity.argtypes = (wintypes.HWND, ctypes.POINTER(wintypes.DWORD))
else:
    _user32 = _get_long = _set_long = _get_display_affinity = None


class OverlayService:
    """Controls the native window that hosts the ScreenCopilot UI."""

    def __init__(self, window_title: str = "ScreenCopilot"):
        self.window_title = window_title
        self.hwnd: Optional[int] = None
        self.opacity_percent: int = 100
        self.is_ghost_mode: bool = False
        self.always_on_top: bool = False

    # ------------------------------------------------------------------
    # Window handle
    # ------------------------------------------------------------------
    def attach(self, window=None, retries: int = 10, delay: float = 0.2) -> bool:
        """Locate the native window handle.

        Tries pywebview's private ``_hwnd`` first, then falls back to a title
        search with retries (the native window can lag behind the 'shown' event).
        """
        if not IS_WINDOWS:
            return False

        hwnd = getattr(window, "_hwnd", None) if window is not None else None
        for _ in range(max(1, retries)):
            if not hwnd:
                hwnd = _user32.FindWindowW(None, self.window_title)
            if hwnd:
                self.hwnd = int(hwnd)
                return True
            time.sleep(delay)
        print(f"Could not find a window titled '{self.window_title}'")
        return False

    def _ready(self) -> bool:
        return IS_WINDOWS and bool(self.hwnd) and bool(_user32.IsWindow(self.hwnd))

    # ------------------------------------------------------------------
    # Capture exclusion (hidden from Zoom / Teams / OBS)
    # ------------------------------------------------------------------
    def apply_capture_protection(self, window=None) -> bool:
        """Exclude the window from screen capture and remove it from the taskbar."""
        if not self._ready() and not self.attach(window):
            return False
        if not _user32.SetWindowDisplayAffinity(self.hwnd, WDA_EXCLUDEFROMCAPTURE):
            print(f"SetWindowDisplayAffinity failed (error {ctypes.get_last_error()})")
            return False
        self.hide_from_taskbar()
        self.verify_protection()
        return True

    def remove_capture_protection(self) -> bool:
        if not self._ready():
            return False
        return bool(_user32.SetWindowDisplayAffinity(self.hwnd, WDA_NONE))

    def verify_protection(self) -> Optional[bool]:
        """Read the display affinity back. None means it could not be verified."""
        if not self._ready() or _get_display_affinity is None:
            return None
        affinity = wintypes.DWORD(0)
        if not _get_display_affinity(self.hwnd, ctypes.byref(affinity)):
            return None
        return affinity.value == WDA_EXCLUDEFROMCAPTURE

    # ------------------------------------------------------------------
    # Extended styles: taskbar hiding, layered, click-through
    # ------------------------------------------------------------------
    def _modify_ex_style(self, add: int = 0, remove: int = 0) -> bool:
        if not self._ready():
            return False
        style = _get_long(self.hwnd, GWL_EXSTYLE)
        _set_long(self.hwnd, GWL_EXSTYLE, (style | add) & ~remove)
        # Make Windows re-read the frame so the taskbar entry updates.
        _user32.SetWindowPos(
            self.hwnd, None, 0, 0, 0, 0,
            SWP_NOMOVE | SWP_NOSIZE | SWP_NOZORDER | SWP_NOACTIVATE | SWP_FRAMECHANGED,
        )
        return True

    def hide_from_taskbar(self) -> bool:
        """Set WS_EX_TOOLWINDOW so the window has no taskbar / Alt+Tab entry."""
        return self._modify_ex_style(add=WS_EX_TOOLWINDOW, remove=WS_EX_APPWINDOW)

    def set_ghost_mode(self, enabled: bool) -> bool:
        """Ghost mode: mouse clicks pass through the overlay to the apps below."""
        if enabled:
            ok = self._modify_ex_style(add=WS_EX_LAYERED | WS_EX_TRANSPARENT)
        else:
            ok = self._modify_ex_style(add=WS_EX_LAYERED, remove=WS_EX_TRANSPARENT)
        if ok:
            self.is_ghost_mode = enabled
            if enabled:
                self.set_always_on_top(True)
            self.set_opacity(self.opacity_percent)  # re-apply alpha after style change
        return ok

    def toggle_ghost_mode(self) -> bool:
        return self.set_ghost_mode(not self.is_ghost_mode)


    # ------------------------------------------------------------------
    # Overlay opacity
    # ------------------------------------------------------------------
    def set_opacity(self, percent: int) -> bool:
        """Set overlay opacity, clamped to 10-100 percent."""
        percent = max(10, min(100, int(percent)))
        if not self._ready():
            return False
        if not self._modify_ex_style(add=WS_EX_LAYERED):
            return False
        alpha = int(round(percent * 255 / 100))
        if not _user32.SetLayeredWindowAttributes(self.hwnd, 0, alpha, LWA_ALPHA):
            print(f"SetLayeredWindowAttributes failed (error {ctypes.get_last_error()})")
            return False
        self.opacity_percent = percent
        return True

    def set_opacity_level(self, level: str) -> bool:
        """Apply a named preset: 'ghost' (40%), 'semi' (70%), 'opaque' (100%)."""
        if level not in OPACITY_LEVELS:
            print(f"Unknown opacity level '{level}'")
            return False
        return self.set_opacity(OPACITY_LEVELS[level])

    def adjust_opacity(self, delta: int) -> bool:
        return self.set_opacity(self.opacity_percent + delta)

    # ------------------------------------------------------------------
    # Z-order, visibility and movement
    # ------------------------------------------------------------------
    def set_always_on_top(self, on_top: bool) -> bool:
        if not self._ready():
            return False
        ok = bool(_user32.SetWindowPos(
            self.hwnd, HWND_TOPMOST if on_top else HWND_NOTOPMOST,
            0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE,
        ))
        if ok:
            self.always_on_top = on_top
        return ok

    def toggle_visibility(self) -> bool:
        """Show/hide without taking keyboard focus from the active app."""
        if not self._ready():
            return False
        if _user32.IsWindowVisible(self.hwnd):
            _user32.ShowWindow(self.hwnd, SW_HIDE)
        else:
            _user32.ShowWindow(self.hwnd, SW_SHOWNOACTIVATE)
            self.set_always_on_top(True)
        return True

    def move_window(self, dx: int, dy: int) -> bool:
        """Move the window by a pixel offset without activating it."""
        if not self._ready():
            return False
        rect = _RECT()
        if not _user32.GetWindowRect(self.hwnd, ctypes.byref(rect)):
            return False
        return bool(_user32.SetWindowPos(
            self.hwnd, None, rect.left + dx, rect.top + dy, 0, 0,
            SWP_NOSIZE | SWP_NOZORDER | SWP_NOACTIVATE,
        ))

    def get_state(self) -> Dict[str, object]:
        return {
            "attached": self._ready(),
            "opacity": self.opacity_percent,
            "ghost_mode": self.is_ghost_mode,
            "always_on_top": self.always_on_top,
            "capture_protected": self.verify_protection(),
        }


overlay_service = OverlayService()

