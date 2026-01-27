
import { describe, it, expect } from 'vitest';
import { detectConflicts, type ExecutionTrace } from '../src/parallel/conflict.js';

describe('Conflict Detection', () => {
    function trace(txIndex: number, reads: string[], writes: string[]): ExecutionTrace {
        return {
            txIndex,
            accessSet: {
                reads: new Set(reads),
                writes: new Set(writes)
            }
        };
    }

    it('should report no conflicts for disjoint sets', () => {
        const traces = [
            trace(0, ['A'], ['B']),
            trace(1, ['C'], ['D'])
        ];
        const conflicts = detectConflicts(traces);
        expect(conflicts.size).toBe(0);
    });

    it('should detect Read-After-Write (RAW) conflict', () => {
        // Tx 0 writes A. Tx 1 reads A.
        // Tx 1 runs in parallel, so it reads pre-0 value of A.
        // But it SHOULD have read post-0 value.
        // So Tx 1 is invalid.
        const traces = [
            trace(0, [], ['A']),
            trace(1, ['A'], ['B'])
        ];
        const conflicts = detectConflicts(traces);
        expect(conflicts.size).toBe(1);
        expect(conflicts.has(1)).toBe(true);
    });

    it('should NOT detect Anti-Dependency (WAR)', () => {
        // Tx 0 reads A. Tx 1 writes A.
        // Tx 0 reads pre-1 value of A. This is CORRECT for order 0->1.
        const traces = [
            trace(0, ['A'], ['B']),
            trace(1, [], ['A'])
        ];
        const conflicts = detectConflicts(traces);
        expect(conflicts.size).toBe(0);
    });

    it('should NOT detect Write-Write (WAW)', () => {
        // Tx 0 writes A. Tx 1 writes A.
        // Both write to their own journals. Commit order handles this.
        const traces = [
            trace(0, [], ['A']),
            trace(1, [], ['A'])
        ];
        const conflicts = detectConflicts(traces);
        expect(conflicts.size).toBe(0);
    });

    it('should detect conflicts with gaps', () => {
        // Tx 0 writes A.
        // Tx 2 reads A.
        // Tx 2 is invalid.
        const traces = [
            trace(0, [], ['A']),
            trace(1, ['B'], ['C']),
            trace(2, ['A'], ['D'])
        ];
        const conflicts = detectConflicts(traces);
        expect(conflicts.has(2)).toBe(true);
        expect(conflicts.size).toBe(1);
    });

    it('should handle multiple conflicts', () => {
        // 0 writes A
        // 1 reads A -> Conflict
        // 2 reads A -> Conflict
        const traces = [
            trace(0, [], ['A']),
            trace(1, ['A'], []),
            trace(2, ['A'], [])
        ];
        const conflicts = detectConflicts(traces);
        expect(conflicts.size).toBe(2);
        expect(conflicts.has(1)).toBe(true);
        expect(conflicts.has(2)).toBe(true);
    });

    it('should respect transaction index order in unsorted input', () => {
        // Input is traces 1 then 0.
        // 0 writes A. 1 reads A. 1 is conflict.
        const traces = [
            trace(1, ['A'], []),
            trace(0, [], ['A'])
        ];
        const conflicts = detectConflicts(traces);
        expect(conflicts.has(1)).toBe(true);
    });
});
