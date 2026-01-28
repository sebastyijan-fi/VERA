import {
    type Bytes32,
    bytesEqual,
    bytesToHex,
    toBytes64,
    zeroBytes32,
    verifyTransactionSignature,
    concat,
    HashDomains,
    verifyBatch,
    sha256WithDomain,
    SignatureWorkerPool,
    uint64ToBytes,
    bytesToUint64,
} from '@vera/core';
import type {
    RawTransaction,
    OrderedTransaction,
    SubmitResult,
    SequenceNumber,
    SequencerStatus,
    TransactionCallback,
    FinalityCallback,
    Subscription,
} from './types.js';
import type { Sequencer } from './sequencer.js';
import type { Store } from '@vera/store';
import { TransactionPool, type PoolConfig } from './pool.js';
import { FinalityTracker, type FinalityConfig } from './finality.js';
import { TransactionLog, ExecutionStatus, type LogEntry } from './log.js';
import type { Clock } from './clock.js';
import { SystemClock } from './clock.js';

// ============================================================================
// SingleSequencer Configuration
// ============================================================================

export interface SingleSequencerConfig {
    /** Sequencer identifier */
    id?: string | undefined;
    /** Chain identifier */
    chainId?: Bytes32 | undefined;
    /** Pool configuration */
    pool?: PoolConfig | undefined;
    /** Finality configuration */
    finality?: FinalityConfig | undefined;
    /** Persistence backend */
    store?: Store | undefined;
    /** Durability mode */
    durability?: 'strict' | 'logical' | undefined;
    /** Time source */
    clock?: Clock | undefined;
    /** Parallel signature verification pool */
    signaturePool?: SignatureWorkerPool | undefined;
    /** Batching interval in ms (default: 2) */
    batchTimeout?: number | undefined;
    /** Maximum transactions per batch (default: 1000) */
    maxBatchSize?: number | undefined;
    /** Maximum transactions in submission queue (default: 5000) */
    maxSubmissionQueueSize?: number | undefined;

    // Backpressure Configuration
    /** Maximum mempool size before rejecting transactions (default: 10000) */
    maxMempoolSize?: number | undefined;
    /** Maximum execution backlog before rejecting transactions (default: 5000) */
    maxExecutionBacklog?: number | undefined;
    /** Maximum transaction size in bytes (default: 1MB) */
    maxTxSize?: number | undefined;
}

// ============================================================================
// SingleSequencer
// ============================================================================

/**
 * Single-node sequencer for development and testing
 */
export class SingleSequencer implements Sequencer {
    private readonly id: string;
    private readonly chainId: Bytes32;
    private readonly pool: TransactionPool;
    private readonly finality: FinalityTracker;
    private readonly store?: Store;
    private readonly clock: Clock;
    private readonly durability: 'strict' | 'logical';
    private readonly signaturePool: SignatureWorkerPool | undefined;
    private readonly sequenced: Map<string, OrderedTransaction> = new Map();
    private readonly txCallbacks: Set<TransactionCallback> = new Set();
    private readonly nonces: Map<string, bigint> = new Map();
    private readonly log?: TransactionLog;
    private nextSequence: SequenceNumber = 1n;
    private isActive = false;

    // Phase 2: Performance Caches
    private readonly signatureCache: Map<string, boolean> = new Map(); // txId hex -> isValid
    private readonly metadataCache: Map<string, RawTransaction> = new Map(); // txId hex -> cached metadata

    // Phase 2: Batching
    private readonly submissionQueue: { tx: RawTransaction, resolve: (r: SubmitResult) => void, reject: (err: any) => void }[] = [];
    private readonly batchTimeout: number;
    private readonly maxBatchSize: number;
    private readonly maxSubmissionQueueSize: number;
    private flushTimer: NodeJS.Timeout | null = null;

    // Backpressure Config (Configurable)
    private readonly maxMempoolSize: number;
    private readonly maxExecutionBacklog: number;
    private readonly maxTxSize: number;

