import { inflateSync, strFromU8 } from 'fflate';

import {
  GlookoTextFile,
  isGlookoCgmFileName,
} from './glookoCsv';

const MAX_ARCHIVE_BYTES = 50 * 1024 * 1024;
const MAX_ENTRY_BYTES = 25 * 1024 * 1024;
const MAX_CGM_ENTRY_BYTES = 48 * 1024 * 1024;
const MAX_EXTRACTED_BYTES = 120 * 1024 * 1024;
const MAX_CSV_FILES = 40;
const EOCD_SIGNATURE = 0x06054b50;
const ZIP64_EOCD_SIGNATURE = 0x06064b50;
const ZIP64_LOCATOR_SIGNATURE = 0x07064b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const LOCAL_SIGNATURE = 0x04034b50;
const UINT16_MAX = 0xffff;
const UINT32_MAX = 0xffffffff;

export function glookoEntryLimitForName(name: string) {
  return isGlookoCgmFileName(name)
    ? MAX_CGM_ENTRY_BYTES
    : MAX_ENTRY_BYTES;
}

export interface GlookoArchiveEntrySummary {
  name: string;
  measuredBytes?: number;
  reportedOriginalBytes?: number;
  compressedBytes?: number;
  handling: 'loaded' | 'retained';
  reason?:
    | 'not-normalised'
    | 'entry-limit'
    | 'archive-limit'
    | 'file-limit';
}

export interface UnpackedGlookoExport {
  format: 'zip' | 'csv';
  files: GlookoTextFile[];
  entries: GlookoArchiveEntrySummary[];
}

interface CentralEntry {
  name: string;
  flags: number;
  compression: number;
  compressedBytes: number;
  reportedOriginalBytes: number;
  localOffset: number;
}

export function safeGlookoFileName(value: string) {
  return value.split(/[\\/]/).pop()?.trim() || 'glooko-export.zip';
}

function isZip(name: string, bytes: Uint8Array) {
  return (
    name.toLowerCase().endsWith('.zip') ||
    (bytes[0] === 0x50 && bytes[1] === 0x4b)
  );
}

function requireRange(bytes: Uint8Array, offset: number, length: number) {
  if (
    !Number.isSafeInteger(offset) ||
    !Number.isSafeInteger(length) ||
    offset < 0 ||
    length < 0 ||
    offset + length > bytes.length
  ) {
    throw new Error('The Glooko ZIP directory is incomplete or corrupt.');
  }
}

function readU16(bytes: Uint8Array, offset: number) {
  requireRange(bytes, offset, 2);
  return bytes[offset]! | (bytes[offset + 1]! << 8);
}

function readU32(bytes: Uint8Array, offset: number) {
  requireRange(bytes, offset, 4);
  return (
    (bytes[offset]! |
      (bytes[offset + 1]! << 8) |
      (bytes[offset + 2]! << 16) |
      (bytes[offset + 3]! << 24)) >>>
    0
  );
}

function readU64(bytes: Uint8Array, offset: number) {
  const value = readU32(bytes, offset) + readU32(bytes, offset + 4) * 2 ** 32;
  if (!Number.isSafeInteger(value)) {
    throw new Error('The Glooko ZIP contains an unsupported very large entry.');
  }
  return value;
}

function findEndOfCentralDirectory(bytes: Uint8Array) {
  const earliest = Math.max(0, bytes.length - 65_558);
  for (let offset = bytes.length - 22; offset >= earliest; offset -= 1) {
    if (readU32(bytes, offset) === EOCD_SIGNATURE) return offset;
  }
  throw new Error('The selected file is not a complete ZIP export.');
}

function zipDirectory(bytes: Uint8Array) {
  const end = findEndOfCentralDirectory(bytes);
  let entryCount = readU16(bytes, end + 10);
  let centralOffset = readU32(bytes, end + 16);
  if (
    entryCount === UINT16_MAX ||
    centralOffset === UINT32_MAX
  ) {
    const locator = end - 20;
    if (
      locator < 0 ||
      readU32(bytes, locator) !== ZIP64_LOCATOR_SIGNATURE
    ) {
      throw new Error('The Glooko ZIP64 directory is incomplete.');
    }
    const zip64End = readU64(bytes, locator + 8);
    if (readU32(bytes, zip64End) !== ZIP64_EOCD_SIGNATURE) {
      throw new Error('The Glooko ZIP64 directory is invalid.');
    }
    entryCount = readU64(bytes, zip64End + 32);
    centralOffset = readU64(bytes, zip64End + 48);
  }
  if (entryCount > 10_000) {
    throw new Error('The selected ZIP contains too many files.');
  }
  return { centralOffset, entryCount };
}

