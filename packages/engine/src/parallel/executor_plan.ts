
import { TransactionStateProcessor, type ExecutionResult, type ProcessorOptions } from '../processor.js';
import { StateJournal } from '../state/journal.js';
import { detectConflicts, type ExecutionTrace } from './conflict.js';
import type { IRProgram } from '@vera/dsl';
import type { Value } from '../vm/value.js';
import type { BlockContext } from '../state/context.js';

export interface ParallelExecutionStats {
    totalTransactions: number;
    conflictsDetected: number;
    rounds: number;
    parallelTimeMs: number;
    serialFallbackTimeMs: number;
}

export class ParallelExecutor {
    private processor: TransactionStateProcessor;

    constructor(program: IRProgram, options: ProcessorOptions = {}) {
        this.processor = new TransactionStateProcessor(program, options);
    }

    /**
     * Executes a batch of transactions using (simulated) parallel optimistic execution.
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

        // 1. Optimistic Pass: Execute all against the generic base state
        // In a real system, this would fork threads. In Node, this interleaves IO.
        const optimisticPromises = txs.map((tx, index) => {
            // Create a dedicated processor/journal for this tx to run in isolation against SNAPSHOT
            // Actually TransactionStateProcessor creates a fresh StateJournal(this.state) for each execute() call,
            // so we just need to call execute().
            // BUT: We need to capture the `accessSet` (read/writes).
            // standard `execute` returns `stateChanges` but not the full read set.
            // We need to extend execution result or expose the journal.

            // Hack for MVP: We will assume we can get the journal from the result or 
            // we might need to modify Processor to return the Journal or AccessSet.
            // Let's assume we modify Processor to return 'accessSet' in ExecutionResult.
            return this.processor.execute(tx.functionName, tx.args, tx.caller, block);
        });

        const results = await Promise.all(optimisticPromises);
        stats.parallelTimeMs = Date.now() - startTime;

        // 2. Extract Traces
        // We need `accessSet` from results. Since we haven't modified Processor yet to return it,
        // we must do that first. But let's assume it exists for the plan.
        const traces: ExecutionTrace[] = results.map((res, index) => ({
            txIndex: index,
            accessSet: (res as any).accessSet // TODO: Add this to generic
        }));

        // 3. Detect Conflicts
        const conflicts = detectConflicts(traces);
        stats.conflictsDetected = conflicts.size;

        // 4. Resolve
        if (conflicts.size === 0) {
            // Happy path! Commit all changes to the processor's persistent state.
            // The processor.execute() does NOT commit to the persistent map automatically if we are just running them?
            // Wait, `TransactionStateProcessor` in `execute` calls `state.commit()` to its local `this.state`.
            // This means `this.state` is mutated IMMEDIATELY sequentially?
            // NO. `TransactionStateProcessor` has `this.state`.
            // `execute` creates `new StateJournal(this.state)`.
            // `state.commit()` applies changes to `this.state`.
            // IF we run `Promise.all([processor.execute(...), processor.execute(...)])`:
            // They both read `this.state` (concurrently).
            // They both finish.
            // They both `state.commit()` to `this.state`.
            // RACE CONDITION in `commit()`! `Map.set` is synchronous but they might interleave in weird ways 
            // if we weren't careful.
            // ACTUALLY: `state.commit()` writes to the Map.
            // If they are strictly parallel, we want them NOT to commit until we say so.
            // We need `execute` to NOT commit, or use a "Dry Run" mode?

            // CORRECT APPROACH:
            // The `ParallelExecutor` should maintain the canonical state.
            // It runs Txs against clones/snapshots.
            // It applies valid results.

            // Refactoring needed:
            // 1. `TransactionStateProcessor.execute` needs verify-only mode (optimistic) that returns the journal/changes/accessSet WITHOUT committing to `this.state`.
            // 2. `ParallelExecutor` collects these "Pending Commits".
            // 3. If Valid, applies them.
            // 4. If Invalid, discards and re-runs.
        }

        // ... Implementation continues ...
        return { results, stats };
    }
}