    constructor(config: SingleSequencerConfig = {}) {
        this.id = config.id ?? 'single-sequencer';
        this.chainId = config.chainId ?? zeroBytes32();
        this.pool = new TransactionPool(config.pool);
        this.finality = new FinalityTracker(config.finality);
        this.clock = config.clock ?? new SystemClock();
        this.durability = config.durability ?? 'logical';
        this.signaturePool = config.signaturePool;
        this.batchTimeout = config.batchTimeout ?? 2;
        this.maxBatchSize = config.maxBatchSize ?? 1000;
        this.maxSubmissionQueueSize = config.maxSubmissionQueueSize ?? 5000;

        // Backpressure configuration
        this.maxMempoolSize = config.maxMempoolSize ?? 10000;
        this.maxExecutionBacklog = config.maxExecutionBacklog ?? 5000;
        this.maxTxSize = config.maxTxSize ?? 1 * 1024 * 1024; // 1MB default

        if (config.store) {
            this.store = config.store;
            this.log = new TransactionLog(config.store);
        }
    }

    /**
     * Records an execution receipt for a transaction
     */
    async recordReceipt(seq: SequenceNumber, success: boolean): Promise<void> {
        if (this.store && this.log) {
            const batch = this.store.batch();
            this.log.recordReceipt(
                batch,
                seq,
                success ? ExecutionStatus.EXEC_OK : ExecutionStatus.EXEC_FAIL
            );
            await batch.write({ sync: this.durability === 'strict' });
        }
    }

    /**
     * Replays the log for a given sequence range
     */
    async replay(
        start: SequenceNumber,
        end: SequenceNumber,
        callback: (entry: LogEntry, receipt: ExecutionStatus) => Promise<void>
    ): Promise<void> {
        if (!this.log) return;

        for (let seq = start; seq <= end; seq++) {
            const entry = await this.log.getEntry(seq);
            if (!entry) throw new Error(`Log entry missing for sequence #${seq}`);

            const receipt = await this.log.getReceipt(seq);
            if (receipt === undefined) throw new Error(`Execution receipt missing for sequence #${seq}`);

            await callback(entry, receipt);
        }
    }

    async getReceiptByTxId(txId: Bytes32): Promise<{ sequenceNumber: SequenceNumber; status: ExecutionStatus } | undefined> {
        if (!this.log) return undefined;
        const seq = await this.log.getSeqByTxId(txId);
        if (seq === undefined) return undefined;
        const status = await this.log.getReceipt(seq);
        if (status === undefined) return undefined;
        return { sequenceNumber: seq, status };
    }

    async submit(tx: RawTransaction): Promise<SubmitResult> {
        if (this.submissionQueue.length >= this.maxSubmissionQueueSize) {
            return {
                accepted: false,
                hash: tx.hash,
                error: `Backpressure: Submission queue full (${this.submissionQueue.length})`
            };
        }

        return new Promise<SubmitResult>((resolve, reject) => {
            this.submissionQueue.push({ tx, resolve, reject });

            if (this.submissionQueue.length >= this.maxBatchSize) {
                this.triggerFlush(true);
            } else if (!this.flushTimer) {
                this.triggerFlush(false);
            }
        });
    }

    private triggerFlush(immediate: boolean) {
        if (this.flushTimer) {
            clearTimeout(this.flushTimer);
            this.flushTimer = null;
        }

        if (immediate) {
            void this.flushQueue();
        } else {
            this.flushTimer = setTimeout(() => {
                this.flushTimer = null;
                void this.flushQueue();
            }, this.batchTimeout);
        }
    }

    private async flushQueue() {
        if (this.submissionQueue.length === 0) return;

        const batch = this.submissionQueue.splice(0, this.maxBatchSize);
        const txs = batch.map(b => b.tx);

        try {
            const results = await this.submitMany(txs);
            for (let i = 0; i < batch.length; i++) {
                const item = batch[i];
                const res = results[i];
                if (item && res) {
                    item.resolve(res);
                } else if (item) {
                    item.reject(new Error('No result for transaction in batch'));
                }
            }
        } catch (err) {
            for (const item of batch) {
                item.reject(err);
            }
        }
    }

    private processing: Promise<void> = Promise.resolve();

