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
import commandLineArgs from 'command-line-args';
import { LatencyTracker, MemoryMonitor, TransactionLogger, ReplayVerifier } from './metrics.js';

const optionDefinitions = [
    { name: 'duration', alias: 'd', type: Number, defaultValue: 60 }, // Seconds for short demo, user asked for 30-120m normally
    { name: 'targetTps', alias: 't', type: Number, defaultValue: 100 },
    { name: 'outDir', alias: 'o', type: String, defaultValue: './bench-out/soak' }
];

async function benchSoak() {
    // Filter out '--' that pnpm might pass through
    const argv = process.argv.slice(2).filter(arg => arg !== '--');
    const options = commandLineArgs(optionDefinitions, { argv });
    const durationMs = options.duration * 1000;
    const targetTps = options.targetTps;

    console.log(pc.cyan(`\nStarting Soak Benchmark`));
    console.log(pc.gray(`Duration: ${options.duration}s | Target: ${targetTps} TPS`));

    // 1. Setup Data Dirs
    const benchDir = path.resolve(options.outDir);
    await fs.rm(benchDir, { recursive: true, force: true });
    await fs.mkdir(benchDir, { recursive: true });

    const seqDb = new LevelDBStore(path.join(benchDir, 'sequencer.db'));
    const stateDb = new LevelDBStore(path.join(benchDir, 'state.db'));

    // 2. Setup Components
    let stateStore = await PersistentStateStore.load(stateDb);

    const dslSource = `
        module Soak;
        
        entity Data[bytes] {
            val: Bytes
        }

        transaction inc(payload: Bytes) {
            let key = crypto.sha256(payload);
            set get<Data>(key) = Data { val: payload };
        }
    `;
    const lexer = new Lexer(dslSource);
    const parser = new Parser(lexer.tokenize());
    const ir = compileToIR(parser.parseModule());
    const processor = createProcessor(ir);

    const sequencer = createSingleSequencer({
        id: 'soak-seq',
        chainId: zeroBytes32(),
        store: seqDb,
        finality: { confirmationDepth: 0, autoFinalizeMs: 50 }
    });

    // 3. Metrics Setup
    const latencyTracker = new LatencyTracker();
    const memoryMonitor = new MemoryMonitor(5000); // 5s sampling for soak
    const submissionTimes = new Map<string, number>();
    const logger = new TransactionLogger(path.join(benchDir, 'audit.jsonl'));
    await logger.start();

    // 4. Execution Loop
    let committedCount = 0;
    let submittedCount = 0;
    let running = true;

    sequencer.onFinality(async (tx) => {
        try {
            const now = performance.now();
            const hashHex = bytesToHex(tx.tx.hash);
            const submitTime = submissionTimes.get(hashHex);
            if (submitTime) {
                latencyTracker.record(now - submitTime);
            }

            logger.log(tx);

            const args = TransactionStateProcessor.decodeArguments(tx.tx.args);
            const result = await processor.execute(
                'inc',
                args,
                bytesToHex(tx.tx.sender),
                { height: tx.sequenceNumber, timestamp: tx.sequencedAt }
            );

            if (result.success) {
                stateStore = await stateStore.apply(result.binaryChanges, tx.sequenceNumber) as PersistentStateStore;
            }
            committedCount++;
        } catch (e) {
            console.error('Soak Error:', e);
        }
    });

    await sequencer.start();
    memoryMonitor.start();

    // 5. Pacing Logic
    const startTime = performance.now();
    const corpus = generateCorpus(1000); // reuse corpus periodically or generate new?
    // For soak, we want unique nonces but maybe same keys.
    const keyPair = corpus[0].keyPair;

    console.log(pc.gray('Soaking...'));
    let warmupMarked = false;
    const warmupDurationMs = 10000; // 10s warmup
    while (performance.now() - startTime < durationMs) {
        const elapsed = performance.now() - startTime;
        const elapsedSec = elapsed / 1000;
        const expectedCount = Math.floor(elapsedSec * targetTps);

        if (!warmupMarked && elapsed > warmupDurationMs) {
            memoryMonitor.markWarmupFinished();
            warmupMarked = true;
            console.log(pc.yellow('\nWarmup finished, benchmarking...'));
        }

        if (submittedCount < expectedCount) {
            // Submit 1 tx
            const nonce = BigInt(submittedCount + 1);
            const key = `key-${submittedCount % 100}`;
            const encodedArgs = TransactionStateProcessor.encodeArguments([
                { kind: 'string', value: key }
            ]);

            const canonical = encodeCanonicalTransaction({
                version: 1,
                chainId: zeroBytes32(),
                type: { moduleId: zeroBytes32(), transactionName: 'inc' },
                nonce,
                maxSequence: 0n,
                payload: encodedArgs
            });
            const txHash = sha256WithDomain(HashDomains.TRANSACTION, canonical);
            const sig = signTransaction(txHash, keyPair.privateKey);

            const rawTx = {
                hash: txHash,
                chainId: zeroBytes32(),
                sender: keyPair.publicKey,
                function: 'inc',
                args: encodedArgs,
                nonce,
                signature: sig.signature,
                submittedAt: BigInt(Date.now())
            };

            const submitTime = performance.now();
            submissionTimes.set(bytesToHex(txHash), submitTime);

            await sequencer.submit(rawTx as any);
            submittedCount++;

            if (submittedCount % 1000 === 0) {
                process.stdout.write(pc.gray(`\rProcessed: ${submittedCount} | Memory: ${Math.round(process.memoryUsage().rss / 1024 / 1024)}MB`));
            }
        } else {
            // Tiny sleep to prevent busy loop
            await new Promise(r => setTimeout(r, 1));
        }
    }

    console.log(pc.gray(`\nWaiting for completion...`));
    const waitStart = Date.now();
    while (committedCount < submittedCount && Date.now() - waitStart < 10000) {
        await new Promise(r => setTimeout(r, 100));
    }

    const end = performance.now();
    await logger.stop();
    const memoryStats = memoryMonitor.stop();
    const latencyStats = latencyTracker.getStats({ durability: 'logical' });

    console.log(pc.gray('Verifying replay...'));
    const replayStats = await ReplayVerifier.verify(
        path.join(benchDir, 'audit.jsonl'),
        processor,
        '0x' + bytesToHex(stateStore.root),
        benchDir
    );

    const totalTime = (end - startTime) / 1000;
    const actualTps = committedCount / totalTime;

    console.log(pc.green(`\n✓ Soak Complete in ${totalTime.toFixed(2)}s`));
    console.log(pc.bold(`Average Throughput: ${actualTps.toFixed(1)} TPS`));
    console.log(pc.gray(`Latency (ms): p50=${latencyStats.p50.toFixed(2)}, p95=${latencyStats.p95.toFixed(2)}`));
    console.log(pc.gray(`Memory (MB): start=${memoryStats.rss_start_mb}, peak=${memoryStats.rss_peak_mb}, slope=${memoryStats.rss_slope_mb_per_min} MB/min`));
    console.log(pc.gray(`Replay Match: ${replayStats.match ? pc.green('YES') : pc.red('NO')}`));

    // Final Report
    const report = {
        timestamp: new Date().toISOString(),
        bench_name: 'soak_test',
        config: options,
        metrics: {
            tps_avg: actualTps,
            latency: latencyStats,
            memory: memoryStats,
            replay: replayStats,
            total_tx: committedCount
        },
        replay_root_match: replayStats.match
    };

    await fs.writeFile(
        path.join(benchDir, 'report.json'),
        JSON.stringify(report, null, 2)
    );

    await sequencer.stop();
    await seqDb.close();
    await stateDb.close();
}

benchSoak().catch(console.error);
