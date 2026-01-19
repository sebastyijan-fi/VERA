/**
 * VERA Ordering Layer - Public API
 */

// Types
export {
    type SequenceNumber,
    type FinalityState,
    type RawTransaction,
    type OrderedTransaction,
    type SubmitResult,
    type SequencerInfo,
    type SequencerStatus,
    type TransactionCallback,
    type FinalityCallback,
    type Subscription,
    createRawTransaction,
} from './types.js';

// Sequencer interface
export {
    type Sequencer,
    SequencerError,
    DuplicateTransactionError,
    SequencerNotActiveError,
    SequenceNotFoundError,
} from './sequencer.js';

// SingleSequencer implementation
export {
    SingleSequencer,
    createSingleSequencer,
    type SingleSequencerConfig,
} from './single.js';

// Transaction pool
export {
    TransactionPool,
    createPool,
    type PoolConfig,
} from './pool.js';

// Finality tracker
export {
    FinalityTracker,
    createFinalityTracker,
    type FinalityConfig,
} from './finality.js';