    async submitMany(txs: RawTransaction[]): Promise<SubmitResult[]> {
        // Serialize submissions to prevent race conditions with nonces and pool
        const result = await new Promise<SubmitResult[]>((resolve, reject) => {
            this.processing = this.processing.then(async () => {
                try {
                    const res = await this._submitMany(txs);
                    resolve(res);
                } catch (err) {
                    reject(err);
                }
            });
        });
        return result;
    }

    private async _submitMany(txs: RawTransaction[]): Promise<SubmitResult[]> {
        if (!this.isActive) {
            return txs.map(tx => ({
                accepted: false,
                hash: tx.hash,
                error: 'Sequencer not active',
            }));
        }

        const results: SubmitResult[] = new Array(txs.length);
        const dirtyNonces: Set<string> = new Set();
        const toVerify: { tx: RawTransaction; index: number }[] = [];
        const toSequence: { tx: RawTransaction; index: number }[] = [];

        // Backpressure Check
        if (this.pool.size + txs.length > this.maxMempoolSize) {
            return txs.map(tx => ({ accepted: false, hash: tx.hash, error: 'Backpressure: Mempool full' }));
        }

        const currentBacklog = Number(this.nextSequence - 1n) - this.finality.finalizedCount;
        if (currentBacklog > this.maxExecutionBacklog) {
            return txs.map(tx => ({ accepted: false, hash: tx.hash, error: `Backpressure: Execution backlog too high (${currentBacklog})` }));
        }

        // TIER 1: Cheap Fixed Checks & Cache Hits
        const batchNonces = new Map<string, bigint>();

        const { toVerify: toVerifyNew } = this._performInitialChecks(txs, results, batchNonces, dirtyNonces, toSequence);
        toVerify.push(...toVerifyNew);

        // TIER 2: Batch Signature Verification & Delayed Checks
        if (toVerify.length > 0) {
            await this._verifySignatures(toVerify, results, batchNonces, dirtyNonces, toSequence);
        }

        // POOL & SEQUENCE
        if (toSequence.length > 0) {
            // Re-sort to maintain original arrival order
            const sortedSequence = toSequence.sort((a, b) => a.index - b.index);

            for (const s of sortedSequence) {
                const hashHex = bytesToHex(s.tx.hash, false);
                this.metadataCache.set(hashHex, s.tx); // Cache validated metadata

                if (this.pool.add(s.tx)) {
                    results[s.index] = { accepted: true, hash: s.tx.hash };
                } else {
                    results[s.index] = { accepted: false, hash: s.tx.hash, error: 'Pool full' };
                }
            }

            // Trigger sequencing for accepted transactions
            const acceptedTxs = sortedSequence.filter(s => results[s.index]?.accepted).map(s => s.tx);
            if (acceptedTxs.length > 0) {
                const orderedList = await this.sequenceBatch(acceptedTxs, dirtyNonces);
                // Update sequence numbers in results
                let orderedIdx = 0;
                for (const s of sortedSequence) {
                    if (results[s.index]?.accepted) {
                        const ordered = orderedList[orderedIdx++];
                        if (ordered) {
                            results[s.index] = {
                                accepted: true,
                                hash: ordered.tx.hash,
                                sequenceNumber: ordered.sequenceNumber,
                            };
                        }
                    }
                }
            }
        }

        return results;
    }

    async getNext(): Promise<OrderedTransaction | undefined> {
        const pending = this.finality.getPending();
        if (pending.length === 0) return undefined;
        return pending.sort((a, b) => Number(a.sequenceNumber - b.sequenceNumber))[0];
    }

    async getBySequence(seq: SequenceNumber): Promise<OrderedTransaction | undefined> {
        return this.sequenced.get(seq.toString());
    }

    async getRange(start: SequenceNumber, end: SequenceNumber): Promise<OrderedTransaction[]> {
        const result: OrderedTransaction[] = [];
        for (let seq = start; seq <= end; seq++) {
            const tx = this.sequenced.get(seq.toString());
            if (tx) {
                result.push(tx);
            }
        }
        return result;
    }

