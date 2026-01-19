
import { describe, it, expect, beforeEach } from 'vitest';
import { MemoryStore } from '../src/memory.js';

describe('MemoryStore', () => {
    let store: MemoryStore;

    beforeEach(async () => {
        store = new MemoryStore();
    });

    describe('put/get/del', () => {
        it('should put and get a value', async () => {
            const key = new Uint8Array([1, 2, 3]);
            const value = new Uint8Array([4, 5, 6]);

            await store.put(key, value);
            const retrieved = await store.get(key);

            expect(retrieved).toEqual(value);
        });

        it('should return undefined for non-existent key', async () => {
            const key = new Uint8Array([1, 2, 3]);
            const retrieved = await store.get(key);
            expect(retrieved).toBeUndefined();
        });

        it('should delete a key', async () => {
            const key = new Uint8Array([1, 2, 3]);
            const value = new Uint8Array([4, 5, 6]);

            await store.put(key, value);
            await store.del(key);
            const retrieved = await store.get(key);

            expect(retrieved).toBeUndefined();
        });

        it('should handle string keys', async () => {
            await store.put('foo', new Uint8Array([1]));
            const val = await store.get('foo');
            expect(val).toEqual(new Uint8Array([1]));
        });
    });

    describe('batch', () => {
        it('should perform atomic writes', async () => {
            const batch = store.batch();
            batch.put('a', new Uint8Array([1]));
            batch.put('b', new Uint8Array([2]));
            batch.del('c'); // 'c' doesn't exist, should happen cleanly

            // Not written yet
            expect(await store.get('a')).toBeUndefined();

            await batch.write();

            expect(await store.get('a')).toEqual(new Uint8Array([1]));
            expect(await store.get('b')).toEqual(new Uint8Array([2]));
        });
    });

    describe('iterator', () => {
        beforeEach(async () => {
            await store.put('a', new Uint8Array([1]));
            await store.put('b', new Uint8Array([2]));
            await store.put('c', new Uint8Array([3]));
        });

        it('should iterate all entries', async () => {
            const iter = store.iterator();
            const entries = await iter.all();

            expect(entries.length).toBe(3);
            expect(entries[0][0]).toBe('a');
            expect(entries[1][0]).toBe('b');
            expect(entries[2][0]).toBe('c');
        });

        it('should respect limits', async () => {
            const iter = store.iterator({ limit: 2 });
            const entries = await iter.all();
            expect(entries.length).toBe(2);
            expect(entries[0][0]).toBe('a');
        });

        it('should iterate in reverse', async () => {
            const iter = store.iterator({ reverse: true });
            const entries = await iter.all();

            expect(entries[0][0]).toBe('c');
            expect(entries[1][0]).toBe('b');
            expect(entries[2][0]).toBe('a');
        });

        it('should filter ranges', async () => {
            const iter = store.iterator({ gt: 'a', lte: 'c' });
            const entries = await iter.all();

            // > 'a' and <= 'c' means 'b', 'c'
            expect(entries.length).toBe(2);
            expect(entries[0][0]).toBe('b');
            expect(entries[1][0]).toBe('c');
        });
    });
});
