
import { TransactionStateProcessor, type ExecutionResult, type ProcessorOptions } from '../processor.js';
import { detectConflicts, type ExecutionTrace } from './conflict.js';
import type { IRProgram } from '@vera/dsl';
import type { Value } from '../vm/value.js';
import type { BlockContext } from '../state/context.js';
import { WorkerPool } from './pool.js';

export interface ParallelExecutionStats {
    totalTransactions: number;
    conflictsDetected: number;
    rounds: number;
    parallelTimeMs: number;
    serialFallbackTimeMs: number;
}

export class ParallelExecutor {
    private processor: TransactionStateProcessor;
    private pool: WorkerPool;

    constructor(private program: IRProgram, options: ProcessorOptions & { poolSize?: number } = {}) {
        this.processor = new TransactionStateProcessor(program, options);
        // Size pool based on available parallelism, default to 4 for now or use options
        this.pool = new WorkerPool(options.poolSize || 4);
    }

    /**
     * Cleans up worker thread resources
     */
    terminate() {
        this.pool.terminate();
    }

    /**
     * Executes a batch of transactions using (simulated) parallel optimistic execution.
     * Strategy: Optimistic Prefix + Serial Suffix
     * 1. Run all transactions in parallel against base state (snapshot).
     * 2. Identify the first transaction index that conflicts (Read-After-Write hazard).
     * 3. Commit the results of all transactions BEFORE the conflict.
     * 4. Re-execute the conflicting transaction and all subsequent transactions serially.
     */
    async executeBlock(
        txs: { functionName: string, args: Value[], caller: string }[],
        block: BlockContext
    ): Promise<{ results: ExecutionResult[], stats: ParallelExecutionStats }> {
        const startTime = Date.now();
        const stats: ParallelExecutionStats = {
            totalTransactions: txs.length,
            conflictsDetected: 0,
            rounds: 1,
            parallelTimeMs: 0,
            serialFallbackTimeMs: 0
        };

        // Snapshot state for workers
        // Workers need a copy of the state. 
        // We use getSnapshot() which returns the underlying map.
        // postMessage will structure-clone it.
        const stateSnapshot = this.processor.getSnapshot();

        // 1. Optimistic Pass (Worker Threads)
        const optimisticPromises = txs.map(async (tx, index) => {
            const msg = await this.pool.execute({
                txIndex: index,
                program: this.program,
                functionName: tx.functionName,
                args: tx.args,
                caller: tx.caller,
                block,
                snapshot: stateSnapshot
            });

            if ((!msg.success && !msg.result) || msg.error) {
                // Worker crashed or threw unexpected error or returned explicit error
                return {
                    success: false,
                    events: [],
                    gasUsed: 0n,
                    instructionsExecuted: 0,
                    stateChanges: new Map(),
                    binaryChanges: [],
                    error: { type: 'runtime', message: msg.error || 'Worker error' }
                } as ExecutionResult;
            }
            return msg.result as ExecutionResult;
        });

        const results = await Promise.all(optimisticPromises);
        stats.parallelTimeMs = Date.now() - startTime;

        // 2. Extract Traces
        const traces: ExecutionTrace[] = results.map((res, index) => ({
            txIndex: index,
            accessSet: res.accessSet || { reads: new Set(), writes: new Set() }
        }));

        // 3. Detect Conflicts
        const conflicts = detectConflicts(traces);
        stats.conflictsDetected = conflicts.size;

        // 4. Resolve & Commit
        const finalResults: ExecutionResult[] = new Array(txs.length);

        let firstConflict = txs.length;
        if (conflicts.size > 0) {
            firstConflict = Math.min(...conflicts);
        }

        const serialStartTime = Date.now();

        // Commit valid block prefix
        // These transactions are guaranteed to be independent of each other (in terms of SAW) 
        // or properly ordered (no RAW violations relative to predecessors).
        for (let i = 0; i < firstConflict; i++) {
            finalResults[i] = results[i]!;
            if (results[i]!.success && results[i]!.journalEntries) {
                this.processor.applyJournal(results[i]!.journalEntries!);
            }
        }

        // Serial Fallback for remainder
        // If a conflict occurred at index i, it means i depended on something < i but read stale data.
        // We must re-run i against the state updated by 0..i-1.
        // We also re-run all subsequent transactions to ensure they see the correct effects of i.
        if (firstConflict < txs.length) {
            stats.rounds++;
            for (let i = firstConflict; i < txs.length; i++) {
                // Execute serially with COMMIT=TRUE (standard execution)
                // This runs against the updated state.
                finalResults[i] = await this.processor.execute(
                    txs[i]!.functionName,
                    txs[i]!.args,
                    txs[i]!.caller,
                    block,
                    { commit: true }
                );
            }
        }
        stats.serialFallbackTimeMs = Date.now() - serialStartTime;

        return { results: finalResults, stats };
    }
}
