import { generateCorpus } from './generator.js';
import { createSingleSequencer } from '@vera/ordering';
import { LevelDBStore } from '@vera/store';
import { zeroBytes32, bytesToHex, sha256WithDomain, HashDomains, encodeCanonicalTransaction, signTransaction } from '@vera/core';
import fs from 'node:fs/promises';
import path from 'node:path';
import pc from 'picocolors';
import { performance } from 'node:perf_hooks';
import { LatencyTracker, MemoryMonitor } from './metrics.js';

async function benchSequencer() {
    const COUNT = 10000;
    console.log(pc.cyan(`\nStarting Sequencer Benchmark (${COUNT} txs)...`));

    // 1. Setup
    const benchDir = path.resolve('./bench-out/sequencer');
    await fs.rm(benchDir, { recursive: true, force: true });
    await fs.mkdir(benchDir, { recursive: true });

    const store = new LevelDBStore(benchDir);
    const sequencer = createSingleSequencer({
        id: 'bench-seq',
        chainId: zeroBytes32(),
        store
    });

    await sequencer.start();

    // 2. Generate & Prepare
    console.log(pc.gray('Generating corpus & signing...'));
    const rawCorpus = generateCorpus(COUNT);
    const signedCorpus = [];

    for (const item of rawCorpus) {
        const canonical = encodeCanonicalTransaction({
            version: 1,
            chainId: zeroBytes32(),
            type: { moduleId: zeroBytes32(), transactionName: 'bench' },
            nonce: item.nonce,
            maxSequence: 0n,
            payload: item.payload
        });
        const txHash = sha256WithDomain(HashDomains.TRANSACTION, canonical);
        const sig = signTransaction(txHash, item.keyPair.privateKey);

        signedCorpus.push({
            hash: txHash,
            chainId: zeroBytes32(),
            sender: item.keyPair.publicKey,
            function: 'bench',
            args: item.payload,
            nonce: item.nonce,
            signature: sig.signature,
            canonicalTxBytes: canonical,
            submittedAt: BigInt(Date.now())
        });
    }

    // 3. Run
    const latencyTracker = new LatencyTracker();
    const memoryMonitor = new MemoryMonitor(500);

    console.log(pc.gray('Appending transactions...'));
    memoryMonitor.start();
    const start = performance.now();

    for (const rawTx of signedCorpus) {
        const submitStart = performance.now();
        const res = await sequencer.submit(rawTx as any);
        latencyTracker.record(performance.now() - submitStart);

        if (!res.accepted) {
            throw new Error(`Submit failed: ${res.error}`);
        }
    }

    const end = performance.now();
    const memoryStats = memoryMonitor.stop();
    const latencyStats = latencyTracker.getStats();

    const durationSec = (end - start) / 1000;
    const tps = COUNT / durationSec;

    console.log(pc.green(`\n✓ Done in ${durationSec.toFixed(2)}s`));
    console.log(pc.bold(`Throughput: ${tps.toFixed(0)} TPS`));
    console.log(pc.gray(`Latency (ms): p50=${latencyStats.p50.toFixed(2)}, p95=${latencyStats.p95.toFixed(2)}, p99=${latencyStats.p95.toFixed(2)}`));
    console.log(pc.gray(`Memory (MB): start=${memoryStats.rss_start_mb}, peak=${memoryStats.rss_peak_mb}, slope=${memoryStats.rss_slope_mb_per_min}MB/min`));

    // 4. Budget Tightening (Screw Turn 6)
    const BUDGET = {
        min_tps: 200,
        max_p99_latency: 10,
        max_rss_slope: 50
    };

    console.log(pc.cyan('\nVerifying Performance Budgets...'));
    let ok = true;

    if (tps < BUDGET.min_tps) {
        console.error(pc.red(`✖ TPS too low: ${tps.toFixed(0)} < ${BUDGET.min_tps}`));
        ok = false;
    }
    if (latencyStats.p99 > BUDGET.max_p99_latency) {
        console.error(pc.red(`✖ p99 latency too high: ${latencyStats.p99.toFixed(2)}ms > ${BUDGET.max_p99_latency}ms`));
        ok = false;
    }
    if (memoryStats.rss_slope_mb_per_min > BUDGET.max_rss_slope) {
        console.error(pc.red(`✖ Memory RSS slope too high: ${memoryStats.rss_slope_mb_per_min}MB/min > ${BUDGET.max_rss_slope}MB/min`));
        ok = false;
    }

    if (ok) {
        console.log(pc.green('✅ Performance budgets satisfied.'));
    } else {
        throw new Error('Performance budget violation');
    }

    // Generate Report Artifact
    const report = {
        timestamp: new Date().toISOString(),
        hardware: process.arch,
        node_version: process.version,
        benchmark: 'sequencer_append',
        description: 'Measures durably appending signed transactions to the Ordering Log (LevelDB). Does NOT include State Execution.',
        metrics: {
            count: COUNT,
            duration_sec: durationSec,
            tps: Math.round(tps),
            latency: latencyStats,
            memory: memoryStats,
            boundary: 'appended_durable'
        },
        config: {
            sync: false
        }
    };

    await fs.writeFile(
        path.join(benchDir, 'report.json'),
        JSON.stringify(report, null, 2)
    );

    await sequencer.stop();
    await store.close();
}

benchSequencer().catch(console.error);
