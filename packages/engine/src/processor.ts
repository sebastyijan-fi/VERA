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
import { StateJournal, createExecutionContext, type BlockContext, type ExecutionContext, type AccessSet, type JournalEntry } from './state/index.js';
import { EventEmitter, type EmittedEvent } from './events.js';
import { AuditLogger, type AuditLog } from './audit.js';
import {
    decode,
    encode,
    type StateKey,
    type StateValue as BinaryStateValue,
    deriveStateId,
    hexToBytes32,
    type StateChange,
    type AsyncStateStore,
} from '@vera/core';

export interface PrefetchEntry {
    entityType: string;
    keys: string[]; // key strings (e.g. "i:123")
}

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
    /** Journal entries for applying changes */
    journalEntries?: JournalEntry[] | undefined;
    /** Audit log if enabled */
    auditLog?: AuditLog | undefined;
    /** Read/Write set for conflict detection */
    accessSet?: AccessSet | undefined;
}

/**
 * Execution error details
 */
export interface ExecutionError {
    type: 'require' | 'ensure' | 'out_of_gas' | 'runtime' | 'not_found';
    message: string;
    instruction?: number | undefined;
}

export interface ExecutionOptions {
    /** Whether to commit changes to state (default: true) */
    commit?: boolean;
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
    /** Persistent backing store for state loading */
    backingStore?: AsyncStateStore;
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
    private readonly state: Map<string, Map<string, Value>>;

    constructor(program: IRProgram, options: ProcessorOptions = {}) {
        this.program = program;
        this.options = {
            gasLimit: options.gasLimit ?? 1_000_000n,
            enableAudit: options.enableAudit ?? false,
            initialState: options.initialState ?? new Map(),
            backingStore: options.backingStore,
        } as any; // Cast needed because backingStore is optional but Required<T> makes it required??
        // Wait, Required<T> makes all properties required. backingStore | undefined is still required key.
        // I'll handle typing gracefully.

        // Initialize persistent state
        this.state = this.cloneState(this.options.initialState);
    }

    /**
     * Executes a transaction
     */
    async execute(
        functionName: string,
        args: Value[],
        caller: string,
        block?: Partial<BlockContext>,
        execOptions?: ExecutionOptions
    ): Promise<ExecutionResult> {
        // Set up components
        const gas = new GasMeter(this.options.gasLimit);
        // Use persistent state as backing store
        const state = new StateJournal(this.state, this.options.backingStore);
        const events = new EventEmitter();
        const audit = this.options.enableAudit ? new AuditLogger() : undefined;
        const shouldCommit = execOptions?.commit ?? true;

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
            return this.handleSystemTransaction(functionName, args, context, gas, state, events, audit, shouldCommit);
        }

        // Start audit if enabled
        audit?.start(functionName);

        try {
            // Execute via VM
            const vm = new VirtualMachine(this.program);
            const result = await vm.execute(functionName, args, context, gas);

            if (!result.success) {
                const accessSet = state.getAccessSet(); // Capture before rollback!

                // Rollback state on failure
                state.rollback();

                return this.buildErrorResult(
                    result.error!,
                    gas.used,
                    result.instructionsExecuted,
                    events.getEvents(),
                    audit?.finish(false, gas.used, result.error?.message),
                    accessSet
                );
            }

            const binaryChanges = this.translateToBinaryChanges(state, context.block.timestamp);
            const accessSet = state.getAccessSet();
            const journalEntries = [...state.getEntries()];

            // Commit state on success if requested
            if (shouldCommit) {
                state.commit();
            }

            return {
                success: true,
                returnValue: result.returnValue,
                events: events.getEvents(),
                gasUsed: gas.used,
                instructionsExecuted: result.instructionsExecuted,
                stateChanges: this.getStateAsMap(state),
                binaryChanges,
                journalEntries,
                auditLog: audit?.finish(true, gas.used),
                accessSet,
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
        const result = await this.execute(functionName, args, caller, block, { commit: false });
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
     * Returns a snapshot of the current state (underlying map).
     * Used for seeding worker threads.
     */
    getSnapshot(): Map<string, Map<string, Value>> {
        return this.state;
    }

    /**
     * Applies journal entries directly to the persistent state.
     * Used for committing results from parallel/optimistic execution.
     */
    applyJournal(entries: JournalEntry[]): void {
        for (const entry of entries) {
            if (entry.type === 'set') {
                let entityMap = this.state.get(entry.entityType);
                if (!entityMap) {
                    entityMap = new Map();
                    this.state.set(entry.entityType, entityMap);
                }
                entityMap.set(entry.key, entry.value);
            } else if (entry.type === 'delete') {
                this.state.get(entry.entityType)?.delete(entry.key);
            }
        }
    }

    /**
     * Prefetches state for access list (warming the cache)
     */
    async prefetch(accessList: PrefetchEntry[]): Promise<void> {
        if (!this.options.backingStore) return;

        const promises: Promise<void>[] = [];

        for (const entry of accessList) {
            let entityMap = this.state.get(entry.entityType);
            if (!entityMap) {
                entityMap = new Map();
                this.state.set(entry.entityType, entityMap);
            }
            const map = entityMap!;

            for (const keyStr of entry.keys) {
                if (map.has(keyStr)) continue; // Already in cache

                promises.push((async () => {
                    const id = deriveStateId(keyStr);
                    const stateKey: StateKey = {
                        namespace: entry.entityType,
                        id: id as any,
                    };
                    const val = await this.options.backingStore!.get(stateKey);
                    if (val) {
                        const decoded = restoreFromDecoding(val.data);
                        map.set(keyStr, decoded);
                    }
                })());
            }
        }

        await Promise.all(promises);
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
        audit?: AuditLogger,
        shouldCommit: boolean = true
    ): Promise<ExecutionResult> {
        audit?.start(functionName);

        try {
            switch (functionName) {
                case 'system_upgradeModule': {
                    // Persist upgraded Module IR to system state
                    if (args.length < 1) throw new Error('system_upgradeModule requires IR payload');
                    const irPayload = args[0]!;
                    if (irPayload.kind !== 'bytes') throw new Error('IR payload must be bytes');

                    // Store in reserved system namespace
                    await state.set('__system__:modules', stringValue(this.program.name), irPayload);
                    events.emit('GovernanceUpdate', stringValue(`Module ${this.program.name} upgraded`));
                    break;
                }
                default:
                    throw new Error(`Unknown system transaction: ${functionName}`);
            }

            const journalEntries = [...state.getEntries()];

            if (shouldCommit) {
                state.commit();
            }

            return {
                success: true,
                events: events.getEvents(),
                gasUsed: gas.used,
                instructionsExecuted: 1,
                stateChanges: this.getStateAsMap(state),
                binaryChanges: this.translateToBinaryChanges(state, context.block.timestamp),
                auditLog: audit?.finish(true, gas.used),
                accessSet: state.getAccessSet(),
                journalEntries,
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
                accessSet: state.getAccessSet(),
            };
        }
    }

    private buildErrorResult(
        vmError: VMError,
        gasUsed: bigint,
        instructionsExecuted: number,
        events: readonly EmittedEvent[],
        auditLog?: AuditLog,
        accessSet?: AccessSet
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
            accessSet,
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

        for (const entry of entries) {
            const id = deriveStateId(entry.key);

            const stateKey: StateKey = {
                namespace: entry.entityType,
                id: id as any,
            };

            if (entry.type === 'set') {
                const binaryValue: BinaryStateValue = {
                    data: encodeValue(entry.value),
                    lastModified: timestamp,
                    schema: {
                        moduleId: hexToBytes32(this.program.id),
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
