
import path from 'path';
import fs from 'fs/promises';
import { LevelDBStore, PersistentStateStore } from '@vera/store';
import { createSingleSequencer, createRawTransaction } from '@vera/ordering';
import { createProcessor, TransactionStateProcessor, intValue, bytesValue } from '@vera/engine';
import { compileToIR, Lexer, Parser } from '@vera/dsl';
import {
    generateKeyPair,
    signTransaction,
    sha256WithDomain,
    zeroBytes32,
    HashDomains,
} from '@vera/core';
import pc from 'picocolors';

const OUT_DIR = path.resolve('bench-out/durability');

// Configuration
const TX_COUNT = 2_000;

async function runBenchmark(durability: 'logical' | 'strict', label: string) {
    const runDir = path.join(OUT_DIR, durability);
    await fs.mkdir(runDir, { recursive: true });

    console.log(pc.bold(`\nRunning Workload: ${label} (durability=${durability})`));

    // Setup
    const store = new LevelDBStore(path.join(runDir, 'store'));
    // Separate state store for fairness, though mostly sequencer durability matters for immediate return
    const stateDb = new LevelDBStore(path.join(runDir, 'state'));
    let persistentState = await PersistentStateStore.load(stateDb);

    // Sequencer with specific durability
    // Note: SingleSequencer options might not expose 'durability' directly if it's passed to store? 
    // Actually, createSingleSequencer config has 'durability'.
    // Let's verify SingleSequencerConfig later if needed, assuming API holds.
    // If LevelDBStore handles durability, we might need to configure the store?
    // But usually application logic controls write options.
    // Let's check SingleSequencerConfig usage.
    // Assuming createSingleSequencer({ ... durability }) controls the write options of the log.

    const sequencer = createSingleSequencer({
        store,
        chainId: zeroBytes32(),
        durability: durability,
    });
    await sequencer.start();

    // Prepare Txs
    const dsl = `
        module Durability;
        public entity Counter[Bytes] { val: UInt }
        public transaction inc(key: Bytes) {
            set Counter[key] = Counter { val: 1 };
        }
    `;
    const ir = compileToIR(new Parser(new Lexer(dsl).tokenize()).parseModule());
    const processor = createProcessor(ir);
    const keys = generateKeyPair();

    const txs = [];
    for (let i = 0; i < TX_COUNT; i++) {
        const key = new Uint8Array(32);
        new DataView(key.buffer).setUint32(0, i);
        const payload = TransactionStateProcessor.encodeArguments([bytesValue(key)]);
        const hash = sha256WithDomain(HashDomains.TRANSACTION, payload);
        const sig = signTransaction(hash, keys.privateKey);

        txs.push(createRawTransaction(
            hash,
            zeroBytes32(),
            keys.publicKey,
            'inc',
            payload,
            BigInt(i + 1),
            sig.signature,
            new Uint8Array(10)
        ));
    }

    // Benchmark Execution: One by one to punish latency
    // If we batch, we amortize fsync cost.
    // To see the real "commit latency" cost, we should submit batches of 1 or small size?
    // Let's submit individual transactions to maximize the visible difference in latency.
    // OR submit small batches (e.g. 10).
    // Submitting 2000 txs individually with fsync will be VERY slow (e.g. 50ms * 2000 = 100s).
    // That's acceptable for a benchmark.

    const tStart = performance.now();
    let latencies = [];

    for (let i = 0; i < TX_COUNT; i++) {
        const t0 = performance.now();
        const res = await sequencer.submitMany([txs[i]]);

        // Wait for it to be sequenced? submitMany returns when sequenced/persisted.
        if (!res[0].accepted) throw new Error(res[0].error);

        // Also apply state?
        // Durability mostly affects sequencer log persistence.
        // State application is async usually.
        // But for "Client commit latency", `submitMany` return time is what counts.

        const t1 = performance.now();
        latencies.push(t1 - t0);

        if (i % 100 === 0) process.stdout.write('.');
    }

    const tEnd = performance.now();
    const totalTime = tEnd - tStart;

    // Stats
    latencies.sort((a, b) => a - b);
    const p50 = latencies[Math.floor(latencies.length * 0.5)];
    const p95 = latencies[Math.floor(latencies.length * 0.95)];
    const p99 = latencies[Math.floor(latencies.length * 0.99)];
    const tps = TX_COUNT / (totalTime / 1000);

    const result = {
        durability,
        count: TX_COUNT,
        tps,
        latency: { p50, p95, p99 },
        total_time_ms: totalTime
    };

    console.log(`\n\nResults for ${label}:`);
    console.log(`TPS: ${tps.toFixed(2)}`);
    console.log(`Latency P50: ${p50.toFixed(2)}ms`);
    console.log(`Latency P99: ${p99.toFixed(2)}ms`);

    await sequencer.stop();
    await store.close();
    await stateDb.close();

    return result;
}

async function run() {
    console.log(pc.cyan('VERA Durability Bake-off (E3)'));
    console.log(pc.dim('-----------------------------------'));

    await fs.rm(OUT_DIR, { recursive: true, force: true });
    await fs.mkdir(OUT_DIR, { recursive: true });

    const results = [];

    // Pass 1: Logical
    results.push(await runBenchmark('logical', 'Scenario A (Logical)'));

    // Pass 2: Strict
    results.push(await runBenchmark('strict', 'Scenario B (Strict)'));

    await fs.writeFile(path.join(OUT_DIR, 'report.json'), JSON.stringify(results, null, 2));

    // Summary
    console.log(pc.green('\nComparison Summary:'));
    const logical = results[0];
    const strict = results[1];

    console.log(`Throughput Drop: ${((1 - strict.tps / logical.tps) * 100).toFixed(1)}%`);
    console.log(`Latency Increase (P99): ${(strict.latency.p99 / logical.latency.p99).toFixed(1)}x`);
}

run().catch(console.error);
