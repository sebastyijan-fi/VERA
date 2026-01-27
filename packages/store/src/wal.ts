/**
 * VERA Write-Ahead Log (WAL)
 * 
 * Append-only log for crash-consistent storage.
 * Inspired by Firewood's compaction-less design.
 * 
 * Key features:
 * - Append-only writes (no in-place updates)
 * - Atomic commit records with checksums
 * - Fast recovery by replaying from last checkpoint
 * - Group commit support for batching fsyncs
 */

import * as fs from 'fs/promises';
import * as fsSync from 'fs';
import { createHash } from 'crypto';
import type { Key, Value } from './types.js';

// ============================================================================
// Types
// ============================================================================

/**
 * WAL record types
 */
export enum RecordType {
    /** Put a key-value pair */
    PUT = 1,
    /** Delete a key */
    DELETE = 2,
    /** Commit marker with state root */
    COMMIT = 3,
    /** Checkpoint marker for recovery */
    CHECKPOINT = 4,
}

/**
 * PUT record - stores a key-value pair
 */
export interface WALPutRecord {
    type: RecordType.PUT;
    key: Uint8Array;
    value: Uint8Array;
    timestamp: number;
}

/**
 * DELETE record - removes a key
 */
export interface WALDeleteRecord {
    type: RecordType.DELETE;
    key: Uint8Array;
    timestamp: number;
}

/**
 * COMMIT record - marks a state commitment
 */
export interface WALCommitRecord {
    type: RecordType.COMMIT;
    stateRoot: Uint8Array;
    height: bigint;
    timestamp: number;
}

/**
 * CHECKPOINT record - marks a recovery point
 */
export interface WALCheckpointRecord {
    type: RecordType.CHECKPOINT;
    stateRoot: Uint8Array;
    height: bigint;
    timestamp: number;
}

/**
 * Discriminated union of all WAL record types
 */
export type WALRecord = WALPutRecord | WALDeleteRecord | WALCommitRecord | WALCheckpointRecord;

/**
 * WAL options
 */
export interface WALOptions {
    /** Path to WAL file */
    path: string;
    /** Max WAL size before rotation (default: 256MB) */
    maxSize?: number;
    /** Whether to sync on every write (default: false for group commit) */
    syncOnWrite?: boolean;
    /** Group commit interval in ms (default: 10ms) */
    groupCommitInterval?: number;
    /** Batch size threshold to trigger group commit (default: 100) */
    groupCommitBatchSize?: number;
}

/**
 * Commit result
 */
export interface CommitResult {
    /** Log sequence number */
    lsn: bigint;
    /** Byte offset in WAL */
    offset: number;
}

// ============================================================================
// WAL Implementation
// ============================================================================

const MAGIC = 0x56455241; // "VERA" in ASCII
const VERSION = 1;
const HEADER_SIZE = 16; // magic(4) + version(4) + record_count(8)

/**
 * Write-Ahead Log for crash-consistent storage
 */
export class WriteAheadLog {
    private fd: number | null = null;
    private currentOffset = 0;
    private lsn = 0n;
    private pendingWrites: WALRecord[] = [];
    private commitTimer: NodeJS.Timeout | null = null;
    private pendingCommitResolvers: Array<{
        resolve: (result: CommitResult) => void;
        reject: (error: Error) => void;
    }> = [];

    constructor(private readonly options: WALOptions) { }

    /**
     * Open the WAL file, replay if exists
     */
    async open(): Promise<WALRecord[]> {
        const recovered: WALRecord[] = [];

        try {
            // Try to open existing WAL
            const stats = await fs.stat(this.options.path);
            if (stats.size > 0) {
                recovered.push(...await this.recover());
            }
        } catch (error: any) {
            if (error.code !== 'ENOENT') throw error;
            // File doesn't exist, create it
        }

        // Open for append
        this.fd = fsSync.openSync(this.options.path, 'a+');
        const stats = fsSync.fstatSync(this.fd);
        this.currentOffset = stats.size;

        // Write header if new file
        if (this.currentOffset === 0) {
            await this.writeHeader();
        }

        return recovered;
    }

