/**
 * VERA State - Public API
 */

export {
    type BlockContext,
    type StateAccessor,
    type ExecutionContext,
    type ExecutionContextOptions,
    createExecutionContext,
} from './context.js';

export {
    type JournalEntry,
    StateJournal,
    createStateJournal,
    type AccessSet,
} from './journal.js';
