/**
 * State Diff Compression
 * 
 * Tracks state changes between blocks as deltas instead of full snapshots.
 * This significantly reduces storage requirements for nodes.
 * 
 * Storage model:
 * - Full snapshots at checkpoint intervals (e.g., every 1000 blocks)
 * - Deltas between snapshots
 * - Reconstruction: apply deltas to checkpoint to get any block's state
 */

// Generic Value type - compatible with @vera/engine Value but avoids circular dependency
// In practice, this should match the engine's Value type structure
export interface DiffValue {
    kind: string;
    value: unknown;
}

// ============================================================================
// State Diff Types
// ============================================================================

/**
 * A single state change operation
 */
export type StateOp =
    | { type: 'set'; entity: string; key: string; value: DiffValue }
    | { type: 'delete'; entity: string; key: string };

/**
 * State diff for a single block
 */
export interface StateDiff {
    /** Block height this diff applies to */
    height: bigint;
    /** Parent state root */
    parentRoot: Uint8Array;
    /** New state root after applying diff */
    newRoot: Uint8Array;
    /** List of operations */
    ops: StateOp[];
    /** Compressed size in bytes (computed after serialization) */
    compressedSize?: number;
}

/**
 * Checkpoint metadata
 */
export interface Checkpoint {
    height: bigint;
    stateRoot: Uint8Array;
    timestamp: bigint;
}

// ============================================================================
// Diff Computation
// ============================================================================

/**
 * Compute the diff between two state snapshots
 */
export function computeDiff(
    before: Map<string, Map<string, DiffValue>>,
    after: Map<string, Map<string, DiffValue>>,
    height: bigint,
    parentRoot: Uint8Array,
    newRoot: Uint8Array
): StateDiff {
    const ops: StateOp[] = [];

    // Find additions and modifications
    for (const [entity, afterKeys] of after) {
        const beforeKeys = before.get(entity);

        for (const [key, value] of afterKeys) {
            const beforeValue = beforeKeys?.get(key);

            if (!beforeValue || !valuesEqual(beforeValue, value)) {
                ops.push({ type: 'set', entity, key, value });
            }
        }
    }

    // Find deletions
    for (const [entity, beforeKeys] of before) {
        const afterKeys = after.get(entity);

        for (const key of beforeKeys.keys()) {
            if (!afterKeys?.has(key)) {
                ops.push({ type: 'delete', entity, key });
            }
        }
    }

    return { height, parentRoot, newRoot, ops };
}

/**
 * Apply a diff to a state snapshot
 */
export function applyDiff(
    base: Map<string, Map<string, DiffValue>>,
    diff: StateDiff
): Map<string, Map<string, DiffValue>> {
    const result = cloneState(base);

    for (const op of diff.ops) {
        if (op.type === 'set') {
            let entityMap = result.get(op.entity);
            if (!entityMap) {
                entityMap = new Map();
                result.set(op.entity, entityMap);
            }
            entityMap.set(op.key, op.value);
        } else {
            const entityMap = result.get(op.entity);
            if (entityMap) {
                entityMap.delete(op.key);
                if (entityMap.size === 0) {
                    result.delete(op.entity);
                }
            }
        }
    }

    return result;
}

/**
 * Deep clone a state map
 */
export function cloneState(
    state: Map<string, Map<string, DiffValue>>
): Map<string, Map<string, DiffValue>> {
    const result = new Map<string, Map<string, DiffValue>>();
    for (const [entity, keys] of state) {
        result.set(entity, new Map(keys));
    }
    return result;
}

// ============================================================================
// Serialization
// ============================================================================

/**
 * Serialize a diff to compact binary format
 */
export function serializeDiff(diff: StateDiff): Uint8Array {
    // Simple JSON serialization for now - can be optimized with CBOR/protobuf
    const json = JSON.stringify({
        height: diff.height.toString(),
        parentRoot: Array.from(diff.parentRoot),
        newRoot: Array.from(diff.newRoot),
        ops: diff.ops.map(op => ({
            ...op,
            value: op.type === 'set' ? op.value : undefined
        }))
    });
    return new TextEncoder().encode(json);
}

/**
 * Deserialize a diff from binary format
 */
export function deserializeDiff(data: Uint8Array): StateDiff {
    const json = new TextDecoder().decode(data);
    const parsed = JSON.parse(json) as {
        height: string;
        parentRoot: number[];
        newRoot: number[];
        ops: StateOp[];
    };

    return {
        height: BigInt(parsed.height),
        parentRoot: new Uint8Array(parsed.parentRoot),
        newRoot: new Uint8Array(parsed.newRoot),
        ops: parsed.ops
    };
}

// ============================================================================
// Helper
// ============================================================================

/**
 * Compare two values for equality
 */
function valuesEqual(a: DiffValue, b: DiffValue): boolean {
    if (a.kind !== b.kind) return false;

    switch (a.kind) {
        case 'int':
            return (a as { kind: 'int'; value: bigint }).value === (b as { kind: 'int'; value: bigint }).value;
        case 'bool':
            return (a as { kind: 'bool'; value: boolean }).value === (b as { kind: 'bool'; value: boolean }).value;
        case 'string':
            return (a as { kind: 'string'; value: string }).value === (b as { kind: 'string'; value: string }).value;
        case 'bytes': {
            const aBytes = (a as { kind: 'bytes'; value: Uint8Array }).value;
            const bBytes = (b as { kind: 'bytes'; value: Uint8Array }).value;
            if (aBytes.length !== bBytes.length) return false;
            return aBytes.every((v, i) => v === bBytes[i]);
        }
        case 'null':
            return true;
        default:
            // For complex types, use JSON comparison (simple but not most efficient)
            return JSON.stringify(a) === JSON.stringify(b);
    }
}
