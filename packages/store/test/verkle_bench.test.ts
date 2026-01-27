
import { describe, it, expect } from 'vitest';
import { MemoryStore, PersistentStateStore, DiskMerkleTrie } from '../src/index.js';
import {
    generateKeyPair,
    toBytes32,
    EMPTY_TREE_ROOT,
    type StateKey,
    type StateChange,
    sha256,
    MerkleCommitmentScheme,
    SimulatedIPACommitmentScheme
} from '@vera/core';

describe('Performance: Verkle vs Hexary', () => {

    const count = 500;

    const generateChanges = (n: number) => {
        const changes: StateChange[] = [];
        for (let i = 0; i < n; i++) {
            const key: StateKey = {
                namespace: 'Account',
                id: sha256(new Uint8Array([i % 256, Math.floor(i / 256)]))
            };
            changes.push({
                type: 'set',
                key,
                value: {
                    data: new Uint8Array([i % 256]),
                    lastModified: BigInt(Date.now()),
                    schema: { moduleId: new Uint8Array(32) as any, schemaName: 'Account', version: 1 }
                }
            });
        }
        return changes;
    };

    it('should measure Hexary (16-ary) performance', async () => {
        const store = new MemoryStore();
        const trie = new DiskMerkleTrie(store, new MerkleCommitmentScheme());
        const stateStore = new (PersistentStateStore as any)(store, { now: () => Date.now() });
        (stateStore as any).trie = trie;

        const changes = generateChanges(count);

        const start = Date.now();
        await stateStore.apply(changes, 1n);
        const end = Date.now();

        console.log(`Hexary (${count} items): ${end - start}ms`);
    });

    it('should measure Verkle (256-ary) performance', async () => {
        const store = new MemoryStore();
        const trie = new DiskMerkleTrie(store, new SimulatedIPACommitmentScheme());
        const stateStore = new (PersistentStateStore as any)(store, { now: () => Date.now() });
        (stateStore as any).trie = trie;

        const changes = generateChanges(count);

        const start = Date.now();
        await stateStore.apply(changes, 1n);
        const end = Date.now();

        console.log(`Verkle (${count} items): ${end - start}ms`);
    });
});