function zip64EntryValues(
  bytes: Uint8Array,
  extraOffset: number,
  extraLength: number,
  compressedBytes: number,
  originalBytes: number,
  localOffset: number,
) {
  let compressed = compressedBytes;
  let original = originalBytes;
  let local = localOffset;
  const end = extraOffset + extraLength;
  for (let offset = extraOffset; offset + 4 <= end; ) {
    const id = readU16(bytes, offset);
    const length = readU16(bytes, offset + 2);
    const valueOffset = offset + 4;
    requireRange(bytes, valueOffset, length);
    if (id === 1) {
      let cursor = valueOffset;
      if (original === UINT32_MAX) {
        original = readU64(bytes, cursor);
        cursor += 8;
      }
      if (compressed === UINT32_MAX) {
        compressed = readU64(bytes, cursor);
        cursor += 8;
      }
      if (local === UINT32_MAX) {
        local = readU64(bytes, cursor);
      }
      break;
    }
    offset = valueOffset + length;
  }
  return { compressed, original, local };
}

function parseCentralEntries(bytes: Uint8Array) {
  const { centralOffset, entryCount } = zipDirectory(bytes);
  const entries: CentralEntry[] = [];
  let offset = centralOffset;
  for (let index = 0; index < entryCount; index += 1) {
    if (readU32(bytes, offset) !== CENTRAL_SIGNATURE) {
      throw new Error('The Glooko ZIP directory contains an invalid entry.');
    }
    const flags = readU16(bytes, offset + 8);
    const compression = readU16(bytes, offset + 10);
    const nameLength = readU16(bytes, offset + 28);
    const extraLength = readU16(bytes, offset + 30);
    const commentLength = readU16(bytes, offset + 32);
    const nameOffset = offset + 46;
    const extraOffset = nameOffset + nameLength;
    requireRange(bytes, nameOffset, nameLength + extraLength + commentLength);
    const decodedName = strFromU8(
      bytes.subarray(nameOffset, nameOffset + nameLength),
      !(flags & 0x0800),
    );
    const values = zip64EntryValues(
      bytes,
      extraOffset,
      extraLength,
      readU32(bytes, offset + 20),
      readU32(bytes, offset + 24),
      readU32(bytes, offset + 42),
    );
    entries.push({
      name: decodedName,
      flags,
      compression,
      compressedBytes: values.compressed,
      reportedOriginalBytes: values.original,
      localOffset: values.local,
    });
    offset = extraOffset + extraLength + commentLength;
  }
  return { entries, centralOffset };
}

function localDataOffset(bytes: Uint8Array, entry: CentralEntry) {
  if (readU32(bytes, entry.localOffset) !== LOCAL_SIGNATURE) {
    throw new Error(`The ZIP entry ${safeGlookoFileName(entry.name)} is invalid.`);
  }
  return (
    entry.localOffset +
    30 +
    readU16(bytes, entry.localOffset + 26) +
    readU16(bytes, entry.localOffset + 28)
  );
}

function extractEntry(
  bytes: Uint8Array,
  entry: CentralEntry,
  nextBoundary: number,
) {
  if (entry.flags & 1) {
    throw new Error(
      `The ZIP entry ${safeGlookoFileName(entry.name)} is encrypted and cannot be read.`,
    );
  }
  const start = localDataOffset(bytes, entry);
  const reportedEnd = start + entry.compressedBytes;
  const end =
    entry.compressedBytes !== UINT32_MAX &&
    reportedEnd >= start &&
    reportedEnd <= nextBoundary
      ? reportedEnd
      : nextBoundary;
  requireRange(bytes, start, end - start);
  const compressed = bytes.subarray(start, end);
  if (entry.compression === 0) {
    if (entry.compressedBytes === UINT32_MAX) {
      throw new Error(
        `The stored ZIP entry ${safeGlookoFileName(entry.name)} has no usable size.`,
      );
    }
    return compressed.slice();
  }
  if (entry.compression === 8) return inflateSync(compressed);
  throw new Error(
    `The ZIP entry ${safeGlookoFileName(entry.name)} uses unsupported compression.`,
  );
}

