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
// Access List Types (C.1)
// ============================================================================

export interface AccessListEntry {
    entityType: string;
    keys: string[];
}

export type AccessList = AccessListEntry[];

// ============================================================================
// Transaction Types
// ============================================================================

/**
 * A raw transaction before ordering
 */
export interface RawTransaction {
    /** Transaction hash */
    hash: Bytes32;
    /** Chain identifier */
    chainId: Bytes32;
    /** Sender address */
    sender: Address;
    /** Target function */
    function: string;
    /** Encoded arguments */
    args: Uint8Array;
    /** Transaction nonce */
    nonce: bigint;
    /** Signature */
    signature: Uint8Array;
    /** Canonical CBOR bytes (pre-hash) */
    canonicalTxBytes: Uint8Array;
    /** Timestamp when submitted */
    submittedAt: bigint;
    /** Optional Access List for state pre-warming/conflict detection */
    accessList?: AccessList | undefined;
}

// ... unchanged types ...

// ============================================================================
// Factory Functions
// ============================================================================

/**
 * Creates a raw transaction
 */
export function createRawTransaction(
    hash: Bytes32,
    chainId: Bytes32,
    sender: Address,
    func: string,
    args: Uint8Array,
    nonce: bigint,
    signature: Uint8Array,
    canonicalTxBytes: Uint8Array,
    submittedAt: bigint = BigInt(Date.now()),
    accessList?: AccessList
): RawTransaction {
    return {
        hash,
        chainId,
        sender,
        function: func,
        args,
        nonce,
        signature,
        canonicalTxBytes,
        submittedAt,
        accessList,
    };
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


