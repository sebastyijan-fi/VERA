/**
 * VERA Append-Only Store
 * 
 * A Store wrapper that uses Write-Ahead Logging for crash consistency.
 * Combines an in-memory index with persistent WAL for durability.
 * 
 * Key features:
 * - All writes go to WAL first (crash safe)
 * - In-memory index for reads (fast)
 * - Periodic checkpointing to main store
 * - Group commit for amortized fsync cost
 */

import type { Store, Batch, Key, Value, StoreIterator, IteratorOptions, WriteOptions } from './types.js';
import { WriteAheadLog, RecordType, type WALRecord, type WALOptions } from './wal.js';

// ============================================================================
// Types
// ============================================================================

/**
 * Options for AppendOnlyStore
 */
export interface AppendOnlyStoreOptions {
    /** Underlying store for checkpointed data */
    baseStore: Store;
    /** WAL options */
    wal: WALOptions;
    /** Checkpoint interval (in commits) */
    checkpointInterval?: number;
    /** Enable group commit (default: true) */
    groupCommit?: boolean;
}

// ============================================================================
// Implementation
// ============================================================================

/**
 * Append-only store with WAL-based crash recovery
 */
export class AppendOnlyStore implements Store {
    private readonly baseStore: Store;
    private readonly wal: WriteAheadLog;
    private readonly memIndex: Map<string, Uint8Array | null> = new Map();
    private commitsSinceCheckpoint = 0;
    private readonly checkpointInterval: number;

    constructor(options: AppendOnlyStoreOptions) {
        this.baseStore = options.baseStore;
        this.wal = new WriteAheadLog(options.wal);
        this.checkpointInterval = options.checkpointInterval ?? 1000;
    }

    /**
     * Open the store and recover from WAL if needed
     */
    async open(): Promise<void> {
        const recovered = await this.wal.open();

        // Replay WAL records to rebuild in-memory index
        for (const record of recovered) {
            this.applyRecord(record);
        }

        console.log(`AppendOnlyStore: Recovered ${recovered.length} records from WAL`);
    }

    /**
     * Apply a WAL record to in-memory index
     */
    private applyRecord(record: WALRecord): void {
        if (record.type === RecordType.PUT && record.key && record.value) {
            this.memIndex.set(this.keyToString(record.key), new Uint8Array(record.value));
        } else if (record.type === RecordType.DELETE && record.key) {
            this.memIndex.set(this.keyToString(record.key), null);
        }
    }

    async put(key: Key, value: Value, options?: WriteOptions): Promise<void> {
        const keyStr = this.keyToString(key);

        // Write to WAL first
        await this.wal.put(key, value);

        // Update in-memory index
        this.memIndex.set(keyStr, value);

        // Sync if requested
        if (options?.sync) {
            await this.wal.flush();
        }
    }

    async get(key: Key): Promise<Value | undefined> {
        const keyStr = this.keyToString(key);

        // Check in-memory index first (includes pending WAL writes)
        if (this.memIndex.has(keyStr)) {
            const value = this.memIndex.get(keyStr);
            return value ?? undefined; // null means deleted
        }

        // Fall back to base store
        return this.baseStore.get(key);
    }

    async del(key: Key): Promise<void> {
        const keyStr = this.keyToString(key);

        // Write to WAL first
        await this.wal.delete(key);

        // Mark as deleted in index
        this.memIndex.set(keyStr, null);
    }

    batch(): Batch {
        return new AppendOnlyBatch(this.wal, this.memIndex);
    }

    /**
     * Commit pending writes with state root
     */
    async commit(stateRoot: Uint8Array, height: bigint): Promise<void> {
        await this.wal.commit(stateRoot, height);
        this.commitsSinceCheckpoint++;

        // Check if we need to checkpoint
        if (this.commitsSinceCheckpoint >= this.checkpointInterval) {
            await this.checkpoint(stateRoot, height);
        }
    }

    /**
     * Checkpoint: flush memIndex to base store and rotate WAL
     */
    async checkpoint(stateRoot: Uint8Array, height: bigint): Promise<void> {
        console.log(`AppendOnlyStore: Checkpointing at height ${height}...`);

        // Batch write all in-memory changes to base store
        const batch = this.baseStore.batch();
        let puts = 0;
        let dels = 0;

        for (const [keyStr, value] of this.memIndex.entries()) {
            if (value === null) {
                batch.del(keyStr);
                dels++;
            } else {
                batch.put(keyStr, value);
                puts++;
            }
        }

        await batch.write({ sync: true });

        // Write checkpoint to WAL and rotate
        await this.wal.checkpoint(stateRoot, height);
        await this.wal.rotate();

        // Clear in-memory index
        this.memIndex.clear();
        this.commitsSinceCheckpoint = 0;

        console.log(`AppendOnlyStore: Checkpoint complete (${puts} puts, ${dels} dels)`);
    }

