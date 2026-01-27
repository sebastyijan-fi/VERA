
import type { AccessSet } from '../state/journal.js';

/**
 * Execution trace for a single transaction
 */
export interface ExecutionTrace {
    txIndex: number;
    accessSet: AccessSet;
}

/**
 * Detects conflicts among a batch of optimistic executions.
 *
 * Rules:
 * A transaction T_i is invalid if it read a key K that was written by a transaction T_j where j < i.
 * This implies T_i read a stale version (from snapshot) instead of T_j's output.
 *
 * @param traces List of execution traces, sorted by txIndex
 * @returns Set of transaction indices that are invalid and must be re-executed
 */
export function detectConflicts(traces: ExecutionTrace[]): Set<number> {
    const conflicts = new Set<number>();

    // Map: Key -> Transaction Index that LAST wrote to this key
    // We only care about the latest writer before current tx
    const writes = new Map<string, number>();

    // Sort to ensure we process 0..N
    const sorted = [...traces].sort((a, b) => a.txIndex - b.txIndex);

    for (const trace of sorted) {
        // 1. Check for conflicts (Read-After-Write)
        for (const readKey of trace.accessSet.reads) {
            if (writes.has(readKey)) {
                const writerIndex = writes.get(readKey)!;
                if (writerIndex < trace.txIndex) {
                    // Conflict! Preceding transaction wrote to a key we read.
                    // We likely read stale data.
                    conflicts.add(trace.txIndex);

                    // Optimization: Once a tx is marked conflict, we don't strictly need to check other keys,
                    // but we continue to populate the 'writes' map for *subsequent* transactions?
                    // actually if T_i is invalid, its writes are also suspect...
                    // In real Block-STM, we re-execute T_i.
                    // Here we just report it.
                    break;
                }
            }
        }

        // 2. Register writes
        // IMPORTANT: Even if T_i is conflicted, we record its writes because T_{i+1} might depend on them.
        // Wait, if T_i is wrong, its writes are garbage. T_{i+1} reading garbage is also a conflict?
        // Yes, if T_{i+1} reads T_i's write, and T_i is invalid, then T_{i+1} will be re-executed effectively implicitly
        // or explicitly in the next round.
        // For this static analyzer, we assume "writes" tracks the *potential* dependency.
        for (const writeKey of trace.accessSet.writes) {
            writes.set(writeKey, trace.txIndex);
        }
    }

    return conflicts;
}
