#!/usr/bin/env python3
"""Dark-mode screenshots of a published T1 Arc release, made on a CI emulator.

Run by .github/workflows/release-screenshots.yml inside a booted emulator.
It installs the published release APK on a fresh emulator profile, switches
the phone to dark mode, English (UK) and Europe/London, turns the network off,
chooses the app's built-in demo (example data) on first run and then visits
each screen of the shot list. Nothing is typed into the app except a
records question for Tarv1s and an invented food in an unsaved food draft.

Every screen is saved as an unmodified `adb exec-out screencap -p` PNG plus
its uiautomator layout, so a screen that went wrong can be fixed without
guessing. A screen that cannot be reached is reported and the run carries on.

Two optional settings, used for the website's pictures:

- SHOT_SET=website takes only the four tab screens (Today, History, Health
  and Tarv1s as it opens).
- DEMO_CLOCK=HH:MM sets the emulator's clock (UTC, today's date) just before
  the app is first opened. The demo's example data follows the time of day,
  so a fixed time gives the same readings on every run.
"""

from __future__ import annotations

import calendar
import hashlib
import json
import os
import re
import struct
import subprocess
import sys
import time
import zlib
import xml.etree.ElementTree as ET
from pathlib import Path
from typing import Callable

# The acceptance script reads these when it is imported; the same tag twice
# means "this release only".
TAG = os.environ.setdefault("RELEASE_TAG", "v1.8.0")
os.environ.setdefault("PREVIOUS_TAG", TAG)
os.environ.setdefault("RESULTS_DIR", "screenshot-results")
# `python3 -I` does not put the script's folder on the path.
sys.path.insert(0, str(Path(__file__).resolve().parent))

from emulator_acceptance import PACKAGE, CheckFailed, Device, normalise  # noqa: E402

RESULTS = Path(os.environ["RESULTS_DIR"])
APK = Path("apks") / f"T1-Arc-{TAG}.apk"
LOCALE = "en-GB"
TIME_ZONE = "Europe/London"
# "website" takes only the four tab screens; anything else takes the whole list.
SHOT_SET = "website" if os.environ.get("SHOT_SET", "").strip().lower() == "website" else "all"
# HH:MM (UTC) to set the emulator's clock to before the app is first opened; empty leaves the clock alone.
DEMO_CLOCK = os.environ.get("DEMO_CLOCK", "").strip()
# The demo makes a reading every five minutes and shows it three minutes later,
# so its newest reading is 3 minutes old when the phone's clock passes a multiple
# of five minutes and 8 minutes old just before the next one. The app marks a
# reading "Delayed" once it is more than 6 minutes old: the last two minutes of
# each five. Today is photographed early in a cycle, while the reading is current.
DEMO_CYCLE_SECONDS = 300
TODAY_START_BY_SECONDS = 75
TODAY_SHOOT_BY_SECONDS = 105
FICTIONAL_FOOD = {
    "name": "Demo yoghurt bowl",
    "amount": "100",
    "carbs": "24",
    "energy": "210",
    "protein": "12",
    "fat": "7",
}
TARVIS_QUESTIONS = (
    "What was my time in range over the last 7 days?",
    "What was my average glucose over the last 7 days?",
)


class ShotFailed(Exception):
    pass


