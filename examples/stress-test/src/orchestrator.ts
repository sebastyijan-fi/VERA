import { NodeSimulator } from './node_simulator.js';
import { AttackEngine } from './attacks.js';
import { MetricsAggregator } from './metrics.js';
import { SingleSequencer, type OrderedTransaction } from '@vera/ordering';
import { LevelDBStore } from '@vera/store';
import { zeroBytes32, bytesToHex } from '@vera/core';
import { AsyncOptimisticExecutor } from '@vera/engine';
import type { IRProgram } from '@vera/dsl';
import fs from 'node:fs/promises';
import path from 'node:path';

// Minimal IR program for stress test - just returns immediately
const STRESS_TEST_IR: IRProgram = {
    id: '0x' + '0'.repeat(64),
    name: 'StressTest',
    entities: [],
    events: [],
    globals: [],
    functions: [{
        name: 'test',
        isPublic: true,
        params: [],
        locals: [],
        instructions: [{ opcode: 'RET' as const }]
    }]
};

// Batch size for parallel execution - larger batches amortize overhead
const BATCH_SIZE = 200;

export enum TestPhase {
    Warmup = 'WARMUP',
    LoadRamp = 'LOAD_RAMP',
    Chaos = 'CHAOS',
    Burst = 'BURST',
    Recovery = 'RECOVERY',
    Finished = 'FINISHED'
}

export class Orchestrator {
    private nodes: NodeSimulator[] = [];
    private sequencer: SingleSequencer | null = null;
    private executor: AsyncOptimisticExecutor;
    private attackEngine = new AttackEngine();
    private phase: TestPhase = TestPhase.Warmup;
    private txRate: number = 10; // tx per second
    private intensity: number = 1;
    private startTime: number = Date.now();
    private nonce: bigint = 1n;
    private isRunning: boolean = false;
    private executedCount: number = 0;

    // Batch accumulator for parallel execution
    private pendingBatch: OrderedTransaction[] = [];
    private batchLock: boolean = false;
    private blockHeight: bigint = 1n;

    constructor(
        private readonly config: {
            nodeCount: number,
            duration: number,
            intensity: number,
            dataDir: string
        },
        private readonly metrics: MetricsAggregator
    ) {
        // Use AsyncOptimisticExecutor (no worker thread overhead)
        this.executor = new AsyncOptimisticExecutor(STRESS_TEST_IR);
    }

    async init() {
        // Clean up any stale data from previous runs
        await fs.rm(this.config.dataDir, { recursive: true, force: true });
        await fs.mkdir(this.config.dataDir, { recursive: true });

        // 1. Init Sequencer with auto-finalization
        const seqDb = new LevelDBStore(path.join(this.config.dataDir, 'sequencer.db'));
        this.sequencer = new SingleSequencer({
            chainId: zeroBytes32(),
            store: seqDb,
            finality: { confirmationDepth: 0, autoFinalizeMs: 5 }, // Faster finalization
            durability: 'logical'
        });

        // Wire the FULL execution pipeline via onFinality
        // Accumulate transactions into batches for parallel execution
        this.sequencer.onFinality((tx) => {
            this.pendingBatch.push(tx);

            // Execute batch when it reaches threshold
            if (this.pendingBatch.length >= BATCH_SIZE && !this.batchLock) {
                this.executeBatch();
            }
        });

        // Log progress periodically
        this.sequencer.onTransaction((tx) => {
            if (tx.sequenceNumber % 2000n === 0n) {
                console.log(`[Pipeline] Sequenced: ${tx.sequenceNumber}, Executed: ${this.executedCount}, Pending: ${this.pendingBatch.length}`);
            }
        });

        await this.sequencer.start();

        // Start batch execution loop (drain remaining txs periodically)
        this.startBatchLoop();

        // 2. Init Nodes
        for (let i = 0; i < this.config.nodeCount; i++) {
            const nodeId = `Node-${String.fromCharCode(65 + i)}`;
            const node = new NodeSimulator(
                nodeId,
                6000 + i,
                path.join(this.config.dataDir, nodeId),
                this.metrics
            );
            this.nodes.push(node);
        }

        // Start nodes
        for (const node of this.nodes) {
            await node.start();
        }

        // Connect nodes in a star topology - all to first node
        const firstNode = this.nodes[0];
        if (firstNode) {
            for (let i = 1; i < this.nodes.length; i++) {
                const node = this.nodes[i];
                if (node) await node.connectTo(firstNode);
            }
        }
    }

