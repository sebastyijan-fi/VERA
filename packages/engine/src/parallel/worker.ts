
import { parentPort } from 'node:worker_threads';
import { TransactionStateProcessor } from '../processor.js';

if (!parentPort) {
    throw new Error('Worker must be spawned with a parent port');
}

parentPort.on('message', async (task: any) => {
    try {
        const { program, functionName, args, caller, block, snapshot } = task;

        // Reconstruct State from Snapshot
        // Snapshot is a Map<string, Map<string, Value>> (cloned by postMessage)
        // We can pass it directly if it preserves Map type, which it does.
        const initialState = snapshot;

        // Initialize Processor
        const processor = new TransactionStateProcessor(program, {
            initialState
        });

        // Use validate for non-committing execution
        // We actually want execute() with { commit: false } but access to full result
        // validate() returns simplistic result. We need execute()

        // Re-hydrate args (Value objects might lose methods over wire, but they are interfaces so mostly fine)
        // Check Value type hydration in processor...

        const result = await processor.execute(functionName, args, caller, block, { commit: false });

        parentPort?.postMessage({
            success: result.success,
            txIndex: task.txIndex,
            result: {
                success: result.success,
                gasUsed: result.gasUsed,
                stateChanges: result.stateChanges, // Maps need special handling for postMessage? Node supports structured clone of Maps.
                journalEntries: result.journalEntries,
                accessSet: result.accessSet,
                error: result.error
            }
        });
    } catch (e: any) {
        parentPort?.postMessage({
            success: false,
            txIndex: task.txIndex,
            error: e.message
        });
    }
});
