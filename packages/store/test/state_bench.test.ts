
import { describe, it, expect } from 'vitest';
import { MemoryStore, PersistentStateStore, DiskMerkleTrie } from '../src/index.js';
import {
    generateKeyPair,
    toBytes32,
    EMPTY_TREE_ROOT,
    type StateKey,
    type StateChange,
    sha256
} from '@vera/core';

describe('Performance: State Store Updates', () => {

    const count = 1000;
    const keyPair = generateKeyPair();

    it('should measure iterative update performance (Baseline)', async () => {
        const store = new MemoryStore();
        const stateStore = new PersistentStateStore(store, { now: () => Date.now() });

        const changes: StateChange[] = [];
        for (let i = 0; i < count; i++) {
            const key: StateKey = {
                namespace: 'Account',
                id: toBytes32(new Uint8Array(32).fill(i % 256))
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

        const start = Date.now();
        // Currently PersistentStateStore.apply processes all changes in one batch, 
        // but it calls trie.update iteratively for each one.
        await stateStore.apply(changes, 1n);
        const end = Date.now();

        const duration = end - start;
        const tps = (count / (duration / 1000)).toFixed(2);
        console.log(`State Apply (${count} items): ${duration}ms (${tps} changes/sec)`);
    }, 60000);
});
