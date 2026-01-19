/**
 * VERA Unified Error Architecture
 *
 * Defines the standard error taxonomy for the VERA system.
 * Distinguishes between user errors, contract constraint violations, and infrastructure failures.
 */

/**
 * Base class for all VERA system errors.
 */
export class VeraError extends Error {
    constructor(
        message: string,
        public readonly code: string,
        public readonly details?: Record<string, unknown>
    ) {
        super(message);
        this.name = 'VeraError';
    }
}

/**
 * Precondition Failure (User Error)
 *
 * Indicates that the input arguments, signature, nonce, or other user-provided
 * data failed validation checks. Retrying without changes will result in the same error.
 *
 * Usage:
 * - Invalid signature
 * - Nonce too low/high
 * - Insufficient balance for gas
 * - Invalid transaction format
 */
export class PreconditionError extends VeraError {
    constructor(message: string, details?: Record<string, unknown>) {
        super(message, 'PRECONDITION_FAILED', details);
        this.name = 'PreconditionError';
    }
}

/**
 * Constraint Violation (Contract Bug/Logic)
 *
 * Indicates that a transaction executed but hit a logical assertion or invariant
 * within the smart contract or execution engine.
 *
 * Usage:
 * - `require` or `ensure` statement failure
 * - Division by zero
 * - Array index out of bounds (in safe mode)
 * - State invariant violation
 */
export class ConstraintError extends VeraError {
    constructor(message: string, details?: Record<string, unknown>) {
        super(message, 'CONSTRAINT_VIOLATION', details);
        this.name = 'ConstraintError';
    }
}

/**
 * Storage Failure (Infrastructure Error)
 *
 * Indicates a failure in the underlying storage or infrastructure layer.
 * These might be transient or fatal system issues.
 *
 * Usage:
 * - Disk full
 * - IO error
 * - Corrupted state file
 * - Database connection lost
 */
export class StorageError extends VeraError {
    constructor(message: string, details?: Record<string, unknown>) {
        super(message, 'STORAGE_FAILURE', details);
        this.name = 'StorageError';
    }
}

/**
 * Internal System Error (Bug)
 *
 * Indicates an unexpected state or bug in the VERA node software itself.
 */
export class InternalError extends VeraError {
    constructor(message: string, details?: Record<string, unknown>) {
        super(message, 'INTERNAL_ERROR', details);
        this.name = 'InternalError';
    }
}