class Shots(Device):
    """The acceptance Device with named final screenshots and a few extra gestures."""

    def __init__(self, results: Path) -> None:
        super().__init__(results)
        self.final = results / "final"
        self.final.mkdir(parents=True, exist_ok=True)
        self.steps = results / "steps"
        self.steps.mkdir(parents=True, exist_ok=True)

    # Evidence -----------------------------------------------------------

    def capture(self, name: str) -> tuple[Path, ET.Element | None]:
        """Save the final PNG and its layout under the shot-list name."""
        self.hide_keyboard()
        time.sleep(2.5)
        root = self.layout()
        data = subprocess.run(["adb", "exec-out", "screencap", "-p"], capture_output=True, timeout=60).stdout
        path = self.final / f"{name}.png"
        path.write_bytes(data)
        xml = self.raw_layout()
        if xml:
            (self.final / f"{name}.xml").write_text(xml, encoding="utf-8")
        return path, root

    def step(self, name: str) -> None:
        """A numbered working screenshot and layout, for fixing navigation."""
        self.counter += 1
        data = subprocess.run(["adb", "exec-out", "screencap", "-p"], capture_output=True, timeout=60).stdout
        (self.steps / f"{self.counter:03d}-{name}.png").write_bytes(data)
        xml = self.raw_layout()
        if xml:
            (self.steps / f"{self.counter:03d}-{name}.xml").write_text(xml, encoding="utf-8")

    def raw_layout(self) -> str:
        for _ in range(3):
            dumped = self.run("shell", "uiautomator dump /sdcard/t1arc-layout.xml", timeout=60, check=False)
            if "dumped to" in (dumped.stdout + dumped.stderr):
                return self.run("exec-out", "cat", "/sdcard/t1arc-layout.xml", timeout=60, check=False).stdout
            time.sleep(1)
        return ""

    # Gestures -----------------------------------------------------------

    def keyboard_shown(self) -> bool:
        output = self.shell("dumpsys input_method", check=False)
        return bool(re.search(r"mInputShown=true|isInputViewShown=true", output))

    def hide_keyboard(self) -> None:
        for _ in range(2):
            if not self.keyboard_shown():
                return
            self.shell("input keyevent KEYCODE_BACK", check=False)
            time.sleep(1.2)

    def open_link(self, url: str) -> None:
        self.shell(f"am start -W -a android.intent.action.VIEW -d '{url}' {PACKAGE}", check=False)
        time.sleep(3)

    def type_text(self, text: str) -> None:
        escaped = text.replace(" ", "%s").replace("?", "\\?").replace("'", "\\'").replace("&", "\\&")
        self.shell(f"input text '{escaped}'", check=False)
        time.sleep(1)

    def swipe_down(self) -> None:
        x = self.width // 2
        self.shell(f"input swipe {x} {int(self.height * 0.38)} {x} {int(self.height * 0.72)} 450", check=False)
        time.sleep(1.2)

    def find(self, root: ET.Element | None, *labels: str, exact: bool = True) -> tuple[int, int] | None:
        if root is None:
            return None
        for label in labels:
            point = self.locate(root, label, exact=exact)
            if point:
                return point
        return None

    def wait_any(self, labels: tuple[str, ...], timeout: int, *, exact: bool = True) -> tuple[str, ET.Element] | None:
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            root = self.layout()
            if root is not None:
                for label in labels:
                    if self.locate(root, label, exact=exact) or self.has_label(root, label):
                        return label, root
            time.sleep(1.5)
        return None

    def must_see(self, labels: tuple[str, ...], timeout: int, *, exact: bool = True, step: str) -> ET.Element:
        found = self.wait_any(labels, timeout, exact=exact)
        if not found:
            self.step(f"{step}-missing")
            raise ShotFailed(f"Did not see {' or '.join(map(repr, labels))} within {timeout} s.")
        return found[1]

    def tap_label(self, *labels: str, exact: bool = True, timeout: int = 20, step: str = "tap") -> None:
        root = self.must_see(labels, timeout, exact=exact, step=step)
        point = self.find(root, *labels, exact=exact)
        if point is None:
            raise ShotFailed(f"{labels[0]!r} is in the layout but not on screen.")
        self.tap_point(point)

    def scroll_find(self, *labels: str, exact: bool = True, swipes: int = 10, max_y: float = 0.85) -> ET.Element:
        for _ in range(swipes + 1):
            root = self.layout()
            point = self.find(root, *labels, exact=exact)
            if root is not None and point and point[1] < self.height * max_y:
                return root
            self.swipe_up()
        raise ShotFailed(f"Could not find {labels[0]!r} after scrolling.")

    def scroll_label_to(self, label: str, y_fraction: float, *, exact: bool = True) -> None:
        """Move the content so the label sits near a given height on the screen."""
        root = self.layout()
        point = self.find(root, label, exact=exact)
        if not point:
            return
        target = int(self.height * y_fraction)
        distance = point[1] - target
        if abs(distance) < 40:
            return
        x = self.width // 2
        start = int(self.height * 0.75) if distance > 0 else int(self.height * 0.3)
        end = max(int(self.height * 0.15), min(int(self.height * 0.85), start - distance))
        # A slow swipe moves the content by about the swipe distance, without flinging.
        self.shell(f"input swipe {x} {start} {x} {end} 1500", check=False)
        time.sleep(1.5)

    def foreign_packages(self, root: ET.Element | None) -> list[str]:
        if root is None:
            return ["layout unavailable"]
        packages = {node.get("package", "") for node in root.iter("node")}
        return sorted(p for p in packages if p and p not in (PACKAGE, "com.android.systemui"))


