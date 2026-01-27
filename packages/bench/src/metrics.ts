import { createWriteStream } from 'node:fs';
import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';
import { bytesToHex } from '@vera/core';
import { TransactionStateProcessor } from '@vera/engine';
import { PersistentStateStore, LevelDBStore } from '@vera/store';
import path from 'node:path';
import fs from 'node:fs/promises';

/**
 * VERA Benchmarking Metrics
 * 
 * Utilities for tracking latency percentiles and memory usage.
 */

export class LatencyTracker {
    private latencies: number[] = [];

    /**
     * Records a latency measurement in milliseconds
     */
    record(ms: number): void {
        this.latencies.push(ms);
    }

    /**
     * Calculates percentiles and other stats
     */
    getStats(metadata: { durability?: 'logical' | 'fsync_enforced' } = {}) {
        if (this.latencies.length === 0) {
            return { p50: 0, p95: 0, p99: 0, avg: 0, min: 0, max: 0, ...metadata };
        }

        const sorted = [...this.latencies].sort((a, b) => a - b);
        const getPercentile = (p: number) => {
            const idx = Math.floor((p / 100) * (sorted.length - 1));
            return sorted[idx];
        };

        const sum = this.latencies.reduce((a, b) => a + b, 0);

        const buckets = [1, 2, 5, 10, 20, 50, 100];
        const histogram = buckets.map(le => ({
            le,
            count: sorted.filter(l => l <= le).length
        }));

        return {
            count: this.latencies.length,
            p50: getPercentile(50),
            p95: getPercentile(95),
            p99: getPercentile(99),
            avg: sum / this.latencies.length,
            min: sorted[0],
            max: sorted[sorted.length - 1],
            histogram_buckets: histogram,
            ...metadata
        };
    }
}

export class MemoryMonitor {
    private samples: { rss: number, t: number }[] = [];
    private interval: NodeJS.Timeout | null = null;
    private startMemory: number = 0;
    private warmupFinishedIdx: number = 0;

    constructor(private sampleIntervalMs: number = 1000) { }

    /**
     * Starts background sampling of RSS
     */
    start(): void {
        const now = performance.now();
        this.startMemory = process.memoryUsage().rss;
        this.samples = [{ rss: this.startMemory, t: now }];
        this.warmupFinishedIdx = 0;
        this.interval = setInterval(() => {
            this.samples.push({ rss: process.memoryUsage().rss, t: performance.now() });
        }, this.sampleIntervalMs);
    }

    /**
     * Marks the end of the warmup period. 
     */
    markWarmupFinished(): void {
        this.warmupFinishedIdx = this.samples.length - 1;
    }

    /**
     * Stops sampling and returns statistics
     */
    stop() {
        if (this.interval) {
            clearInterval(this.interval);
            this.interval = null;
        }

        const now = performance.now();
        const endMemory = process.memoryUsage().rss;
        this.samples.push({ rss: endMemory, t: now });

        const peak = Math.max(...this.samples.map(s => s.rss));

        // Calculate slope based on post-warmup window
        const relevantSamples = this.samples.slice(this.warmupFinishedIdx);
        const durationMin = (relevantSamples[relevantSamples.length - 1].t - relevantSamples[0].t) / 60000;
        const memoryDiffMb = (endMemory - relevantSamples[0].rss) / 1024 / 1024;

        const slopeMbPerMin = durationMin > 0.01 // Minimum 600ms for slope calculation
            ? memoryDiffMb / durationMin
            : 0;

        return {
            rss_start_mb: Math.round(this.startMemory / 1024 / 1024 * 100) / 100,
            rss_peak_mb: Math.round(peak / 1024 / 1024 * 100) / 100,
            rss_end_mb: Math.round(endMemory / 1024 / 1024 * 100) / 100,
            rss_slope_mb_per_min: Math.round(slopeMbPerMin * 100) / 100,
            duration_ms: Math.round(relevantSamples[relevantSamples.length - 1].t - relevantSamples[0].t),
            samples_count: this.samples.length,
            warmup_samples_count: this.warmupFinishedIdx
        };
    }
}

