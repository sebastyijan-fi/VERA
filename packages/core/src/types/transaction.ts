/**
 * VERA Transaction Types
 *
 * Defines types for transactions, signatures, execution context, and results.
 * Transactions are the atomic units of state change in VERA.
 */

import type { Address, Bytes, Bytes32, Bytes64 } from './primitives.js';
import type { StateChange, StateStore } from './state.js';

// ============================================================================
// Transaction Type References
// ============================================================================

/**
 * Reference to a registered transaction type
 */
export interface TransactionTypeRef {
    /** Module containing the transaction type */
    readonly moduleId: Bytes32;
    /** Name of the transaction within the module */
    readonly transactionName: string;
}

// ============================================================================
// Signatures
// ============================================================================

/**
 * Digital signature with attribution
 */
export interface Signature {
    /** Ed25519 public key (32 bytes) */
    readonly publicKey: Bytes32;
    /** Ed25519 signature (64 bytes) */
    readonly signature: Bytes64;
    /** Fields that were included in the signed content */
    readonly signedFields: readonly string[];
}

// ============================================================================
// Transactions
// ============================================================================

/**
 * A transaction is an atomic unit of state change.
 * All transactions must be authenticated and typed.
 */
export interface Transaction {
    /** Protocol version */
    readonly version: number;
    /** Chain ID for replay protection */
    readonly chainId: Bytes32;
    /** Reference to the transaction type definition */
    readonly type: TransactionTypeRef;
    /** Replay protection nonce (unique per sender) */
    readonly nonce: bigint;
    /** Optional maximum sequence number (reject if ordered after) */
    readonly maxSequence?: bigint;
    /** Type-specific payload (CBOR encoded) */
    readonly payload: Bytes;
    /** One or more required signatures */
    readonly signatures: readonly Signature[];
    /** Client submission timestamp (informational, not trusted) */
    readonly submittedAt?: Date;
}

/**
 * Transaction with ordering metadata
 */
export interface OrderedTransaction {
    /** The transaction */
    readonly transaction: Transaction;
    /** Global sequence number */
    readonly sequence: bigint;
    /** Block height containing this transaction */
    readonly blockHeight: bigint;
    /** Position within the block */
    readonly indexInBlock: number;
    /** Ordering timestamp (from consensus) */
    readonly timestamp: bigint;
}

// ============================================================================
// Transaction ID
// ============================================================================

/**
 * Unique identifier for a transaction (hash of canonical form)
 */
export type TransactionId = Bytes32;

// ============================================================================
// Block Context
// ============================================================================

/**
 * Block-level context available during execution
 */
export interface BlockContext {
    /** Block timestamp (Unix seconds) */
    readonly timestamp: bigint;
    /** Block height/sequence number */
    readonly height: bigint;
    /** Block proposer address */
    readonly proposer: Address;
    /** Previous block hash */
    readonly prevBlockHash: Bytes32;
}

// ============================================================================
// Execution Context
// ============================================================================

/**
 * Context for transaction execution
 */
export interface ExecutionContext {
    // Immutable context
    /** Current state (read-only during constraint checks) */
    readonly state: StateStore;
    /** Transaction being executed */
    readonly transaction: Transaction;
    /** Block-level context */
    readonly block: BlockContext;
    /** Maximum gas allowed */
    readonly gasLimit: bigint;
    /** Current call depth (for nested calls if supported) */
    readonly callDepth: number;

    // Mutable during execution (accumulated)
    /** Pending state modifications */
    stateChanges: StateChange[];
    /** Emitted events */
    events: Event[];
    /** Gas consumed so far */
    gasUsed: bigint;
}

// ============================================================================
// Events
// ============================================================================

/**
 * Event emitted during transaction execution
 */
export interface Event {
    /** Event name (from EMIT statement) */
    readonly name: string;
    /** Module that emitted the event */
    readonly moduleId: Bytes32;
    /** Event data (CBOR encoded) */
    readonly data: Bytes;
    /** Transaction that emitted this event */
    readonly transactionId: TransactionId;
    /** Block height when emitted */
    readonly blockHeight: bigint;
    /** Index of this event in the block's event log */
    readonly logIndex: number;
}

// ============================================================================
// Audit Log
// ============================================================================

/**
 * Audit entry for a transaction execution
 */
