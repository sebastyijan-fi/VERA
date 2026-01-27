/**
 * VERA Binary Snapshot Manager
 * 
 * Streaming binary snapshots for state persistence.
 * Replaces JSON-based SnapshotManager with proper binary format.
 * 
 * Features:
 * - CBOR encoding (compact, fast)
 * - Streaming read/write (memory efficient)
 * - Per-entry checksums (integrity)
 * - Height-indexed (fast sync)
 */

import * as fs from 'fs/promises';
import * as fsSync from 'fs';
import { createHash } from 'crypto';
import { encode, decode } from 'cbor-x';

// ============================================================================
// Types
// ============================================================================

/**
 * Snapshot metadata header
 */
export interface SnapshotHeader {
    /** Format version */
    version: number;
    /** Block height this snapshot represents */
    height: bigint;
    /** State root at this height */
    stateRoot: Uint8Array;
    /** Number of entries in snapshot */
    entryCount: number;
    /** Timestamp of snapshot creation */
    createdAt: number;
    /** SHA256 of all entry checksums (for full verification) */
    entriesHash: Uint8Array;
}

/**
 * A single state entry in the snapshot
 */
export interface SnapshotEntry {
    /** State key (namespace + id) */
    key: {
        namespace: string;
        id: Uint8Array;
    };
    /** State value */
    value: {
        data: Uint8Array;
        lastModified: bigint;
        schema: {
            moduleId: Uint8Array;
            schemaName: string;
            version: number;
        };
    };
}

/**
 * Snapshot options
 */
export interface BinarySnapshotOptions {
    /** Directory for snapshot files */
    directory: string;
}

// ============================================================================
// Constants
// ============================================================================

const MAGIC = 0x56534E50; // "VSNP" in ASCII
const VERSION = 1;
const HEADER_SIZE = 128;

// ============================================================================
// Implementation
// ============================================================================

/**
 * Binary snapshot manager for state persistence
 */
export class BinarySnapshotManager {
    constructor(private readonly options: BinarySnapshotOptions) { }

    /**
     * Create a snapshot from state entries
     */
    async save(
        height: bigint,
        stateRoot: Uint8Array,
        entries: Iterable<SnapshotEntry>
    ): Promise<string> {
        const filePath = this.getSnapshotPath(height);

        // Ensure directory exists
        await fs.mkdir(this.options.directory, { recursive: true });

        // Open file for writing
        const fd = fsSync.openSync(filePath, 'w');

        try {
            // Write placeholder header (will update at end)
            const headerBuffer = new Uint8Array(HEADER_SIZE);
            fsSync.writeSync(fd, headerBuffer);

            // Write entries and collect checksums
            const checksums: Uint8Array[] = [];
            let entryCount = 0;

            for (const entry of entries) {
                const record = this.encodeEntry(entry);
                fsSync.writeSync(fd, record);

                // Collect checksum for verification
                const checksum = this.checksum(record);
                checksums.push(checksum);
                entryCount++;
            }

            // Calculate entries hash
            const entriesHash = this.hashChecksums(checksums);

            // Write final header
            const header: SnapshotHeader = {
                version: VERSION,
                height,
                stateRoot,
                entryCount,
                createdAt: Date.now(),
                entriesHash,
            };

            this.writeHeader(fd, header);
            fsSync.fsyncSync(fd);

            return filePath;
        } finally {
            fsSync.closeSync(fd);
        }
    }

    /**
     * Load entries from a snapshot (streaming)
     */
    async *load(filePath: string): AsyncGenerator<SnapshotEntry> {
        const fd = fsSync.openSync(filePath, 'r');

        try {
            // Read and verify header
            const header = this.readHeader(fd);

            // Read entries - each entry has its own checksum verified in readEntryAt
            let offset = HEADER_SIZE;

            for (let i = 0; i < header.entryCount; i++) {
                const result = this.readEntryAt(fd, offset);
                if (!result) {
                    throw new Error(`Failed to read entry ${i} at offset ${offset}`);
                }

                offset = result.nextOffset;
                yield result.entry;
            }
        } finally {
            fsSync.closeSync(fd);
        }
    }

    /**
     * Load snapshot metadata without reading entries
     */
    async getMetadata(filePath: string): Promise<SnapshotHeader> {
        const fd = fsSync.openSync(filePath, 'r');
        try {
            return this.readHeader(fd);
        } finally {
            fsSync.closeSync(fd);
        }
    }

    /**
     * List available snapshots
     */
    async list(): Promise<{ height: bigint; path: string; header: SnapshotHeader }[]> {
        const results: { height: bigint; path: string; header: SnapshotHeader }[] = [];

        try {
            const files = await fs.readdir(this.options.directory);

            for (const file of files) {
                if (!file.endsWith('.vsnap')) continue;

                const filePath = `${this.options.directory}/${file}`;
                try {
                    const header = await this.getMetadata(filePath);
                    results.push({ height: header.height, path: filePath, header });
                } catch {
                    // Skip invalid snapshots
                }
            }

            // Sort by height
            results.sort((a, b) => Number(a.height - b.height));
        } catch {
            // Directory doesn't exist
        }

        return results;
    }

    /**
     * Find the closest snapshot at or before a given height
     */
    async findClosest(height: bigint): Promise<{ height: bigint; path: string } | null> {
        const snapshots = await this.list();

        for (let i = snapshots.length - 1; i >= 0; i--) {
            const snap = snapshots[i];
            if (snap && snap.height <= height) {
                return { height: snap.height, path: snap.path };
            }
        }

        return null;
    }

    /**
     * Delete a snapshot
     */
    async delete(height: bigint): Promise<void> {
        const filePath = this.getSnapshotPath(height);
        await fs.unlink(filePath);
    }