# PNG checks --------------------------------------------------------------


def png_facts(path: Path) -> dict:
    """Size and average brightness of an 8-bit RGB(A) PNG, using the standard library only."""
    data = path.read_bytes()
    if data[:8] != b"\x89PNG\r\n\x1a\n":
        raise ValueError("not a PNG")
    offset, idat, width = 8, b"", 0
    while offset < len(data):
        length, kind = struct.unpack(">I4s", data[offset:offset + 8])
        body = data[offset + 8:offset + 8 + length]
        if kind == b"IHDR":
            width, height, depth, colour = struct.unpack(">IIBB", body[:10])
        elif kind == b"IDAT":
            idat += body
        offset += 12 + length
    channels = {2: 3, 6: 4}.get(colour)
    if depth != 8 or channels is None:
        return {"width": width, "height": height, "meanLuma": None}
    raw = zlib.decompress(idat)
    stride = width * channels
    previous = bytearray(stride)
    total = count = 0
    position = 0
    for row in range(height):
        kind = raw[position]
        line = bytearray(raw[position + 1:position + 1 + stride])
        position += 1 + stride
        for i in range(stride):
            left = line[i - channels] if i >= channels else 0
            up = previous[i]
            if kind == 1:
                line[i] = (line[i] + left) & 255
            elif kind == 2:
                line[i] = (line[i] + up) & 255
            elif kind == 3:
                line[i] = (line[i] + ((left + up) >> 1)) & 255
            elif kind == 4:
                corner = previous[i - channels] if i >= channels else 0
                estimate = left + up - corner
                pa, pb, pc = abs(estimate - left), abs(estimate - up), abs(estimate - corner)
                line[i] = (line[i] + (left if pa <= pb and pa <= pc else up if pb <= pc else corner)) & 255
        previous = line
        if row % 8 == 0:
            for x in range(0, width, 8):
                r, g, b = line[x * channels:x * channels + 3]
                total += (299 * r + 587 * g + 114 * b) // 1000
                count += 1
    return {"width": width, "height": height, "meanLuma": round(total / max(count, 1), 1)}


# Phone set-up ------------------------------------------------------------


def wait_for_framework(device: Shots, timeout: int = 300) -> None:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        ready = device.prop("sys.boot_completed") == "1"
        services = device.shell("service check activity; service check package", check=False)
        if ready and services.count(": found") >= 2 and "package:" in device.shell("pm path android", check=False):
            time.sleep(8)
            return
        time.sleep(3)
    raise CheckFailed("Android did not come back after the restart.")


def prepare_phone(device: Shots) -> dict:
    facts: dict[str, str] = {}
    device.run("root", check=False)
    time.sleep(3)
    device.run("wait-for-device", timeout=120, check=False)
    device.shell(f"setprop persist.sys.locale {LOCALE}", check=False)
    device.shell(f"setprop persist.sys.timezone {TIME_ZONE}", check=False)
    # Restart Android's framework so the new locale is used everywhere.
    device.shell("stop", check=False)
    time.sleep(3)
    device.shell("start", check=False)
    time.sleep(10)
    wait_for_framework(device)
    device.shell("wm dismiss-keyguard", check=False)
    device.shell("input keyevent KEYCODE_WAKEUP", check=False)
    device.shell("settings put system font_scale 1.0", check=False)
    device.shell("settings put system screen_off_timeout 1800000", check=False)
    device.shell("svc power stayon true", check=False)
    device.shell("cmd uimode night yes", check=False)
    # Gesture navigation, as on a current Pixel.
    device.shell("cmd overlay enable com.android.internal.systemui.navbar.gestural", check=False)
    facts["network"] = device.go_offline()
    clean_status_bar(device)
    facts["locale"] = device.prop("persist.sys.locale")
    facts["timeZone"] = device.prop("persist.sys.timezone")
    facts["night"] = device.shell("cmd uimode night", check=False).strip()
    facts["fontScale"] = device.shell("settings get system font_scale", check=False).strip()
    facts["density"] = device.shell("wm density", check=False).strip()
    facts["size"] = device.shell("wm size", check=False).strip()
    device.read_screen_size()
    return facts


