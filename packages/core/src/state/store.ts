/**
 * VERA In-Memory State Store
 *
 * Immutable state store implementation with Merkle tree commitment.
 * All mutations return new StateStore instances.
 */

import {
    type Bytes32,
    bytesEqual,
    toBytes32,
} from '../types/primitives.js';
import {
    type StateKey,
    type StateValue,
    type StateChange,
    type StateStore,
    type StateQueryResult,
    encodeStateKey,
} from '../types/state.js';
import { MerkleTree, type MerkleEntry } from '../crypto/merkle.js';
import { encode, decode } from '../encoding/cbor.js';

// ============================================================================
// In-Memory State Store Implementation
// ============================================================================

/**
 * In-memory implementation of StateStore.
 * Uses a Map for O(1) lookups and a MerkleTree for commitments.
 */
export class InMemoryStateStore implements StateStore {
    private readonly data: Map<string, StateValue>;
    private readonly tree: MerkleTree;
    public readonly version: bigint;

    constructor(
        data: Map<string, StateValue> = new Map(),
        version: bigint = 0n
    ) {
        this.data = data;
        this.version = version;

        // Build Merkle tree from data
        const entries: MerkleEntry[] = [];
        for (const [keyStr, value] of data.entries()) {
            entries.push({
                key: this.stringToKey(keyStr),
                value: this.serializeValue(value),
            });
        }
        this.tree = new MerkleTree(entries);
    }

    /**
     * Gets the Merkle root of the state
     */
    get root(): Bytes32 {
        return this.tree.root;
    }

    /**
     * Gets a value by key
     */
    get(key: StateKey): StateValue | null {
        const keyStr = this.keyToString(key);
        return this.data.get(keyStr) ?? null;
    }

    /**
     * Gets a value with Merkle proof
     */
    getWithProof(key: StateKey): StateQueryResult {
        const value = this.get(key);
        const keyBytes = encodeStateKey(key);
        const proof = this.tree.getProof(keyBytes);

        return { value, proof };
    }

    /**
     * Checks if a key exists
     */
    has(key: StateKey): boolean {
        return this.data.has(this.keyToString(key));
    }

    /**
     * Applies changes and returns new StateStore
     */
    apply(changes: readonly StateChange[], newVersion: bigint): StateStore {
        // Create new data map with changes applied
        const newData = new Map(this.data);

        for (const change of changes) {
            const keyStr = this.keyToString(change.key);

            if (change.type === 'set') {
                newData.set(keyStr, change.value);
            } else {
                newData.delete(keyStr);
            }
        }

        return new InMemoryStateStore(newData, newVersion);
    }

    /**
     * Iterates over keys in a namespace
     */
    *keys(namespace: string): IterableIterator<StateKey> {
        const prefix = `${namespace}:`;

        for (const keyStr of this.data.keys()) {
            if (keyStr.startsWith(prefix)) {
                yield this.stringToStateKey(keyStr);
            }
        }
    }

    /**
     * Iterates over all entries (for snapshotting)
     */
    *entries(): IterableIterator<{ key: StateKey; value: StateValue }> {
        for (const [keyStr, value] of this.data.entries()) {
            yield {
                key: this.stringToStateKey(keyStr),
                value,
            };
        }
    }

    /**
     * Gets the number of entries
     */
    size(): number {
        return this.data.size;
    }

    // ============================================================================
    // Private Helpers
    // ============================================================================

    private keyToString(key: StateKey): string {
        const idHex = Array.from(key.id)
            .map((b) => b.toString(16).padStart(2, '0'))
            .join('');
        return `${key.namespace}:${idHex}`;
    }

    private stringToStateKey(str: string): StateKey {
        const colonIndex = str.indexOf(':');
        const namespace = str.slice(0, colonIndex);
        const idHex = str.slice(colonIndex + 1);
        const id = new Uint8Array(32);
        for (let i = 0; i < 32; i++) {
            id[i] = parseInt(idHex.slice(i * 2, i * 2 + 2), 16);
        }
        return { namespace, id: toBytes32(id) };
    }

    private stringToKey(str: string): Uint8Array {
        const stateKey = this.stringToStateKey(str);
        return encodeStateKey(stateKey);
    }

    private serializeValue(value: StateValue): Uint8Array {
        return serializeStateValue(value);
    }
}

// ============================================================================
// Factory Functions
// ============================================================================

/**
 * Creates an empty state store
 */
export function createEmptyStateStore(): StateStore {
    return new InMemoryStateStore();
}

/**
 * Creates a state store from entries
 */
export function createStateStore(
    entries: readonly { key: StateKey; value: StateValue }[],
    version: bigint = 0n
): StateStore {
    const data = new Map<string, StateValue>();

    for (const entry of entries) {
        const keyStr = `${entry.key.namespace}:${Array.from(entry.key.id)
            .map((b) => b.toString(16).padStart(2, '0'))
            .join('')}`;
        data.set(keyStr, entry.value);
    }

    return new InMemoryStateStore(data, version);
}

// ============================================================================
// State Diff Utilities
// ============================================================================

/**
 * Computes the diff between two state stores.
 * TODO: Implement full diff computation across all namespaces.
 */
export function computeStateDiff(
    _from: StateStore,
    _to: StateStore
): StateChange[] {
    // This is a placeholder - full implementation requires
    // iterating all namespaces in both stores
    return [];
}

/**
 * Encodes a state diff for transmission
 */
export interface StateDiff {
    version: number;
    fromRoot: Bytes32;
    toRoot: Bytes32;
    fromVersion: bigint;
    toVersion: bigint;
    changes: StateChange[];
}

/**
 * Creates a state diff object
 */
export function createStateDiff(
    from: StateStore,
    to: StateStore,
    changes: readonly StateChange[]
): StateDiff {
    return {
        version: 1,
        fromRoot: from.root,
        toRoot: to.root,
        fromVersion: from.version,
        toVersion: to.version,
        changes: [...changes],
    };
}

/**
 * Applies a state diff to a state store
 */
export function applyStateDiff(state: StateStore, diff: StateDiff): StateStore {
    // Verify starting state
    if (!bytesEqual(state.root, diff.fromRoot)) {
        throw new Error('State root mismatch: cannot apply diff');
    }

    if (state.version !== diff.fromVersion) {
        throw new Error('State version mismatch: cannot apply diff');
    }

    // Apply changes
    const newState = state.apply(diff.changes, diff.toVersion);

    // Verify result
    if (!bytesEqual(newState.root, diff.toRoot)) {
        throw new Error('Resulting state root mismatch: diff application failed');
    }

    return newState;
}

// ============================================================================
// Serialization Utilities
// ============================================================================

/**
 * Serializes a StateValue to bytes (CBOR)
 */
export function serializeStateValue(value: StateValue): Uint8Array {
    return encode({
        data: value.data,
        lastModified: value.lastModified,
        schema: {
            moduleId: value.schema.moduleId,
            schemaName: value.schema.schemaName,
            version: value.schema.version,
        },
    });
}

/**
 * Deserializes bytes to a StateValue
 */
export function deserializeStateValue(bytes: Uint8Array): StateValue {
    // Note: 'decode' import needs to be available. 
    // In InMemoryStateStore it was imported from '../encoding/cbor.js'.
    // We reuse that import.
    // However, decode likely returns 'unknown' or 'any'.
    // We cast it if strictly typed structure matches.
    // For now assume trusted input or runtime validation in future.
    return decode(bytes) as StateValue;
}