    /**
     * Prune old snapshots, keeping only the N most recent
     */
    async prune(keepCount: number): Promise<number> {
        const snapshots = await this.list();
        const toDelete = snapshots.slice(0, -keepCount);

        for (const snap of toDelete) {
            await fs.unlink(snap.path);
        }

        return toDelete.length;
    }

    // ========================================================================
    // Private Methods
    // ========================================================================

    private getSnapshotPath(height: bigint): string {
        return `${this.options.directory}/snapshot_${height.toString().padStart(16, '0')}.vsnap`;
    }

    private writeHeader(fd: number, header: SnapshotHeader): void {
        const buffer = new Uint8Array(HEADER_SIZE);
        const view = new DataView(buffer.buffer);

        let offset = 0;
        view.setUint32(offset, MAGIC, true); offset += 4;
        view.setUint32(offset, header.version, true); offset += 4;
        view.setBigUint64(offset, header.height, true); offset += 8;
        buffer.set(header.stateRoot.subarray(0, 32), offset); offset += 32;
        view.setUint32(offset, header.entryCount, true); offset += 4;
        view.setBigUint64(offset, BigInt(header.createdAt), true); offset += 8;
        buffer.set(header.entriesHash.subarray(0, 32), offset); offset += 32;

        // Checksum of header content
        const checksum = this.checksum32(buffer.subarray(0, 88));
        view.setUint32(88, checksum, true);

        // Write at start of file
        fsSync.writeSync(fd, buffer, 0, HEADER_SIZE, 0);
    }

    private readHeader(fd: number): SnapshotHeader {
        const buffer = Buffer.alloc(HEADER_SIZE);
        fsSync.readSync(fd, buffer, 0, HEADER_SIZE, 0);

        const view = new DataView(buffer.buffer, buffer.byteOffset);

        const magic = view.getUint32(0, true);
        if (magic !== MAGIC) {
            throw new Error('Invalid snapshot magic number');
        }

        let offset = 4;
        const version = view.getUint32(offset, true); offset += 4;
        if (version !== VERSION) {
            throw new Error(`Unsupported snapshot version: ${version}`);
        }

        const height = view.getBigUint64(offset, true); offset += 8;
        const stateRoot = new Uint8Array(buffer.subarray(offset, offset + 32)); offset += 32;
        const entryCount = view.getUint32(offset, true); offset += 4;
        const createdAt = Number(view.getBigUint64(offset, true)); offset += 8;
        const entriesHash = new Uint8Array(buffer.subarray(offset, offset + 32)); offset += 32;

        // Verify checksum
        const expectedChecksum = view.getUint32(88, true);
        const actualChecksum = this.checksum32(buffer.subarray(0, 88));
        if (expectedChecksum !== actualChecksum) {
            throw new Error('Snapshot header checksum mismatch');
        }

        return { version, height, stateRoot, entryCount, createdAt, entriesHash };
    }

    private encodeEntry(entry: SnapshotEntry): Uint8Array {
        const cbor = encode({
            key: {
                namespace: entry.key.namespace,
                id: entry.key.id,
            },
            value: {
                data: entry.value.data,
                lastModified: entry.value.lastModified.toString(),
                schema: {
                    moduleId: entry.value.schema.moduleId,
                    schemaName: entry.value.schema.schemaName,
                    version: entry.value.schema.version,
                },
            },
        });

        // Record format: length(4) + checksum(4) + cbor
        const record = new Uint8Array(8 + cbor.length);
        const view = new DataView(record.buffer);

        view.setUint32(0, cbor.length, true);
        view.setUint32(4, this.checksum32(cbor), true);
        record.set(cbor, 8);

        return record;
    }

    private readEntryAt(fd: number, offset: number): { entry: SnapshotEntry; record: Uint8Array; nextOffset: number } | null {
        // Read header
        const headerBuf = Buffer.alloc(8);
        const bytesRead = fsSync.readSync(fd, headerBuf, 0, 8, offset);
        if (bytesRead < 8) return null;

        const view = new DataView(headerBuf.buffer, headerBuf.byteOffset);
        const length = view.getUint32(0, true);
        const expectedChecksum = view.getUint32(4, true);

        // Read CBOR data
        const dataBuf = Buffer.alloc(length);
        fsSync.readSync(fd, dataBuf, 0, length, offset + 8);

        // Verify checksum
        const actualChecksum = this.checksum32(dataBuf);
        if (expectedChecksum !== actualChecksum) {
            throw new Error(`Entry checksum mismatch at offset ${offset}`);
        }

        // Decode CBOR
        const decoded = decode(dataBuf);
        const entry: SnapshotEntry = {
            key: {
                namespace: decoded.key.namespace,
                id: new Uint8Array(decoded.key.id),
            },
            value: {
                data: new Uint8Array(decoded.value.data),
                lastModified: BigInt(decoded.value.lastModified),
                schema: {
                    moduleId: new Uint8Array(decoded.value.schema.moduleId),
                    schemaName: decoded.value.schema.schemaName,
                    version: decoded.value.schema.version,
                },
            },
        };

        // Reconstruct the full record using Buffer.concat for proper byte layout
        const record = Buffer.concat([headerBuf, dataBuf]);

        return { entry, record: new Uint8Array(record), nextOffset: offset + 8 + length };
    }

    private checksum(data: Uint8Array): Uint8Array {
        const hash = createHash('sha256');
        hash.update(data);
        return hash.digest();
    }

    private checksum32(data: Uint8Array): number {
        const hash = createHash('sha256');
        hash.update(data);
        return hash.digest().readUInt32LE(0);
    }

    private hashChecksums(checksums: Uint8Array[]): Uint8Array {
        const hash = createHash('sha256');
        for (const cs of checksums) {
            hash.update(cs);
        }
        return hash.digest();
    }
}
