/**
 * VERA Commit Log
 * 
 * Binary commit log for state persistence and auditing.
 * Uses CBOR encoding with SHA256 checksums.
 * 
 * Features:
 * - Height-indexed commits for fast sync
 * - Streaming read/write for large state
 * - Integrity verification via checksums
 * - Links to WAL for crash recovery
 */

import * as fs from 'fs/promises';
import * as fsSync from 'fs';
import * as path from 'path';
import { createHash } from 'crypto';
import { encode, decode } from 'cbor-x';

// ============================================================================
// Types
// ============================================================================

/**
 * A single commit in the log
 */
export interface CommitEntry {
    /** Block height */
    height: bigint;
    /** State root hash */
    stateRoot: Uint8Array;
    /** Previous state root (for verification) */
    prevStateRoot: Uint8Array;
    /** Timestamp of commit */
    timestamp: number;
    /** Number of state changes in this commit */
    changeCount: number;
    /** WAL LSN this commit corresponds to */
    walLSN: bigint;
    /** Optional metadata (e.g., block hash, proposer) */
    metadata?: Record<string, unknown>;
}

/**
 * Commit log header
 */
interface CommitLogHeader {
    magic: number;
    version: number;
    genesisRoot: Uint8Array;
    createdAt: number;
}

/**
 * Commit log options
 */
export interface CommitLogOptions {
    /** Path to commit log file */
    path: string;
    /** Genesis state root */
    genesisRoot?: Uint8Array;
}

// ============================================================================
// Constants
// ============================================================================

const MAGIC = 0x564C4F47; // "VLOG" in ASCII
const VERSION = 1;
const HEADER_SIZE = 64; // Fixed header size

// ============================================================================
// Implementation
// ============================================================================

/**
 * Binary commit log with CBOR encoding
 */
export class CommitLog {
    private fd: number | null = null;
    private header: CommitLogHeader | null = null;
    private indexCache: Map<bigint, number> = new Map(); // height -> file offset
    private latestHeight = -1n;

    constructor(private readonly options: CommitLogOptions) { }

    /**
     * Open or create the commit log
     */
    async open(): Promise<void> {
        // Reset state
        this.indexCache.clear();
        this.latestHeight = -1n;
        this.header = null;

        // Ensure parent directory exists
        const dir = path.dirname(this.options.path);
        await fs.mkdir(dir, { recursive: true });

        try {
            const stats = await fs.stat(this.options.path);
            if (stats.size >= HEADER_SIZE) {
                // Open existing
                this.fd = fsSync.openSync(this.options.path, 'r+');
                await this.readHeader();
                await this.buildIndex();
            } else {
                // Create new
                this.fd = fsSync.openSync(this.options.path, 'w+');
                await this.writeHeader();
            }
        } catch (error: any) {
            if (error.code === 'ENOENT') {
                // Create new
                this.fd = fsSync.openSync(this.options.path, 'w+');
                await this.writeHeader();
            } else {
                throw error;
            }
        }
    }

    /**
     * Append a commit to the log
     */
    async append(entry: CommitEntry): Promise<void> {
        if (!this.fd) throw new Error('CommitLog not open');

        // Validate height is sequential (first commit must be 0, subsequent must increment)
        const expectedHeight = this.latestHeight < 0n ? 0n : this.latestHeight + 1n;
        if (entry.height !== expectedHeight) {
            throw new Error(
                `Non-sequential commit: expected height ${expectedHeight}, got ${entry.height}`
            );
        }

        // Encode entry
        const record = this.encodeEntry(entry);

        // Write to file at the correct position (after header + existing entries)
        const offset = fsSync.fstatSync(this.fd).size;
        fsSync.writeSync(this.fd, record, 0, record.length, offset);
        fsSync.fsyncSync(this.fd);

        // Update index
        this.indexCache.set(entry.height, offset);
        this.latestHeight = entry.height;
    }