export interface AuditEntry {
    /** Transaction ID */
    readonly transactionId: TransactionId;
    /** Block height */
    readonly blockHeight: bigint;
    /** Block timestamp */
    readonly timestamp: bigint;
    /** Transaction type */
    readonly transactionType: TransactionTypeRef;
    /** Caller address (derived from first signature) */
    readonly caller: Address;
    /** Number of state changes */
    readonly stateChangeCount: number;
    /** Number of events emitted */
    readonly eventCount: number;
    /** Gas consumed */
    readonly gasUsed: bigint;
    /** Whether execution succeeded */
    readonly success: boolean;
    /** Error code if failed */
    readonly errorCode?: string;
}

// ============================================================================
// Execution Results
// ============================================================================

/**
 * Source location for error reporting
 */
export interface SourceLocation {
    /** Source file path */
    readonly file: string;
    /** Line number (1-indexed) */
    readonly line: number;
    /** Column number (1-indexed) */
    readonly column: number;
}

/**
 * Execution error details
 */
export interface ExecutionError {
    /** Error code (e.g., "PRECONDITION_FAILED") */
    readonly code: string;
    /** Human-readable error message */
    readonly message: string;
    /** Source location where error occurred */
    readonly location?: SourceLocation;
    /** Additional error data */
    readonly data?: Record<string, unknown>;
}

/**
 * Successful execution result
 */
export interface ExecutionSuccess {
    readonly success: true;
    /** New state after applying transaction */
    readonly newState: StateStore;
    /** Events emitted during execution */
    readonly events: readonly Event[];
    /** Gas consumed */
    readonly gasUsed: bigint;
    /** Audit log entry */
    readonly auditLog: AuditEntry;
}

/**
 * Failed execution result
 */
export interface ExecutionFailure {
    readonly success: false;
    /** Error details */
    readonly error: ExecutionError;
    /** Gas consumed before failure */
    readonly gasUsed: bigint;
}

/**
 * Result of transaction execution
 */
export type ExecutionResult = ExecutionSuccess | ExecutionFailure;

// ============================================================================
// Transaction Utilities
// ============================================================================

/**
 * Creates a transaction type reference
 */
export function createTransactionTypeRef(
    moduleId: Bytes32,
    transactionName: string
): TransactionTypeRef {
    return { moduleId, transactionName };
}

/**
 * Gets the caller address from a transaction (first signer's public key)
 */
export function getTransactionCaller(transaction: Transaction): Address | null {
    const firstSig = transaction.signatures[0];
    if (!firstSig) return null;
    return firstSig.publicKey;
}

/**
 * Creates a failed execution result
 */
export function createExecutionError(
    code: string,
    message: string,
    gasUsed: bigint,
    location?: SourceLocation,
    data?: Record<string, unknown>
): ExecutionFailure {
    const error: ExecutionError = { code, message };
    if (location !== undefined) {
        (error as { location: SourceLocation }).location = location;
    }
    if (data !== undefined) {
        (error as { data: Record<string, unknown> }).data = data;
    }
    return {
        success: false,
        error,
        gasUsed,
    };
}

// ============================================================================
// Common Error Codes
// ============================================================================

export const ErrorCodes = {
    // Authentication errors
    INVALID_SIGNATURE: 'INVALID_SIGNATURE',
    NONCE_TOO_LOW: 'NONCE_TOO_LOW',
    NONCE_TOO_HIGH: 'NONCE_TOO_HIGH',
    UNAUTHORIZED: 'UNAUTHORIZED',

    // Execution errors
    PRECONDITION_FAILED: 'PRECONDITION_FAILED',
    POSTCONDITION_FAILED: 'POSTCONDITION_FAILED',
    INVARIANT_VIOLATED: 'INVARIANT_VIOLATED',

    // Resource errors
    OUT_OF_GAS: 'OUT_OF_GAS',
    STACK_OVERFLOW: 'STACK_OVERFLOW',

    // State errors
    STATE_NOT_FOUND: 'STATE_NOT_FOUND',
    SCHEMA_MISMATCH: 'SCHEMA_MISMATCH',

    // Ordering errors
    SEQUENCE_EXPIRED: 'SEQUENCE_EXPIRED',

    // Network errors
    NETWORK_ERROR: 'NETWORK_ERROR',
} as const;

export type ErrorCode = (typeof ErrorCodes)[keyof typeof ErrorCodes];
