#!/usr/bin/env python3
"""Emulator acceptance checks for signed T1 Arc release APKs.

Run by .github/workflows/emulator-acceptance.yml inside a booted emulator.
It drives the app with adb and uiautomator only, connects no data source,
saves one invented sensor-change record and keeps the emulator offline, so no
personal data, accounts or usage counts are involved. Screenshots, screen
layouts, logcat and a Markdown summary are written to RESULTS_DIR and uploaded
as the run's artifact.
"""

from __future__ import annotations

import hashlib
import json
import os
import re
import subprocess
import sys
import time
import xml.etree.ElementTree as ET
from dataclasses import dataclass
from pathlib import Path
from typing import Callable

PACKAGE = "io.github.gregorgregor25.t1arc"
# Bottom tab labels used by recent releases ("Insights" became "Tarv1s").
TAB_NAMES = ("Today", "History", "Health", "Tarv1s", "Insights")
# The invented record: a Dexcom G6 sensor change. With no glucose source
# connected, Today shows a recorded sensor change only while its warm-up runs;
# a G6 warms up for two hours, far longer than this check takes.
SENSOR_MODEL = "Dexcom G6"
SENSOR_WARMUP_MINUTES = 120
SENSOR_TITLE = f"{SENSOR_MODEL} warming up"
SENSOR_DETAIL_PREFIX = "Readings expected from"
BOUNDS = re.compile(r"\[(-?\d+),(-?\d+)\]\[(-?\d+),(-?\d+)\]")
TIME_AT_END = re.compile(r"(\d{1,2}):(\d{2})(?: ([ap]m))?$")
COMMIT = re.compile(r"[0-9a-f]{40}")


def require_env(name: str, default: str | None = None) -> str:
    value = os.environ.get(name, default)
    if not value:
        raise SystemExit(f"Missing environment variable {name}.")
    return value


RELEASE_TAG = require_env("RELEASE_TAG")
PREVIOUS_TAG = require_env("PREVIOUS_TAG")
# The same tag twice reinstalls one release over itself: a test of this
# check, not an upgrade.
UPGRADE = RELEASE_TAG != PREVIOUS_TAG
RESULTS = Path(require_env("RESULTS_DIR", "emulator-results"))
NEW_APK = Path("apks/new") / f"T1-Arc-{RELEASE_TAG}.apk"
OLD_APK = Path("apks/old") / f"T1-Arc-{PREVIOUS_TAG}.apk"


class CheckFailed(Exception):
    """A check did not pass; the message explains what was seen."""


@dataclass
class Result:
    name: str
    status: str  # "Pass", "Fail" or "Not run"
    detail: str = ""


def normalise(text: str) -> str:
    return " ".join(text.split()).casefold()


def version_tuple(version: str) -> tuple[int, ...]:
    return tuple(int(part) for part in re.findall(r"\d+", version)[:3])


def clock_minutes(text: str) -> int | None:
    """Minutes after midnight for a time such as '3:06 pm' or '15:06' ending normalised text."""
    match = TIME_AT_END.search(text)
    if not match:
        return None
    hour, minute, half = int(match.group(1)), int(match.group(2)), match.group(3)
    if minute > 59 or (half and not 1 <= hour <= 12) or (not half and hour > 23):
        return None
    if half:
        hour = hour % 12 + (12 if half == "pm" else 0)
    return hour * 60 + minute


def read_build_record(tag: str, folder: str) -> dict:
    """The build record attached to a release, checked against its tag and its APK."""
    apk = Path("apks") / folder / f"T1-Arc-{tag}.apk"
    path = apk.with_name(f"{apk.name}.build.json")
    try:
        record = json.loads(path.read_text(encoding="utf-8-sig"))
        digest = hashlib.sha256(apk.read_bytes()).hexdigest()
    except (OSError, ValueError) as error:
        raise CheckFailed(f"The {tag} release files could not be read: {error}.") from error
    if not isinstance(record, dict):
        raise CheckFailed(f"{path.name} is not a JSON object.")
    problems = []
    if record.get("version") != tag[1:]:
        problems.append(f"version is {record.get('version')!r}, not {tag[1:]!r}")
    code = record.get("versionCode")
    if type(code) is not int or code < 1:
        problems.append(f"versionCode {code!r} is not a positive whole number")
    commit = record.get("sourceCommit")
    if not isinstance(commit, str) or not COMMIT.fullmatch(commit):
        problems.append("sourceCommit is not a full commit hash")
    if record.get("applicationId") != PACKAGE:
        problems.append(f"applicationId is {record.get('applicationId')!r}")
    if record.get("apk") != apk.name:
        problems.append(f"apk is {record.get('apk')!r}, not {apk.name!r}")
    if record.get("sha256") != digest:
        problems.append("its sha256 does not match the downloaded APK")
    if problems:
        raise CheckFailed(f"{path.name}: " + "; ".join(problems) + ".")
    return record


