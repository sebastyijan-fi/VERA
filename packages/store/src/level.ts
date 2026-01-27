/**
 * LevelDB-based Store Implementation
 */

import { ClassicLevel, type BatchOperation } from 'classic-level';
import type { Store, Batch, StoreIterator, Key, Value, IteratorOptions } from './types.js';

/**
 * Options for fine-tuning LevelDB performance.
 */
export interface LevelDBOptions {
    /** Write buffer size in bytes (default: 64MB) */
    writeBufferSize?: number;
    /** Max open files (default: 1000) */
    maxOpenFiles?: number;
    /** Block cache size in bytes (default: 8MB) */
    cacheSize?: number;
    /** Whether to use Snappy compression (default: true) */
    compression?: boolean;
}

/**
 * Store implementation using LevelDB (classic-level)
 */
export class LevelDBStore implements Store {
    private readonly db: ClassicLevel<string, Uint8Array>;

    constructor(path: string, options: LevelDBOptions = {}) {
        this.db = new ClassicLevel(path, {
            keyEncoding: 'utf8',
            valueEncoding: 'view', // Returns Uint8Array
            writeBufferSize: options.writeBufferSize ?? 64 * 1024 * 1024,
            maxOpenFiles: options.maxOpenFiles ?? 1000,
            cacheSize: options.cacheSize ?? 8 * 1024 * 1024,
            compression: options.compression ?? true,
        });
    }

    async put(key: Key, value: Value, options?: any): Promise<void> {
        return this.db.put(this.normalizeKey(key), value, options);
    }

    async get(key: Key): Promise<Value | undefined> {
        try {
            return await this.db.get(this.normalizeKey(key));
        } catch (error: any) {
            if (error.code === 'LEVEL_NOT_FOUND') {
                return undefined;
            }
            throw error;
        }
    }

    async del(key: Key): Promise<void> {
        return this.db.del(this.normalizeKey(key));
    }

    batch(): Batch {
        const operations: BatchOperation<ClassicLevel<string, Uint8Array>, string, Uint8Array>[] = [];
        const db = this.db;
        const normalizeKey = this.normalizeKey;

        return {
            put(key: Key, value: Value): Batch {
                operations.push({
                    type: 'put',
                    key: normalizeKey(key),
                    value,
                });
                return this;
            },
            del(key: Key): Batch {
                operations.push({
                    type: 'del',
                    key: normalizeKey(key),
                });
                return this;
            },
            async write(options?: any): Promise<void> {
                return db.batch(operations, options);
            },
        };
    }

    iterator(options: IteratorOptions = {}): StoreIterator {
        const iterOptions: any = {
            reverse: options.reverse,
            limit: options.limit,
        };

        if (options.gt !== undefined) iterOptions.gt = this.normalizeKey(options.gt);
        if (options.gte !== undefined) iterOptions.gte = this.normalizeKey(options.gte);
        if (options.lt !== undefined) iterOptions.lt = this.normalizeKey(options.lt);
        if (options.lte !== undefined) iterOptions.lte = this.normalizeKey(options.lte);

        const iter = this.db.iterator(iterOptions);

        return {
            async next(): Promise<[Key, Value] | undefined> {
                const entry = await iter.next();
                if (entry === undefined) {
                    return undefined;
                }
                return [entry[0], entry[1]]; // already normalizeKey'd? classic-level keys in iter are strings as per helper? Wait, keyEncoding is utf8.
            },
            async all(): Promise<Array<[Key, Value]>> {
                const entries = await iter.all();
                return entries.map(([k, v]) => [k, v]);
            },
            async end(): Promise<void> {
                // @ts-ignore
                return iter.close();
            },
        };
    }

    async clear(): Promise<void> {
        return this.db.clear();
    }

    async close(): Promise<void> {
        return this.db.close();
    }

    snapshot(): Store {
        return new ReadOnlyLevelSnapshot(this);
    }

    async putWithPath(path: Uint8Array, value: Value, options?: any): Promise<void> {
        // Hierarchical locality hint: we could prefix keys with 'p:' + path
        // for better clustering, but for now we follow the 'replaceable storage' plan
        return this.put(path, value, options);
    }

    private normalizeKey = (key: Key): string => {
        if (typeof key === 'string') {
            return key;
        }
        return Buffer.from(key).toString('utf8');
    };
}

/**
 * Read-only wrapper for LevelDB snapshots
 */
class ReadOnlyLevelSnapshot implements Store {
    constructor(private readonly store: Store) { }
    async put(): Promise<void> { throw new Error('Snapshot is read-only'); }
    async putWithPath(): Promise<void> { throw new Error('Snapshot is read-only'); }
    async del(): Promise<void> { throw new Error('Snapshot is read-only'); }
    async clear(): Promise<void> { throw new Error('Snapshot is read-only'); }
    batch(): any { throw new Error('Snapshot is read-only'); }

    async get(key: Key): Promise<Value | undefined> { return this.store.get(key); }
    iterator(options?: IteratorOptions): StoreIterator { return this.store.iterator(options); }
    snapshot(): Store { return this; }
    async close(): Promise<void> { /* no-op */ }
}