    async finalize(seq: SequenceNumber): Promise<void> {
        this.finality.finalize(seq);
    }

    async getStatus(): Promise<SequencerStatus> {
        const finalized = this.finality.finalizedCount;

        return {
            sequencer: {
                id: this.id,
                address: zeroBytes32() as any,
                isActive: this.isActive,
                lastSequence: this.nextSequence - 1n,
                epoch: 1n,
            },
            pendingCount: this.pool.size,
            sequencedCount: this.sequenced.size - finalized,
            finalizedCount: finalized,
        };
    }

    onTransaction(callback: TransactionCallback): Subscription {
        this.txCallbacks.add(callback);
        return {
            unsubscribe: () => this.txCallbacks.delete(callback),
        };
    }

    onFinality(callback: FinalityCallback): Subscription {
        return this.finality.onFinality(callback);
    }

    async start(): Promise<void> {
        if (this.isActive) return;

        if (this.store) {
            await this.loadState(this.store);
            if (this.log) {
                await this.log.open();
            }
        }

        this.isActive = true;
        this.pool.startEviction();
        this.finality.startAutoFinalize();
    }

    async stop(): Promise<void> {
        this.isActive = false;
        this.pool.stopEviction();
        this.finality.stopAutoFinalize();
    }

    clear(): void {
        this.pool.clear();
        this.finality.clear();
        this.sequenced.clear();
        this.nonces.clear();
        this.nextSequence = 1n;
    }

    // ========================================================================
    // Backpressure Monitoring
    // ========================================================================

    /**
     * Get current queue depth (pending transactions in mempool)
     */
    getQueueDepth(): number {
        return this.pool.size;
    }

    /**
     * Get current execution backlog (sequenced but not finalized)
     */
    getExecutionBacklog(): number {
        return Number(this.nextSequence - 1n) - this.finality.finalizedCount;
    }

    /**
     * Get comprehensive backpressure status
     */
    getBackpressureStatus(): {
        queueDepth: number;
        queueLimit: number;
        queueUtilization: number;
        executionBacklog: number;
        backlogLimit: number;
        backlogUtilization: number;
        isUnderPressure: boolean;
    } {
        const queueDepth = this.getQueueDepth();
        const executionBacklog = this.getExecutionBacklog();
        const queueUtilization = queueDepth / this.maxMempoolSize;
        const backlogUtilization = executionBacklog / this.maxExecutionBacklog;

        return {
            queueDepth,
            queueLimit: this.maxMempoolSize,
            queueUtilization,
            executionBacklog,
            backlogLimit: this.maxExecutionBacklog,
            backlogUtilization,
            isUnderPressure: queueUtilization > 0.8 || backlogUtilization > 0.8
        };
    }

    private async sequenceBatch(txs: RawTransaction[], dirtyNonces: Set<string>): Promise<OrderedTransaction[]> {
        const orderedList: OrderedTransaction[] = [];

        for (const tx of txs) {
            this.pool.remove(tx.hash);

            const ordered: OrderedTransaction = {
                tx,
                sequenceNumber: this.nextSequence++,
                sequencedAt: BigInt(this.clock.now()),
                finality: 'sequenced',
            };

            const hashKey = this.hashToKey(tx.hash);
            this.sequenced.set(hashKey, ordered);
            this.sequenced.set(ordered.sequenceNumber.toString(), ordered);

            this.finality.track(ordered);
            this.emitTransaction(ordered);
            orderedList.push(ordered);
        }

        if (this.store) {
            // Atomic update of log and sequencer metadata
            const batch = this.store.batch();

            // 1. Update sequence number
            batch.put('sequencer:next_sequence', uint64ToBytes(this.nextSequence));

            // 2. Update nonces
            for (const address of dirtyNonces) {
                const nonce = this.nonces.get(address);
                if (nonce !== undefined) {
                    batch.put(`sequencer:nonce:${address}`, uint64ToBytes(nonce));
                }
            }

            // 3. Append to log
            if (this.log) {
                for (const ordered of orderedList) {
                    this.log.append(batch, {
                        seq: ordered.sequenceNumber,
                        txId: ordered.tx.hash,
                        sender: ordered.tx.sender,
                        nonce: ordered.tx.nonce,
                        chainId: ordered.tx.chainId,
                        canonicalTxBytes: ordered.tx.canonicalTxBytes,
                    });
                }
            }

            // 4. Commit batch
            try {
                await batch.write({ sync: this.durability === 'strict' });
            } catch (err) {
                console.error('Failed to commit ordering batch:', err);
                throw err; // Propagate error so submission fails
            }
        }

        return orderedList;
    }

