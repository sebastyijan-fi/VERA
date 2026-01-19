/**
 * VERA Execution Context
 *
 * Runtime context for transaction execution.
 */

import type { Value } from '../vm/value.js';
import type { EventCollector } from '../events.js';

// ============================================================================
// Block Context
// ============================================================================

export interface BlockContext {
    /** Block height */
    height: bigint;
    /** Block timestamp (Unix seconds) */
    timestamp: bigint;
    /** Previous block hash */
    parentHash: string;
}

// ============================================================================
// State Interface
// ============================================================================

/**
 * State accessor for VM execution
 */
export interface StateAccessor {
    /**
     * Gets a value from state
     */
    get(entityType: string, key: Value): Value | undefined;

    /**
     * Sets a value in state
     */
    set(entityType: string, key: Value, value: Value): void;

    /**
     * Deletes a value from state
     */
    delete(entityType: string, key: Value): void;

    /**
     * Checks if a key exists
     */
    exists(entityType: string, key: Value): boolean;
}

// ============================================================================
// Execution Context
// ============================================================================

/**
 * Complete execution context for a transaction
 */
export interface ExecutionContext {
    /** Transaction caller address */
    caller: string;
    /** Contract address being executed */
    contractAddress: string;
    /** Block context */
    block: BlockContext;
    /** State accessor */
    state: StateAccessor;
    /** Event collector */
    events: EventCollector;
    /** Transaction hash */
    txHash?: string | undefined;
    /** Transaction arguments */
    args?: Value[] | undefined;
}

// ============================================================================
// Context Builder
// ============================================================================

export interface ExecutionContextOptions {
    caller: string;
    contractAddress?: string;
    block?: Partial<BlockContext>;
    state: StateAccessor;
    events: EventCollector;
    txHash?: string;
    args?: Value[];
}

/**
 * Creates an execution context
 */
export function createExecutionContext(options: ExecutionContextOptions): ExecutionContext {
    const ctx: ExecutionContext = {
        caller: options.caller,
        contractAddress: options.contractAddress ?? '0x0000000000000000000000000000000000000000',
        block: {
            height: options.block?.height ?? 0n,
            timestamp: options.block?.timestamp ?? BigInt(Math.floor(Date.now() / 1000)),
            parentHash: options.block?.parentHash ?? '0x0000000000000000000000000000000000000000000000000000000000000000',
        },
        state: options.state,
        events: options.events,
    };
    if (options.txHash !== undefined) {
        ctx.txHash = options.txHash;
    }
    if (options.args !== undefined) {
        ctx.args = options.args;
    }
    return ctx;
}
