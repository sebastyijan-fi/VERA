import { generateCorpus } from './generator.js';
import { createSingleSequencer } from '@vera/ordering';
import { LevelDBStore, PersistentStateStore } from '@vera/store';
import { zeroBytes32, bytesToHex, sha256WithDomain, HashDomains, encodeCanonicalTransaction, signTransaction } from '@vera/core';
import { compileToIR, Lexer, Parser } from '@vera/dsl';
import { createProcessor, TransactionStateProcessor } from '@vera/engine';
import fs from 'node:fs/promises';
import path from 'node:path';
import pc from 'picocolors';
import { performance } from 'node:perf_hooks';
import { LatencyTracker, MemoryMonitor, TransactionLogger, ReplayVerifier } from './metrics.js';

/**
 * Rigorous Commit Benchmark (v2.2)
 * 
 * Matrix Coverage:
 * - E3: Durability Cost (Logical vs Strict)
 * - A1: Truth/Reconstructability (Replay Match)
 * - F1: Memory Bound (RSS Slope)
 */

const SYNC = process.env.VERA_BENCH_SYNC === 'true';
const ITERATIONS = 3;
const WARMUP_COUNT = 1000;
const MEASURE_COUNT = 10000;

async function runIteration(iterIdx: number, benchDir: string) {
    console.log(pc.cyan(`\n--- Iteration ${iterIdx + 1}/${ITERATIONS} (${SYNC ? 'Strict' : 'Logical'} Durability) ---`));

    const iterDir = path.join(benchDir, `iter-${iterIdx}`);
    await fs.mkdir(iterDir, { recursive: true });

    const seqDb = new LevelDBStore(path.join(iterDir, 'sequencer.db'));
    const stateDb = new LevelDBStore(path.join(iterDir, 'state.db'));

    let stateStore = await PersistentStateStore.load(stateDb);

    const dslSource = `
        module Bench;
        entity Data[bytes] { val: Bytes }
        transaction run(payload: Bytes) {
            let key = crypto.sha256(payload);
            set get<Data>(key) = Data { val: payload };
        }
    `;
    const ir = compileToIR(new Parser(new Lexer(dslSource).tokenize()).parseModule());
    const processor = createProcessor(ir);

    const sequencer = createSingleSequencer({
        id: 'bench-seq',
        chainId: zeroBytes32(),
        store: seqDb,
        finality: { confirmationDepth: 0, autoFinalizeMs: 10 }
    });

    const latencyTracker = new LatencyTracker();
    const memoryMonitor = new MemoryMonitor(500);
    const submissionTimes = new Map<string, number>();
    const logger = new TransactionLogger(path.join(iterDir, 'audit.jsonl'));
    await logger.start();

    // Bottleneck Instrumentation (only during MEASURE phase)
    const timings = { sig_verify_ms: 0, trie_ms: 0, disk_ms: 0 };
    let isMeasuring = false;

    let committedCount = 0;
    let resolveComplete: () => void;
    const completePromise = new Promise<void>(r => resolveComplete = r);

    const executionQueue: any[] = [];
    let processing = false;

    const processQueue = async () => {
        if (processing || executionQueue.length === 0) return;
        processing = true;

        while (executionQueue.length > 0) {
            const tx = executionQueue.shift();
            try {
                const now = performance.now();
                const hashHex = bytesToHex(tx.tx.hash);
                const submitTime = submissionTimes.get(hashHex);

                // Record latency only if measuring
                if (isMeasuring && submitTime) latencyTracker.record(now - submitTime);

                logger.log(tx);

                const args = TransactionStateProcessor.decodeArguments(tx.tx.args);

                // Phase: Trie/Logic
                const t0 = performance.now();
                const result = await processor.execute(
                    'run', args, bytesToHex(tx.tx.sender),
                    { height: tx.sequenceNumber, timestamp: tx.sequencedAt }
                );
                const t1 = performance.now();
                if (isMeasuring) timings.trie_ms += (t1 - t0);

                if (result.success) {
                    // Phase: Disk
                    const t2 = performance.now();
                    stateStore = await (stateStore as any).apply(result.binaryChanges, tx.sequenceNumber, { sync: SYNC });
                    const t3 = performance.now();
                    if (isMeasuring) timings.disk_ms += (t3 - t2);
                }

                committedCount++;
                if (committedCount >= (WARMUP_COUNT + MEASURE_COUNT)) {
                    resolveComplete();
                }
            } catch (e) {
                console.error('Exec error', e);
            }
        }
        processing = false;
    };

    sequencer.onFinality((tx) => {
        executionQueue.push(tx);
        processQueue();
    });

    await sequencer.start();

    // Generate Corpus
    console.log(pc.gray(`Generating corpus (${WARMUP_COUNT + MEASURE_COUNT} txs)...`));
    const corpus = generateCorpus(WARMUP_COUNT + MEASURE_COUNT);
    const signedCorpus = [];

    const tSigStart = performance.now();
    for (const item of corpus) {
        const encodedArgs = TransactionStateProcessor.encodeArguments([{ kind: 'bytes', value: item.payload }]);
        const canonical = encodeCanonicalTransaction({
            version: 1, chainId: zeroBytes32(),
            type: { moduleId: zeroBytes32(), transactionName: 'run' },
            nonce: item.nonce, maxSequence: 0n, payload: encodedArgs
        });
        const txHash = sha256WithDomain(HashDomains.TRANSACTION, canonical);
        const sig = signTransaction(txHash, item.keyPair.privateKey);

        signedCorpus.push({
            hash: txHash, chainId: zeroBytes32(),
            sender: item.keyPair.publicKey, function: 'run',
            args: encodedArgs, nonce: item.nonce,
            signature: sig.signature, canonicalTxBytes: canonical,
            submittedAt: BigInt(Date.now())
        });
    }
    const totalSigTime = performance.now() - tSigStart;
    // Estimated sig time for measurement phase only
    timings.sig_verify_ms = (totalSigTime / (WARMUP_COUNT + MEASURE_COUNT)) * MEASURE_COUNT;

    // Firing Loop
    console.log(pc.gray('Running warmup and measurement...'));
    memoryMonitor.start();

    // Warmup
    for (let i = 0; i < WARMUP_COUNT; i++) {
        await sequencer.submit(signedCorpus[i] as any);
    }

    // Transitions
    while (committedCount < WARMUP_COUNT) await new Promise(r => setTimeout(r, 50));

    console.log(pc.gray('Warmup executed. Forcing GC and starting measurement...'));
    if (global.gc) global.gc();
    memoryMonitor.markWarmupFinished();
    isMeasuring = true;

    const startMeasure = performance.now();
    for (let i = WARMUP_COUNT; i < (WARMUP_COUNT + MEASURE_COUNT); i++) {
        const rawTx = signedCorpus[i];
        submissionTimes.set(bytesToHex(rawTx.hash), performance.now());
        await sequencer.submit(rawTx as any);
    }

    await completePromise;
    const endMeasure = performance.now();
    isMeasuring = false;

    const memoryStats = memoryMonitor.stop();
    const latencyStats = latencyTracker.getStats({ durability: SYNC ? 'fsync_enforced' : 'logical' });

    await logger.stop();
    const durationSec = (endMeasure - startMeasure) / 1000;
    const tps = MEASURE_COUNT / durationSec;

    console.log(pc.green(`Iteration Result: ${tps.toFixed(0)} TPS`));

    // A1: Verification Replay Match
    console.log(pc.gray('Verifying A1 (Truth)...'));
    const replayStats = await ReplayVerifier.verify(
        path.join(iterDir, 'audit.jsonl'),
        processor,
        bytesToHex(stateStore.root),
        iterDir
    );

    // Cleanup
    await sequencer.stop();
    await seqDb.close();
    await stateDb.close();

    return {
        tps,
        latency: latencyStats,
        memory: memoryStats,
        timings,
        root: bytesToHex(stateStore.root),
        replay_match: replayStats.match
    };
}