    /**
     * Append a PUT record
     * Returns a promise that resolves when the write is durable (if group commit enabled)
     */
    async put(key: Key, value: Value): Promise<CommitResult | void> {
        const keyBytes = typeof key === 'string'
            ? new TextEncoder().encode(key)
            : key;

        this.pendingWrites.push({
            type: RecordType.PUT,
            key: keyBytes,
            value,
            timestamp: Date.now(),
        });

        if (this.options.syncOnWrite) {
            return this.flush();
        }

        // Check batch size threshold
        const batchSize = this.options.groupCommitBatchSize ?? 100;
        if (this.pendingWrites.length >= batchSize) {
            return this.flush();
        }

        // Schedule group commit (returns durability promise)
        return this.scheduleGroupCommit();
    }

    /**
     * Append a DELETE record
     * Returns a promise that resolves when the write is durable (if group commit enabled)
     */
    async delete(key: Key): Promise<CommitResult | void> {
        const keyBytes = typeof key === 'string'
            ? new TextEncoder().encode(key)
            : key;

        this.pendingWrites.push({
            type: RecordType.DELETE,
            key: keyBytes,
            timestamp: Date.now(),
        });

        if (this.options.syncOnWrite) {
            return this.flush();
        }

        // Check batch size threshold
        const batchSize = this.options.groupCommitBatchSize ?? 100;
        if (this.pendingWrites.length >= batchSize) {
            return this.flush();
        }

        // Schedule group commit
        return this.scheduleGroupCommit();
    }

    /**
     * Commit pending writes with state root
     */
    async commit(stateRoot: Uint8Array, height: bigint): Promise<CommitResult> {
        this.pendingWrites.push({
            type: RecordType.COMMIT,
            stateRoot,
            height,
            timestamp: Date.now(),
        });

        return this.flush();
    }

    /**
     * Write a checkpoint marker
     */
    async checkpoint(stateRoot: Uint8Array, height: bigint): Promise<CommitResult> {
        this.pendingWrites.push({
            type: RecordType.CHECKPOINT,
            stateRoot,
            height,
            timestamp: Date.now(),
        });

        return this.flush();
    }

    /**
     * Flush pending writes to disk
     */
    async flush(): Promise<CommitResult> {
        if (!this.fd) throw new Error('WAL not open');
        if (this.pendingWrites.length === 0) {
            return { lsn: this.lsn, offset: this.currentOffset };
        }

        // Encode all pending records
        const chunks: Uint8Array[] = [];
        for (const record of this.pendingWrites) {
            chunks.push(this.encodeRecord(record));
        }
        this.pendingWrites = [];

        // Calculate total size
        let totalSize = 0;
        for (const chunk of chunks) {
            totalSize += chunk.length;
        }

        // Concatenate into single buffer
        const buffer = new Uint8Array(totalSize);
        let offset = 0;
        for (const chunk of chunks) {
            buffer.set(chunk, offset);
            offset += chunk.length;
        }

        // Write atomically
        const bytesWritten = fsSync.writeSync(this.fd, buffer);
        this.currentOffset += bytesWritten;
        this.lsn += BigInt(chunks.length);

        // Sync to disk
        fsSync.fsyncSync(this.fd);

        const result = { lsn: this.lsn, offset: this.currentOffset };

        // Resolve all pending group commit promises
        if (this.pendingCommitResolvers.length > 0) {
            for (const resolver of this.pendingCommitResolvers) {
                resolver.resolve(result);
            }
            this.pendingCommitResolvers = [];
        }

        // Clear group commit timer if running
        if (this.commitTimer) {
            clearTimeout(this.commitTimer);
            this.commitTimer = null;
        }

        return result;
    }

