/**
 * VERA Block Types
 *
 * Defines types for blocks and network status.
 */

import type { Address, Bytes, Bytes32 } from './primitives.js';
import type { Transaction } from './transaction.js';

// ============================================================================
// Blocks
// ============================================================================

/**
 * Validator signature on a block
 */
export interface ValidatorSignature {
    /** Validator address */
    readonly validator: Address;
    /** Signature bytes */
    readonly signature: Bytes;
    /** Timestamp when signed */
    readonly timestamp: bigint;
}

/**
 * A block containing ordered transactions
 */
export interface Block {
    /** Block height (monotonically increasing) */
    readonly height: bigint;
    /** Block timestamp (Unix seconds) */
    readonly timestamp: bigint;
    /** Hash of the previous block */
    readonly prevBlockHash: Bytes32;
    /** State root after applying all transactions */
    readonly stateRoot: Bytes32;
    /** Merkle root of transactions in this block */
    readonly transactionsRoot: Bytes32;
    /** Merkle root of receipts/events in this block */
    readonly receiptsRoot: Bytes32;
    /** Transactions included in this block */
    readonly transactions: readonly Transaction[];
    /** Block proposer */
    readonly proposer: Address;
    /** Validator signatures (for finality) */
    readonly signatures: readonly ValidatorSignature[];
}

/**
 * Block header (block without transactions)
 */
export interface BlockHeader {
    readonly height: bigint;
    readonly timestamp: bigint;
    readonly prevBlockHash: Bytes32;
    readonly stateRoot: Bytes32;
    readonly transactionsRoot: Bytes32;
    readonly receiptsRoot: Bytes32;
    readonly proposer: Address;
}

// ============================================================================
// Finality
// ============================================================================

/**
 * Proof of block finality
 */
export interface FinalityProof {
    /** Block being proven final */
    readonly blockHash: Bytes32;
    /** Block height */
    readonly height: bigint;
    /** Validator signatures attesting finality */
    readonly signatures: readonly ValidatorSignature[];
}

/**
 * Finality status of a block or transaction
 */
export type FinalityStatus =
    | { status: 'pending' }
    | { status: 'included'; confirmations: number }
    | { status: 'final'; proof: FinalityProof }
    | { status: 'rejected'; reason: string };

// ============================================================================
// Network Status
// ============================================================================

/**
 * Validator information
 */
export interface ValidatorInfo {
    /** Validator address */
    readonly address: Address;
    /** Validator public key */
    readonly publicKey: Bytes32;
    /** Voting power */
    readonly votingPower: bigint;
    /** Whether currently active */
    readonly isActive: boolean;
}

/**
 * Network status information
 */
export interface NetworkStatus {
    /** Chain identifier */
    readonly chainId: string;
    /** Latest finalized block height */
    readonly latestHeight: bigint;
    /** Latest block hash */
    readonly latestBlockHash: Bytes32;
    /** Latest state root */
    readonly latestStateRoot: Bytes32;
    /** Number of connected peers */
    readonly peerCount: number;
    /** Whether node is syncing */
    readonly isSyncing: boolean;
    /** Sync progress (0-1) if syncing */
    readonly syncProgress?: number;
}