def check_release_files() -> tuple[dict, dict, str]:
    new = read_build_record(RELEASE_TAG, "new")
    old = read_build_record(PREVIOUS_TAG, "old")
    if UPGRADE and (version_tuple(new["version"]) <= version_tuple(old["version"])
                    or new["versionCode"] <= old["versionCode"]):
        raise CheckFailed(
            f"{RELEASE_TAG} ({new['version']}, code {new['versionCode']}) is not newer than "
            f"{PREVIOUS_TAG} ({old['version']}, code {old['versionCode']})."
        )

    def describe(tag: str, record: dict) -> str:
        return f"{tag} is {record['version']} ({record['versionCode']}) from {record['sourceCommit'][:12]}"

    described = [describe(RELEASE_TAG, new)] + ([describe(PREVIOUS_TAG, old)] if UPGRADE else [])
    return new, old, "; ".join(described) + ". Each APK matches the SHA-256 in its build record."


class Device:
    def __init__(self, results: Path) -> None:
        self.screens = results / "screenshots"
        self.layouts = results / "layouts"
        self.logs = results / "logs"
        for folder in (self.screens, self.layouts, self.logs):
            folder.mkdir(parents=True, exist_ok=True)
        self.counter = 0
        self.width = 1080
        self.height = 2400

    # adb plumbing -------------------------------------------------------

    def run(self, *args: str, timeout: int = 120, check: bool = True) -> subprocess.CompletedProcess[str]:
        completed = subprocess.run(
            ["adb", *args],
            capture_output=True,
            encoding="utf-8",
            errors="replace",
            timeout=timeout,
        )
        if check and completed.returncode != 0:
            message = (completed.stderr or completed.stdout).strip()
            raise CheckFailed(f"adb {' '.join(args)} failed: {message}")
        return completed

    def shell(self, command: str, timeout: int = 120, check: bool = True) -> str:
        return self.run("shell", command, timeout=timeout, check=check).stdout

    def prop(self, name: str) -> str:
        return self.shell(f"getprop {name}", check=False).strip()

    def read_screen_size(self) -> None:
        output = self.shell("wm size", check=False)
        sizes = re.findall(r"(\d+)x(\d+)", output)
        if sizes:
            # "Override size" (if any) is listed after "Physical size".
            self.width, self.height = (int(value) for value in sizes[-1])

    # Evidence -----------------------------------------------------------

    def screenshot(self, name: str) -> str:
        self.counter += 1
        filename = f"{self.counter:02d}-{name}.png"
        data = subprocess.run(
            ["adb", "exec-out", "screencap", "-p"], capture_output=True, timeout=60
        ).stdout
        (self.screens / filename).write_bytes(data)
        return filename

    def save_logcat(self, name: str) -> str:
        output = self.run("logcat", "-d", "-b", "all", "-v", "threadtime", timeout=120, check=False).stdout
        path = self.logs / f"{name}.txt"
        path.write_text(output, encoding="utf-8")
        return output

    def clear_logcat(self) -> None:
        self.run("logcat", "-b", "all", "-c", check=False)

    def problems_in_log(self) -> list[str]:
        crash = self.run("logcat", "-d", "-b", "crash", timeout=60, check=False).stdout
        system = self.run("logcat", "-d", "-b", "system", timeout=60, check=False).stdout
        problems = []
        if PACKAGE in crash:
            problems.append("a crash was recorded for T1 Arc")
        if f"ANR in {PACKAGE}" in system:
            problems.append("Android reported T1 Arc as not responding")
        return problems

    def assert_healthy(self) -> None:
        problems = self.problems_in_log()
        if problems:
            self.screenshot("problem")
            raise CheckFailed("; ".join(problems).capitalize() + ". See the saved logs.")

    # Screen layout ------------------------------------------------------

    def layout(self, name: str | None = None) -> ET.Element | None:
        for _ in range(3):
            dumped = self.run("shell", "uiautomator dump /sdcard/t1arc-layout.xml", timeout=60, check=False)
            if "dumped to" in (dumped.stdout + dumped.stderr):
                xml = self.run("exec-out", "cat", "/sdcard/t1arc-layout.xml", timeout=60, check=False).stdout
                try:
                    root = ET.fromstring(xml)
                except ET.ParseError:
                    time.sleep(1)
                    continue
                if name:
                    (self.layouts / f"{self.counter:02d}-{name}.xml").write_text(xml, encoding="utf-8")
                return root
            time.sleep(2)
        return None

    def node_bounds(self, node: ET.Element) -> tuple[int, int, int, int] | None:
        bounds = BOUNDS.fullmatch(node.get("bounds", ""))
        return tuple(int(value) for value in bounds.groups()) if bounds else None  # type: ignore[return-value]

    def locate(self, root: ET.Element, label: str, *, exact: bool = True, lowest: bool = False) -> tuple[int, int] | None:
        want = normalise(label)
        points: list[tuple[int, int]] = []
        for node in root.iter("node"):
            for attribute in ("text", "content-desc"):
                value = normalise(node.get(attribute, ""))
                if not value or not (value == want or (not exact and want in value)):
                    continue
                bounds = self.node_bounds(node)
                if not bounds:
                    continue
                x1, y1, x2, y2 = bounds
                x, y = (x1 + x2) // 2, (y1 + y2) // 2
                if x2 > x1 and y2 > y1 and 0 <= x < self.width and 0 <= y < self.height:
                    points.append((x, y))
                break
        if not points:
            return None
        return max(points, key=lambda point: point[1]) if lowest else points[0]

    def labelled_clock(self, root: ET.Element, label: str) -> int | None:
        """The time at the end of the first text or description starting with label."""
        want = normalise(label)
        for node in root.iter("node"):
            for attribute in ("content-desc", "text"):
                value = normalise(node.get(attribute, ""))
                if value.startswith(want):
                    return clock_minutes(value)
        return None

    def selected_tab(self, root: ET.Element) -> str | None:
        """The bottom tab Android reports as selected, if any."""
        for node in root.iter("node"):
            if node.get("selected") != "true":
                continue
            bounds = self.node_bounds(node)
            if not bounds or bounds[1] < self.height * 0.75:
                continue
            description = node.get("content-desc", "")
            for tab in TAB_NAMES:
                if description == tab or description.endswith(f", {tab}"):
                    return tab
        return None

    def screen_content(self, root: ET.Element) -> frozenset[str]:
        """Text above the bottom tabs, to tell one screen from another."""
        texts = set()
        for node in root.iter("node"):
            bounds = self.node_bounds(node)
            if not bounds or bounds[3] > self.height * 0.88:
                continue
            for attribute in ("text", "content-desc"):
                value = normalise(node.get(attribute, ""))
                if value:
                    texts.add(value)
        return frozenset(texts)

    def sensor_record(self, root: ET.Element) -> tuple[str, str] | None:
        """The invented record's title and reading-time detail, when Today shows both."""
        title = detail = None
        for node in root.iter("node"):
            value = normalise(node.get("text", ""))
            if value == normalise(SENSOR_TITLE):
                title = value
            elif value.startswith(normalise(SENSOR_DETAIL_PREFIX) + " "):
                detail = value
        return (title, detail) if title and detail else None

    def wait_for(self, labels: tuple[str, ...], timeout: int, *, exact: bool = True, name: str = "wait") -> tuple[str, ET.Element]:
        deadline = time.monotonic() + timeout
        while True:
            root = self.layout()
            if root is not None:
                for label in labels:
                    if self.locate(root, label, exact=exact):
                        return label, root
            self.assert_healthy()
            if time.monotonic() > deadline:
                self.screenshot(f"{name}-timeout")
                self.layout(f"{name}-timeout")
                raise CheckFailed(f"Did not see {' or '.join(repr(label) for label in labels)} within {timeout} s.")
            time.sleep(2)

    def wait_for_tab(self, tab: str, timeout: int, *, name: str) -> ET.Element:
        deadline = time.monotonic() + timeout
        while True:
            root = self.layout()
            if root is not None and self.selected_tab(root) == tab:
                return root
            self.assert_healthy()
            if time.monotonic() > deadline:
                self.screenshot(f"{name}-timeout")
                self.layout(f"{name}-timeout")
                raise CheckFailed(f"The {tab} tab was not shown as selected within {timeout} s.")
            time.sleep(2)

    def wait_for_sensor_record(self, timeout: int, *, name: str) -> tuple[str, str]:
        deadline = time.monotonic() + timeout
        while True:
            root = self.layout()
            record = self.sensor_record(root) if root is not None else None
            if record:
                return record
            self.assert_healthy()
            if time.monotonic() > deadline:
                self.screenshot(f"{name}-timeout")
                self.layout(f"{name}-timeout")
                raise CheckFailed(f"Today did not show {SENSOR_TITLE!r} with its reading time within {timeout} s.")
            time.sleep(2)

    def tap_point(self, point: tuple[int, int]) -> None:
        self.shell(f"input tap {point[0]} {point[1]}")
        time.sleep(1.5)

    def tap(self, label: str, root: ET.Element | None = None, *, exact: bool = True, lowest: bool = False, timeout: int = 45) -> None:
        point = self.locate(root, label, exact=exact, lowest=lowest) if root is not None else None
        if point is None:
            _, root = self.wait_for((label,), timeout, exact=exact, name=f"tap-{label}")
            point = self.locate(root, label, exact=exact, lowest=lowest)
        assert point is not None
        self.tap_point(point)

    def scroll_to(self, label: str, *, exact: bool = True, swipes: int = 12, max_y: float = 0.8) -> ET.Element:
        for _ in range(swipes + 1):
            root = self.layout()
            if root is not None:
                point = self.locate(root, label, exact=exact)
                # Keep the target clear of the bottom tab bar before using it.
                # Fixed footer buttons pass a larger max_y.
                if point and point[1] < self.height * max_y:
                    return root
            self.swipe_up()
        self.screenshot(f"scroll-{label}-missing")
        self.layout(f"scroll-{label}-missing")
        raise CheckFailed(f"Could not find {label!r} after scrolling.")

    def swipe_up(self) -> None:
        """Move the content up, showing what is further down the page."""
        x = self.width // 2
        self.shell(f"input swipe {x} {int(self.height * 0.72)} {x} {int(self.height * 0.38)} 450", check=False)
        time.sleep(1.2)

    def scroll_to_top(self) -> None:
        x = self.width // 2
        for _ in range(4):
            self.shell(f"input swipe {x} {int(self.height * 0.3)} {x} {int(self.height * 0.8)} 300", check=False)
            time.sleep(0.8)

    def back(self) -> None:
        self.shell("input keyevent KEYCODE_BACK", check=False)
        time.sleep(1.5)

    # App control --------------------------------------------------------

    def install(self, apk: Path, *, replace: bool) -> None:
        args = ["install", "-r", str(apk)] if replace else ["install", str(apk)]
        completed = self.run(*args, timeout=420, check=False)
        if "Success" not in completed.stdout:
            raise CheckFailed(f"Installing {apk.name} failed: {(completed.stdout + completed.stderr).strip()}")
        self.shell(f"pm grant {PACKAGE} android.permission.POST_NOTIFICATIONS", check=False)

    def uninstall(self) -> None:
        self.run("uninstall", PACKAGE, timeout=120, check=False)

    def installed_version(self) -> tuple[str, str]:
        output = self.shell(f"dumpsys package {PACKAGE}", check=False)
        name = re.search(r"versionName=(\S+)", output)
        code = re.search(r"versionCode=(\d+)", output)
        return (name.group(1) if name else "missing", code.group(1) if code else "missing")

    def launch(self) -> None:
        self.shell(f"monkey -p {PACKAGE} -c android.intent.category.LAUNCHER 1", check=False)
        time.sleep(3)

    def force_stop(self) -> None:
        self.shell(f"am force-stop {PACKAGE}", check=False)
        time.sleep(1)

    def network_state(self) -> tuple[str, str]:
        airplane = self.shell("settings get global airplane_mode_on", check=False).strip()
        state = self.shell("dumpsys connectivity", check=False)
        match = re.search(r"Active default network: (\S+)", state)
        return airplane or "unknown", match.group(1) if match else "unknown"

    def go_offline(self) -> str:
        """Switch every network off and prove it; an unknown state fails."""
        failures = []
        for command in ("cmd connectivity airplane-mode enable", "svc wifi disable", "svc data disable"):
            completed = self.run("shell", command, timeout=60, check=False)
            if completed.returncode != 0:
                failures.append(f"'{command}' exited with {completed.returncode}")
        deadline = time.monotonic() + 45
        while True:
            airplane, default_network = self.network_state()
            if airplane == "1" and default_network == "none":
                break
            if time.monotonic() > deadline:
                raise CheckFailed(
                    f"The network did not switch off (airplane mode setting {airplane!r}, default network "
                    f"{default_network!r})" + (f"; {'; '.join(failures)}" if failures else "") + "."
                )
            time.sleep(2)
        ping = self.run("shell", "ping -c 1 -W 3 8.8.8.8", timeout=30, check=False)
        if ping.returncode == 0:
            raise CheckFailed("The emulator still reached the internet after switching the network off.")
        return "airplane mode on, no default network, and a test ping to 8.8.8.8 failed"

    def reboot(self) -> None:
        self.run("reboot", timeout=60, check=False)
        time.sleep(5)
        self.run("wait-for-device", timeout=300, check=False)
        deadline = time.monotonic() + 300
        while self.prop("sys.boot_completed") != "1":
            if time.monotonic() > deadline:
                raise CheckFailed("The emulator did not finish restarting within 5 minutes.")
            time.sleep(3)
        time.sleep(10)
        self.shell("wm dismiss-keyguard", check=False)
        self.shell("input keyevent KEYCODE_WAKEUP", check=False)
        time.sleep(2)