def set_clock(device: Shots, clock: str) -> str:
    """Set the emulator's clock to HH:MM (UTC) on today's date and say what happened.

    Needs the root shell that prepare_phone() asks for. If the clock cannot be
    set the run carries on at the real time, and the summary says so.
    """
    if not re.fullmatch(r"([01]\d|2[0-3]):[0-5]\d", clock):
        return f"not changed: DEMO_CLOCK must look like 11:57, not {clock!r}"
    today = time.gmtime()
    wanted = calendar.timegm((today.tm_year, today.tm_mon, today.tm_mday, int(clock[:2]), int(clock[3:]), 0))
    # Android must not put the clock back by itself.
    device.shell("settings put global auto_time 0", check=False)
    reported = ""
    for command in (time.strftime("date -u %m%d%H%M%Y.%S", time.gmtime(wanted)), f"date -u @{wanted}"):
        device.shell(command, check=False)
        reported = device.shell("date -u +%s", check=False).strip()
        if reported.isdigit() and 0 <= int(reported) - wanted < 120:
            return time.strftime("set to %H:%M UTC on %Y-%m-%d before the app was opened", time.gmtime(wanted))
    seen = time.strftime("%Y-%m-%d %H:%M UTC", time.gmtime(int(reported))) if reported.isdigit() else "nothing"
    return f"could not be set to {clock} UTC (the phone reports {seen}); the real time was used"


def clean_status_bar(device: Shots) -> None:
    device.shell("settings put global sysui_demo_allowed 1", check=False)
    commands = [
        "-e command enter",
        "-e command clock -e hhmm 1200",
        "-e command battery -e level 100 -e plugged false -e powersave false",
        "-e command network -e wifi show -e level 4 -e fully true",
        "-e command network -e mobile show -e datatype none -e level 4 -e fully true",
        "-e command network -e airplane hide",
        "-e command notifications -e visible false",
        "-e command status -e volume hide -e bluetooth hide -e location hide -e alarm hide -e sync hide -e mute hide -e speakerphone hide -e tty hide -e eri hide",
    ]
    for extra in commands:
        device.shell(f"am broadcast -a com.android.systemui.demo {extra}", check=False)
    time.sleep(1)


# The shot list -----------------------------------------------------------


