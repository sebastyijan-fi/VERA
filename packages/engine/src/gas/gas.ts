/**
 * VERA Gas System
 *
 * Gas metering for deterministic execution cost tracking.
 */

import { IROpcode } from '@vera/dsl';

// ============================================================================
// Gas Error
// ============================================================================

export class OutOfGasError extends Error {
    constructor(
        public readonly gasLimit: bigint,
        public readonly gasUsed: bigint,
        public readonly gasNeeded: bigint
    ) {
        super(`Out of gas: limit=${gasLimit}, used=${gasUsed}, needed=${gasNeeded}`);
        this.name = 'OutOfGasError';
    }
}

// ============================================================================
// Gas Costs
// ============================================================================

/**
 * Gas cost table by opcode category
 */
export const GAS_COSTS: Record<IROpcode, bigint> = {
    // Stack ops (cheap)
    [IROpcode.PUSH]: 1n,
    [IROpcode.POP]: 1n,
    [IROpcode.DUP]: 1n,
    [IROpcode.SWAP]: 1n,

    // Variables
    [IROpcode.LOAD]: 2n,
    [IROpcode.STORE]: 2n,

    // Arithmetic (medium)
    [IROpcode.ADD]: 3n,
    [IROpcode.SUB]: 3n,
    [IROpcode.MUL]: 5n,
    [IROpcode.DIV]: 5n,
    [IROpcode.MOD]: 5n,
    [IROpcode.NEG]: 2n,

    // Comparison
    [IROpcode.EQ]: 2n,
    [IROpcode.NEQ]: 2n,
    [IROpcode.LT]: 2n,
    [IROpcode.LTE]: 2n,
    [IROpcode.GT]: 2n,
    [IROpcode.GTE]: 2n,

    // Logical
    [IROpcode.AND]: 2n,
    [IROpcode.OR]: 2n,
    [IROpcode.NOT]: 2n,

    // Control flow
    [IROpcode.JMP]: 5n,
    [IROpcode.JMP_IF]: 5n,
    [IROpcode.JMP_IF_NOT]: 5n,
    [IROpcode.CALL]: 50n,
    [IROpcode.RET]: 5n,

    // State operations (expensive)
    [IROpcode.STATE_GET]: 100n,
    [IROpcode.STATE_SET]: 500n,
    [IROpcode.STATE_DEL]: 200n,
    [IROpcode.STATE_EXISTS]: 50n,

    // Context
    [IROpcode.CTX_CALLER]: 5n,
    [IROpcode.CTX_BLOCK]: 5n,
    [IROpcode.CTX_THIS]: 5n,

    // Collections
    [IROpcode.LIST_NEW]: 10n,
    [IROpcode.LIST_GET]: 5n,
    [IROpcode.LIST_SET]: 10n,
    [IROpcode.LIST_LEN]: 2n,
    [IROpcode.LIST_PUSH]: 10n,
    [IROpcode.MAP_NEW]: 10n,
    [IROpcode.MAP_GET]: 10n,
    [IROpcode.MAP_SET]: 20n,
    [IROpcode.MAP_DEL]: 10n,
    [IROpcode.MAP_HAS]: 5n,

    // Member access
    [IROpcode.MEMBER_GET]: 5n,
    [IROpcode.MEMBER_SET]: 10n,

    // Assertions
    [IROpcode.REQUIRE]: 10n,
    [IROpcode.ENSURE]: 10n,

    // Events
    [IROpcode.EMIT]: 50n,

    // Misc
    [IROpcode.HASH]: 20n,
    [IROpcode.NOP]: 0n,
    [IROpcode.HALT]: 0n,
};

// ============================================================================
// Gas Meter
// ============================================================================

/**
 * Tracks gas consumption during execution
 */
export class GasMeter {
    private _used = 0n;
    private readonly _limit: bigint;

    constructor(limit: bigint) {
        this._limit = limit;
    }

    /**
     * Consumes gas, throwing if limit exceeded
     */
    consume(amount: bigint): void {
        const newUsed = this._used + amount;
        if (newUsed > this._limit) {
            throw new OutOfGasError(this._limit, this._used, amount);
        }
        this._used = newUsed;
    }

    /**
     * Consumes gas for an opcode
     */
    consumeOpcode(opcode: IROpcode): void {
        this.consume(GAS_COSTS[opcode] ?? 1n);
    }

    /**
     * Gets total gas used
     */
    get used(): bigint {
        return this._used;
    }

    /**
     * Gets gas limit
     */
    get limit(): bigint {
        return this._limit;
    }

    /**
     * Gets remaining gas
     */
    get remaining(): bigint {
        return this._limit - this._used;
    }

    /**
     * Checks if there's enough gas for an operation
     */
    hasEnough(amount: bigint): boolean {
        return this._used + amount <= this._limit;
    }

    /**
     * Resets gas used (for testing)
     */
    reset(): void {
        this._used = 0n;
    }
}

// ============================================================================
// Convenience
// ============================================================================

/**
 * Creates a gas meter with default limit
 */
export function createGasMeter(limit: bigint = 1_000_000n): GasMeter {
    return new GasMeter(limit);
}

/**
 * Gets gas cost for an opcode
 */
export function getGasCost(opcode: IROpcode): bigint {
    return GAS_COSTS[opcode] ?? 1n;
}
