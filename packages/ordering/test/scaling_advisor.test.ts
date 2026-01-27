
import { describe, it, expect } from 'vitest';
import { TransactionPool } from '../src/pool.js';
import { createRawTransaction } from '../src/types.js';
import { toBytes32, zeroBytes32 } from '@vera/core';
import { performance } from 'node:perf_hooks';

// Helper to deduce Big-O complexity from measurements
function estimateComplexity(measurements: { n: number; time: number }[]): 'O(1)' | 'O(n)' | 'O(n^2)' {
    // We look at the growth factor between N and 10N
    const base = measurements[0];
    const mid = measurements[1];

    const timeGrowth = mid.time / base.time;
    const inputGrowth = mid.n / base.n;

    if (timeGrowth < 1.5) return 'O(1)'; // Constant time (mostly)
    if (timeGrowth < inputGrowth * 1.5) return 'O(n)'; // Linear time (approx)
    return 'O(n^2)'; // Quadratic or worse
}

describe('Algorithmic Governor (Scalability Advisor)', () => {

    it('Transaction Pool insertion should strictly follow O(1) or O(log n)', async () => {
        // Prepare datasets
        const createBatch = (n: number) => Array.from({ length: n }, (_, i) => {
            const hash = toBytes32(Buffer.from(`tx-${n}-${i}`.padStart(32, '0')));
            const sender = toBytes32(Buffer.from(`sender-${i}`.padStart(32, '0')));
            return createRawTransaction(
                hash, zeroBytes32(), sender, 'test', new Uint8Array(), BigInt(i), new Uint8Array(64), new Uint8Array()
            );
        });

        const inputs = [1000, 10000];
        const measurements: { n: number; time: number }[] = [];

        for (const n of inputs) {
            const pool = new TransactionPool();
            const txs = createBatch(n);

            // Warmup
            pool.add(txs[0]);

            const start = performance.now();
            for (const tx of txs) {
                pool.add(tx);
            }
            const end = performance.now();

            measurements.push({ n, time: end - start });
        }

        const complexity = estimateComplexity(measurements);

        console.log(`\nAlgorithmic Governor Report:`);
        console.log(`Input N=${inputs[0]}: ${measurements[0].time.toFixed(2)}ms`);
        console.log(`Input N=${inputs[1]}: ${measurements[1].time.toFixed(2)}ms`);
        console.log(`Detected Complexity: ${complexity}`);

        // THE ADVICE:
        // If this verification fails, the test is advising you to refactor the data structure.
        expect(complexity).not.toBe('O(n^2)');
        expect(['O(1)', 'O(n)']).toContain(complexity);
        // Note: O(n) total for N items means O(1) per item (Amortized). 
        // If total time scales linearly with input size, then per-item is constant.
    });
});
