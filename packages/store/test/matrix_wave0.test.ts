
import { describe, it, expect, beforeEach } from 'vitest';
import { MemoryStore, PersistentStateStore } from '../src/index.js';
import {
    createStateKey,
    toBytes32,
    serializeStateValue,
    EMPTY_TREE_ROOT,
    bytesToHex
} from '@vera/core';

describe('Wave 0: Store & Determinism Quick Wins', () => {
    let memoryStore: MemoryStore;

    beforeEach(() => {
        memoryStore = new MemoryStore();
    });

    describe('D2: Time Independence', () => {
        it('should produce identical roots regardless of clock time', async () => {
            const key = createStateKey('ns', toBytes32(new Uint8Array(32).fill(1)));
            const value = {
                data: new Uint8Array([1, 2, 3]),
                lastModified: 1n,
                schema: { moduleId: toBytes32(new Uint8Array(32)), schemaName: 'Test', version: 1 }
            };
            const changes = [{ type: 'set' as const, key, value }];

            // Run 1: 2020
            const clock2020 = { now: () => new Date('2020-01-01').getTime() };
            const store2020 = await PersistentStateStore.load(memoryStore, clock2020);
            const state2020 = await store2020.apply(changes, 1n);
            const root2020 = bytesToHex(state2020.root);

            // Clear memory store for a clean secondary run with the same substrate
            // Actually, let's use two different stores to be absolutely sure
            const memoryStore2 = new MemoryStore();

            // Run 2: 2030
            const clock2030 = { now: () => new Date('2030-01-01').getTime() };
            const store2030 = await PersistentStateStore.load(memoryStore2, clock2030);
            const state2030 = await store2030.apply(changes, 1n);
            const root2030 = bytesToHex(state2030.root);

            console.log(`[D2] Root 2020: ${root2020}`);
            console.log(`[D2] Root 2030: ${root2030}`);

            expect(root2020).toBe(root2030);
        });
    });

    describe('J3: Empty/Null Semantics in Store', () => {
        it('should handle empty byte arrays as values', async () => {
            const key = createStateKey('ns', toBytes32(new Uint8Array(32).fill(2)));
            const emptyValue = {
                data: new Uint8Array(0),
                lastModified: 1n,
                schema: { moduleId: toBytes32(new Uint8Array(32)), schemaName: 'Test', version: 1 }
            };

            const store = await PersistentStateStore.load(memoryStore);
            const state = await store.apply([{ type: 'set' as const, key, value: emptyValue }], 1n);

            const retrieved = await state.get(key);
            expect(retrieved?.data.length).toBe(0);
            expect(state.root).not.toEqual(EMPTY_TREE_ROOT);
        });

        it('should handle deletion and return to empty state if all keys removed', async () => {
            const key = createStateKey('ns', toBytes32(new Uint8Array(32).fill(3)));
            const value = {
                data: new Uint8Array([1]),
                lastModified: 1n,
                schema: { moduleId: toBytes32(new Uint8Array(32)), schemaName: 'Test', version: 1 }
            };

            let store = await PersistentStateStore.load(memoryStore);
            store = await store.apply([{ type: 'set' as const, key, value }], 1n) as PersistentStateStore;
            expect(store.root).not.toEqual(EMPTY_TREE_ROOT);

            store = await store.apply([{ type: 'delete' as const, key }], 2n) as PersistentStateStore;
            expect(store.root).toEqual(EMPTY_TREE_ROOT);
        });
    });
});
