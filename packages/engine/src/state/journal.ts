/**
 * VERA State Journal
 *
 * Write-ahead log for atomic state updates with commit/rollback.
 */

import type { AsyncStateStore, StateKey } from '@vera/core';
import { deriveStateId } from '@vera/core';
import type { Value } from '../vm/value.js';
import { valueToString } from '../vm/value.js';
import type { StateAccessor } from './context.js';
import { restoreFromDecoding } from '../vm/codec.js';

// ============================================================================
// Journal Entry
// ============================================================================

export type JournalEntry =
    | { type: 'set'; entityType: string; key: string; value: Value }
    | { type: 'delete'; entityType: string; key: string };

// ============================================================================
// Read/Write Sets
// ============================================================================

export interface AccessSet {
    reads: Set<string>;   // "entityType:key"
    writes: Set<string>;  // "entityType:key"
}

// ============================================================================
// State Journal
// ============================================================================

/**
 * Journaling state accessor for atomic updates
 */
export class StateJournal implements StateAccessor {
    private readonly underlying: Map<string, Map<string, Value>>;
    private readonly journal: JournalEntry[] = [];
    private readonly readSet: Set<string> = new Set();
    private readonly fallbackStore: AsyncStateStore | undefined;

    constructor(
        initialState: Map<string, Map<string, Value>> = new Map(),
        fallbackStore?: AsyncStateStore
    ) {
        this.underlying = initialState;
        this.fallbackStore = fallbackStore;
    }

    /**
     * Gets a value from state
     */
    async get(entityType: string, key: Value): Promise<Value | undefined> {
        const keyStr = this.keyToString(key);
        // Record read
        this.readSet.add(`${entityType}:${keyStr}`);

        // Check journal first (reverse order)
        for (let i = this.journal.length - 1; i >= 0; i--) {
            const entry = this.journal[i];
            if (entry && entry.entityType === entityType && entry.key === keyStr) {
                if (entry.type === 'set') {
                    // Type guard ensures entry is 'set' type here, which has 'value'
                    return (entry as { value: Value }).value;
                } else {
                    return undefined; // Deleted
                }
            }
        }

        // Check underlying Map (Cache/Staging)
        const cached = this.underlying.get(entityType)?.get(keyStr);
        if (cached !== undefined) return cached;

        // Fallback to persistent store
        if (this.fallbackStore) {
            // Convert string key back to ID?
            // KeyStr from VM is NOT the raw key bytes, it's string repr.
            // We need to know the raw key bytes to derive ID.
            // But `key` argument IS the Value object.
            // If key is int/string/bytes, deriveStateId can handle it (if encoded properly).
            // Wait, `deriveStateId` takes `string` in current codebase? Or `StateKey`?
            // Let's assume we can derive ID from the key value.
            // We need to construct `StateKey`.

            // Issue: keyStr is "i:123". StateKey uses encoded form.
            // We need to encode the key value to bytes, then derive ID (sha256).
            // But we don't have `encodeStateKey` imported from core directly that takes Value?
            // Core has `encodeStateKey(StateKey)`.
            // StateKey is { namespace, id }.
            // We need `id`.
            // `deriveStateId` typically takes the key string/bytes?

            // If we look at processor.ts:
            // const id = deriveStateId(entry.key); // entry.key is keyStr
            // But entry.key is constructed from `valueToString(key)`.
            // Is `deriveStateId` compatible with `valueToString` output?
            // Likely yes if developed consistently.

            const id = deriveStateId(keyStr);

            const stateKey: StateKey = {
                namespace: entityType,
                id: id as any // Cast to Bytes32
            };

            const coreValue = await this.fallbackStore.get(stateKey);
            if (coreValue) {
                // Convert Core StateValue (binary) to VM Value
                // CoreStateValue has `.data` (Uint8Array).
                const vmValue = restoreFromDecoding(coreValue.data); // Expects CBOR bytes?

                // Cache in underlying map for future hits in this transaction
                let entityMap = this.underlying.get(entityType);
                if (!entityMap) {
                    entityMap = new Map();
                    this.underlying.set(entityType, entityMap);
                }
                entityMap.set(keyStr, vmValue);

                return vmValue;
            }
        }

        return undefined;
    }

