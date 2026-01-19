/**
 * VERA SingleSequencer
 *
 * Single-node in-memory sequencer for development.
 * Provides immediate finality with FIFO ordering.
 */

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
import { TransactionPool, type PoolConfig } from './pool.js';
import { FinalityTracker, type FinalityConfig } from './finality.js';

// ============================================================================
// SingleSequencer Configuration
// ============================================================================

export interface SingleSequencerConfig {
    /** Sequencer identifier */
    id?: string | undefined;
    /** Pool configuration */
    pool?: PoolConfig | undefined;
    /** Finality configuration */
    finality?: FinalityConfig | undefined;
}

// ============================================================================
// SingleSequencer
// ============================================================================

/**
 * Single-node sequencer for development and testing
 */
export class SingleSequencer implements Sequencer {
    private readonly id: string;
    private readonly pool: TransactionPool;
    private readonly finality: FinalityTracker;
    private readonly sequenced: Map<string, OrderedTransaction> = new Map();
    private readonly txCallbacks: Set<TransactionCallback> = new Set();
    private nextSequence: SequenceNumber = 1n;
    private isActive = false;

    constructor(config: SingleSequencerConfig = {}) {
        this.id = config.id ?? 'single-sequencer';
        this.pool = new TransactionPool(config.pool);
        this.finality = new FinalityTracker(config.finality);
    }

    async submit(tx: RawTransaction): Promise<SubmitResult> {
        if (!this.isActive) {
            return {
                accepted: false,
                hash: tx.hash,
                error: 'Sequencer not active',
            };
        }

        // Check for duplicate
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
                address: new Uint8Array(20) as any, // Placeholder
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
        this.nextSequence = 1n;
    }

    private sequenceTransaction(tx: RawTransaction): OrderedTransaction {
        // Remove from pool
        this.pool.remove(tx.hash);

        // Create ordered transaction
        const ordered: OrderedTransaction = {
            tx,
            sequenceNumber: this.nextSequence++,
            sequencedAt: BigInt(Date.now()),
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

    private hashToKey(hash: Uint8Array): string {
        return Array.from(hash)
            .map((b) => b.toString(16).padStart(2, '0'))
            .join('');
    }
}

/**
 * Creates a new single sequencer
 */
export function createSingleSequencer(config?: SingleSequencerConfig): SingleSequencer {
    return new SingleSequencer(config);
}