    /**
     * Get a commit by height
     */
    async get(height: bigint): Promise<CommitEntry | null> {
        if (!this.fd) throw new Error('CommitLog not open');

        const offset = this.indexCache.get(height);
        if (offset === undefined) return null;

        return this.readEntryAt(offset);
    }

    /**
     * Get the latest commit
     */
    async getLatest(): Promise<CommitEntry | null> {
        if (this.latestHeight < 0n) return null;
        return this.get(this.latestHeight);
    }

    /**
     * Get all commits in a range (inclusive)
     */
    async getRange(fromHeight: bigint, toHeight: bigint): Promise<CommitEntry[]> {
        const entries: CommitEntry[] = [];
        for (let h = fromHeight; h <= toHeight; h++) {
            const entry = await this.get(h);
            if (entry) entries.push(entry);
        }
        return entries;
    }

    /**
     * Verify the commit chain integrity
     */
    async verify(): Promise<{ valid: boolean; lastValidHeight: bigint; error?: string }> {
        if (this.latestHeight < 0n) {
            return { valid: true, lastValidHeight: -1n };
        }

        let prevRoot = this.header?.genesisRoot ?? new Uint8Array(32);

        for (let h = 0n; h <= this.latestHeight; h++) {
            const entry = await this.get(h);
            if (!entry) {
                return { valid: false, lastValidHeight: h - 1n, error: `Missing commit at height ${h}` };
            }

            // Verify chain linkage
            if (!this.bytesEqual(entry.prevStateRoot, prevRoot)) {
                return {
                    valid: false,
                    lastValidHeight: h - 1n,
                    error: `Chain break at height ${h}: prevStateRoot mismatch`,
                };
            }

            prevRoot = entry.stateRoot;
        }

        return { valid: true, lastValidHeight: this.latestHeight };
    }

    /**
     * Get current height
     */
    get height(): bigint {
        return this.latestHeight;
    }

    /**
     * Get genesis root
     */
    get genesisRoot(): Uint8Array | null {
        return this.header?.genesisRoot ?? null;
    }

    /**
     * Close the commit log
     */
    async close(): Promise<void> {
        if (this.fd !== null) {
            fsSync.closeSync(this.fd);
            this.fd = null;
        }
    }

    // ========================================================================
    // Private Methods
    // ========================================================================

    private async writeHeader(): Promise<void> {
        if (!this.fd) throw new Error('CommitLog not open');

        const genesisRoot = this.options.genesisRoot ?? new Uint8Array(32);
        const createdAt = Date.now();

        this.header = {
            magic: MAGIC,
            version: VERSION,
            genesisRoot,
            createdAt,
        };

        // Use Buffer for consistency with readHeader
        const buffer = Buffer.alloc(HEADER_SIZE);
        buffer.writeUInt32LE(MAGIC, 0);
        buffer.writeUInt32LE(VERSION, 4);
        buffer.set(genesisRoot.subarray(0, 32), 8);
        buffer.writeBigUInt64LE(BigInt(createdAt), 40);

        // Checksum of header content
        const checksum = this.checksum32(buffer.subarray(0, 48));
        buffer.writeUInt32LE(checksum, 48);

        fsSync.writeSync(this.fd, buffer, 0, HEADER_SIZE, 0);
        fsSync.fsyncSync(this.fd);
    }

    private async readHeader(): Promise<void> {
        if (!this.fd) throw new Error('CommitLog not open');

        const buffer = Buffer.alloc(HEADER_SIZE);
        fsSync.readSync(this.fd, buffer, 0, HEADER_SIZE, 0);

        // Use Buffer methods directly for proper byte handling
        const magic = buffer.readUInt32LE(0);
        if (magic !== MAGIC) {
            throw new Error('Invalid CommitLog magic number');
        }

        const version = buffer.readUInt32LE(4);
        if (version !== VERSION) {
            throw new Error(`Unsupported CommitLog version: ${version}`);
        }

        const genesisRoot = new Uint8Array(buffer.subarray(8, 40));
        const createdAt = Number(buffer.readBigUInt64LE(40));

        // Verify checksum
        const expectedChecksum = buffer.readUInt32LE(48);
        const actualChecksum = this.checksum32(buffer.subarray(0, 48));
        if (expectedChecksum !== actualChecksum) {
            throw new Error('CommitLog header checksum mismatch');
        }

        this.header = { magic, version, genesisRoot, createdAt };
    }

