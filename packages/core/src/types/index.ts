/**
 * VERA Core Types - Public API
 */

// Primitives
export {
    type Bytes,
    type Bytes32,
    type Bytes64,
    type Address,
    type Fixed,
    toBytes32,
    toBytes64,
    toAddress,
    zeroBytes32,
    zeroAddress,
    isZeroAddress,
    concat,
    bytesEqual,
    bytesCompare,
    hexToBytes,
    bytesToHex,
    hexToBytes32,
    createFixed,
    toFixed,
    addFixed,
    subFixed,
    mulFixed,
    compareFixed,
} from './primitives.js';

// State
export {
    type SchemaRef,
    type StateKey,
    type StateValue,
    type StateChange,
    type ProofSibling,
    type MerkleProof,
    type StateQueryResult,
    type StateStore,
    createStateKey,
    encodeStateKey,
    compareStateKeys,
    stateKeysEqual,
} from './state.js';

// Transactions
export {
    type TransactionTypeRef,
    type Signature,
    type Transaction,
    type OrderedTransaction,
    type TransactionId,
    type BlockContext,
    type ExecutionContext,
    type Event,
    type AuditEntry,
    type SourceLocation,
    type ExecutionError,
    type ExecutionSuccess,
    type ExecutionFailure,
    type ExecutionResult,
    createTransactionTypeRef,
    getTransactionCaller,
    createExecutionError,
    ErrorCodes,
    type ErrorCode,
} from './transaction.js';

// Blocks
export {
    type ValidatorSignature,
    type Block,
    type BlockHeader,
    type FinalityProof,
    type FinalityStatus,
    type ValidatorInfo,
    type NetworkStatus,
} from './block.js';
