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
    | { type: 'set'; entityType: string; key: string; value: Value; previousValue?: Value | undefined }
    | { type: 'delete'; entityType: string; key: string; previousValue?: Value | undefined };

// ============================================================================
// State Journal
// ============================================================================

/**
 * Journaling state accessor for atomic updates
 */
export class StateJournal implements StateAccessor {
    private readonly underlying: Map<string, Map<string, Value>>;
    private readonly journal: JournalEntry[] = [];
    private readonly snapshot: Map<string, Map<string, Value>>;

    constructor(initialState: Map<string, Map<string, Value>> = new Map()) {
        this.underlying = initialState;
        this.snapshot = this.deepClone(initialState);
    }

    /**
     * Gets a value from state
     */
    async get(entityType: string, key: Value): Promise<Value | undefined> {
        const keyStr = this.keyToString(key);
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
     * Sets a value in state
     */
    async set(entityType: string, key: Value, value: Value): Promise<void> {
        const keyStr = this.keyToString(key);
        // We need the previous value for rollback, which must be fetched async now if needed.
        // Optimization: if we are in a transaction, get() checks journal mostly.
        const previousValue = await this.get(entityType, key);

        // We do NOT update 'underlying' immediately in a journaled approach?
        // The original code updated 'underlying' AND pushed to journal.
        // Let's keep the original logic but make it async compatible.

        let entityMap = this.underlying.get(entityType);
        if (!entityMap) {
            entityMap = new Map();
            this.underlying.set(entityType, entityMap);
        }
        entityMap.set(keyStr, value);

        const entry: JournalEntry = {
            type: 'set',
            entityType,
            key: keyStr,
            value,
        };
        if (previousValue !== undefined) {
            entry.previousValue = previousValue;
        }
        this.journal.push(entry);
    }

    /**
     * Deletes a value from state
     */
    async delete(entityType: string, key: Value): Promise<void> {
        const keyStr = this.keyToString(key);
        const previousValue = await this.get(entityType, key);

        this.underlying.get(entityType)?.delete(keyStr);

        const entry: JournalEntry = {
            type: 'delete',
            entityType,
            key: keyStr,
        };
        if (previousValue !== undefined) {
            entry.previousValue = previousValue;
        }
        this.journal.push(entry);
    }

    /**
     * Checks if a key exists
     */
    async exists(entityType: string, key: Value): Promise<boolean> {
        const value = await this.get(entityType, key);
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
     * Commits changes (clears journal, keeps state)
     */
    commit(): void {
        this.journal.length = 0;
        // Update snapshot to current state
        this.snapshot.clear();
        for (const [entity, values] of this.underlying) {
            this.snapshot.set(entity, new Map(values));
        }
    }

    /**
     * Rolls back to snapshot
     */
    rollback(): void {
        this.underlying.clear();
        for (const [entity, values] of this.snapshot) {
            this.underlying.set(entity, new Map(values));
        }
        this.journal.length = 0;
    }

    /**
     * Creates a checkpoint for nested rollback
     */
    checkpoint(): number {
        return this.journal.length;
    }

    /**
     * Rolls back to a checkpoint
     */
    rollbackTo(checkpoint: number): void {
        while (this.journal.length > checkpoint) {
            const entry = this.journal.pop()!;
            if (entry.type === 'set') {
                if (entry.previousValue !== undefined) {
                    let entityMap = this.underlying.get(entry.entityType);
                    if (entityMap) {
                        entityMap.set(entry.key, entry.previousValue);
                    }
                } else {
                    this.underlying.get(entry.entityType)?.delete(entry.key);
                }
            } else if (entry.type === 'delete') {
                if (entry.previousValue !== undefined) {
                    let entityMap = this.underlying.get(entry.entityType);
                    if (!entityMap) {
                        entityMap = new Map();
                        this.underlying.set(entry.entityType, entityMap);
                    }
                    entityMap.set(entry.key, entry.previousValue);
                }
            }
        }
    }

    /**
     * Gets the current state (for inspection)
     */
    getState(): ReadonlyMap<string, ReadonlyMap<string, Value>> {
        return this.underlying;
    }

    private keyToString(key: Value): string {
        return valueToString(key);
    }

    private deepClone(state: Map<string, Map<string, Value>>): Map<string, Map<string, Value>> {
        const clone = new Map<string, Map<string, Value>>();
        for (const [entity, values] of state) {
            clone.set(entity, new Map(values));
        }
        return clone;
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
