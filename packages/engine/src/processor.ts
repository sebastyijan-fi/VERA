/**
 * VERA Transaction State Processor
 *
 * Main orchestrator for executing transactions.
 */

import type { IRProgram } from '@vera/dsl';
import { VirtualMachine, VMError, RequireError, EnsureError, stringValue } from './vm/index.js';
import { encodeValue, prepareForEncoding, restoreFromDecoding } from './vm/codec.js';
import type { Value } from './vm/value.js';
import { GasMeter, OutOfGasError } from './gas/index.js';
import { StateJournal, createExecutionContext, type BlockContext, type ExecutionContext } from './state/index.js';
import { EventEmitter, type EmittedEvent } from './events.js';
import { AuditLogger, type AuditLog } from './audit.js';
import { decode, encode, hexToBytes32, sha256, type StateKey, type StateValue as BinaryStateValue, type StateChange } from '@vera/core';

// ============================================================================
// Execution Result
// ============================================================================

/**
 * Result of transaction execution
 */
export interface ExecutionResult {
    /** Whether execution succeeded */
    success: boolean;
    /** Return value if any */
    returnValue?: Value | undefined;
    /** Emitted events */
    events: readonly EmittedEvent[];
    /** Total gas used */
    gasUsed: bigint;
    /** Error if failed */
    error?: ExecutionError | undefined;
    /** Instructions executed */
    instructionsExecuted: number;
    /** State changes (entity -> key -> value) */
    stateChanges: Map<string, Map<string, Value>>;
    /** Binary state changes for StateStore.apply */
    binaryChanges: StateChange[];
    /** Audit log if enabled */
    auditLog?: AuditLog | undefined;
}

/**
 * Execution error details
 */
export interface ExecutionError {
    type: 'require' | 'ensure' | 'out_of_gas' | 'runtime' | 'not_found';
    message: string;
    instruction?: number | undefined;
}

// ============================================================================
// Processor Options
// ============================================================================

export interface ProcessorOptions {
    /** Gas limit for execution */
    gasLimit?: bigint;
    /** Enable audit logging */
    enableAudit?: boolean;
    /** Initial state */
    initialState?: Map<string, Map<string, Value>>;
}

// ============================================================================
// Transaction State Processor
// ============================================================================

/**
 * Executes transactions against state
 */
export class TransactionStateProcessor {
    private readonly program: IRProgram;
    private readonly options: Required<ProcessorOptions>;

    constructor(program: IRProgram, options: ProcessorOptions = {}) {
        this.program = program;
        this.options = {
            gasLimit: options.gasLimit ?? 1_000_000n,
            enableAudit: options.enableAudit ?? false,
            initialState: options.initialState ?? new Map(),
        };
    }

    /**
     * Executes a transaction
     */
    /**
     * Executes a transaction
     */
    async execute(
        functionName: string,
        args: Value[],
        caller: string,
        block?: Partial<BlockContext>
    ): Promise<ExecutionResult> {
        // Set up components
        const gas = new GasMeter(this.options.gasLimit);
        const state = new StateJournal(this.cloneState(this.options.initialState));
        const events = new EventEmitter();
        const audit = this.options.enableAudit ? new AuditLogger() : undefined;

        // Create execution context
        const contextOptions: import('./state/index.js').ExecutionContextOptions = {
            caller,
            state,
            events,
        };
        if (block) {
            contextOptions.block = block;
        }
        const context = createExecutionContext(contextOptions);

        // Handle system transactions
        if (functionName.startsWith('system_')) {
            return this.handleSystemTransaction(functionName, args, context, gas, state, events, audit);
        }

        // Start audit if enabled
        audit?.start(functionName);

        try {
            // Execute via VM
            const vm = new VirtualMachine(this.program);
            const result = await vm.execute(functionName, args, context, gas);

            if (!result.success) {
                // Rollback state on failure
                state.rollback();

                return this.buildErrorResult(
                    result.error!,
                    gas.used,
                    result.instructionsExecuted,
                    events.getEvents(),
                    audit?.finish(false, gas.used, result.error?.message)
                );
            }

            // Commit state on success
            state.commit();

            return {
                success: true,
                returnValue: result.returnValue,
                events: events.getEvents(),
                gasUsed: gas.used,
                instructionsExecuted: result.instructionsExecuted,
                stateChanges: this.getStateAsMap(state),
                binaryChanges: this.translateToBinaryChanges(state, context.block.timestamp),
                auditLog: audit?.finish(true, gas.used),
            };
        } catch (e) {
            // Rollback on any error
            state.rollback();

            if (e instanceof OutOfGasError) {
                return {
                    success: false,
                    events: events.getEvents(),
                    gasUsed: gas.used,
                    error: {
                        type: 'out_of_gas',
                        message: e.message,
                    },
                    instructionsExecuted: 0,
                    stateChanges: new Map(),
                    binaryChanges: [],
                    auditLog: audit?.finish(false, gas.used, e.message),
                };
            }

            throw e;
        }
    }

    /**
     * Validates a transaction without committing
     */
    async validate(
        functionName: string,
        args: Value[],
        caller: string,
        block?: Partial<BlockContext>
    ): Promise<{ valid: boolean; gasEstimate: bigint; error?: string | undefined }> {
        const result = await this.execute(functionName, args, caller, block);
        const ret: { valid: boolean; gasEstimate: bigint; error?: string | undefined } = {
            valid: result.success,
            gasEstimate: result.gasUsed,
        };
        if (result.error?.message) {
            ret.error = result.error.message;
        }
        return ret;
    }

