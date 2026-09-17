function wipe(bytes: Uint8Array) {
  bytes.fill(0);
}

/**
 * Owns raw Dexcom file buffers across picker, preview and import phases. An
 * active parser or database write keeps its buffer until that work settles;
 * retained preview buffers are wiped immediately when the UI is disposed.
 */
export class DexcomImportLifecycle {
  private mounted = false;
  private generation = 0;
  private readonly buffers = new Set<Uint8Array>();
  private readonly inUse = new Set<Uint8Array>();

  activate() {
    this.mounted = true;
  }

  dispose() {
    this.mounted = false;
    this.generation += 1;
    [...this.buffers].forEach((bytes) => {
      if (!this.inUse.has(bytes)) this.release(bytes);
    });
  }

  beginSelection() {
    this.generation += 1;
    return this.generation;
  }

  isCurrent(generation: number) {
    return this.mounted && generation === this.generation;
  }

  isMounted() {
    return this.mounted;
  }

  trackPreparation(bytes: Uint8Array) {
    if (!this.mounted) {
      wipe(bytes);
      return false;
    }
    this.buffers.add(bytes);
    this.inUse.add(bytes);
    return true;
  }

  retainPreview(bytes: Uint8Array) {
    if (!this.buffers.has(bytes)) return false;
    this.inUse.delete(bytes);
    if (!this.mounted) {
      this.release(bytes);
      return false;
    }
    return true;
  }

  beginImport(bytes: Uint8Array) {
    if (
      !this.mounted ||
      !this.buffers.has(bytes) ||
      this.inUse.has(bytes)
    ) {
      return false;
    }
    this.inUse.add(bytes);
    return true;
  }

  release(bytes: Uint8Array) {
    wipe(bytes);
    this.inUse.delete(bytes);
    this.buffers.delete(bytes);
  }
}