class Session:
    def __init__(self, device: Shots) -> None:
        self.device = device
        self.results: dict[str, dict] = {}
        self.tabs: dict[str, tuple[int, int]] = {}

    def shot(self, name: str, action: Callable[[], str | None]) -> None:
        device = self.device
        print(f"--- {name}", flush=True)
        try:
            note = action() or ""
            path, root = device.capture(name)
            facts = png_facts(path)
            foreign = device.foreign_packages(root)
            demo_notice = bool(root is not None and device.has_label(root, "Demo · example data"))
            keyboard = device.keyboard_shown()
            status = "ok"
            problems = []
            if facts["meanLuma"] is not None and facts["meanLuma"] > 110:
                problems.append(f"looks light (mean brightness {facts['meanLuma']})")
            if foreign:
                problems.append("other app on screen: " + ", ".join(foreign))
            if keyboard:
                problems.append("keyboard shown")
            if problems:
                status = "check"
            self.results[name] = {
                "status": status, "note": note, "problems": problems, "demoNotice": demo_notice, **facts,
            }
        except (ShotFailed, CheckFailed, subprocess.TimeoutExpired) as error:
            device.step(f"{name}-failed")
            self.results[name] = {"status": "failed", "note": str(error)}
        print(f"    {self.results[name]}", flush=True)
        device.save_logcat(f"after-{name}")
        if device.problems_in_log():
            self.results[name].setdefault("problems", []).append("crash or ANR recorded in logcat")

    # Helpers ----------------------------------------------------------

    def go_tab(self, tab: str, *, to_top: bool = True) -> ET.Element:
        device = self.device
        device.hide_keyboard()
        point = self.tabs.get(tab)
        if point is None:
            raise ShotFailed(f"No {tab} tab position recorded.")
        device.tap_point(point)
        deadline = time.monotonic() + 30
        while time.monotonic() < deadline:
            root = device.layout()
            if root is not None and device.selected_tab(root) == tab:
                time.sleep(2)
                if to_top:
                    device.scroll_to_top()
                return device.layout() or root
            time.sleep(1.5)
        raise ShotFailed(f"The {tab} tab did not open.")

    def home_today(self) -> ET.Element:
        self.device.open_link("t1arc://today")
        return self.go_tab("Today")

    def settings_page(self, source: str, *markers: str) -> ET.Element:
        device = self.device
        device.hide_keyboard()
        device.open_link(f"t1arc://sources/{source}")
        root = device.must_see(markers, 30, exact=False, step=f"settings-{source}")
        device.scroll_to_top()
        return root

    # Shots ------------------------------------------------------------

    def first_run(self) -> None:
        device = self.device

        def onboarding() -> str:
            device.launch()
            device.must_see(("Skip tour",), 240, step="tour")
            time.sleep(4)
            return "First page of the first-run tour."

        self.shot("onboarding", onboarding)
        # Walk the rest of the tour for the working record, then choose the demo.
        root = device.wait_any(("Skip tour",), 30)
        if root:
            device.tap("Skip tour", root[1])
        root = device.must_see(("Explore the demo first",), 60, step="setup")
        device.step("setup")
        device.tap("Explore the demo first", root)
        root = device.wait_for_tab("Today", 180, name="today")
        for tab in ("Today", "History", "Health", "Tarv1s"):
            point = device.locate(root, tab, lowest=True)
            if point and point[1] > device.height * 0.75:
                self.tabs[tab] = point
        time.sleep(8)

    def cycle_seconds(self) -> int | None:
        """Seconds since the phone's clock last passed a multiple of five minutes."""
        output = self.device.shell("date +%s", check=False).strip()
        return int(output) % DEMO_CYCLE_SECONDS if output.isdigit() else None

    @staticmethod
    def reading_is_late(root: ET.Element | None) -> bool:
        """Whether the screen marks its reading as delayed or stale, or could not be read."""
        if root is None:
            return True
        for node in root.iter("node"):
            words = normalise(node.get("text", "") + " " + node.get("content-desc", ""))
            if "delayed" in words or "stale" in words:
                return True
        return False

    def today(self) -> str:
        """Today while the demo's newest reading is still current (see DEMO_CYCLE_SECONDS)."""
        device = self.device
        self.home_today()
        time.sleep(4)
        for _ in range(2):
            seconds = self.cycle_seconds()
            if seconds is None:
                return "Today, top of the screen. The phone's clock could not be read, so the reading may be marked Delayed."
            if seconds > TODAY_START_BY_SECONDS:
                wait = DEMO_CYCLE_SECONDS - seconds + 8
                print(f"    waiting {wait} s for the demo's next reading", flush=True)
                time.sleep(wait)
                # Coming back to the app makes it look for a newer reading.
                self.home_today()
                time.sleep(4)
            while True:
                root = device.layout()
                seconds = self.cycle_seconds()
                if seconds is None or seconds > TODAY_SHOOT_BY_SECONDS:
                    break
                if not self.reading_is_late(root):
                    return f"Today, top of the screen, {seconds} s into the demo's five-minute reading cycle."
                # The app also checks for a newer reading by itself once a minute.
                time.sleep(6)
            device.step("today-reading-late")
        return "Today, top of the screen. The demo's reading was still marked Delayed or Stale."

    def flag_late_reading(self, name: str) -> None:
        """Mark a shot for checking if its saved layout shows a delayed or stale reading."""
        result = self.results.get(name, {})
        layout = self.device.final / f"{name}.xml"
        if result.get("status") in (None, "failed") or not layout.exists():
            return
        try:
            root = ET.fromstring(layout.read_text(encoding="utf-8"))
        except ET.ParseError:
            return
        if self.reading_is_late(root):
            result["status"] = "check"
            result.setdefault("problems", []).append("the reading is marked Delayed or Stale")
            print(f"    {name}: the reading is marked Delayed or Stale", flush=True)

    def history(self) -> str:
        device = self.device
        self.go_tab("History")
        time.sleep(4)
        device.step("history-top")
        root = device.layout()
        if root is not None and not device.has_label(root, "Time in ranges"):
            # Bring the ranges card into view, keeping the summary above it if possible.
            try:
                device.scroll_find("Time in ranges", exact=False, swipes=4)
                device.scroll_label_to("Time in ranges", 0.45, exact=False)
                return "History scrolled so the Time in ranges card shows."
            except ShotFailed:
                device.scroll_to_top()
        return "History opening summary."

    def insights(self) -> str:
        device = self.device
        self.home_today()
        device.tap_label("Compare periods", step="compare")
        device.must_see(("7 days", "Compare"), 30, exact=False, step="compare-open")
        time.sleep(5)
        device.scroll_to_top()
        return "Compare periods from Today's menu (last 7 complete days with the 7 days before)."

    def tarvis_home(self) -> str:
        """The Tarv1s tab as it opens, before anything is typed."""
        self.go_tab("Tarv1s", to_top=False)
        time.sleep(4)
        return "Tarv1s tab as it opens, before a question is asked."

    def tarvis(self) -> str:
        device = self.device
        self.go_tab("Tarv1s")
        device.step("tarvis-home")
        answered = None
        for question in TARVIS_QUESTIONS:
            root = device.wait_any(("Question for Tarv1s", "Message Tarv1s"), 15)
            if not root:
                # The composer may sit behind a button on the workspace.
                for opener in ("Ask Tarv1s", "New conversation", "Start a conversation", "Message Tarv1s"):
                    point = device.find(device.layout(), opener, exact=False)
                    if point:
                        device.tap_point(point)
                        break
                root = device.must_see(("Question for Tarv1s", "Message Tarv1s"), 20, step="tarvis-composer")
            else:
                root = root[1]
            device.tap_point(device.find(root, "Question for Tarv1s", "Message Tarv1s"))
            device.type_text(question)
            device.step("tarvis-typed")
            send = device.find(device.layout(), "Send question")
            if send:
                device.tap_point(send)
            else:
                device.shell("input keyevent KEYCODE_ENTER", check=False)
            device.hide_keyboard()
            if device.wait_any(("View calculation and records",), 45, exact=False):
                answered = question
                break
            device.step("tarvis-no-records")
        if not answered:
            raise ShotFailed("Tarv1s did not show an answer with its records.")
        time.sleep(3)
        device.step("tarvis-answer")
        return f"Asked: {answered!r} (typed with adb). The answer is the app's own, with no AI key."

    def tarvis_records(self) -> str:
        device = self.device
        root = device.layout()
        if root is None or not device.has_label(root, "View calculation and records"):
            raise ShotFailed("The Tarv1s answer is not on screen.")
        device.tap_label("View calculation and records", exact=False, step="records")
        time.sleep(3)
        device.step("tarvis-records-open")
        return "Opened 'View calculation and records' under the same answer."

    def food(self) -> str:
        device = self.device
        device.open_link("t1arc://today/log-food")
        device.must_see(("Search foods and brands", "Enter a food yourself"), 40, step="food-open")
        device.step("food-open")
        device.tap_label("Enter a food yourself", step="food-enter")
        root = device.must_see(("Custom food name",), 20, step="food-form")
        device.step("food-form")
        device.tap_point(device.find(root, "Custom food name"))
        device.type_text(FICTIONAL_FOOD["name"])
        device.hide_keyboard()
        fields = (
            ("Custom food serving amount", "amount"),
            ("Custom food carbohydrate", "carbs"),
            ("Custom food carbs", "carbs"),
            ("Custom food energy", "energy"),
            ("Custom food calories", "energy"),
            ("Custom food protein", "protein"),
            ("Custom food fat", "fat"),
        )
        filled = set()
        for label, key in fields:
            if key in filled:
                continue
            try:
                root = device.scroll_find(label, exact=False, swipes=3, max_y=0.7)
            except ShotFailed:
                device.scroll_to_top()
                continue
            device.tap_point(device.find(root, label, exact=False))
            if key == "amount":
                device.shell("input keyevent KEYCODE_MOVE_END", check=False)
                for _ in range(6):
                    device.shell("input keyevent KEYCODE_DEL", check=False)
            device.type_text(FICTIONAL_FOOD[key])
            device.hide_keyboard()
            filled.add(key)
        device.step("food-filled")
        device.tap_label("Save this custom food in My Foods and add it to the current meal", step="food-add")
        time.sleep(3)
        device.step("food-added")
        device.must_see((FICTIONAL_FOOD["name"],), 20, exact=False, step="food-draft")
        device.scroll_to_top()
        device.scroll_find(FICTIONAL_FOOD["name"], exact=False, swipes=4)
        device.scroll_label_to(FICTIONAL_FOOD["name"], 0.55, exact=False)
        return (f"Unsaved meal draft with the invented food {FICTIONAL_FOOD['name']!r} "
                f"(filled: {', '.join(sorted(filled))}). The meal was not saved.")

    def close_food(self) -> None:
        device = self.device
        device.hide_keyboard()
        for _ in range(3):
            root = device.layout()
            point = device.find(root, "Close food logger")
            if not point:
                break
            device.tap_point(point)
            time.sleep(1.5)
            root = device.layout()
            for discard in ("Discard", "Discard meal", "Discard changes", "Leave without saving"):
                point = device.find(root, discard, exact=False)
                if point:
                    device.tap_point(point)
                    break
        device.step("food-closed")

    def health(self) -> str:
        device = self.device
        self.go_tab("Health")
        time.sleep(4)
        return "Health tab, top of the screen."

    def sleep(self) -> str:
        device = self.device
        self.go_tab("Health")
        root = device.scroll_find("Sleep", exact=True, swipes=8, max_y=0.8)
        device.step("health-sleep-card")
        device.tap_point(device.find(root, "Sleep"))
        time.sleep(4)
        device.step("sleep-open")
        return "Health, Sleep."

    def close_sleep(self) -> None:
        """Leave the Sleep screen. It covers the tabs, so the next screens could not be reached."""
        device = self.device
        root = device.layout()
        point = device.find(root, "Close Sleep")
        if point:
            device.tap_point(point)
        elif root is not None and device.selected_tab(root) is None:
            device.back()
        time.sleep(1.5)
        device.step("sleep-closed")

    def settings_home(self) -> str:
        device = self.device
        device.open_link("t1arc://sources")
        device.must_see(("Glucose source",), 30, step="settings-home")
        device.scroll_to_top()
        return "Settings home."

    def bedside(self) -> str:
        device = self.device
        self.home_today()
        device.tap_label("Bedside view", step="bedside")
        time.sleep(5)
        return "Bedside view from Today's menu."

    def close_bedside(self) -> None:
        device = self.device
        device.back()
        time.sleep(1)
        root = device.layout()
        if root is not None and device.selected_tab(root) is None:
            device.back()

    def overnight(self) -> str:
        device = self.device
        self.home_today()
        root = device.layout()
        if root is None or not any("overnight" in normalise(node.get("text", "") + node.get("content-desc", ""))
                                   for node in root.iter("node")):
            device.step("today-no-overnight")
            # Look further down Today.
            for _ in range(6):
                device.swipe_up()
                root = device.layout()
                if root is not None and any(normalise(node.get("content-desc", "")).endswith("summary")
                                            and "night" in normalise(node.get("content-desc", ""))
                                            for node in root.iter("node")):
                    break
            else:
                raise ShotFailed("The demo did not show an overnight summary on Today.")
        return "Today with the overnight summary card."

    def cycle(self) -> str:
        device = self.device
        device.open_link("t1arc://cycle")
        device.must_see(("Cycle tracking",), 30, step="cycle")
        time.sleep(3)
        return "Cycle tracking as the demo leaves it."

    def watch(self) -> None:
        device = self.device

        def prepare() -> str:
            self.settings_page("watch", "Watch", "Set up my watch")
            root = device.scroll_find("Set up my watch", "Install or update watch companion", swipes=6)
            device.tap_point(device.find(root, "Set up my watch", "Install or update watch companion"))
            device.must_see(("Prepare your watch",), 20, step="watch-prepare")
            return "Watch guide, step 1."

        self.shot("watch-prepare", prepare)

        def brand(label: str) -> Callable[[], str]:
            def action() -> str:
                root = device.layout()
                if root is None or not device.has_label(root, "Enable developer options"):
                    device.tap_label("Continue", step="watch-continue")
                    device.must_see(("Enable developer options",), 20, step="watch-step2")
                device.tap_label(label, exact=False, step=f"watch-{label}")
                time.sleep(2)
                return f"Watch guide, step 2 with {label} chosen."
            return action

        self.shot("watch-samsung", brand("Samsung Galaxy Watch"))
        self.shot("watch-pixel", brand("Google Pixel Watch"))
        device.back()
        device.back()

    def run(self) -> None:
        device = self.device
        self.first_run()
        self.shot("today", self.today)
        self.flag_late_reading("today")
        if SHOT_SET == "website":
            # The four tab screens only, in the order the website shows them.
            self.shot("history", self.history)
            self.shot("health", self.health)
            self.shot("tarvis-home", self.tarvis_home)
            return
        self.shot("overnight-summary", self.overnight)
        self.shot("history", self.history)
        self.shot("insights", self.insights)
        self.shot("health", self.health)
        self.shot("sleep", self.sleep)
        self.close_sleep()
        self.shot("tarvis-home", self.tarvis_home)
        self.shot("tarvis", self.tarvis)
        if self.results["tarvis"]["status"] != "failed":
            self.shot("tarvis-records", self.tarvis_records)
        self.shot("food-logging", self.food)
        self.close_food()
        self.shot("bedside", self.bedside)
        self.close_bedside()
        self.shot("cycle-tracking", self.cycle)
        self.shot("settings-home", self.settings_home)
        self.shot("sources", lambda: (self.settings_page("glucose", "AAPS on this phone", "Glucose source"), "Settings, Glucose source.")[1])
        self.shot("aaps-source", lambda: (self.settings_page("aaps", "AAPS"), "Settings, Glucose source, AAPS on this phone (not connected).")[1])
        self.shot("alarms", lambda: (self.settings_page("alarms", "Alarms", "alarm"), "Settings, Alarms.")[1])
        self.shot("regional-settings", lambda: (self.settings_page("region", "Units and region", "mmol/L"), "Settings, Units and region.")[1])
        self.shot("display-settings", lambda: (self.settings_page("appearance", "Glucose ranges", "System"), "Settings, Appearance (glucose ranges entry and theme).")[1])

        def colours() -> str:
            self.settings_page("appearance", "Glucose ranges")
            device.tap_label("Glucose ranges", step="ranges")
            time.sleep(3)
            return "Settings, Appearance, Glucose ranges (target range, levels and colours)."

        self.shot("glucose-colours", colours)
        device.back()
        self.shot("backup-privacy", lambda: (self.settings_page("privacy", "Backup", "backup"), "Settings, Backup and privacy.")[1])
        self.shot("phone-widget", lambda: (self.settings_page("phone", "widget", "Widget"), "Settings, Phone, widget and car (extra, for reference).")[1])
        self.shot("notifications", lambda: (self.settings_page("notifications", "Notifications", "reminder"), "Settings, Notifications and reminders (extra, for reference).")[1])
        self.watch()