    /**
     * Gets available public functions
     */
    getPublicFunctions(): string[] {
        return this.program.functions
            .filter(f => f.isPublic)
            .map(f => f.name);
    }

    private async handleSystemTransaction(
        functionName: string,
        args: Value[],
        context: ExecutionContext,
        gas: GasMeter,
        state: StateJournal,
        events: EventEmitter,
        audit?: AuditLogger
    ): Promise<ExecutionResult> {
        audit?.start(functionName);

        try {
            switch (functionName) {
                case 'system_upgradeModule': {
                    // Stub for module upgrade
                    // In a full implementation, this would update the module IR in state
                    if (args.length < 1) throw new Error('system_upgradeModule requires IR payload');
                    events.emit('GovernanceUpdate', stringValue(`Module ${this.program.name} upgraded`));
                    break;
                }
                default:
                    throw new Error(`Unknown system transaction: ${functionName}`);
            }

            state.commit();

            return {
                success: true,
                events: events.getEvents(),
                gasUsed: gas.used,
                instructionsExecuted: 1,
                stateChanges: this.getStateAsMap(state),
                binaryChanges: this.translateToBinaryChanges(state, context.block.timestamp),
                auditLog: audit?.finish(true, gas.used),
            };
        } catch (e: any) {
            state.rollback();
            return {
                success: false,
                events: events.getEvents(),
                gasUsed: gas.used,
                error: { type: 'runtime', message: e.message },
                instructionsExecuted: 0,
                stateChanges: new Map(),
                binaryChanges: [],
                auditLog: audit?.finish(false, gas.used, e.message),
            };
        }
    }

    private buildErrorResult(
        vmError: VMError,
        gasUsed: bigint,
        instructionsExecuted: number,
        events: readonly EmittedEvent[],
        auditLog?: AuditLog
    ): ExecutionResult {
        let errorType: ExecutionError['type'] = 'runtime';
        if (vmError instanceof RequireError) {
            errorType = 'require';
        } else if (vmError instanceof EnsureError) {
            errorType = 'ensure';
        } else if (vmError.message.includes('not found')) {
            errorType = 'not_found';
        }

        const error: ExecutionError = {
            type: errorType,
            message: vmError.message,
        };
        if (vmError.instruction !== undefined) {
            error.instruction = vmError.instruction;
        }

        return {
            success: false,
            events,
            gasUsed,
            error,
            instructionsExecuted,
            stateChanges: new Map(),
            binaryChanges: [],
            auditLog,
        };
    }

    private cloneState(
        state: Map<string, Map<string, Value>>
    ): Map<string, Map<string, Value>> {
        const clone = new Map<string, Map<string, Value>>();
        for (const [entity, values] of state) {
            clone.set(entity, new Map(values));
        }
        return clone;
    }

    private getStateAsMap(
        journal: StateJournal
    ): Map<string, Map<string, Value>> {
        const result = new Map<string, Map<string, Value>>();
        for (const [entity, values] of journal.getState()) {
            result.set(entity, new Map(values));
        }
        return result;
    }

    /**
     * Decodes a transaction payload into VM Values.
     * Expects a CBOR-encoded array of runtime values.
     */
    static decodeArguments(payload: Uint8Array): Value[] {
        const raw = decode(payload);
        if (!Array.isArray(raw)) {
            // If it's not an array, maybe it's a single value or empty
            if (raw === undefined || raw === null) return [];
            // If it's a single value, wrap it in an array for restoreFromDecoding
            return [restoreFromDecoding(raw)];
        }
        // If it's an array of encoded values (nested structure)
        return raw.map(r => restoreFromDecoding(r));
    }

    /**
     * Encodes VM Values into a transaction payload.
     */
    static encodeArguments(args: Value[]): Uint8Array {
        return encode(args.map(a => prepareForEncoding(a)));
    }

    private translateToBinaryChanges(journal: StateJournal, timestamp: bigint): StateChange[] {
        const changes: StateChange[] = [];
        const entries = journal.getEntries();
        const encoder = new TextEncoder();

        for (const entry of entries) {
            // Map entity key to 32-byte ID
            // If the key is a hex address, we use that.
            // Otherwise we hash the string representation.
            let id: Uint8Array;
            if (entry.key.startsWith('0x') && entry.key.length === 66) {
                id = hexToBytes32(entry.key);
            } else {
                id = sha256(encoder.encode(entry.key));
            }

            const stateKey: StateKey = {
                namespace: entry.entityType,
                id: id as any,
            };

            if (entry.type === 'set') {
                const binaryValue: BinaryStateValue = {
                    data: encodeValue(entry.value),
                    lastModified: timestamp,
                    schema: {
                        moduleId: new Uint8Array(32) as any, // System Module (0x0...0)
                        schemaName: entry.entityType,
                        version: 1,
                    }
                };
                changes.push({ type: 'set', key: stateKey, value: binaryValue });
            } else {
                changes.push({ type: 'delete', key: stateKey });
            }
        }

        return changes;
    }
}

// ============================================================================
// Convenience
// ============================================================================

/**
 * Creates a TSP from an IR program
 */
export function createProcessor(
    program: IRProgram,
    options?: ProcessorOptions
): TransactionStateProcessor {
    return new TransactionStateProcessor(program, options);
}