export async function unpackGlookoExport(
  name: string,
  bytes: Uint8Array,
): Promise<UnpackedGlookoExport> {
  if (!bytes.length) throw new Error('The selected export is empty.');
  if (bytes.length > MAX_ARCHIVE_BYTES) {
    throw new Error('The selected export is larger than the 50 MB safety limit.');
  }
  if (!isZip(name, bytes)) {
    if (!name.toLowerCase().endsWith('.csv')) {
      throw new Error('Choose a Glooko .zip export or one of its .csv files.');
    }
    const fileName = safeGlookoFileName(name);
    const cgmBytes = isGlookoCgmFileName(fileName) ? bytes.slice() : undefined;
    return {
      format: 'csv',
      files: [
        {
          name: fileName,
          text: cgmBytes ? undefined : strFromU8(bytes),
          bytes: cgmBytes,
        },
      ],
      entries: [
        {
          name: fileName,
          measuredBytes: bytes.length,
          reportedOriginalBytes: bytes.length,
          handling: 'loaded',
        },
      ],
    };
  }

  let extractedBytes = 0;
  let selectedFiles = 0;
  let csvFiles = 0;
  const files: GlookoTextFile[] = [];
  const summaries: GlookoArchiveEntrySummary[] = [];
  const parsed = parseCentralEntries(bytes);
  const boundaries = parsed.entries
    .map((entry) => entry.localOffset)
    .filter((offset) => offset >= 0 && offset < parsed.centralOffset)
    .sort((a, b) => a - b);

  for (const entry of parsed.entries) {
    const fileName = safeGlookoFileName(entry.name);
    const sizes = {
      reportedOriginalBytes: entry.reportedOriginalBytes,
      compressedBytes: entry.compressedBytes,
    };
    if (!fileName.toLowerCase().endsWith('.csv')) {
      summaries.push({
        name: fileName,
        ...sizes,
        handling: 'retained',
        reason: 'not-normalised',
      });
      continue;
    }

    csvFiles += 1;
    if (selectedFiles >= MAX_CSV_FILES) {
      summaries.push({
        name: fileName,
        ...sizes,
        handling: 'retained',
        reason: 'file-limit',
      });
      files.push({
        name: fileName,
        text: '',
        retainedOnly: true,
        originalBytes: entry.reportedOriginalBytes,
      });
      continue;
    }

    const boundaryIndex = boundaries.findIndex(
      (offset) => offset > entry.localOffset,
    );
    const nextBoundary =
      boundaryIndex >= 0 ? boundaries[boundaryIndex]! : parsed.centralOffset;
    // Inflate without preallocating from the advertised uncompressed size.
    // This is the key compatibility behaviour for Glooko's unusual ZIP
    // metadata; the bytes actually produced decide every safety limit.
    const content = extractEntry(bytes, entry, nextBoundary);
    const measuredBytes = content.byteLength;
    let reason: GlookoArchiveEntrySummary['reason'];
    if (measuredBytes > glookoEntryLimitForName(fileName)) {
      reason = 'entry-limit';
    }
    else if (extractedBytes + measuredBytes > MAX_EXTRACTED_BYTES) {
      reason = 'archive-limit';
    }

    if (reason) {
      summaries.push({
        name: fileName,
        ...sizes,
        measuredBytes,
        handling: 'retained',
        reason,
      });
      files.push({
        name: fileName,
        text: '',
        retainedOnly: true,
        originalBytes: measuredBytes,
      });
      continue;
    }

    extractedBytes += measuredBytes;
    selectedFiles += 1;
    summaries.push({
      name: fileName,
      ...sizes,
      measuredBytes,
      handling: 'loaded',
    });
    files.push({
      name: fileName,
      text: isGlookoCgmFileName(fileName) ? undefined : strFromU8(content),
      bytes: isGlookoCgmFileName(fileName) ? content : undefined,
      originalBytes: measuredBytes,
    });
  }
  if (!csvFiles) {
    throw new Error('The selected ZIP does not contain any CSV files.');
  }
  return {
    format: 'zip',
    files,
    entries: summaries,
  };
}

export async function unpackGlookoFiles(name: string, bytes: Uint8Array) {
  return (await unpackGlookoExport(name, bytes)).files;
}