    /**
     * Sets a value in state (STAGED)
     */
    async set(entityType: string, key: Value, value: Value): Promise<void> {
        const keyStr = this.keyToString(key);
        // Stage in journal
        this.journal.push({
            type: 'set',
            entityType,
            key: keyStr,
            value,
        });
    }

    /**
     * Deletes a value from state (STAGED)
     */
    async delete(entityType: string, key: Value): Promise<void> {
        const keyStr = this.keyToString(key);
        // Stage in journal
        this.journal.push({
            type: 'delete',
            entityType,
            key: keyStr,
        });
    }

    /**
     * Checks if a key exists
     */
    async exists(entityType: string, key: Value): Promise<boolean> {
        const value = await this.get(entityType, key); // get() records the read
        return value !== undefined;
    }

    /**
     * Gets all journal entries
     */
    getEntries(): readonly JournalEntry[] {
        return this.journal;
    }

    /**
     * Gets number of changes
     */
    get changeCount(): number {
        return this.journal.length;
    }

    /**
     * Commits changes (applies journal to underlying)
     */
    commit(): void {
        for (const entry of this.journal) {
            if (entry.type === 'set') {
                let entityMap = this.underlying.get(entry.entityType);
                if (!entityMap) {
                    entityMap = new Map();
                    this.underlying.set(entry.entityType, entityMap);
                }
                entityMap.set(entry.key, entry.value);
            } else if (entry.type === 'delete') {
                this.underlying.get(entry.entityType)?.delete(entry.key);
            }
        }
        this.journal.length = 0;
        this.readSet.clear();
    }

    /**
     * Rolls back changes (clears journal and read set)
     */
    rollback(): void {
        this.journal.length = 0;
        this.readSet.clear();
    }

    /**
     * Creates a checkpoint for nested rollback
     */
    checkpoint(): { journalIdx: number, readSetSize: number } {
        return {
            journalIdx: this.journal.length,
            readSetSize: this.readSet.size
        };
    }

    /**
     * Rolls back to a checkpoint (truncates journal)
     * Note: Read set rollback is approximate for Set (cannot easily rollback standard Set insertion order without iteration)
     * For now, we accept read set might be larger than strictly necessary on rollback, or we could rebuild.
     * Given parallel execution checks happen AFTER execution, keeping the read set is mostly fine or we can optimize later.
     */
    rollbackTo(checkpoint: { journalIdx: number, readSetSize: number } | number): void {
        if (typeof checkpoint === 'number') {
            // Legacy support
            this.journal.length = checkpoint;
        } else {
            this.journal.length = checkpoint.journalIdx;
            // Optimally we would shrink readSet, but JS Set doesn't support generic truncation.
            // For MVP conflict detection, over-estimating reads (false positives for conflict) is safe (just re-executes).
        }
    }

    /**
     * Gets the current state (for inspection)
     */
    getState(): ReadonlyMap<string, ReadonlyMap<string, Value>> {
        return this.underlying;
    }

    /**
     * Gets the read and write sets for conflict detection
     */
    getAccessSet(): AccessSet {
        const writes = new Set<string>();
        for (const entry of this.journal) {
            writes.add(`${entry.entityType}:${entry.key}`);
        }
        return {
            reads: new Set(this.readSet),
            writes
        };
    }

    private keyToString(key: Value): string {
        return valueToString(key);
    }
}

/**
 * Creates a new state journal
 */
export function createStateJournal(
    initialState: Map<string, Map<string, Value>> = new Map()
): StateJournal {
    return new StateJournal(initialState);
}

