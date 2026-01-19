import { describe, it, expect, beforeEach } from 'vitest';
import { MemoryStore } from '../src/memory.js';
import { PersistentStateStore } from '../src/persistent.js';
import { bytesToHex, zeroBytes32, sha256 } from '@vera/core';

describe('Store Completeness', () => {
    let memory: MemoryStore;
    let store: PersistentStateStore;

    const mkKey = (name: string) => ({
        namespace: 'test',
        id: sha256(new TextEncoder().encode(name))
    });

    const mkVal = (v: number) => ({
        data: new Uint8Array([v]),
        lastModified: 1n,
        schema: { moduleId: zeroBytes32(), schemaName: 'u64', version: 1 }
    });

    beforeEach(async () => {
        memory = new MemoryStore();
        store = await PersistentStateStore.load(memory);
    });

    it('should track size correctly', async () => {
        expect(await store.size()).toBe(0);

        // Add some keys
        const store2 = await store.apply([
            { type: 'set', key: mkKey('a'), value: mkVal(1) },
            { type: 'set', key: mkKey('b'), value: mkVal(2) },
        ], 1n);

        expect(await store2.size()).toBe(2);

        // Update existing key
        const store3 = await store2.apply([
            { type: 'set', key: mkKey('a'), value: mkVal(3) },
        ], 2n);
        expect(await store3.size()).toBe(2);

        // Delete key
        const store4 = await store3.apply([
            { type: 'delete', key: mkKey('b') },
        ], 3n);
        expect(await store4.size()).toBe(1);

        // Delete same key again (should not decrement)
        const store5 = await store4.apply([
            { type: 'delete', key: mkKey('b') },
        ], 4n);
        expect(await store5.size()).toBe(1);
    });

    it('should update Merkle root on deletion', async () => {
        const root0 = store.root;

        const store1 = await store.apply([
            { type: 'set', key: mkKey('test'), value: mkVal(1) },
        ], 1n);
        const root1 = store1.root;
        expect(bytesToHex(root1)).not.toBe(bytesToHex(root0));

        // Delete the key
        const store2 = await store1.apply([
            { type: 'delete', key: mkKey('test') },
        ], 2n);
        const root2 = store2.root;

        // In a perfect trie, root2 should be back to root0 (empty tree)
        expect(bytesToHex(root2)).toBe(bytesToHex(root0));
    });

    it('should generate verifiable Merkle proofs', async () => {
        const key = mkKey('test-proof');
        const val = mkVal(42);

        const store1 = await store.apply([
            { type: 'set', key, value: val },
        ], 1n);

        const result = await store1.getWithProof(key);
        expect(result.value).not.toBeNull();

        // Verify using core utility
        const { verifyMerkleProof } = await import('@vera/core');
        const isValid = verifyMerkleProof(result.proof);
        expect(isValid).toBe(true);
    });

    it('should persist size across restarts', async () => {
        await store.apply([
            { type: 'set', key: mkKey('a'), value: mkVal(1) },
            { type: 'set', key: mkKey('b'), value: mkVal(2) },
        ], 1n);

        // Reload store from same memory
        const reloaded = await PersistentStateStore.load(memory);
        expect(await reloaded.size()).toBe(2);
    });
});
