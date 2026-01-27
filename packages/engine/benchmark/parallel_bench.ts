
import { ParallelExecutor } from '../src/parallel/executor.js';
import { TransactionStateProcessor } from '../src/processor.js';
import { type IRProgram, IROpcode } from '@vera/dsl';
import { stringValue, intValue } from '../src/vm/value.js';

async function runBenchmark() {
    console.log('Starting Parallel Execution Benchmark...');
    console.log('Warning: This benchmark compares Serial execution vs Async Concurrency (Simulated Parallelism).');
    console.log('True CPU parallelism requires Worker Threads (Phase 4.X).');
    console.log('------------------------------------------------------------');

    // 1. Setup Program
    const program: IRProgram = {
        id: '0x' + '0'.repeat(64),
        name: 'Bench',
        entities: [],
        events: [],
        functions: [
            {
                name: 'Write',
                isPublic: true,
                params: ['key', 'val'],
                locals: [],
                instructions: [
                    { opcode: IROpcode.LOAD, operand: 'key' },
                    { opcode: IROpcode.LOAD, operand: 'val' },
                    { opcode: IROpcode.STATE_SET, operand: 'bench' },
                    { opcode: IROpcode.RET }
                ]
            },
            {
                name: 'ReadWrite',
                isPublic: true,
                params: ['key', 'val'],
                locals: [],
                instructions: [
                    { opcode: IROpcode.LOAD, operand: 'key' },
                    { opcode: IROpcode.STATE_GET, operand: 'bench' }, // Read
                    { opcode: IROpcode.POP },
                    { opcode: IROpcode.LOAD, operand: 'key' },
                    { opcode: IROpcode.LOAD, operand: 'val' },
                    { opcode: IROpcode.STATE_SET, operand: 'bench' }, // Write
                    { opcode: IROpcode.RET }
                ]
            }
        ]
    };

    const block = { timestamp: 1000n, height: 1n, parentHash: '0x' + '0'.repeat(64) };
    const TX_COUNT = 5000;

    // Warmup
    console.log('Warming up...');
    new TransactionStateProcessor(program);

    // ========================================================================
    // Scenario 1: Serial Execution (Baseline)
    // ========================================================================
    {
        console.log(`\nScenario 1: Serial Execution (${TX_COUNT} txs)`);
        const processor = new TransactionStateProcessor(program);
        const start = Date.now();

        for (let i = 0; i < TX_COUNT; i++) {
            await processor.execute('Write', [stringValue(`key-${i}`), intValue(BigInt(i))], '0xUser');
        }

        const end = Date.now();
        const duration = end - start;
        const tps = (TX_COUNT / duration) * 1000;
        console.log(`Time: ${duration}ms`);
        console.log(`TPS: ${tps.toFixed(2)}`);
    }

    // ========================================================================
    // Scenario 2: Parallel Execution (Disjoint - Best Case)
    // ========================================================================
    {
        console.log(`\nScenario 2: Parallel Execution - Disjoint (${TX_COUNT} txs)`);
        const executor = new ParallelExecutor(program);
        const txs = Array.from({ length: TX_COUNT }, (_, i) => ({
            functionName: 'Write',
            args: [stringValue(`key-${i}`), intValue(BigInt(i))],
            caller: '0xUser'
        }));

        const start = Date.now();
        const { stats } = await executor.executeBlock(txs, block);
        const end = Date.now();

        const duration = end - start;
        const tps = (TX_COUNT / duration) * 1000;
        console.log(`Time: ${duration}ms`);
        console.log(`TPS: ${tps.toFixed(2)}`);
        console.log(`Stats: Rounds=${stats.rounds}, Conflicts=${stats.conflictsDetected}`);
        console.log(`Breakdown: Parallel=${stats.parallelTimeMs}ms, Serial=${stats.serialFallbackTimeMs}ms`);
        executor.terminate();
    }

    // ========================================================================
    // Scenario 3: Parallel Execution (High Contention - Worst Case)
    // ========================================================================
    {
        console.log(`\nScenario 3: Parallel Execution - High Contention (${TX_COUNT} txs, 10 keys)`);
        const executor = new ParallelExecutor(program);
        // Reuse keys 0..9 cyclically to determine read+write
        const txs = Array.from({ length: TX_COUNT }, (_, i) => ({
            functionName: 'ReadWrite',
            args: [stringValue(`key-${i % 10}`), intValue(BigInt(i))],
            caller: '0xUser'
        }));

        const start = Date.now();
        const { stats } = await executor.executeBlock(txs, block);
        const end = Date.now();

        const duration = end - start;
        const tps = (TX_COUNT / duration) * 1000;
        console.log(`Time: ${duration}ms`);
        console.log(`TPS: ${tps.toFixed(2)}`);
        console.log(`Stats: Rounds=${stats.rounds}, Conflicts=${stats.conflictsDetected}`);
        console.log(`Breakdown: Parallel=${stats.parallelTimeMs}ms, Serial=${stats.serialFallbackTimeMs}ms`);
        executor.terminate();
    }
}

runBenchmark().catch(console.error);
