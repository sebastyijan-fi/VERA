/**
 * VERA Store - Public API
 */

export {
    type Key,
    type Value,
    type Store,
    type Batch,
    type StoreIterator,
    type IteratorOptions,
    type StoreOptions,
    StoreError,
} from './types.js';
export { MemoryStore } from './memory.js';
export { JsonStore } from './json.js';
export { SnapshotManager } from './snapshot.js';
export { LRUCache } from './cache.js';

// Stores
export { LevelDBStore } from './level.js';
export { PersistentStateStore } from './persistent.js';
export { DiskMerkleTrie } from './trie.js';

// Append-only / WAL-based storage
export { WriteAheadLog, RecordType, type WALRecord, type WALOptions, type CommitResult } from './wal.js';
export { AppendOnlyStore, type AppendOnlyStoreOptions } from './append.js';

// Binary commit log and snapshots
export { CommitLog, type CommitEntry, type CommitLogOptions } from './commitlog.js';
export { BinarySnapshotManager, type SnapshotHeader, type SnapshotEntry, type BinarySnapshotOptions } from './binarysnapshot.js';

// State diff compression
export {
    type StateDiff,
    type StateOp,
    type Checkpoint,
    computeDiff,
    applyDiff,
    cloneState,
    serializeDiff,
    deserializeDiff,
} from './state_diff.js';
