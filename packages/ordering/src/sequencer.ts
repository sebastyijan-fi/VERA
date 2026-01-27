/**
 * VERA Sequencer Interface
 *
 * Abstract interface for transaction ordering implementations.
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

// ============================================================================
// Sequencer Interface
// ============================================================================

/**
 * Abstract sequencer interface
 *
 * Implementations can be:
 * - SingleSequencer: Single node, in-memory (development)
 * - RaftSequencer: Multi-node Raft consensus
 * - ExternalSequencer: Delegates to external service
 */
export interface Sequencer {
    /**
     * Submits a transaction for sequencing
     */
    submit(tx: RawTransaction): Promise<SubmitResult>;
    /**
     * Submits multiple transactions for sequencing
     */
    submitMany(txs: RawTransaction[]): Promise<SubmitResult[]>;

    /**
     * Gets the next transaction to be executed
     * Returns undefined if no transactions pending
     */
    getNext(): Promise<OrderedTransaction | undefined>;

    /**
     * Gets a transaction by sequence number
     */
    getBySequence(seq: SequenceNumber): Promise<OrderedTransaction | undefined>;

    /**
     * Gets transactions in a sequence range
     */
    getRange(
        start: SequenceNumber,
        end: SequenceNumber
    ): Promise<OrderedTransaction[]>;

    /**
     * Marks a transaction as finalized
     */
    finalize(seq: SequenceNumber): Promise<void>;

    /**
     * Gets current sequencer status
     */
    getStatus(): Promise<SequencerStatus>;

    /**
     * Subscribes to new sequenced transactions
     */
    onTransaction(callback: TransactionCallback): Subscription;

    /**
     * Subscribes to finality changes
     */
    onFinality(callback: FinalityCallback): Subscription;

    /**
     * Starts the sequencer
     */
    start(): Promise<void>;

    /**
     * Stops the sequencer gracefully
     */
    stop(): Promise<void>;
}

// ============================================================================
// Sequencer Error
// ============================================================================

export class SequencerError extends Error {
    constructor(
        message: string,
        public readonly code: string
    ) {
        super(message);
        this.name = 'SequencerError';
    }
}

export class DuplicateTransactionError extends SequencerError {
    constructor(hash: string) {
        super(`Duplicate transaction: ${hash}`, 'DUPLICATE_TX');
        this.name = 'DuplicateTransactionError';
    }
}

export class SequencerNotActiveError extends SequencerError {
    constructor() {
        super('Sequencer is not active', 'NOT_ACTIVE');
        this.name = 'SequencerNotActiveError';
    }
}

export class SequenceNotFoundError extends SequencerError {
    constructor(seq: bigint) {
        super(`Sequence ${seq} not found`, 'NOT_FOUND');
        this.name = 'SequenceNotFoundError';
    }
}