    iterator(options?: IteratorOptions): StoreIterator {
        // Merge iterator: in-memory + base store
        return new MergedIterator(this.memIndex, this.baseStore.iterator(options), options);
    }

    snapshot(): Store {
        // Create a snapshot of current state
        return new AppendOnlySnapshot(this.baseStore.snapshot(), new Map(this.memIndex));
    }

    async clear(): Promise<void> {
        this.memIndex.clear();
        await this.baseStore.clear();
        await this.wal.rotate();
    }

    async close(): Promise<void> {
        // Flush pending writes
        await this.wal.close();
        await this.baseStore.close();
    }

    private keyToString(key: Key): string {
        if (typeof key === 'string') return key;
        return Buffer.from(key).toString('utf8');
    }

    /**
     * Get current WAL size
     */
    get walSize(): number {
        return this.wal.size;
    }

    /**
     * Get number of pending changes in memory
     */
    get pendingChanges(): number {
        return this.memIndex.size;
    }
}

// ============================================================================
// Batch Implementation
// ============================================================================

class AppendOnlyBatch implements Batch {
    private readonly operations: Array<{ type: 'put' | 'del'; key: Key; value?: Value }> = [];

    constructor(
        private readonly wal: WriteAheadLog,
        private readonly memIndex: Map<string, Uint8Array | null>
    ) { }

    put(key: Key, value: Value): Batch {
        this.operations.push({ type: 'put', key, value });
        return this;
    }

    del(key: Key): Batch {
        this.operations.push({ type: 'del', key });
        return this;
    }

    async write(options?: WriteOptions): Promise<void> {
        // Write all operations to WAL
        for (const op of this.operations) {
            if (op.type === 'put' && op.value) {
                await this.wal.put(op.key, op.value);
                this.memIndex.set(this.keyToString(op.key), op.value);
            } else if (op.type === 'del') {
                await this.wal.delete(op.key);
                this.memIndex.set(this.keyToString(op.key), null);
            }
        }

        // Flush if sync requested
        if (options?.sync) {
            await this.wal.flush();
        }
    }

    private keyToString(key: Key): string {
        if (typeof key === 'string') return key;
        return Buffer.from(key).toString('utf8');
    }
}

// ============================================================================
// Merged Iterator
// ============================================================================

class MergedIterator implements StoreIterator {
    private memEntries: Array<[string, Uint8Array | null]>;
    private memIdx = 0;

    constructor(
        memIndex: Map<string, Uint8Array | null>,
        private readonly baseIterator: StoreIterator,
        _options?: IteratorOptions
    ) {
        // Sort memory entries for consistent iteration
        this.memEntries = [...memIndex.entries()].sort((a, b) => a[0].localeCompare(b[0]));
    }

    async next(): Promise<[Key, Value] | undefined> {
        // Simple implementation: iterate memory first, then base
        // (A proper implementation would merge-sort both)
        while (this.memIdx < this.memEntries.length) {
            const [key, value] = this.memEntries[this.memIdx]!;
            this.memIdx++;
            if (value !== null) {
                return [key, value];
            }
            // Skip deleted entries
        }

        // Then iterate base, skipping keys in memory
        while (true) {
            const entry = await this.baseIterator.next();
            if (!entry) return undefined;

            const [key] = entry;
            const keyStr = typeof key === 'string' ? key : Buffer.from(key).toString('utf8');

            // Skip if key was modified in memory
            if (this.memEntries.some(([k]) => k === keyStr)) {
                continue;
            }

            return entry;
        }
    }

    async all(): Promise<Array<[Key, Value]>> {
        const results: Array<[Key, Value]> = [];
        let entry: [Key, Value] | undefined;
        while ((entry = await this.next()) !== undefined) {
            results.push(entry);
        }
        return results;
    }

    async end(): Promise<void> {
        await this.baseIterator.end();
    }
}

// ============================================================================
// Snapshot
// ============================================================================

class AppendOnlySnapshot implements Store {
    constructor(
        private readonly baseSnapshot: Store,
        private readonly memSnapshot: Map<string, Uint8Array | null>
    ) { }

    async get(key: Key): Promise<Value | undefined> {
        const keyStr = typeof key === 'string' ? key : Buffer.from(key).toString('utf8');

        if (this.memSnapshot.has(keyStr)) {
            const value = this.memSnapshot.get(keyStr);
            return value ?? undefined;
        }

        return this.baseSnapshot.get(key);
    }

    async put(): Promise<void> { throw new Error('Snapshot is read-only'); }
    async del(): Promise<void> { throw new Error('Snapshot is read-only'); }
    async clear(): Promise<void> { throw new Error('Snapshot is read-only'); }
    batch(): Batch { throw new Error('Snapshot is read-only'); }

    iterator(_options?: IteratorOptions): StoreIterator {
        return new MergedIterator(this.memSnapshot, this.baseSnapshot.iterator(_options));
    }

    snapshot(): Store { return this; }
    async close(): Promise<void> { await this.baseSnapshot.close(); }
}
