/**
 * VERA State Module - Public API
 */

export {
    InMemoryStateStore,
    createEmptyStateStore,
    createStateStore,
    type StateDiff,
    createStateDiff,
    applyStateDiff,
    serializeStateValue,
    deserializeStateValue,
} from './store.js';
