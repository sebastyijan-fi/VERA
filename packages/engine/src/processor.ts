/**
 * VERA Transaction State Processor
 *
 * Main orchestrator for executing transactions.
 */

import type { IRProgram } from '@vera/dsl';
import { VirtualMachine, VMError, RequireError, EnsureError } from './vm/index.js';
import type { Value } from './vm/value.js';
import { GasMeter, OutOfGasError } from './gas/index.js';
import { StateJournal, createExecutionContext, type BlockContext } from './state/index.js';
import { EventEmitter, type EmittedEvent } from './events.js';
import { AuditLogger, type AuditLog } from './audit.js';

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
    execute(
        functionName: string,
        args: Value[],
        caller: string,
        block?: Partial<BlockContext>
    ): ExecutionResult {
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

        // Start audit if enabled
        audit?.start(functionName);

        try {
            // Execute via VM
            const vm = new VirtualMachine(this.program);
            const result = vm.execute(functionName, args, context, gas);

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
                    auditLog: audit?.finish(false, gas.used, e.message),
                };
            }

            throw e;
        }
    }

    /**
     * Validates a transaction without committing
     */
    validate(
        functionName: string,
        args: Value[],
        caller: string,
        block?: Partial<BlockContext>
    ): { valid: boolean; gasEstimate: bigint; error?: string | undefined } {
        const result = this.execute(functionName, args, caller, block);
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