    /**
     * Schedule a group commit
     */
    scheduleGroupCommit(): Promise<CommitResult> {
        return new Promise((resolve, reject) => {
            this.pendingCommitResolvers.push({ resolve, reject });

            if (!this.commitTimer) {
                const interval = this.options.groupCommitInterval ?? 10;
                this.commitTimer = setTimeout(async () => {
                    this.commitTimer = null;
                    try {
                        const result = await this.flush();
                        for (const resolver of this.pendingCommitResolvers) {
                            resolver.resolve(result);
                        }
                    } catch (error) {
                        for (const resolver of this.pendingCommitResolvers) {
                            resolver.reject(error as Error);
                        }
                    }
                    this.pendingCommitResolvers = [];
                }, interval);
            }
        });
    }

    /**
     * Recover records from existing WAL
     */
    private async recover(): Promise<WALRecord[]> {
        const records: WALRecord[] = [];
        const data = await fs.readFile(this.options.path);

        if (data.length < HEADER_SIZE) return records;

        // Verify header
        const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
        const magic = view.getUint32(0, true);
        if (magic !== MAGIC) {
            throw new Error('Invalid WAL file magic number');
        }

        const version = view.getUint32(4, true);
        if (version !== VERSION) {
            throw new Error(`Unsupported WAL version: ${version}`);
        }

        // Read records
        let offset = HEADER_SIZE;
        while (offset < data.length) {
            const result = this.decodeRecord(data, offset);
            if (!result) break;

            records.push(result.record);
            offset = result.nextOffset;
            this.lsn++;
        }

        return records;
    }

    /**
     * Encode a record to bytes
     */
    private encodeRecord(record: WALRecord): Uint8Array {
        // Extract fields based on record type using type narrowing
        let keyLen = 0;
        let valueLen = 0;
        let stateRootLen = 0;
        let height = 0n;
        let key: Uint8Array | null = null;
        let value: Uint8Array | null = null;
        let stateRoot: Uint8Array | null = null;

        switch (record.type) {
            case RecordType.PUT:
                key = record.key;
                value = record.value;
                keyLen = key.length;
                valueLen = value.length;
                break;
            case RecordType.DELETE:
                key = record.key;
                keyLen = key.length;
                break;
            case RecordType.COMMIT:
            case RecordType.CHECKPOINT:
                stateRoot = record.stateRoot;
                height = record.height;
                stateRootLen = stateRoot.length;
                break;
        }

        // Record format:
        // type(1) + keyLen(4) + valueLen(4) + stateRootLen(1) + height(8) + timestamp(8) + key + value + stateRoot + checksum(4)
        const headerSize = 1 + 4 + 4 + 1 + 8 + 8;
        const totalSize = headerSize + keyLen + valueLen + stateRootLen + 4;

        const buffer = new Uint8Array(totalSize);
        const view = new DataView(buffer.buffer);

        let offset = 0;
        view.setUint8(offset, record.type); offset += 1;
        view.setUint32(offset, keyLen, true); offset += 4;
        view.setUint32(offset, valueLen, true); offset += 4;
        view.setUint8(offset, stateRootLen); offset += 1;
        view.setBigUint64(offset, height, true); offset += 8;
        view.setBigUint64(offset, BigInt(record.timestamp), true); offset += 8;

        if (key) {
            buffer.set(key, offset);
            offset += keyLen;
        }
        if (value) {
            buffer.set(value, offset);
            offset += valueLen;
        }
        if (stateRoot) {
            buffer.set(stateRoot, offset);
            offset += stateRootLen;
        }

        // Calculate checksum of everything before checksum field
        const checksum = this.checksum32(buffer.subarray(0, offset));
        view.setUint32(offset, checksum, true);

        return buffer;
    }

