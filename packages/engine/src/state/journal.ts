/**
 * VERA State Journal
 *
 * Write-ahead log for atomic state updates with commit/rollback.
 */

import type { Value } from '../vm/value.js';
import { valueToString } from '../vm/value.js';
import type { StateAccessor } from './context.js';

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

    constructor(initialState: Map<string, Map<string, Value>> = new Map()) {
        this.underlying = initialState;
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
        // Fallback to underlying
        return this.underlying.get(entityType)?.get(keyStr);
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

