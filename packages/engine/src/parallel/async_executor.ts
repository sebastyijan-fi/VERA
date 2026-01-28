/**
 * Async Optimistic Executor
 * 
 * High-performance single-threaded optimistic execution for transaction batches.
 * Eliminates worker thread overhead while maintaining conflict detection.
 * 
 * Strategy:
 * 1. Execute all transactions optimistically against base state (no commits)
 * 2. Track read/write sets during execution
 * 3. Detect conflicts using Read-After-Write analysis
 * 4. Commit valid prefix, re-execute conflicting suffix serially
 */

import { TransactionStateProcessor, type ExecutionResult, type ProcessorOptions } from '../processor.js';
import { detectConflicts, type ExecutionTrace } from './conflict.js';
import type { IRProgram } from '@vera/dsl';
import type { Value } from '../vm/value.js';
import type { BlockContext } from '../state/context.js';

export interface AsyncExecutionStats {
    totalTransactions: number;
    conflictsDetected: number;
    rounds: number;
    optimisticPhaseMs: number;
    commitPhaseMs: number;
    serialFallbackMs: number;
}

/**
 * Single-threaded async optimistic executor.
 * 
 * Key advantages over worker-based ParallelExecutor:
 * - No state snapshot serialization overhead
 * - No structured cloning of large state maps
 * - Direct memory access for state operations
 * - Lower latency for small batches
 * 
 * Best for:
 * - Batches where transactions are mostly independent
 * - When state size is large (avoids expensive cloning)
 * - Systems where worker thread pool overhead dominates
 */
export class AsyncOptimisticExecutor {
    private processor: TransactionStateProcessor;
    private readonly program: IRProgram; // Stored for future JIT/caching

    constructor(program: IRProgram, options: ProcessorOptions = {}) {
        this.program = program;
        this.processor = new TransactionStateProcessor(program, options);
    }

    /**
     * No-op for compatibility with ParallelExecutor interface
     */
    terminate(): void {
        // No workers to terminate
    }

    /**
     * Get the underlying processor for direct state access
     */
    getProcessor(): TransactionStateProcessor {
        return this.processor;
    }

    /**
     * Execute a batch of transactions using optimistic scheduling.
     * 
     * All transactions are first executed without committing (optimistic phase).
     * Read/write sets are collected and analyzed for conflicts.
     * Valid prefix is committed, conflicting suffix is re-executed serially.
     */
    async executeBlock(
        txs: { functionName: string, args: Value[], caller: string }[],
        block: BlockContext
    ): Promise<{ results: ExecutionResult[], stats: AsyncExecutionStats }> {
        const startTime = performance.now();
        const stats: AsyncExecutionStats = {
            totalTransactions: txs.length,
            conflictsDetected: 0,
            rounds: 1,
            optimisticPhaseMs: 0,
            commitPhaseMs: 0,
            serialFallbackMs: 0
        };

        if (txs.length === 0) {
            return { results: [], stats };
        }

        // Fast path: single transaction, just execute and commit
        if (txs.length === 1) {
            const tx = txs[0]!;
            const result = await this.processor.execute(
                tx.functionName,
                tx.args,
                tx.caller,
                block,
                { commit: true }
            );
            stats.optimisticPhaseMs = performance.now() - startTime;
            return { results: [result], stats };
        }

        // ================================================================
        // Phase 1: Optimistic Execution (No Commits)
        // ================================================================
        const optimisticStart = performance.now();
        const optimisticResults: ExecutionResult[] = [];

        for (const tx of txs) {
            // Execute without commit - state changes are tracked but not applied
            const result = await this.processor.execute(
                tx.functionName,
                tx.args,
                tx.caller,
                block,
                { commit: false } // KEY: Don't commit, just collect accessSet
            );
            optimisticResults.push(result);
        }
        stats.optimisticPhaseMs = performance.now() - optimisticStart;

        // ================================================================
        // Phase 2: Conflict Detection
        // ================================================================
        const traces: ExecutionTrace[] = optimisticResults.map((res, index) => ({
            txIndex: index,
            accessSet: res.accessSet || { reads: new Set(), writes: new Set() }
        }));

        const conflicts = detectConflicts(traces);
        stats.conflictsDetected = conflicts.size;

        // Find first conflict index
        let firstConflict = txs.length;
        if (conflicts.size > 0) {
            firstConflict = Math.min(...conflicts);
        }

        // ================================================================
        // Phase 3: Commit Valid Prefix
        // ================================================================
        const commitStart = performance.now();
        const finalResults: ExecutionResult[] = new Array(txs.length);

        for (let i = 0; i < firstConflict; i++) {
            const result = optimisticResults[i]!;
            finalResults[i] = result;

            // Apply journal entries to persist state changes
            if (result.success && result.journalEntries) {
                this.processor.applyJournal(result.journalEntries);
            }
        }
        stats.commitPhaseMs = performance.now() - commitStart;

        // ================================================================
        // Phase 4: Serial Fallback for Conflicting Suffix
        // ================================================================
        if (firstConflict < txs.length) {
            stats.rounds++;
            const serialStart = performance.now();

            for (let i = firstConflict; i < txs.length; i++) {
                const tx = txs[i]!;
                // Execute with commit - runs against updated state
                finalResults[i] = await this.processor.execute(
                    tx.functionName,
                    tx.args,
                    tx.caller,
                    block,
                    { commit: true }
                );
            }
            stats.serialFallbackMs = performance.now() - serialStart;
        }

        return { results: finalResults, stats };
    }

    /**
     * Execute a single transaction immediately with commit.
     * Convenience method for non-batched execution.
     */
    async executeSingle(
        functionName: string,
        args: Value[],
        caller: string,
        block: BlockContext
    ): Promise<ExecutionResult> {
        return this.processor.execute(functionName, args, caller, block, { commit: true });
    }

    /**
     * Get internal state snapshot (for debugging/testing)
     */
    getSnapshot(): Map<string, Map<string, Value>> {
        return this.processor.getSnapshot();
    }

    /**
     * Get the program this executor was initialized with
     */
    getProgram(): IRProgram {
        return this.program;
    }
}
