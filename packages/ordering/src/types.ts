/**
 * VERA Ordering Layer Types
 *
 * Core types for transaction ordering and sequencing.
 */

import type { Address, Bytes32 } from '@vera/core';

// ============================================================================
// Sequence Types
// ============================================================================

/**
 * Monotonically increasing sequence number
 */
export type SequenceNumber = bigint;

/**
 * Transaction finality state
 */
export type FinalityState = 'pending' | 'sequenced' | 'finalized';

// ============================================================================
// Transaction Types
// ============================================================================

/**
 * A raw transaction before ordering
 */
export interface RawTransaction {
    /** Transaction hash */
    hash: Bytes32;
    /** Sender address */
    sender: Address;
    /** Target function */
    function: string;
    /** Encoded arguments */
    args: Uint8Array;
    /** Signature */
    signature: Uint8Array;
    /** Timestamp when submitted */
    submittedAt: bigint;
}

/**
 * A transaction that has been sequenced
 */
export interface OrderedTransaction {
    /** The raw transaction */
    tx: RawTransaction;
    /** Assigned sequence number */
    sequenceNumber: SequenceNumber;
    /** Timestamp when sequenced */
    sequencedAt: bigint;
    /** Current finality state */
    finality: FinalityState;
}

/**
 * Transaction submission result
 */
export interface SubmitResult {
    /** Whether submission was accepted */
    accepted: boolean;
    /** Transaction hash */
    hash: Bytes32;
    /** Error message if rejected */
    error?: string | undefined;
    /** Assigned sequence number if immediately sequenced */
    sequenceNumber?: SequenceNumber | undefined;
}

// ============================================================================
// Sequencer Types
// ============================================================================

/**
 * Sequencer node information
 */
export interface SequencerInfo {
    /** Sequencer identifier */
    id: string;
    /** Sequencer address */
    address: Address;
    /** Whether this is the active sequencer */
    isActive: boolean;
    /** Last sequence number assigned */
    lastSequence: SequenceNumber;
    /** Current epoch/term */
    epoch: bigint;
}

/**
 * Sequencer status
 */
export interface SequencerStatus {
    /** Current sequencer info */
    sequencer: SequencerInfo;
    /** Number of pending transactions */
    pendingCount: number;
    /** Number of sequenced transactions */
    sequencedCount: number;
    /** Number of finalized transactions */
    finalizedCount: number;
}

// ============================================================================
// Subscription Types
// ============================================================================

/**
 * Callback for new sequenced transactions
 */
export type TransactionCallback = (tx: OrderedTransaction) => void;

/**
 * Callback for finality events
 */
export type FinalityCallback = (tx: OrderedTransaction, oldState: FinalityState) => void;

/**
 * Subscription handle for cleanup
 */
export interface Subscription {
    /** Unsubscribe from updates */
    unsubscribe(): void;
}

// ============================================================================
// Factory Functions
// ============================================================================

/**
 * Creates a raw transaction
 */
export function createRawTransaction(
    hash: Bytes32,
    sender: Address,
    func: string,
    args: Uint8Array,
    signature: Uint8Array
): RawTransaction {
    return {
        hash,
        sender,
        function: func,
        args,
        signature,
        submittedAt: BigInt(Date.now()),
    };
}