    private async buildIndex(): Promise<void> {
        if (!this.fd) return;

        const stats = fsSync.fstatSync(this.fd);
        let offset = HEADER_SIZE;

        while (offset < stats.size) {
            const entry = this.readEntryAt(offset);
            if (!entry) break;

            this.indexCache.set(entry.height, offset);
            this.latestHeight = entry.height;

            // Calculate record size to move to next
            const recordSize = this.calculateRecordSize(entry);
            offset += recordSize;
        }
    }

    private readEntryAt(offset: number): CommitEntry | null {
        if (!this.fd) return null;

        try {
            // Read record header: length(4) + checksum(4)
            const headerBuf = Buffer.alloc(8);
            const bytesRead = fsSync.readSync(this.fd, headerBuf, 0, 8, offset);
            if (bytesRead < 8) return null;

            const view = new DataView(headerBuf.buffer, headerBuf.byteOffset);
            const length = view.getUint32(0, true);
            const expectedChecksum = view.getUint32(4, true);

            // Read CBOR data
            const dataBuf = Buffer.alloc(length);
            fsSync.readSync(this.fd, dataBuf, 0, length, offset + 8);

            // Verify checksum
            const actualChecksum = this.checksum32(dataBuf);
            if (expectedChecksum !== actualChecksum) {
                console.warn(`CommitLog checksum mismatch at offset ${offset}`);
                return null;
            }

            // Decode CBOR
            const decoded = decode(dataBuf);
            return {
                height: BigInt(decoded.height),
                stateRoot: new Uint8Array(decoded.stateRoot),
                prevStateRoot: new Uint8Array(decoded.prevStateRoot),
                timestamp: decoded.timestamp,
                changeCount: decoded.changeCount,
                walLSN: BigInt(decoded.walLSN),
                metadata: decoded.metadata,
            };
        } catch {
            return null;
        }
    }

    private encodeEntry(entry: CommitEntry): Uint8Array {
        // Encode to CBOR (convert BigInt to string for CBOR compatibility)
        const cbor = encode({
            height: entry.height.toString(),
            stateRoot: entry.stateRoot,
            prevStateRoot: entry.prevStateRoot,
            timestamp: entry.timestamp,
            changeCount: entry.changeCount,
            walLSN: entry.walLSN.toString(),
            metadata: entry.metadata,
        });

        // Record format: length(4) + checksum(4) + cbor_data
        const record = new Uint8Array(8 + cbor.length);
        const view = new DataView(record.buffer);

        view.setUint32(0, cbor.length, true);
        view.setUint32(4, this.checksum32(cbor), true);
        record.set(cbor, 8);

        return record;
    }

    private calculateRecordSize(entry: CommitEntry): number {
        const cbor = encode({
            height: entry.height.toString(),
            stateRoot: entry.stateRoot,
            prevStateRoot: entry.prevStateRoot,
            timestamp: entry.timestamp,
            changeCount: entry.changeCount,
            walLSN: entry.walLSN.toString(),
            metadata: entry.metadata,
        });
        return 8 + cbor.length;
    }

    private checksum32(data: Uint8Array): number {
        const hash = createHash('sha256');
        hash.update(data);
        const digest = hash.digest();
        return digest.readUInt32LE(0);
    }

    private bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
        if (a.length !== b.length) return false;
        for (let i = 0; i < a.length; i++) {
            if (a[i] !== b[i]) return false;
        }
        return true;
    }
}