# Flows -----------------------------------------------------------------


class Acceptance:
    def __init__(self, device: Device, new_record: dict, old_record: dict, results: list[Result]) -> None:
        self.device = device
        self.new = new_record
        self.old = old_record
        self.results = results
        self.tab_points: dict[str, tuple[int, int]] = {}
        # The invented record as Today showed it before the update.
        self.sensor: tuple[str, str] | None = None

    def check(self, name: str, action: Callable[[], str | None], *, prerequisite: bool = True) -> bool:
        if not prerequisite:
            self.results.append(Result(name, "Not run", "An earlier step failed."))
            return False
        try:
            detail = action() or ""
        except (CheckFailed, subprocess.TimeoutExpired) as error:
            self.results.append(Result(name, "Fail", str(error)))
            return False
        self.results.append(Result(name, "Pass", detail))
        return True

    @property
    def new_is_redesign(self) -> bool:
        return version_tuple(self.new["version"]) >= (1, 8, 0)

    def expect_installed(self, record: dict) -> str:
        name, code = self.device.installed_version()
        if (name, code) != (record["version"], str(record["versionCode"])):
            raise CheckFailed(f"Android reports {name} ({code}); expected {record['version']} ({record['versionCode']}).")
        return f"Android reports {name} ({code})."

    def finish_first_run(self, prefix: str) -> str:
        device = self.device
        device.launch()
        label, root = device.wait_for(("Skip tour", "Explore the demo first"), 240, name=f"{prefix}-tour")
        device.screenshot(f"{prefix}-tour")
        device.layout(f"{prefix}-tour")
        if label == "Skip tour":
            device.tap("Skip tour", root)
            label, root = device.wait_for(("Explore the demo first",), 60, name=f"{prefix}-setup")
        device.screenshot(f"{prefix}-setup")
        device.layout(f"{prefix}-setup")
        device.tap("Explore the demo first", root)
        root = device.wait_for_tab("Today", 180, name=f"{prefix}-today")
        device.screenshot(f"{prefix}-today")
        device.layout(f"{prefix}-today")
        self.remember_tabs(root)
        device.assert_healthy()
        return "Skipped the tour, chose the demo and reached Today."

    def remember_tabs(self, root: ET.Element) -> None:
        for tab in TAB_NAMES:
            point = self.device.locate(root, tab, lowest=True)
            if point and point[1] > self.device.height * 0.75:
                self.tab_points[tab] = point

    def open_main_tabs(self, prefix: str) -> str:
        """Open each tab, proving it became the selected tab with its own screen."""
        device = self.device
        if "Today" not in self.tab_points:
            raise CheckFailed("The Today tab was not found on screen.")
        today = device.wait_for_tab("Today", 30, name=f"{prefix}-tabs-start")
        today_content = device.screen_content(today)
        visited = []
        for tab in TAB_NAMES[1:]:
            point = self.tab_points.get(tab)
            if point is None:
                continue
            device.tap_point(point)
            root = device.wait_for_tab(tab, 30, name=f"{prefix}-{tab.lower()}")
            device.screenshot(f"{prefix}-{tab.lower()}")
            device.layout(f"{prefix}-{tab.lower()}")
            content = device.screen_content(root)
            if not content or content == today_content:
                raise CheckFailed(f"{tab} was selected, but the screen above the tabs still showed Today.")
            device.assert_healthy()
            visited.append(tab)
        device.tap_point(self.tab_points["Today"])
        device.wait_for_tab("Today", 60, name=f"{prefix}-back-today")
        device.assert_healthy()
        if len(visited) < 3:
            raise CheckFailed(f"Only found these tabs: {', '.join(visited) or 'none'}.")
        return ("Opened " + ", ".join(visited) + "; each became the selected tab with its own screen. "
                "Returned to Today.")

    def check_about(self, prefix: str) -> str:
        device = self.device
        device.tap("Open settings")
        device.wait_for(("More settings", "Glucose source"), 60, name=f"{prefix}-settings")
        device.screenshot(f"{prefix}-settings")
        root = device.scroll_to("About and updates")
        device.tap("About and updates", root)
        device.wait_for(("Source revision", "Tell me when an update is out"), 60, exact=False, name=f"{prefix}-about")
        version_text = f"{self.new['version']} ({self.new['versionCode']})"
        device.scroll_to(version_text)
        revision = self.new["sourceCommit"][:12]
        root = device.scroll_to(revision)
        device.screenshot(f"{prefix}-about")
        device.layout(f"{prefix}-about")
        if device.locate(root, "local changes", exact=False):
            raise CheckFailed("About reports local changes in the source revision.")
        device.back()
        device.back()
        device.wait_for_tab("Today", 60, name=f"{prefix}-after-about")
        return f"About shows {version_text} and the clean source revision {revision}."

    def record_sensor_change(self, prefix: str) -> str:
        """Save one invented record through the app's own form before updating."""
        device = self.device
        root = device.scroll_to("Record sensor change")
        device.tap("Record sensor change", root)
        _, root = device.wait_for(("Sensor model:", "Choose your sensor"), 45, exact=False, name=f"{prefix}-sensor-form")
        device.screenshot(f"{prefix}-sensor-form")
        device.layout(f"{prefix}-sensor-form")
        started = device.labelled_clock(root, "Change time, currently")
        root = device.scroll_to("Sensor model:", exact=False)
        device.tap("Sensor model:", root, exact=False)
        root = device.scroll_to(SENSOR_MODEL)
        device.tap(SENSOR_MODEL, root)
        root = device.scroll_to("Save new sensor", max_y=0.97)
        device.tap("Save new sensor", root)
        title, detail = device.wait_for_sensor_record(60, name=f"{prefix}-sensor-saved")
        device.screenshot(f"{prefix}-sensor-saved")
        device.layout(f"{prefix}-sensor-saved")
        device.assert_healthy()
        ends = clock_minutes(detail)
        if started is None or ends is None:
            raise CheckFailed(f"Could not read the recorded start time or the time in {detail!r}.")
        if (ends - started) % (24 * 60) != SENSOR_WARMUP_MINUTES:
            raise CheckFailed(f"Today shows {detail!r}, which is not {SENSOR_WARMUP_MINUTES} minutes after the recorded start.")
        self.sensor = (title, detail)
        return (f"Saved a {SENSOR_MODEL} sensor change. Today shows {title!r} and {detail!r}, "
                f"{SENSOR_WARMUP_MINUTES} minutes after the recorded start.")

    def expect_sensor_record(self, prefix: str) -> str:
        device = self.device
        if self.sensor is None:
            raise CheckFailed("No sensor change was saved before the update.")
        for _ in range(6):
            root = device.layout()
            record = device.sensor_record(root) if root is not None else None
            if record:
                device.screenshot(f"{prefix}-sensor-record")
                device.layout(f"{prefix}-sensor-record")
                device.scroll_to_top()
                title, detail = record
                saved_title, saved_detail = self.sensor
                if title != saved_title or clock_minutes(detail) != clock_minutes(saved_detail):
                    raise CheckFailed(f"Today shows {title!r} / {detail!r}, not the saved {saved_title!r} / {saved_detail!r}.")
                return f"Today still shows {title!r} with {detail!r}, as saved before the update."
            device.swipe_up()
        device.screenshot(f"{prefix}-sensor-record-missing")
        device.layout(f"{prefix}-sensor-record-missing")
        device.scroll_to_top()
        raise CheckFailed("The sensor change saved before the update is not shown on Today.")

    def relaunch_to_today(self, prefix: str) -> str:
        device = self.device
        device.launch()
        label, _ = device.wait_for(("Skip tour", "Explore the demo first", "History"), 240, name=f"{prefix}-relaunch")
        if label != "History":
            device.screenshot(f"{prefix}-tour-again")
            raise CheckFailed("The first-run tour appeared again, so saved app state was not kept.")
        root = device.wait_for_tab("Today", 120, name=f"{prefix}-relaunch")
        device.screenshot(f"{prefix}-today")
        self.remember_tabs(root)
        device.assert_healthy()
        return "Opened straight to Today with the saved choices kept."

    def update_flow(self) -> None:
        device = self.device
        device.uninstall()
        device.clear_logcat()
        old_version = f"{self.old['version']} ({self.old['versionCode']})"
        installed = self.check(
            f"Previous public release {old_version} installs",
            lambda: (device.install(OLD_APK, replace=False), self.expect_installed(self.old))[1],
        )
        ready = self.check(
            "Previous release: tour, demo and Today",
            lambda: self.finish_first_run("old"),
            prerequisite=installed,
        )
        recorded = self.check(
            "Previous release: save an invented sensor-change record",
            lambda: self.record_sensor_change("old"),
            prerequisite=ready,
        )
        device.force_stop()
        target = f"Update to {self.new['version']}" if UPGRADE else f"Reinstall {self.new['version']}"
        updated = self.check(
            f"{target} installs over it, keeping app data",
            lambda: (device.install(NEW_APK, replace=True), self.expect_installed(self.new))[1],
            prerequisite=ready,
        )
        opened = self.check(
            "Updated app opens to Today without the first-run tour",
            lambda: self.relaunch_to_today("updated"),
            prerequisite=updated,
        )
        self.check(
            "Updated app still shows the saved sensor change",
            lambda: self.expect_sensor_record("updated"),
            prerequisite=opened and recorded,
        )
        self.check("Updated app: main tabs open", lambda: self.open_main_tabs("updated"), prerequisite=opened)
        if self.new_is_redesign:
            self.check("Updated app: About shows the version and source", lambda: self.check_about("updated"), prerequisite=opened)
        self.check("No crash or freeze during the update", self.no_problems, prerequisite=installed)
        device.save_logcat("update-flow")

    def clean_flow(self) -> None:
        device = self.device
        device.force_stop()
        device.uninstall()
        device.clear_logcat()
        installed = self.check(
            f"Clean install of {self.new['version']} ({self.new['versionCode']})",
            lambda: (device.install(NEW_APK, replace=False), self.expect_installed(self.new))[1],
        )
        ready = self.check("Clean install: tour, demo and Today", lambda: self.finish_first_run("clean"), prerequisite=installed)
        self.check("Clean install: main tabs open", lambda: self.open_main_tabs("clean"), prerequisite=ready)
        if self.new_is_redesign:
            self.check("Clean install: About shows the version and source", lambda: self.check_about("clean"), prerequisite=ready)

        def cold_launch() -> str:
            device.force_stop()
            return self.relaunch_to_today("cold")

        self.check("Cold launch after the app is stopped", cold_launch, prerequisite=ready)

        def restart() -> str:
            device.reboot()
            # Airplane mode should survive a restart; prove it before the app opens.
            network = device.go_offline()
            device.clear_logcat()
            return f"{self.relaunch_to_today('restart')} After the restart: {network}."

        self.check("Cold launch after the emulator restarts", restart, prerequisite=ready)
        self.check("No crash or freeze after a clean install", self.no_problems, prerequisite=installed)
        device.save_logcat("clean-flow")

    def no_problems(self) -> str:
        problems = self.device.problems_in_log()
        if problems:
            raise CheckFailed("; ".join(problems).capitalize() + ".")
        return "No T1 Arc crash or not-responding report in the logs."