def main() -> int:
    RESULTS.mkdir(parents=True, exist_ok=True)
    device = Shots(RESULTS)
    facts: dict = {
        "release": device.prop("ro.build.version.release"),
        "sdk": device.prop("ro.build.version.sdk"),
        "abi": device.prop("ro.product.cpu.abi"),
        "abilist": device.prop("ro.product.cpu.abilist"),
        "model": device.prop("ro.product.model"),
        "image": device.prop("ro.build.fingerprint"),
    }
    session = None
    try:
        facts.update(prepare_phone(device))
        device.uninstall()
        device.install(APK, replace=False)
        facts["installed"] = "%s (%s)" % device.installed_version()
        facts["shotSet"] = SHOT_SET
        device.clear_logcat()
        if DEMO_CLOCK:
            facts["clock"] = set_clock(device, DEMO_CLOCK)
            print(f"Emulator clock: {facts['clock']}", flush=True)
        session = Session(device)
        session.run()
    except (CheckFailed, ShotFailed, subprocess.TimeoutExpired) as error:
        facts["error"] = str(error)
        device.step("stopped")
        print(f"Stopped: {error}", flush=True)
    finally:
        device.save_logcat("final")
        shots = session.results if session else {}
        (RESULTS / "results.json").write_text(json.dumps({"device": facts, "shots": shots}, indent=2), encoding="utf-8")
        lines = [f"## Release screenshots: T1 Arc {TAG}", "",
                 f"- Emulator: Android {facts.get('release')} (API {facts.get('sdk')}), {facts.get('model')}",
                 f"- Locale {facts.get('locale')}, time zone {facts.get('timeZone')}, {facts.get('night')}, "
                 f"font scale {facts.get('fontScale')}", f"- Installed: {facts.get('installed')}"]
        if facts.get("shotSet") == "website":
            lines.append("- Screens: the four tab screens only (SHOT_SET=website)")
        if facts.get("clock"):
            lines.append(f"- Emulator clock: {facts['clock']}")
        lines.append("")
        if facts.get("error"):
            lines += [f"**Stopped early:** {facts['error']}", ""]
        lines += ["| Screen | Status | Demo notice | Brightness | Note |", "| --- | --- | --- | --- | --- |"]
        for name, result in shots.items():
            note = (result.get("note", "") + " " + "; ".join(result.get("problems", []))).replace("|", "\\|")
            lines.append(f"| {name} | {result['status']} | {result.get('demoNotice', '')} | {result.get('meanLuma', '')} | {note} |")
        (RESULTS / "summary.md").write_text("\n".join(lines) + "\n", encoding="utf-8")
        print("\n".join(lines))
    # The run passes when it got this far; the summary says which screens need work.
    return 1 if facts.get("error") else 0


if __name__ == "__main__":
    sys.exit(main())