    getExecutedCount() { return this.executedCount; }

    /**
     * Start a loop that drains pending transactions even if batch threshold isn't reached
     */
    private startBatchLoop() {
        const drainInterval = setInterval(() => {
            if (!this.isRunning && this.pendingBatch.length === 0) {
                clearInterval(drainInterval);
                return;
            }
            // Execute any pending transactions even if below threshold
            if (this.pendingBatch.length > 0 && !this.batchLock) {
                this.executeBatch();
            }
        }, 10); // Drain every 10ms for higher throughput
    }

    /**
     * Execute accumulated batch using ParallelExecutor
     */
    private executeBatch() {
        if (this.batchLock || this.pendingBatch.length === 0) return;

        this.batchLock = true;
        const batch = this.pendingBatch.splice(0, BATCH_SIZE);
        const currentBlock = this.blockHeight++;

        // Convert OrderedTransactions to execution format
        const txs = batch.map(otx => ({
            functionName: otx.tx.function,
            args: [] as import('@vera/engine').Value[],  // Stress test txs have no args
            caller: bytesToHex(otx.tx.sender)
        }));

        // Execute batch in parallel
        this.executor.executeBlock(txs, {
            height: currentBlock,
            timestamp: BigInt(Date.now()),
            parentHash: '0x' + '0'.repeat(64) // Stress test doesn't care about real hashes
        }).then(({ results, stats }) => {
            const successCount = results.filter(r => r.success).length;
            this.executedCount += successCount;

            // Update node heights
            for (const node of this.nodes) {
                node.updateHeight(Number(currentBlock));
            }

            // Log batch stats periodically
            if (currentBlock % 20n === 0n) {
                console.log(`[Batch #${currentBlock}] Executed: ${successCount}/${batch.length}, Time: ${stats.optimisticPhaseMs.toFixed(1)}ms, Conflicts: ${stats.conflictsDetected}`);
            }
        }).catch(err => {
            console.error(`Batch execution failed:`, err);
        }).finally(() => {
            this.batchLock = false;
        });
    }

    async start() {
        this.isRunning = true;
        this.startTime = Date.now();
        this.runLoop();
        this.phaseLoop();
        this.chaosLoop();
    }

    private async chaosLoop() {
        while (this.isRunning) {
            if (this.phase === TestPhase.Chaos || this.phase === TestPhase.Burst) {
                // Randomly choose an attack
                const attacks = [
                    'byzantine_flood',
                    'signature_forgery',
                    'replay_attack',
                    'nonce_manipulation',
                    'malformed_payload'
                ];
                const attackIndex = Math.floor(Math.random() * attacks.length);
                const type = attacks[attackIndex];

                if (type) await this.injectAttack(type);

                // Adaptive intensity
                const wait = Math.max(1000, 5000 / this.intensity);
                await new Promise(r => setTimeout(r, wait));
            } else {
                await new Promise(r => setTimeout(r, 1000));
            }
        }
    }