def write_summary(results: list[Result], device_facts: dict[str, str]) -> None:
    path = (f"{PREVIOUS_TAG} to {RELEASE_TAG}" if UPGRADE
            else f"{RELEASE_TAG} reinstalled over itself (a test of this check, not an upgrade)")
    lines = [
        f"## Emulator acceptance: T1 Arc {RELEASE_TAG}",
        "",
        f"- Emulator: Android {device_facts['release']} (API {device_facts['sdk']}), "
        f"{device_facts['abi']} with ARM64 apps allowed: {device_facts['arm64']}.",
        f"- Network: {device_facts['network']}.",
        f"- Update path: {path}. No data source is connected; the only record is",
        f"  an invented {SENSOR_MODEL} sensor change that this check saves before updating.",
    ]
    apk_facts = RESULTS / "apks.txt"
    if apk_facts.exists():
        for line in apk_facts.read_text(encoding="utf-8").splitlines():
            key, _, value = line.partition("=")
            lines.append(f"- {key.replace('_', ' ')}: `{value}`")
    lines += ["", "| Check | Result | Detail |", "| --- | --- | --- |"]
    for result in results:
        detail = result.detail.replace("|", "\\|").replace("\n", " ")
        lines.append(f"| {result.name} | {result.status} | {detail} |")
    lines += [
        "",
        "Screenshots, screen layouts and logcat are attached to this run as an artifact.",
        "An emulator shows install, update and launch behaviour; it does not replace",
        "checks on a physical phone, a watch or real data sources.",
        "",
    ]
    (RESULTS / "summary.md").write_text("\n".join(lines), encoding="utf-8")
    (RESULTS / "results.json").write_text(
        json.dumps(
            {
                "release": RELEASE_TAG,
                "previous": PREVIOUS_TAG,
                "upgrade": UPGRADE,
                "device": device_facts,
                "checks": [result.__dict__ for result in results],
            },
            indent=2,
        ),
        encoding="utf-8",
    )