    private emitTransaction(tx: OrderedTransaction): void {
        for (const callback of this.txCallbacks) {
            try {
                callback(tx);
            } catch {
                // Ignore callback errors
            }
        }
    }

    private async loadState(store: Store): Promise<void> {
        try {
            const seqBytes = await store.get('sequencer:next_sequence');
            if (seqBytes) {
                this.nextSequence = bytesToUint64(seqBytes);
            }

            const iterator = store.iterator({
                gte: 'sequencer:nonce:',
                lte: 'sequencer:nonce:\uffff'
            });

            try {
                while (true) {
                    const entry = await iterator.next();
                    if (!entry) break;

                    const keyStr = typeof entry[0] === 'string' ? entry[0] : Buffer.from(entry[0]).toString('utf-8');
                    const addressHex = keyStr.replace('sequencer:nonce:', '');
                    const nonce = bytesToUint64(entry[1]);
                    this.nonces.set(addressHex, nonce);
                }
            } finally {
                await iterator.end();
            }

        } catch (error) {
            // Ignore missing state
        }
    }

    private hashToKey(hash: Uint8Array): string {
        return bytesToHex(hash, false);
    }

    private _performInitialChecks(
        txs: RawTransaction[],
        results: SubmitResult[],
        batchNonces: Map<string, bigint>,
        dirtyNonces: Set<string>,
        toSequence: { tx: RawTransaction; index: number }[]
    ): { toVerify: { tx: RawTransaction; index: number }[] } {
        const toVerify: { tx: RawTransaction; index: number }[] = [];

        for (let i = 0; i < txs.length; i++) {
            const tx = txs[i]!;
            const hashHex = bytesToHex(tx.hash, false);
            const senderKey = bytesToHex(tx.sender, false);

            // 0. Size Check
            if (tx.canonicalTxBytes.length > this.maxTxSize) {
                results[i] = { accepted: false, hash: tx.hash, error: `Transaction too large: ${tx.canonicalTxBytes.length} > ${this.maxTxSize}` };
                continue;
            }

            // 1. Integrity Check: Hash must match canonical bytes
            const expectedHash = sha256WithDomain(HashDomains.TRANSACTION, tx.canonicalTxBytes);
            if (!bytesEqual(tx.hash, expectedHash)) {
                results[i] = { accepted: false, hash: tx.hash, error: 'Invalid transaction hash' };
                continue;
            }

            // 2. Chain ID Match
            if (!bytesEqual(tx.chainId, this.chainId)) {
                results[i] = { accepted: false, hash: tx.hash, error: 'Invalid chain ID' };
                continue;
            }

            // 2. Signature Cache Check (Precedence: Proof of identity before state check)
            if (this.signatureCache.get(hashHex) === true) {
                // Signature is known good. Safe to check nonces.
                const currentNonce = batchNonces.get(senderKey) ?? (this.nonces.get(senderKey) ?? -1n);

                if (tx.nonce <= currentNonce) {
                    results[i] = { accepted: false, hash: tx.hash, error: 'Nonce too low' };
                    continue;
                }

                if (tx.nonce > currentNonce + 1n) {
                    results[i] = { accepted: false, hash: tx.hash, error: `Nonce too high (gap): ${tx.nonce} > ${currentNonce + 1n}` };
                    continue;
                }

                if (this.sequenced.has(hashHex) || this.pool.has(tx.hash)) {
                    results[i] = { accepted: false, hash: tx.hash, error: 'Duplicate transaction' };
                    continue;
                }

                // Accept
                batchNonces.set(senderKey, tx.nonce);
                this.nonces.set(senderKey, tx.nonce);
                dirtyNonces.add(senderKey);
                toSequence.push({ tx, index: i });
                continue;
            }

            // Signature miss. Delay nonce check until TIER 2.
            toVerify.push({ tx, index: i });
        }
        return { toVerify };
    }