async function main() {
    const benchDir = path.resolve('./bench-out/commit-rigorous');
    await fs.rm(benchDir, { recursive: true, force: true });
    await fs.mkdir(benchDir, { recursive: true });

    const results = [];
    for (let i = 0; i < ITERATIONS; i++) {
        results.push(await runIteration(i, benchDir));
    }

    const tpsValues = results.map(r => r.tps);
    const tpsMean = tpsValues.reduce((a, b) => a + b, 0) / ITERATIONS;
    const tpsStdDev = Math.sqrt(tpsValues.map(x => Math.pow(x - tpsMean, 2)).reduce((a, b) => a + b, 0) / ITERATIONS);

    const report = {
        timestamp: new Date().toISOString(),
        config: { iterations: ITERATIONS, measure_count: MEASURE_COUNT, warmup_count: WARMUP_COUNT, durability: SYNC ? 'strict' : 'logical' },
        summary: {
            tps_mean: Math.round(tpsMean),
            tps_stddev: Math.round(tpsStdDev),
            latency_p50_avg: results.reduce((acc, r) => acc + r.latency.p50, 0) / ITERATIONS,
            latency_p99_avg: results.reduce((acc, r) => acc + r.latency.p99, 0) / ITERATIONS,
            replay_match_all: results.every(r => r.replay_match)
        },
        bottlenecks_avg_ms: {
            sig_verify: results.reduce((acc, r) => acc + r.timings.sig_verify_ms, 0) / ITERATIONS,
            trie_update: results.reduce((acc, r) => acc + r.timings.trie_ms, 0) / ITERATIONS,
            disk_write: results.reduce((acc, r) => acc + r.timings.disk_ms, 0) / ITERATIONS
        }
    };

    await fs.writeFile(path.join(benchDir, 'report-summary.json'), JSON.stringify(report, null, 2));

    console.log(pc.bold(pc.green(`\n\nFinal Result: ${Math.round(tpsMean)} ± ${Math.round(tpsStdDev)} TPS`)));
    console.log(pc.gray(`Replay Determinism: ${report.summary.replay_match_all ? pc.green('PASS') : pc.red('FAIL')}`));
    console.log(pc.gray(`Bottlenecks (Total MS per ${MEASURE_COUNT} tx):`));
    console.log(pc.gray(`  SigVerify: ${Math.round(report.bottlenecks_avg_ms.sig_verify)}ms`));
    console.log(pc.gray(`  TrieUpdate: ${Math.round(report.bottlenecks_avg_ms.trie_update)}ms`));
    console.log(pc.gray(`  DiskWrite: ${Math.round(report.bottlenecks_avg_ms.disk_write)}ms`));
}

main().catch(console.error);
