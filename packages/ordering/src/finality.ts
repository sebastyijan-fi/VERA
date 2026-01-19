/// <reference types="node" />
/**
 * VERA Finality Tracker
 *
 * Tracks transaction finality state transitions.
 */

import type {
    OrderedTransaction,
    SequenceNumber,
    FinalityState,
    FinalityCallback,
    Subscription,
} from './types.js';

// ============================================================================
// Finality Configuration
// ============================================================================

export interface FinalityConfig {
    /** Number of transactions before finality (0 = immediate) */
    confirmationDepth?: number | undefined;
    /** Time before automatic finality in ms (0 = disabled) */
    autoFinalizeMs?: number | undefined;
}

// ============================================================================
// Finality Tracker
// ============================================================================

/**
 * Tracks and manages transaction finality
 */
export class FinalityTracker {
    private readonly confirmationDepth: number;
    private readonly autoFinalizeMs: number;
    private readonly transactions: Map<string, OrderedTransaction> = new Map();
    private readonly callbacks: Set<FinalityCallback> = new Set();
    private lastFinalizedSeq: SequenceNumber = 0n;
    private autoFinalizeTimer: NodeJS.Timeout | null = null;

    constructor(config: FinalityConfig = {}) {
        this.confirmationDepth = config.confirmationDepth ?? 0;
        this.autoFinalizeMs = config.autoFinalizeMs ?? 0;
    }

    /**
     * Tracks a new sequenced transaction
     */
    track(tx: OrderedTransaction): void {
        const key = this.seqToKey(tx.sequenceNumber);
        this.transactions.set(key, tx);

        // Check if we can finalize earlier transactions
        this.checkFinality();
    }

    /**
     * Gets transaction by sequence number
     */
    get(seq: SequenceNumber): OrderedTransaction | undefined {
        return this.transactions.get(this.seqToKey(seq));
    }

    /**
     * Manually finalizes a transaction
     */
    finalize(seq: SequenceNumber): boolean {
        const tx = this.get(seq);
        if (!tx) return false;
        if (tx.finality === 'finalized') return true;

        const oldState = tx.finality;
        const updated: OrderedTransaction = { ...tx, finality: 'finalized' };
        this.transactions.set(this.seqToKey(seq), updated);

        if (seq > this.lastFinalizedSeq) {
            this.lastFinalizedSeq = seq;
        }

        this.emitFinality(updated, oldState);
        return true;
    }

    /**
     * Finalizes all transactions up to and including a sequence number
     */
    finalizeUpTo(seq: SequenceNumber): number {
        let count = 0;
        for (const [, tx] of this.transactions) {
            if (tx.sequenceNumber <= seq && tx.finality !== 'finalized') {
                this.finalize(tx.sequenceNumber);
                count++;
            }
        }
        return count;
    }

    /**
     * Gets finality state of a transaction
     */
    getFinalityState(seq: SequenceNumber): FinalityState | undefined {
        return this.get(seq)?.finality;
    }

    /**
     * Gets last finalized sequence number
     */
    getLastFinalized(): SequenceNumber {
        return this.lastFinalizedSeq;
    }

    /**
     * Gets all pending (non-finalized) transactions
     */
    getPending(): OrderedTransaction[] {
        return [...this.transactions.values()].filter(
            (tx) => tx.finality !== 'finalized'
        );
    }

    /**
     * Gets count of finalized transactions
     */
    get finalizedCount(): number {
        return [...this.transactions.values()].filter(
            (tx) => tx.finality === 'finalized'
        ).length;
    }

    /**
     * Subscribes to finality events
     */
    onFinality(callback: FinalityCallback): Subscription {
        this.callbacks.add(callback);
        return {
            unsubscribe: () => this.callbacks.delete(callback),
        };
    }

    /**
     * Starts automatic finalization timer
     */
    startAutoFinalize(): void {
        if (this.autoFinalizeMs <= 0) return;
        if (this.autoFinalizeTimer !== null) return;

        const interval = Math.min(this.autoFinalizeMs, 1000);
        this.autoFinalizeTimer = setInterval(() => {
            this.autoFinalizeExpired();
        }, interval);
    }

    /**
     * Stops automatic finalization
     */
    stopAutoFinalize(): void {
        if (this.autoFinalizeTimer !== null) {
            clearInterval(this.autoFinalizeTimer);
            this.autoFinalizeTimer = null;
        }
    }

    /**
     * Clears all tracked transactions
     */
    clear(): void {
        this.transactions.clear();
        this.lastFinalizedSeq = 0n;
    }

    private checkFinality(): void {
        if (this.confirmationDepth === 0) {
            // Immediate finality
            for (const [, tx] of this.transactions) {
                if (tx.finality !== 'finalized') {
                    this.finalize(tx.sequenceNumber);
                }
            }
            return;
        }

        // Check depth-based finality
        const pending = this.getPending().sort(
            (a, b) => Number(a.sequenceNumber - b.sequenceNumber)
        );

        for (const tx of pending) {
            const depth = this.getConfirmationDepth(tx.sequenceNumber);
            if (depth >= this.confirmationDepth) {
                this.finalize(tx.sequenceNumber);
            }
        }
    }

    private getConfirmationDepth(seq: SequenceNumber): number {
        let maxSeq = 0n;
        for (const [, tx] of this.transactions) {
            if (tx.sequenceNumber > maxSeq) {
                maxSeq = tx.sequenceNumber;
            }
        }
        return Number(maxSeq - seq);
    }

    private autoFinalizeExpired(): void {
        const now = BigInt(Date.now());
        const threshold = BigInt(this.autoFinalizeMs);

        for (const [, tx] of this.transactions) {
            if (tx.finality !== 'finalized') {
                if (now - tx.sequencedAt >= threshold) {
                    this.finalize(tx.sequenceNumber);
                }
            }
        }
    }

    private emitFinality(tx: OrderedTransaction, oldState: FinalityState): void {
        for (const callback of this.callbacks) {
            try {
                callback(tx, oldState);
            } catch {
                // Ignore callback errors
            }
        }
    }

    private seqToKey(seq: SequenceNumber): string {
        return seq.toString();
    }
}

/**
 * Creates a new finality tracker
 */
export function createFinalityTracker(config?: FinalityConfig): FinalityTracker {
    return new FinalityTracker(config);
}
