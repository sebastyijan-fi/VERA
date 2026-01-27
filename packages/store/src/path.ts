/**
 * Path-Addressable Store Wrapper
 *
 * Implements a locality-aware key scheme by prefixing trie nodes with their hierarchical path.
 * This ensures that siblings and children are stored in physically proximate sectors in LSM-trees (like LevelDB).
 */

import { type Store, type Batch, type StoreIterator, type Key, type Value, type IteratorOptions } from './types.js';
import { bytesToHex } from '@vera/core';

export class PathAddressableStore implements Store {
    constructor(private readonly base: Store) { }

    async put(key: Key, value: Value, options?: any): Promise<void> {
        return this.base.put(key, value, options);
    }

    async putWithPath(path: Uint8Array, value: Value, options?: any): Promise<void> {
        const pathHex = Buffer.from(path).toString('hex');
        const hash = (value as any).hash;
        const key = `trie:p:${pathHex}:${hash ? bytesToHex(hash) : ''}`;
        return this.base.put(key, value, options);
    }

    async get(key: Key): Promise<Value | undefined> {
        return this.base.get(key);
    }

    async del(key: Key): Promise<void> {
        return this.base.del(key);
    }

    batch(): Batch {
        const baseBatch = this.base.batch();
        return {
            put: (key: Key, value: Value) => { baseBatch.put(key, value); return this; },
            del: (key: Key) => { baseBatch.del(key); return this; },
            write: (options: any) => baseBatch.write(options)
        } as any;
    }

    iterator(options?: IteratorOptions): StoreIterator {
        return this.base.iterator(options);
    }

    snapshot(): Store {
        return new PathAddressableStore(this.base.snapshot());
    }

    async clear(): Promise<void> {
        return this.base.clear();
    }

    async close(): Promise<void> {
        return this.base.close();
    }
}
