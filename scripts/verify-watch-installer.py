"""Verify installer packaging and ELF alignment without executing APK code."""
import argparse
import hashlib
import json
import struct
import zipfile


def verify(apk, enabled):
    with zipfile.ZipFile(apk) as archive:
        names = archive.namelist()
        asset = 'assets/watch-installer/companion.apk'
        if not enabled:
            assert not any(name.startswith('assets/watch-installer/') for name in names), 'Installer APK leaked into store build'
            assert not any('conscrypt' in name or 'spake' in name for name in names), 'Installer native dependency leaked into store build'
            for name in names:
                if name.endswith('.dex'):
                    data = archive.read(name)
                    assert b'io/github/muntashirakon/adb' not in data, 'ADB transport leaked into store build'
            print('PASS: installer assets and ADB transport excluded')
            return
        metadata = json.loads(archive.read('assets/watch-installer/manifest.json'))
        assert hashlib.sha256(archive.read(asset)).hexdigest() == metadata['sha256'], 'Companion checksum mismatch'
        assert metadata['versionCode'] > 0 and metadata['minSdk'] >= 30
        native_count = 0
        for name in names:
            if not name.endswith('.so') or not name.startswith(('lib/arm64-v8a/', 'lib/x86_64/')):
                continue
            data = archive.read(name)
            assert data[:4] == b'\x7fELF' and data[4] == 2, name
            endian = '<' if data[5] == 1 else '>'
            offset = struct.unpack_from(endian + 'Q', data, 32)[0]
            entry_size, count = struct.unpack_from(endian + 'HH', data, 54)
            for index in range(count):
                entry = offset + index * entry_size
                kind = struct.unpack_from(endian + 'I', data, entry)[0]
                if kind == 1:
                    file_offset, address = struct.unpack_from(endian + 'QQ', data, entry + 8)
                    alignment = struct.unpack_from(endian + 'Q', data, entry + 48)[0]
                    assert alignment >= 16384 and (file_offset - address) % 16384 == 0, f'16 KB ELF alignment failed: {name}'
            native_count += 1
        assert native_count, 'No 64-bit native libraries found'
        print(f"PASS: companion {metadata['packageName']} ({metadata['versionCode']}), checksum verified; {native_count} native libraries support 16 KB pages")


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('apk')
    parser.add_argument('--enabled', action='store_true')
    arguments = parser.parse_args()
    verify(arguments.apk, arguments.enabled)