    /**
     * Decode a record from bytes
     */
    private decodeRecord(data: Uint8Array, offset: number): { record: WALRecord; nextOffset: number } | null {
        if (offset + 26 > data.length) return null; // Minimum record size

        const view = new DataView(data.buffer, data.byteOffset + offset);

        let pos = 0;
        const type = view.getUint8(pos) as RecordType; pos += 1;
        const keyLen = view.getUint32(pos, true); pos += 4;
        const valueLen = view.getUint32(pos, true); pos += 4;
        const stateRootLen = view.getUint8(pos); pos += 1;
        const height = view.getBigUint64(pos, true); pos += 8;
        const timestamp = Number(view.getBigUint64(pos, true)); pos += 8;

        const totalSize = pos + keyLen + valueLen + stateRootLen + 4;
        if (offset + totalSize > data.length) return null;

        const keyData = data.subarray(offset + pos, offset + pos + keyLen);
        pos += keyLen;

        const valueData = data.subarray(offset + pos, offset + pos + valueLen);
        pos += valueLen;

        const stateRootData = data.subarray(offset + pos, offset + pos + stateRootLen);
        pos += stateRootLen;

        // Verify checksum
        const recordData = data.subarray(offset, offset + pos);
        const expectedChecksum = view.getUint32(pos, true);
        const actualChecksum = this.checksum32(recordData);

        if (expectedChecksum !== actualChecksum) {
            console.warn(`WAL checksum mismatch at offset ${offset}, skipping rest of log`);
            return null;
        }

        // Construct the appropriate record type
        let record: WALRecord;
        switch (type) {
            case RecordType.PUT:
                record = { type, key: keyData, value: valueData, timestamp };
                break;
            case RecordType.DELETE:
                record = { type, key: keyData, timestamp };
                break;
            case RecordType.COMMIT:
                record = { type, stateRoot: stateRootData, height, timestamp };
                break;
            case RecordType.CHECKPOINT:
                record = { type, stateRoot: stateRootData, height, timestamp };
                break;
            default:
                console.warn(`Unknown WAL record type: ${type}`);
                return null;
        }

        return { record, nextOffset: offset + totalSize };
    }

    /**
     * Write WAL header
     */
    private async writeHeader(): Promise<void> {
        if (!this.fd) throw new Error('WAL not open');

        const header = new Uint8Array(HEADER_SIZE);
        const view = new DataView(header.buffer);

        view.setUint32(0, MAGIC, true);
        view.setUint32(4, VERSION, true);
        view.setBigUint64(8, 0n, true); // Record count (updated on close)

        fsSync.writeSync(this.fd, header);
        this.currentOffset = HEADER_SIZE;
    }

    /**
     * 32-bit checksum using first 4 bytes of SHA256
     * More robust than CRC32 and universally supported
     */
    private checksum32(data: Uint8Array): number {
        const hash = createHash('sha256');
        hash.update(data);
        const digest = hash.digest();
        // Use first 4 bytes as 32-bit checksum
        return digest.readUInt32LE(0);
    }

    /**
     * Get current log size
     */
    get size(): number {
        return this.currentOffset;
    }

    /**
     * Get current LSN
     */
    get currentLSN(): bigint {
        return this.lsn;
    }

    /**
     * Close the WAL
     */
    async close(): Promise<void> {
        if (this.commitTimer) {
            clearTimeout(this.commitTimer);
            this.commitTimer = null;
        }

        // Flush any pending writes
        if (this.pendingWrites.length > 0) {
            await this.flush();
        }

        if (this.fd !== null) {
            fsSync.closeSync(this.fd);
            this.fd = null;
        }
    }

    /**
     * Truncate WAL after checkpoint (rotate)
     */
    async rotate(): Promise<void> {
        if (!this.fd) throw new Error('WAL not open');

        // Close current file
        fsSync.closeSync(this.fd);

        // Rename to backup
        const backupPath = `${this.options.path}.${Date.now()}.bak`;
        await fs.rename(this.options.path, backupPath);

        // Create new file
        this.fd = fsSync.openSync(this.options.path, 'a+');
        this.currentOffset = 0;
        this.lsn = 0n;
        await this.writeHeader();
    }
}
