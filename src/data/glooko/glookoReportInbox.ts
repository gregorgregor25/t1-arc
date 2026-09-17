import * as Crypto from 'expo-crypto';
import { Directory, File } from 'expo-file-system';
import * as SecureStore from 'expo-secure-store';

import T1ArcGlookoExport from '../../../modules/t1arc-glooko-export';

const REPORT_INBOX_KEY = 't1arc.glooko.report-inbox.v1';
const MAX_REPORT_BYTES = 25 * 1024 * 1024;
const MAX_REPORT_CANDIDATES = 24;

interface StoredReportInbox {
  uri: string;
  selectedAt: number;
}

export interface GlookoReportInboxStatus {
  configured: boolean;
  accessible: boolean;
  folderLabel?: string;
}

export interface GlookoReportInboxCandidate {
  uri: string;
  fileName: string;
  byteLength: number;
  modifiedAt?: number;
}

export type GlookoReportInboxScan =
  | {
      status: 'not-configured';
    }
  | {
      status: 'unavailable';
      message: string;
    }
  | {
      status: 'ready';
      snapshot: string;
      candidates: GlookoReportInboxCandidate[];
    };

function parseStoredInbox(value: string | null): StoredReportInbox | undefined {
  if (!value) return undefined;
  try {
    const parsed = JSON.parse(value) as Partial<StoredReportInbox>;
    if (
      typeof parsed.uri !== 'string' ||
      !parsed.uri.startsWith('content://') ||
      typeof parsed.selectedAt !== 'number' ||
      !Number.isFinite(parsed.selectedAt)
    ) {
      return undefined;
    }
    return { uri: parsed.uri, selectedAt: parsed.selectedAt };
  } catch {
    return undefined;
  }
}

async function loadStoredInbox() {
  return parseStoredInbox(await SecureStore.getItemAsync(REPORT_INBOX_KEY));
}

function friendlyFolderLabel(directory: Directory) {
  const decoded = (() => {
    try {
      return decodeURIComponent(directory.name);
    } catch {
      return directory.name;
    }
  })();
  const lastPart = decoded.split(/[:/]/).filter(Boolean).pop()?.trim();
  return lastPart && lastPart.length <= 80
    ? lastPart
    : 'Selected Android folder';
}

function isCandidate(file: File) {
  const name = file.name.trim();
  const type = file.type.toLowerCase();
  return (
    file.exists &&
    file.size >= 5 &&
    file.size <= MAX_REPORT_BYTES &&
    (name.toLowerCase().endsWith('.pdf') || type === 'application/pdf')
  );
}

export async function getGlookoReportInboxStatus(): Promise<GlookoReportInboxStatus> {
  const stored = await loadStoredInbox();
  if (!stored) return { configured: false, accessible: false };
  try {
    const directory = new Directory(stored.uri);
    return {
      configured: true,
      accessible: directory.exists,
      folderLabel: friendlyFolderLabel(directory),
    };
  } catch {
    return { configured: true, accessible: false };
  }
}

export async function chooseGlookoReportInbox(): Promise<
  GlookoReportInboxStatus | { cancelled: true }
> {
  const previous = await loadStoredInbox();
  let directory: Directory;
  try {
    directory = await Directory.pickDirectoryAsync(previous?.uri);
  } catch {
    return { cancelled: true };
  }

  const pickedUri = directory.uri;
  let selectionStored = false;
  try {
    const stored: StoredReportInbox = {
      uri: directory.uri,
      selectedAt: Date.now(),
    };
    await SecureStore.setItemAsync(REPORT_INBOX_KEY, JSON.stringify(stored));
    selectionStored = true;
    if (previous && previous.uri !== directory.uri) {
      const released = await T1ArcGlookoExport.releaseReportInboxAccessAsync(
        previous.uri,
      );
      if (!released) {
        throw new Error(
          'Android could not replace the previous Glooko report-folder access.',
        );
      }
    }
    return {
      configured: true,
      accessible: directory.exists,
      folderLabel: friendlyFolderLabel(directory),
    };
  } catch (error) {
    if (selectionStored) {
      if (previous) {
        await SecureStore.setItemAsync(
          REPORT_INBOX_KEY,
          JSON.stringify(previous),
        ).catch(() => undefined);
      } else {
        await SecureStore.deleteItemAsync(REPORT_INBOX_KEY).catch(
          () => undefined,
        );
      }
    }
    if (pickedUri !== previous?.uri) {
      await T1ArcGlookoExport.releaseReportInboxAccessAsync(pickedUri).catch(
        () => false,
      );
    }
    throw error instanceof Error
      ? error
      : new Error('The Glooko report folder could not be saved.');
  }
}

export async function clearGlookoReportInbox() {
  const stored = await loadStoredInbox();
  if (stored) {
    const released =
      await T1ArcGlookoExport.releaseReportInboxAccessAsync(stored.uri).catch(
        () => false,
      );
    if (!released) {
      throw new Error('The saved Glooko report-folder access could not be released.');
    }
  }
  await SecureStore.deleteItemAsync(REPORT_INBOX_KEY);
}

export async function scanGlookoReportInbox(): Promise<GlookoReportInboxScan> {
  const stored = await loadStoredInbox();
  if (!stored) return { status: 'not-configured' };

  try {
    const directory = new Directory(stored.uri);
    if (!directory.exists) {
      return {
        status: 'unavailable',
        message:
          'Android can no longer read the selected report folder. Choose it again in Glooko settings.',
      };
    }
    const candidates = directory
      .list()
      .filter((entry): entry is File => entry instanceof File)
      .filter(isCandidate)
      .map(
        (file): GlookoReportInboxCandidate => ({
          uri: file.uri,
          fileName: file.name,
          byteLength: file.size,
          modifiedAt: file.lastModified ?? undefined,
        }),
      )
      .sort(
        (left, right) =>
          (right.modifiedAt ?? 0) - (left.modifiedAt ?? 0) ||
          right.fileName.localeCompare(left.fileName),
      )
      .slice(0, MAX_REPORT_CANDIDATES);
    const snapshotInput = candidates
      .map(
        (candidate) =>
          `${candidate.uri}\u0000${candidate.byteLength}\u0000${candidate.modifiedAt ?? 0}`,
      )
      .join('\u0001');
    const snapshot = await Crypto.digestStringAsync(
      Crypto.CryptoDigestAlgorithm.SHA256,
      snapshotInput,
    );
    return { status: 'ready', snapshot, candidates };
  } catch {
    return {
      status: 'unavailable',
      message:
        'Android can no longer read the selected report folder. Choose it again in Glooko settings.',
    };
  }
}
