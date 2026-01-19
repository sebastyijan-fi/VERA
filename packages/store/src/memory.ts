/**
 * VERA Memory Store
 *
 * In-memory implementation of the Store interface.
 * Useful for development and testing.
 */

import {
    type Store,
    type Batch,
    type StoreIterator,
    type Key,
    type Value,
    type IteratorOptions,
} from './types.js';

// ============================================================================
// Utilities
// ============================================================================

function normalizeKey(key: Key): string {
    if (typeof key === 'string') return key;
    return Buffer.from(key).toString('hex');
}

function normalizeValue(value: Value): Uint8Array {
    if (value instanceof Uint8Array) return value;
    // Should theoretically not happen given type signature, but for safety
    return new Uint8Array(value);
}

// ============================================================================
// Memory Store
// ============================================================================

export class MemoryStore implements Store {
    private readonly data = new Map<string, Uint8Array>();

    async put(key: Key, value: Value): Promise<void> {
        this.data.set(normalizeKey(key), normalizeValue(value));
    }

    async get(key: Key): Promise<Value | undefined> {
        return this.data.get(normalizeKey(key));
    }

    async del(key: Key): Promise<void> {
        this.data.delete(normalizeKey(key));
    }

    batch(): Batch {
        return new MemoryBatch(this.data);
    }

    iterator(options: IteratorOptions = {}): StoreIterator {
        return new MemoryIterator(this.data, options);
    }

    async clear(): Promise<void> {
        this.data.clear();
    }

    async close(): Promise<void> {
        // No-op for memory store
    }
}

// ============================================================================
// Memory Batch
// ============================================================================

class MemoryBatch implements Batch {
    private readonly ops: Array<() => void> = [];

    constructor(private readonly storeData: Map<string, Uint8Array>) { }

    put(key: Key, value: Value): Batch {
        const k = normalizeKey(key);
        const v = normalizeValue(value);
        this.ops.push(() => this.storeData.set(k, v));
        return this;
    }

    del(key: Key): Batch {
        const k = normalizeKey(key);
        this.ops.push(() => this.storeData.delete(k));
        return this;
    }

    async write(): Promise<void> {
        for (const op of this.ops) {
            op();
        }
    }
}

// ============================================================================
// Memory Iterator
// ============================================================================

class MemoryIterator implements StoreIterator {
    private readonly entries: Array<[string, Uint8Array]>;
    private index = 0;

    constructor(data: Map<string, Uint8Array>, options: IteratorOptions) {
        let allEntries = Array.from(data.entries()).sort((a, b) =>
            a[0].localeCompare(b[0])
        );

        if (options.reverse) {
            allEntries = allEntries.reverse();
        }

        // Filter range
        if (options.gt !== undefined || options.gte !== undefined) {
            const lower = normalizeKey(options.gt ?? options.gte!);
            const inclusive = options.gte !== undefined;
            allEntries = allEntries.filter(([k]) =>
                inclusive ? k >= lower : k > lower
            );
        }

        if (options.lt !== undefined || options.lte !== undefined) {
            const upper = normalizeKey(options.lt ?? options.lte!);
            const inclusive = options.lte !== undefined;
            allEntries = allEntries.filter(([k]) =>
                inclusive ? k <= upper : k < upper
            );
        }

        // Apply limit
        if (options.limit !== undefined && options.limit > 0) {
            allEntries = allEntries.slice(0, options.limit);
        }

        this.entries = allEntries;
    }

    async next(): Promise<[Key, Value] | undefined> {
        if (this.index >= this.entries.length) {
            return undefined;
        }
        const entry = this.entries[this.index++];
        if (!entry) return undefined;
        return [entry[0], entry[1]];
    }

    async all(): Promise<Array<[Key, Value]>> {
        const result: Array<[Key, Value]> = [];
        while (true) {
            const entry = await this.next();
            if (!entry) break;
            result.push(entry);
        }
        return result;
    }

    async end(): Promise<void> {
        // No resource cleanup needed for memory iterator
    }
}
