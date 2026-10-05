"""Confirm the APK contains the exact JavaScript bundle produced by Gradle."""

import argparse
import hashlib
import json
import sys
import zipfile
from pathlib import Path


APK_BUNDLE_ENTRY = "assets/index.android.bundle"
CHUNK_SIZE = 1024 * 1024


def _hash_stream(stream):
    digest = hashlib.sha256()
    size = 0
    while chunk := stream.read(CHUNK_SIZE):
        digest.update(chunk)
        size += len(chunk)
    return digest.hexdigest(), size


def verify(apk_path, bundle_path):
    apk_path = Path(apk_path)
    bundle_path = Path(bundle_path)

    with bundle_path.open("rb") as generated:
        generated_hash, generated_size = _hash_stream(generated)
    if generated_size == 0:
        raise ValueError("Generated Gradle bundle is empty")

    try:
        with zipfile.ZipFile(apk_path) as archive:
            entries = [entry for entry in archive.infolist() if entry.filename == APK_BUNDLE_ENTRY]
            if len(entries) != 1:
                raise ValueError("APK must contain exactly one JavaScript bundle")
            if entries[0].is_dir():
                raise ValueError("APK JavaScript bundle is a directory")
            with archive.open(entries[0]) as bundled:
                apk_hash, apk_size = _hash_stream(bundled)
    except (zipfile.BadZipFile, zipfile.LargeZipFile, EOFError) as error:
        raise ValueError("APK is not a valid ZIP archive") from error

    if apk_size == 0:
        raise ValueError("APK JavaScript bundle is empty")
    if apk_size != generated_size or apk_hash != generated_hash:
        raise ValueError("APK JavaScript bundle differs from generated Gradle bundle")

    return {
        "apk": apk_path.name,
        "bundle": bundle_path.name,
        "apk_entry": APK_BUNDLE_ENTRY,
        "sha256": apk_hash,
        "bytes": apk_size,
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("apk", help="APK produced by the Android release build")
    parser.add_argument("bundle", help="Generated Gradle Hermes bundle to compare")
    arguments = parser.parse_args()
    try:
        result = verify(arguments.apk, arguments.bundle)
    except (OSError, ValueError) as error:
        print(f"FAIL: {error}", file=sys.stderr)
        return 1
    print(json.dumps(result, sort_keys=True))
    return 0


if __name__ == "__main__":
    sys.exit(main())