def main() -> int:
    RESULTS.mkdir(parents=True, exist_ok=True)
    device = Device(RESULTS)
    device.read_screen_size()
    abilist = device.prop("ro.product.cpu.abilist")
    facts = {
        "release": device.prop("ro.build.version.release"),
        "sdk": device.prop("ro.build.version.sdk"),
        "abi": device.prop("ro.product.cpu.abi"),
        "abilist": abilist,
        "arm64": "yes" if "arm64-v8a" in abilist.split(",") else "no",
        "screen": f"{device.width}x{device.height}",
        "network": "not checked",
    }
    results: list[Result] = []

    def finish() -> int:
        write_summary(results, facts)
        print((RESULTS / "summary.md").read_text(encoding="utf-8"))
        return 1 if any(result.status != "Pass" for result in results) else 0

    try:
        new_record, old_record, detail = check_release_files()
    except CheckFailed as error:
        results.append(Result("Release files match the requested tags", "Fail", str(error)))
        return finish()
    results.append(Result("Release files match the requested tags", "Pass", detail))
    if facts["arm64"] != "yes":
        results.append(Result("Emulator can run ARM64 apps", "Fail", f"ABI list is {abilist}; choose another API level."))
        return finish()
    try:
        facts["network"] = device.go_offline()
    except CheckFailed as error:
        results.append(Result("Emulator is offline", "Fail", str(error)))
        return finish()
    acceptance = Acceptance(device, new_record, old_record, results)
    acceptance.update_flow()
    acceptance.clean_flow()
    return finish()


if __name__ == "__main__":
    sys.exit(main())