    private async injectAttack(type: string) {
        let tx;
        switch (type) {
            case 'signature_forgery': tx = this.attackEngine.createForgedSignatureTx(this.nonce++); break;
            case 'byzantine_flood': tx = this.attackEngine.createInvalidHashTx(this.nonce++); break;
            case 'nonce_manipulation': tx = this.attackEngine.createHighNonceTx(this.nonce++); break;
            case 'malformed_payload': tx = this.attackEngine.createMalformedPayloadTx(this.nonce++); break;
            default: tx = this.attackEngine.createValidTx(this.nonce++);
        }

        if (this.sequencer) {
            const res = await this.sequencer.submitMany([tx]);
            const success = res[0].accepted;
            this.metrics.recordAttack(type, success);
            if (success) {
                this.metrics.addIssue(`Attack ${type} succeeded! (VERA BUG)`, 'error');
            }
        }
    }

    private async phaseLoop() {
        const durationMs = this.config.duration * 1000;

        // Phase 1: Warmup (30s or 10% of duration)
        this.phase = TestPhase.Warmup;
        this.txRate = 50;
        await new Promise(r => setTimeout(r, Math.min(30000, durationMs * 0.1)));

        // Phase 2: Load Ramp (60s or 20% of duration)
        this.phase = TestPhase.LoadRamp;
        const rampSteps = 10;
        const rampDuration = Math.min(60000, durationMs * 0.2);
        for (let i = 0; i < rampSteps; i++) {
            this.txRate += 200;
            await new Promise(r => setTimeout(r, rampDuration / rampSteps));
        }

        // Phase 3: Chaos (until near end)
        this.phase = TestPhase.Chaos;
        this.txRate = 1000;
        // Chaos logic will be in chaosLoop

        if (this.config.duration > 0) {
            const remaining = durationMs - (Date.now() - this.startTime);
            if (remaining > 10000) {
                await new Promise(r => setTimeout(r, remaining - 10000));
            }
        } else {
            // Wait manually if infinite
            while (this.isRunning) await new Promise(r => setTimeout(r, 1000));
        }

        // Phase 5: Recovery
        this.phase = TestPhase.Recovery;
        await this.performRecoveryTest();

        this.phase = TestPhase.Finished;
        this.isRunning = false;
    }

    private async runLoop() {
        while (this.isRunning) {
            const start = Date.now();
            const count = Math.ceil(this.txRate / 10); // 100ms batches

            const txs = [];
            for (let i = 0; i < count; i++) {
                txs.push(this.attackEngine.createValidTx(this.nonce++));
            }

            if (this.sequencer) {
                const subStart = Date.now();
                const results = await this.sequencer.submitMany(txs);
                this.metrics.recordLatency(Date.now() - subStart);

                const accepted = results.filter(r => r.accepted).length;
                if (accepted < txs.length && txs.length > 0) {
                    const firstError = results.find(r => !r.accepted)?.error;
                    if (firstError) {
                        this.metrics.addIssue(`Sequencer rejected valid tx: ${firstError}`, 'warn');
                    }
                }
                this.metrics.recordThroughput(accepted);
            }

            const elapsed = Date.now() - start;
            const sleep = Math.max(0, 100 - elapsed);
            await new Promise(r => setTimeout(r, sleep));
        }
    }

    private async performRecoveryTest() {
        // Kill nodes
        const toKill = Math.floor(this.nodes.length / 2) + 1;
        for (let i = 0; i < toKill; i++) {
            const node = this.nodes[i];
            if (node) await node.stop(false);
        }

        await new Promise(r => setTimeout(r, 5000));

        // Recover
        for (let i = 0; i < toKill; i++) {
            const node = this.nodes[i];
            if (node) await node.start();
        }

        await new Promise(r => setTimeout(r, 5000));
    }

    getPhase() { return this.phase; }
    getTxRate() { return this.txRate; }
    isFinished() { return this.phase === TestPhase.Finished; }

    async stop() {
        this.isRunning = false;

        // Drain any remaining pending transactions
        while (this.pendingBatch.length > 0 && !this.batchLock) {
            this.executeBatch();
            await new Promise(r => setTimeout(r, 100));
        }

        if (this.sequencer) await this.sequencer.stop();
        this.executor.terminate(); // Clean up worker threads

        for (const node of this.nodes) {
            await node.stop();
        }
    }
}
