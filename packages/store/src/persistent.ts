/**
 * VERA Persistent State Store
 *
 * Persists the Merkle-tree backed InMemoryStateStore to a disk-based JsonStore.
 * Ensures data integrity by verifying the Merkle root on load.
 */

import {
    type StateStore,
    type StateKey,
    type StateValue,
    type StateChange,
    type StateQueryResult,
    type Bytes32,
    InMemoryStateStore,
    bytesEqual,
    bytesToHex,
    hexToBytes,
    createStateStore,
    toBytes32,
    StorageError,
    InternalError,
    serializeStateValue,
    deserializeStateValue,
} from '@vera/core';
import { type Store } from './types.js';

/**
 * Metadata stored alongside the state data
 */
interface StateMetadata {
    version: string; // BigInt as string
    root: string;    // Hex string
    timestamp: number;
}

const METADATA_KEY = Buffer.from('__metadata__');

/**
 * Persistent wrapper around InMemoryStateStore.
 *
 * NOTE: This implementation currently loads ALL state into memory on startup.
 * For production, this should leverage a DB that supports range queries and
 * only load the Merkle Tree / Cache into memory.
 */
export class PersistentStateStore implements StateStore {
    private inner: StateStore;
    private readonly persistence: Store;

    constructor(inner: StateStore, persistence: Store) {
        this.inner = inner;
        this.persistence = persistence;
    }

    /**
     * Loads state from the persistence layer.
     * Verifies the Merkle root matches the stored metadata.
     */
    static async load(persistence: Store): Promise<PersistentStateStore> {
        try {
            // 1. Load Metadata
            const metaBytes = await persistence.get(METADATA_KEY);
            let metadata: StateMetadata | null = null;

            if (metaBytes) {
                metadata = JSON.parse(metaBytes.toString());
            }

            // 2. Load All Data
            const entries: { key: StateKey; value: StateValue }[] = [];
            const iter = persistence.iterator();

            for await (const [k, v] of iter) {
                // Skip metadata key
                // JsonStore memory implementation uses string keys for strings, buffer for bytes
                const keyBuf = typeof k === 'string' ? Buffer.from(k) : k;
                if (keyBuf.equals(METADATA_KEY)) continue;

                // Parse Key (namespace:id) -> StateKey
                // We assume keys are stored as utf8 strings of "namespace:hexId"
                const keyStr = keyBuf.toString('utf-8');
                const parts = keyStr.split(':');
                if (parts.length !== 2) continue;

                const [namespace, idHex] = parts;
                const id = hexToBytes(idHex!);

                // Parse Value (CBOR bytes) -> StateValue
                const value = deserializeStateValue(v);

                entries.push({
                    key: { namespace: namespace!, id: toBytes32(id) },
                    value
                });
            }

            // Create store from entries
            const store = createStateStore(entries, metadata ? BigInt(metadata.version) : 0n);

            // Verify Root if metadata exists
            if (metadata && !bytesEqual(store.root, hexToBytes(metadata.root))) {
                throw new StorageError('State root mismatch on load. Persistence corrupted.');
            }

            return new PersistentStateStore(store, persistence);
        } catch (error: any) {
            throw new StorageError(`Failed to load state: ${error.message}`);
        }
    }

    get version(): bigint { return this.inner.version; }
    get root(): Bytes32 { return this.inner.root; }

    get(key: StateKey): StateValue | null {
        return this.inner.get(key);
    }

    getWithProof(key: StateKey): StateQueryResult {
        return this.inner.getWithProof(key);
    }

    has(key: StateKey): boolean {
        return this.inner.has(key);
    }

    keys(namespace: string): IterableIterator<StateKey> {
        return this.inner.keys(namespace);
    }

    entries(): IterableIterator<{ key: StateKey; value: StateValue }> {
        return this.inner.entries();
    }

    size(): number {
        return this.inner.size();
    }

    apply(changes: readonly StateChange[], newVersion: bigint): StateStore {
        // Apply to inner (immutable)
        const newInner = this.inner.apply(changes, newVersion);

        // Return new wrapper connected to same persistence.
        // It is NOT automatically saved.
        return new PersistentStateStore(newInner, this.persistence);
    }

    /**
     * Persists the current state to disk.
     */
    async commit(): Promise<void> {
        const batch = this.persistence.batch();

        // 1. Write all entries
        // Optimization: track diffs only?
        // For now, write all (simple correctness)
        for (const { key, value } of this.inner.entries()) {
            const keyStr = `${key.namespace}:${bytesToHex(key.id)}`;
            const valueBytes = serializeStateValue(value);
            batch.put(Buffer.from(keyStr), valueBytes);
        }

        // 2. Write Metadata
        const metadata: StateMetadata = {
            version: this.version.toString(),
            root: bytesToHex(this.root),
            timestamp: Date.now()
        };
        batch.put(METADATA_KEY, Buffer.from(JSON.stringify(metadata)));

        // 3. Commit batch
        await batch.write();
    }
}