export class TransactionLogger {
    private stream: any;

    constructor(private filePath: string) { }

    async start() {
        await fs.mkdir(path.dirname(this.filePath), { recursive: true });
        this.stream = createWriteStream(this.filePath);
    }

    log(tx: any) {
        // Simple JSONL format
        // We need to serialize bigints and Uint8Arrays
        const entry = JSON.stringify(tx, (key, value) => {
            if (typeof value === 'bigint') return value.toString();
            if (value && (value instanceof Uint8Array || Buffer.isBuffer(value) || (value.type === 'Buffer' && Array.isArray(value.data)))) {
                return bytesToHex(value instanceof Uint8Array || Buffer.isBuffer(value) ? value : Uint8Array.from(value.data));
            }
            return value;
        });
        this.stream.write(entry + '\n');
    }

    async stop() {
        return new Promise<void>((resolve) => {
            this.stream.end(() => resolve());
        });
    }
}

export class ReplayVerifier {
    static async verify(
        logPath: string,
        processor: any,
        expectedRoot: string,
        outDir: string
    ) {
        const replayDir = path.join(outDir, 'replay');
        await fs.rm(replayDir, { recursive: true, force: true });
        await fs.mkdir(replayDir, { recursive: true });

        const stateDb = new LevelDBStore(replayDir);
        let stateStore = await PersistentStateStore.load(stateDb);

        const fileStream = createReadStream(logPath);
        const rl = createInterface({
            input: fileStream,
            crlfDelay: Infinity
        });

        let count = 0;
        const start = Date.now();

        for await (const line of rl) {
            const tx = JSON.parse(line);

            // Re-normalize types (hex -> bytes, string -> bigint)
            let args: any[];
            try {
                const hex = tx.tx.args.startsWith('0x') ? tx.tx.args.slice(2) : tx.tx.args;
                const payload = Uint8Array.from(Buffer.from(hex, 'hex'));
                args = TransactionStateProcessor.decodeArguments(payload);
            } catch (err: any) {
                const hex = tx.tx.args;
                const debugInfo = `[ReplayVerifier] Failed to decode args for tx ${tx.sequenceNumber}\n` +
                    `[ReplayVerifier] Payload Hex: ${hex}\n` +
                    `[ReplayVerifier] Error: ${err.message}\n` +
                    `[ReplayVerifier] Stack: ${err.stack}\n`;
                await fs.writeFile(path.join(outDir, 'replay-debug.log'), debugInfo);
                throw err;
            }

            const result = await processor.execute(
                tx.tx.function,
                args,
                tx.tx.sender,
                { height: BigInt(tx.sequenceNumber), timestamp: BigInt(tx.sequencedAt) }
            );

            if (result.success) {
                const debugLog = `[ReplayVerifier] Tx ${tx.sequenceNumber} success, changes: ${result.binaryChanges.length}\n`;
                await fs.appendFile(path.join(outDir, 'replay-debug.log'), debugLog);
                stateStore = await stateStore.apply(result.binaryChanges, BigInt(tx.sequenceNumber)) as PersistentStateStore;
            } else {
                const debugInfo = `[ReplayVerifier] Execution FAILED for tx ${tx.sequenceNumber}: ${result.error?.message}\n`;
                await fs.appendFile(path.join(outDir, 'replay-debug.log'), debugInfo);
            }
            count++;
        }

        const actualRoot = bytesToHex(stateStore.root);
        await fs.appendFile(path.join(outDir, 'replay-debug.log'), `[ReplayVerifier] Replay finished. Final Root: ${actualRoot}\n`);
        const match = actualRoot === expectedRoot;

        await stateDb.close();

        return {
            tx_count: count,
            replay_time_ms: Date.now() - start,
            expected_root: expectedRoot,
            actual_root: actualRoot,
            match
        };
    }
}
