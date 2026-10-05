"""Regression tests for the release APK's JavaScript bundle identity check."""

import hashlib
import importlib.util
import json
import subprocess
import sys
import tempfile
import unittest
import warnings
import zipfile
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
SCRIPT = ROOT / "scripts" / "verify-apk-js-bundle.py"
SPEC = importlib.util.spec_from_file_location("verify_apk_js_bundle", SCRIPT)
VERIFIER = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(VERIFIER)


class ApkJsBundleTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        folder = Path(self.temporary.name)
        self.apk = folder / "release.apk"
        self.generated = folder / "index.android.bundle"
        self.generated.write_bytes(b"Hermes-bytecode-test-fixture")

    def write_apk(self, *entries):
        with zipfile.ZipFile(self.apk, "w") as archive:
            for name, data in entries:
                with warnings.catch_warnings():
                    warnings.simplefilter("ignore", UserWarning)
                    archive.writestr(name, data)

    def run_cli(self):
        return subprocess.run(
            [sys.executable, str(SCRIPT), str(self.apk), str(self.generated)],
            capture_output=True,
            text=True,
            check=False,
        )

    def test_matching_bundle_is_accepted_and_reports_small_metadata(self):
        self.write_apk(
            ("assets/other.txt", b"irrelevant"),
            (VERIFIER.APK_BUNDLE_ENTRY, self.generated.read_bytes()),
        )
        result = self.run_cli()
        self.assertEqual(result.returncode, 0, result.stderr)
        report = json.loads(result.stdout)
        self.assertEqual(report["apk"], "release.apk")
        self.assertEqual(report["bundle"], "index.android.bundle")
        self.assertEqual(report["apk_entry"], VERIFIER.APK_BUNDLE_ENTRY)
        self.assertEqual(report["bytes"], len(self.generated.read_bytes()))
        self.assertEqual(report["sha256"], hashlib.sha256(self.generated.read_bytes()).hexdigest())
        self.assertNotIn(str(self.apk.parent), result.stdout)

    def test_missing_bundle_is_rejected(self):
        self.write_apk(("assets/other.txt", b"not the bundle"))
        self.assertNotEqual(self.run_cli().returncode, 0)

    def test_duplicate_bundle_is_rejected(self):
        content = self.generated.read_bytes()
        self.write_apk((VERIFIER.APK_BUNDLE_ENTRY, content), (VERIFIER.APK_BUNDLE_ENTRY, content))
        self.assertNotEqual(self.run_cli().returncode, 0)

    def test_mismatching_bundle_is_rejected(self):
        content = self.generated.read_bytes()
        changed = bytes([content[0] ^ 1]) + content[1:]
        self.write_apk((VERIFIER.APK_BUNDLE_ENTRY, changed))
        self.assertNotEqual(self.run_cli().returncode, 0)

    def test_empty_apk_bundle_is_rejected(self):
        self.write_apk((VERIFIER.APK_BUNDLE_ENTRY, b""))
        self.assertNotEqual(self.run_cli().returncode, 0)

    def test_empty_generated_bundle_is_rejected(self):
        self.generated.write_bytes(b"")
        self.write_apk((VERIFIER.APK_BUNDLE_ENTRY, b""))
        self.assertNotEqual(self.run_cli().returncode, 0)

    def test_invalid_zip_is_rejected(self):
        self.apk.write_bytes(b"not-an-apk")
        self.assertNotEqual(self.run_cli().returncode, 0)


if __name__ == "__main__":
    unittest.main()
