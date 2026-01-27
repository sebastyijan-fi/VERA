
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

const OUT_DIR = path.resolve('bench-out/compaction');

// Configuration
const INITIAL_KEYS = 50_000;
const UPDATES = 100_000;
const BATCH_SIZE = 100; // Small batch for individual latency granularity (amortized slightly)

async function run() {
    console.log(pc.cyan('VERA Compaction & Tail-Latency Benchmark (E2)'));
    console.log(pc.dim('---------------------------------------------'));

    await fs.rm(OUT_DIR, { recursive: true, force: true });
    await fs.mkdir(OUT_DIR, { recursive: true });

    // Setup
    const store = new LevelDBStore(path.join(OUT_DIR, 'store'));
    const stateDb = new LevelDBStore(path.join(OUT_DIR, 'state'));
    let persistentState = await PersistentStateStore.load(stateDb);

    // Logical durability to stress the engine (allow fast writes to trigger compaction)
    const sequencer = createSingleSequencer({
        store,
        chainId: zeroBytes32(),
        durability: 'logical',
    });
    await sequencer.start();

    // DSL
    const dsl = `
        module Compaction;
        public entity Item[Bytes] { val: UInt }
        public transaction setItem(key: Bytes, val: UInt) {
            set Item[key] = Item { val: val };
        }
    `;
    const ir = compileToIR(new Parser(new Lexer(dsl).tokenize()).parseModule());
    const processor = createProcessor(ir);
    const keys = generateKeyPair();
    let globalNonce = 1n;

    // 1. Fill Phase
    console.log(pc.yellow(`\nPhase 1: Filling ${INITIAL_KEYS.toLocaleString()} keys...`));
    let startFill = Date.now();

    // Use larger batches for fill
    const FILL_BATCH = 1000;
    for (let i = 0; i < INITIAL_KEYS; i += FILL_BATCH) {
        const txs = [];
        for (let j = 0; j < FILL_BATCH; j++) {
            const id = i + j;
            const key = new Uint8Array(32);
            new DataView(key.buffer).setUint32(0, id);

            const payload = TransactionStateProcessor.encodeArguments([
                bytesValue(key),
                intValue(BigInt(id))
            ]);
            const hash = sha256WithDomain(HashDomains.TRANSACTION, payload);
            const sig = signTransaction(hash, keys.privateKey);

            txs.push(createRawTransaction(
                hash,
                zeroBytes32(),
                keys.publicKey,
                'setItem',
                payload,
                globalNonce++,
                sig.signature,
                new Uint8Array(10)
            ));
        }

        // Submit
        await sequencer.submitMany(txs);

        // Execute (Simulated - in real bench we might skip exec if purely testing storage, 
        // but storage compaction comes from STATE updates, so we MUST apply changes)
        // Optimization: We define "write churn" as updating the persistent state.

        const validTxs = txs.map((tx, idx) => ({ ...tx, seq: BigInt(i + idx + 1) })); // Mock seq for fill speed
        const atomicBatch = [];
        for (const tx of validTxs) {
            const args = TransactionStateProcessor.decodeArguments(tx.args);
            const res = await processor.execute('setItem', args, '0x00', { height: BigInt(1), timestamp: BigInt(Date.now()) });
            if (res.success) atomicBatch.push(...res.binaryChanges);
        }
        // Apply to state
        persistentState = await persistentState.apply(atomicBatch, BigInt(validTxs[validTxs.length - 1].seq)) as PersistentStateStore;

        process.stdout.write(`\rFilled: ${i + FILL_BATCH}`);
    }
    console.log(`\nFill Complete in ${(Date.now() - startFill) / 1000}s`);

    // 2. Churn Phase
    console.log(pc.yellow(`\nPhase 2: Churning ${UPDATES.toLocaleString()} updates...`));
    const latencies: number[] = [];

    // We will do updates in small batches to measure "Request Latency"
    let totalUpdates = 0;

    const startChurn = performance.now();

    for (let i = 0; i < UPDATES; i += BATCH_SIZE) {
        const txs = [];
        for (let j = 0; j < BATCH_SIZE; j++) {
            // Pick random key from existing range
            const id = Math.floor(Math.random() * INITIAL_KEYS);
            const key = new Uint8Array(32);
            new DataView(key.buffer).setUint32(0, id);

            // New value (incrementing i ensures data changes)
            const val = BigInt(i + j);

            const payload = TransactionStateProcessor.encodeArguments([
                bytesValue(key),
                intValue(val)
            ]);

            const hash = sha256WithDomain(HashDomains.TRANSACTION, payload);
            const sig = signTransaction(hash, keys.privateKey);

            txs.push(createRawTransaction(
                hash,
                zeroBytes32(),
                keys.publicKey,
                'setItem',
                payload,
                globalNonce++, // Monotonic nonce
                sig.signature,
                new Uint8Array(10)
            ));
        }

        const t0 = performance.now();

        // Submit
        const res = await sequencer.submitMany(txs);

        // Execute & Apply
        const atomicBatch = [];
        const validTxs = [];
        for (let idx = 0; idx < txs.length; idx++) {
            if (res[idx].accepted && res[idx].sequenceNumber !== undefined) {
                validTxs.push({ ...txs[idx], seq: res[idx].sequenceNumber! });
            }
        }

        if (validTxs.length === 0) {
            console.warn('Batch rejected entirely');
            continue;
        }

        for (const tx of validTxs) {
            const args = TransactionStateProcessor.decodeArguments(tx.args);
            const r = await processor.execute('setItem', args, '0x00', { height: tx.seq, timestamp: BigInt(Date.now()) });
            if (r.success) atomicBatch.push(...r.binaryChanges);
        }

        persistentState = await persistentState.apply(atomicBatch, BigInt(validTxs[validTxs.length - 1].seq)) as PersistentStateStore;

        const t1 = performance.now();
        const batchLatency = t1 - t0;

        // Amortized latency per tx? Or just track batch latency?
        // Since batch is small (100), batch latency is roughly 100 * single_tx_latency.
        // If we see a 500ms batch, that's a stall.
        latencies.push(batchLatency);

        totalUpdates += BATCH_SIZE;
        if (totalUpdates % 5000 === 0) {
            process.stdout.write(`\rUpdates: ${totalUpdates.toLocaleString()} | Last Batch: ${batchLatency.toFixed(1)}ms`);
        }
    }

    const endChurn = performance.now();

    // Analysis
    latencies.sort((a, b) => a - b);
    const max = latencies[latencies.length - 1];
    const p99 = latencies[Math.floor(latencies.length * 0.99)];
    const p999 = latencies[Math.floor(latencies.length * 0.999)];
    const p50 = latencies[Math.floor(latencies.length * 0.50)];

    console.log('\n\nResults (Batch Size 100):');
    console.log(`Median Batch Latency: ${p50.toFixed(2)}ms`);
    console.log(`P99.9 Batch Latency:  ${p999.toFixed(2)}ms`);
    console.log(`Max Batch Latency:    ${max.toFixed(2)}ms`);

    const spikes = latencies.filter(l => l > 100).length;
    console.log(`\nSpikes (>100ms): ${spikes}`);

    if (max > 200) {
        console.log(pc.red('FAILURE: Max latency exceeded 200ms budget.'));
    } else {
        console.log(pc.green('SUCCESS: Latency remained within bounds.'));
    }

    const report = {
        config: { initial_keys: INITIAL_KEYS, updates: UPDATES, batch_size: BATCH_SIZE },
        latency_ms: { p50, p99, p999, max },
        spikes,
        total_time_s: (endChurn - startChurn) / 1000
    };

    await fs.writeFile(path.join(OUT_DIR, 'report.json'), JSON.stringify(report, null, 2));

    await sequencer.stop();
    await store.close();
    await stateDb.close();
}

run().catch(console.error);