    private async _verifySignatures(
        toVerify: { tx: RawTransaction; index: number }[],
        results: SubmitResult[],
        batchNonces: Map<string, bigint>,
        dirtyNonces: Set<string>,
        toSequence: { tx: RawTransaction; index: number }[]
    ): Promise<void> {
        const batchItems = toVerify.map(v => ({
            signature: toBytes64(v.tx.signature),
            message: concat(HashDomains.SIGNATURE, v.tx.hash),
            publicKey: v.tx.sender
        }));

        const batchOk = await verifyBatch(batchItems, this.signaturePool);

        if (batchOk) {
            // All signatures are valid. Now perform nonce/dedupe checks.
            for (const v of toVerify) {
                const hashHex = bytesToHex(v.tx.hash, false);
                const senderKey = bytesToHex(v.tx.sender, false);
                const currentNonce = batchNonces.get(senderKey) ?? (this.nonces.get(senderKey) ?? -1n);

                if (v.tx.nonce <= currentNonce) {
                    results[v.index] = { accepted: false, hash: v.tx.hash, error: 'Nonce too low' };
                    continue;
                }

                if (v.tx.nonce > currentNonce + 1n) {
                    results[v.index] = { accepted: false, hash: v.tx.hash, error: `Nonce too high (gap): ${v.tx.nonce} > ${currentNonce + 1n}` };
                    continue;
                }

                if (this.sequenced.has(hashHex) || this.pool.has(v.tx.hash)) {
                    results[v.index] = { accepted: false, hash: v.tx.hash, error: 'Duplicate transaction' };
                    continue;
                }

                // Success
                this.signatureCache.set(hashHex, true);
                this.nonces.set(senderKey, v.tx.nonce);
                batchNonces.set(senderKey, v.tx.nonce);
                dirtyNonces.add(senderKey);
                toSequence.push(v);
            }
        } else {
            // Fallback: Individual Verification (Isolate bad actors and maintain precedence)
            for (const v of toVerify) {
                const signature = {
                    publicKey: v.tx.sender,
                    signature: toBytes64(v.tx.signature),
                    signedFields: ['version', 'chainId', 'type', 'nonce', 'maxSequence', 'payload'],
                };

                if (!verifyTransactionSignature(signature, v.tx.hash)) {
                    results[v.index] = { accepted: false, hash: v.tx.hash, error: 'Invalid signature' };
                    continue;
                }

                // Signature is GOOD. Now check nonces.
                const hashHex = bytesToHex(v.tx.hash, false);
                const senderKey = bytesToHex(v.tx.sender, false);
                const currentNonce = batchNonces.get(senderKey) ?? (this.nonces.get(senderKey) ?? -1n);

                if (v.tx.nonce <= currentNonce) {
                    results[v.index] = { accepted: false, hash: v.tx.hash, error: 'Nonce too low' };
                    continue;
                }

                if (v.tx.nonce > currentNonce + 1n) {
                    results[v.index] = { accepted: false, hash: v.tx.hash, error: `Nonce too high (gap): ${v.tx.nonce} > ${currentNonce + 1n}` };
                    continue;
                }

                if (this.sequenced.has(hashHex) || this.pool.has(v.tx.hash)) {
                    results[v.index] = { accepted: false, hash: v.tx.hash, error: 'Duplicate transaction' };
                    continue;
                }

                // Success
                this.signatureCache.set(hashHex, true);
                this.nonces.set(senderKey, v.tx.nonce);
                batchNonces.set(senderKey, v.tx.nonce);
                dirtyNonces.add(senderKey);
                toSequence.push(v);
            }
        }
    }
}

export function createSingleSequencer(config?: SingleSequencerConfig): SingleSequencer {
    return new SingleSequencer(config);
}
