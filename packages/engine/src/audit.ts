/**
 * VERA Audit Logger
 *
 * Optional execution trace logging for debugging and verification.
 */

import type { IROpcode } from '@vera/dsl';
import type { Value } from './vm/value.js';
import { valueToString } from './vm/value.js';

// ============================================================================
// Audit Types
// ============================================================================

/**
 * A single audit log entry
 */
export interface AuditEntry {
    /** Instruction index */
    instruction: number;
    /** Opcode executed */
    opcode: IROpcode;
    /** Operand if any */
    operand?: string | undefined;
    /** Gas consumed */
    gasUsed: bigint;
    /** Stack depth after */
    stackDepth: number;
    /** Timestamp */
    timestamp: number;
}

/**
 * Complete execution audit log
 */
export interface AuditLog {
    /** Function executed */
    functionName: string;
    /** Transaction hash if available */
    txHash?: string | undefined;
    /** Entries */
    entries: AuditEntry[];
    /** Total gas used */
    totalGas: bigint;
    /** Start time */
    startTime: number;
    /** End time */
    endTime: number;
    /** Success flag */
    success: boolean;
    /** Error message if failed */
    error?: string | undefined;
}

// ============================================================================
// Clock Interface
// ============================================================================

export interface Clock {
    now(): number;
}

// ============================================================================
// Audit Logger
// ============================================================================

/**
 * Logs execution details for debugging
 */
export class AuditLogger {
    private entries: AuditEntry[] = [];
    private startTime = 0;
    private functionName = '';
    private txHash?: string | undefined;
    private readonly clock: Clock;

    constructor(clock?: Clock) {
        this.clock = clock ?? { now: () => Date.now() };
    }

    /**
     * Starts logging for a function
     */
    start(functionName: string, txHash?: string | undefined): void {
        this.entries = [];
        this.startTime = this.clock.now();
        this.functionName = functionName;
        this.txHash = txHash;
    }

    /**
     * Logs an instruction execution
     */
    log(
        instruction: number,
        opcode: IROpcode,
        operand: Value | string | number | undefined,
        gasUsed: bigint,
        stackDepth: number
    ): void {
        const entry: AuditEntry = {
            instruction,
            opcode,
            gasUsed,
            stackDepth,
            timestamp: this.clock.now(),
        };
        if (operand !== undefined) {
            entry.operand = this.formatOperand(operand);
        }
        this.entries.push(entry);
    }

    /**
     * Completes the audit log
     */
    finish(success: boolean, totalGas: bigint, error?: string | undefined): AuditLog {
        const log: AuditLog = {
            functionName: this.functionName,
            entries: this.entries,
            totalGas,
            startTime: this.startTime,
            endTime: this.clock.now(),
            success,
        };
        if (this.txHash !== undefined) {
            log.txHash = this.txHash;
        }
        if (error !== undefined) {
            log.error = error;
        }
        return log;
    }

    /**
     * Gets current entry count
     */
    get entryCount(): number {
        return this.entries.length;
    }

    private formatOperand(operand: Value | string | number): string {
        if (typeof operand === 'string') return operand;
        if (typeof operand === 'number') return String(operand);
        return valueToString(operand);
    }
}

/**
 * Creates a new audit logger
 */
export function createAuditLogger(clock?: Clock): AuditLogger {
    return new AuditLogger(clock);
}
