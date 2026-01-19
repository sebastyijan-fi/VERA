/**
 * State Store Tests
 */
import { describe, it, expect } from 'vitest';
import {
    InMemoryStateStore,
    createEmptyStateStore,
    createStateStore,
    createStateDiff,
    applyStateDiff,
} from '../src/state/store.js';
import {
    type StateKey,
    type StateValue,
    type StateChange,
    createStateKey,
} from '../src/types/state.js';
import { toBytes32, bytesEqual, zeroBytes32 } from '../src/types/primitives.js';
import { EMPTY_TREE_ROOT, sha256 } from '../src/crypto/hash.js';

function createTestKey(namespace: string, id: string): StateKey {
    const idBytes = sha256(new TextEncoder().encode(id));
    return createStateKey(namespace, idBytes);
}

function createTestValue(data: string, version: bigint = 0n): StateValue {
    return {
        data: new TextEncoder().encode(data),
        lastModified: version,
        schema: {
            moduleId: zeroBytes32(),
            schemaName: 'Test',
            version: 1,
        },
    };
}

describe('InMemoryStateStore', () => {
    it('empty store has empty tree root', () => {
        const store = createEmptyStateStore();
        expect(bytesEqual(store.root, EMPTY_TREE_ROOT)).toBe(true);
        expect(store.version).toBe(0n);
        expect(store.size()).toBe(0);
    });

    it('get returns null for non-existent key', () => {
        const store = createEmptyStateStore();
        const key = createTestKey('test', 'nonexistent');
        expect(store.get(key)).toBeNull();
    });

    it('has returns false for non-existent key', () => {
        const store = createEmptyStateStore();
        const key = createTestKey('test', 'nonexistent');
        expect(store.has(key)).toBe(false);
    });

    it('apply creates new store with changes', () => {
        const store1 = createEmptyStateStore();
        const key = createTestKey('accounts', 'alice');
        const value = createTestValue('balance: 100');

        const change: StateChange = { type: 'set', key, value };
        const store2 = store1.apply([change], 1n);

        // Original unchanged
        expect(store1.get(key)).toBeNull();
        expect(store1.version).toBe(0n);

        // New store has value
        expect(store2.get(key)).not.toBeNull();
        expect(store2.version).toBe(1n);
        expect(store2.size()).toBe(1);
    });

    it('apply handles multiple changes', () => {
        const store1 = createEmptyStateStore();

        const changes: StateChange[] = [
            { type: 'set', key: createTestKey('a', '1'), value: createTestValue('v1') },
            { type: 'set', key: createTestKey('a', '2'), value: createTestValue('v2') },
            { type: 'set', key: createTestKey('b', '1'), value: createTestValue('v3') },
        ];

        const store2 = store1.apply(changes, 1n);

        expect(store2.size()).toBe(3);
        expect(store2.has(createTestKey('a', '1'))).toBe(true);
        expect(store2.has(createTestKey('a', '2'))).toBe(true);
        expect(store2.has(createTestKey('b', '1'))).toBe(true);
    });

    it('apply handles delete changes', () => {
        const key = createTestKey('test', 'key');
        const value = createTestValue('data');

        const store1 = createEmptyStateStore()
            .apply([{ type: 'set', key, value }], 1n);

        expect(store1.has(key)).toBe(true);

        const store2 = store1.apply([{ type: 'delete', key }], 2n);

        expect(store2.has(key)).toBe(false);
        expect(store2.size()).toBe(0);
    });

    it('root changes when state changes', () => {
        const store1 = createEmptyStateStore();

        const change: StateChange = {
            type: 'set',
            key: createTestKey('test', 'key'),
            value: createTestValue('value'),
        };

        const store2 = store1.apply([change], 1n);

        expect(bytesEqual(store1.root, store2.root)).toBe(false);
    });

    it('same changes produce same root', () => {
        const change: StateChange = {
            type: 'set',
            key: createTestKey('test', 'key'),
            value: createTestValue('value', 1n),
        };

        const store1 = createEmptyStateStore().apply([change], 1n);
        const store2 = createEmptyStateStore().apply([change], 1n);

        expect(bytesEqual(store1.root, store2.root)).toBe(true);
    });

    it('getWithProof returns value and proof', () => {
        const key = createTestKey('test', 'key');
        const value = createTestValue('data');

        const store = createEmptyStateStore()
            .apply([{ type: 'set', key, value }], 1n);

        const result = store.getWithProof(key);

        expect(result.value).not.toBeNull();
        expect(result.proof).toBeDefined();
        expect(bytesEqual(result.proof.root, store.root)).toBe(true);
    });
});

describe('State Diff', () => {
    it('createStateDiff captures state transition', () => {
        const key = createTestKey('test', 'key');
        const value = createTestValue('data');
        const changes: StateChange[] = [{ type: 'set', key, value }];

        const from = createEmptyStateStore();
        const to = from.apply(changes, 1n);

        const diff = createStateDiff(from, to, changes);

        expect(bytesEqual(diff.fromRoot, from.root)).toBe(true);
        expect(bytesEqual(diff.toRoot, to.root)).toBe(true);
        expect(diff.fromVersion).toBe(0n);
        expect(diff.toVersion).toBe(1n);
        expect(diff.changes.length).toBe(1);
    });

    it('applyStateDiff produces correct state', () => {
        const key = createTestKey('test', 'key');
        const value = createTestValue('data');
        const changes: StateChange[] = [{ type: 'set', key, value }];

        const original = createEmptyStateStore();
        const expected = original.apply(changes, 1n);

        const diff = createStateDiff(original, expected, changes);
        const result = applyStateDiff(original, diff);

        expect(bytesEqual(result.root, expected.root)).toBe(true);
        expect(result.version).toBe(expected.version);
    });

    it('applyStateDiff rejects mismatched root', () => {
        const changes: StateChange[] = [
            { type: 'set', key: createTestKey('t', 'k'), value: createTestValue('v') },
        ];

        const store1 = createEmptyStateStore();
        const store2 = store1.apply(changes, 1n);
        const diff = createStateDiff(store1, store2, changes);

        // Try to apply to wrong starting state
        const wrongStore = store2;

        expect(() => applyStateDiff(wrongStore, diff)).toThrow('State root mismatch');
    });
});

describe('Determinism', () => {
    it('same operations in same order produce identical state', () => {
        const operations = [
            { type: 'set' as const, key: createTestKey('a', '1'), value: createTestValue('v1') },
            { type: 'set' as const, key: createTestKey('b', '2'), value: createTestValue('v2') },
            { type: 'set' as const, key: createTestKey('a', '3'), value: createTestValue('v3') },
        ];

        const store1 = createEmptyStateStore().apply(operations, 1n);
        const store2 = createEmptyStateStore().apply(operations, 1n);

        expect(bytesEqual(store1.root, store2.root)).toBe(true);
        expect(store1.size()).toBe(store2.size());
    });
});
