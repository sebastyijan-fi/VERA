import {
    type Bytes32,
    bytesEqual,
    bytesToHex,
    toBytes64,
    zeroBytes32,
    verifyTransactionSignature,
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
    /** Time source */
    clock?: Clock | undefined;
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
    private readonly sequenced: Map<string, OrderedTransaction> = new Map();
    private readonly txCallbacks: Set<TransactionCallback> = new Set();
    private readonly nonces: Map<string, bigint> = new Map();
    private nextSequence: SequenceNumber = 1n;
    private isActive = false;

    constructor(config: SingleSequencerConfig = {}) {
        this.id = config.id ?? 'single-sequencer';
        this.chainId = config.chainId ?? zeroBytes32();
        this.pool = new TransactionPool(config.pool);
        this.finality = new FinalityTracker(config.finality);
        this.clock = config.clock ?? new SystemClock();
        if (config.store) {
            this.store = config.store;
        }
    }

    async submit(tx: RawTransaction): Promise<SubmitResult> {
        if (!this.isActive) {
            return {
                accepted: false,
                hash: tx.hash,
                error: 'Sequencer not active',
            };
        }

        // 1. Verify Chain ID
        if (!bytesEqual(tx.chainId, this.chainId)) {
            return {
                accepted: false,
                hash: tx.hash,
                error: `Invalid chain ID: expected ${bytesToHex(this.chainId)}, got ${bytesToHex(tx.chainId)}`,
            };
        }

        // 2. Verify Signature
        const signature = {
            publicKey: tx.sender,
            signature: toBytes64(tx.signature),
            signedFields: ['version', 'chainId', 'type', 'nonce', 'maxSequence', 'payload'], // Default canonical fields
        };

        if (!verifyTransactionSignature(signature, tx.hash)) {
            return {
                accepted: false,
                hash: tx.hash,
                error: 'Invalid signature',
            };
        }

        // 3. Verify Nonce
        const senderKey = bytesToHex(tx.sender);
        const currentNonce = this.nonces.get(senderKey) ?? 0n;
        if (tx.nonce <= currentNonce) {
            return {
                accepted: false,
                hash: tx.hash,
                error: `Nonce too low: current ${currentNonce}, got ${tx.nonce}`,
            };
        }
        if (tx.nonce > currentNonce + 1n) {
            return {
                accepted: false,
                hash: tx.hash,
                error: `Nonce too high (gap): current ${currentNonce}, expected ${currentNonce + 1n}, got ${tx.nonce}`,
            };
        }

        // Check for duplicate hash
        const hashKey = this.hashToKey(tx.hash);
        if (this.sequenced.has(hashKey) || this.pool.has(tx.hash)) {
            return {
                accepted: false,
                hash: tx.hash,
                error: 'Duplicate transaction',
            };
        }

        // Add to pool
        if (!this.pool.add(tx)) {
            return {
                accepted: false,
                hash: tx.hash,
                error: 'Pool full',
            };
        }

        // 4. Update Nonce
        this.nonces.set(senderKey, tx.nonce);

        // Immediately sequence (single sequencer mode)
        const ordered = this.sequenceTransaction(tx);

        return {
            accepted: true,
            hash: tx.hash,
            sequenceNumber: ordered.sequenceNumber,
        };
    }

    async getNext(): Promise<OrderedTransaction | undefined> {
        // Return the next pending finalization
        const pending = this.finality.getPending();
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

    /**
     * Clears all state (for testing)
     */
    clear(): void {
        this.pool.clear();
        this.finality.clear();
        this.sequenced.clear();
        this.nonces.clear();
        this.nextSequence = 1n;
    }

    private sequenceTransaction(tx: RawTransaction): OrderedTransaction {
        // Remove from pool (should already be there if we called this from submit)
        this.pool.remove(tx.hash);

        // Create ordered transaction
        const ordered: OrderedTransaction = {
            tx,
            sequenceNumber: this.nextSequence++,
            sequencedAt: BigInt(this.clock.now()),
            finality: 'sequenced',
        };

        // Store
        const hashKey = this.hashToKey(tx.hash);
        this.sequenced.set(hashKey, ordered);
        this.sequenced.set(ordered.sequenceNumber.toString(), ordered);

        // Track finality
        this.finality.track(ordered);

        // Emit to subscribers
        this.emitTransaction(ordered);

        if (this.store) {
            this.saveState(this.store).catch(err => {
                console.error('Failed to save sequencer state:', err);
            });
        }

        return ordered;
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
            // Load sequence number
            const seqBytes = await store.get('sequencer:next_sequence');
            if (seqBytes) {
                const seqStr = Buffer.from(seqBytes).toString('utf-8');
                this.nextSequence = BigInt(seqStr);
            }

            // Load nonces
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
                    const nonce = BigInt(Buffer.from(entry[1]).toString('utf-8'));
                    this.nonces.set(addressHex, nonce);
                }
            } finally {
                await iterator.end();
            }

        } catch (error) {
            // Ignore missing state on first run
        }
    }

    private async saveState(store: Store): Promise<void> {
        const batch = store.batch();
        batch.put('sequencer:next_sequence', Buffer.from(this.nextSequence.toString()));

        // Save all nonces
        for (const [address, nonce] of this.nonces) {
            batch.put(`sequencer:nonce:${address}`, Buffer.from(nonce.toString()));
        }

        await batch.write();
    }

    private hashToKey(hash: Uint8Array): string {
        return bytesToHex(hash, false);
    }
}

/**
 * Creates a new single sequencer
 */
export function createSingleSequencer(config?: SingleSequencerConfig): SingleSequencer {
    return new SingleSequencer(config);
}
