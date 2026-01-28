/**
 * VERA Engine - Public API
 *
 * Transaction State Processor and related components.
 */

// Main processor
export {
    TransactionStateProcessor,
    createProcessor,
    type ExecutionResult,
    type ExecutionError,
    type ProcessorOptions,
} from './processor.js';

// VM
export * from './vm/index.js';

// Gas
export * from './gas/index.js';

// State
export * from './state/index.js';

// Events
export {
    EventEmitter,
    createEventEmitter,
    type EmittedEvent,
    type EventCollector,
} from './events.js';

// Audit
export {
    AuditLogger,
    createAuditLogger,
    type AuditEntry,
    type AuditLog,
} from './audit.js';

// Parallel Engine
export { ParallelExecutor } from './parallel/executor.js';
export { AsyncOptimisticExecutor, type AsyncExecutionStats } from './parallel/async_executor.js';
export { WorkerPool } from './parallel/pool.js';
