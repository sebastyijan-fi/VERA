import {
    type AsyncStateStore,
    type StateKey,
    type StateValue,
    type StateChange,
    type StateQueryResult
} from '../types/state.js';
import { type StateStore } from '../types/state.js';
import type { Bytes32 } from '../types/primitives.js';

/**
 * Adapter that wraps a synchronous StateStore in an AsyncStateStore interface.
 * Useful for testing and transition.
 */
export class AsyncInMemoryStateStore implements AsyncStateStore {
    constructor(private readonly syncStore: StateStore) { }

    get version(): bigint {
        return this.syncStore.version;
    }

    get root(): Bytes32 {
        return this.syncStore.root;
    }

    async get(key: StateKey): Promise<StateValue | null> {
        return this.syncStore.get(key);
    }

    async getWithProof(key: StateKey): Promise<StateQueryResult> {
        return this.syncStore.getWithProof(key);
    }

    async has(key: StateKey): Promise<boolean> {
        return this.syncStore.has(key);
    }

    async apply(changes: readonly StateChange[], newVersion: bigint): Promise<AsyncStateStore> {
        const newSyncStore = this.syncStore.apply(changes, newVersion);
        return new AsyncInMemoryStateStore(newSyncStore);
    }

    async *keys(namespace: string): AsyncIterableIterator<StateKey> {
        for (const key of this.syncStore.keys(namespace)) {
            yield key;
        }
    }

    async *entries(): AsyncIterableIterator<{ key: StateKey; value: StateValue }> {
        for (const entry of this.syncStore.entries()) {
            yield entry;
        }
    }

    async size(): Promise<number> {
        return this.syncStore.size();
    }
}
