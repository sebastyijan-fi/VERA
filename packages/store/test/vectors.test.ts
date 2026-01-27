import { describe, it, expect } from 'vitest';
import { DiskMerkleTrie } from '../src/trie.js';
import { MemoryStore } from '../src/memory.js';
import {
    sha256,
    bytesToHex,
    hexToBytes,
    type Bytes32,
    type Transaction,
    zeroBytes32,
} from '@vera/core';

// Canonical "Golden Vectors" ensures that for a specific set of inputs,
// every VERA implementation produces the exact same Root hash.
// This is the "Interop Proof".

describe('Golden Vectors (Determinism)', () => {

    it('should reproduce genesis state root', async () => {
        const store = new MemoryStore();
        const trie = new DiskMerkleTrie(store);
        const { EMPTY_TREE_ROOT } = await import('@vera/core');

        // Root of empty trie is constant
        // 0x03bf... is the SHA-256 of the empty structure defined in core
        expect(bytesToHex(EMPTY_TREE_ROOT)).toBe('0x03bf54dc70cfb5e7db27be39ca1f38fa90d66314ad846078fc3d9045b5076a1d');
    });

    it('should compute deterministic root for simple transaction set', async () => {
        // Setup
        const store = new MemoryStore();
        const trie = new DiskMerkleTrie(store);
        const { EMPTY_TREE_ROOT } = await import('@vera/core');

        let root = EMPTY_TREE_ROOT;

        // 1. We manually simulate the effect of a "Deposit"
        const key = Buffer.from('state:veraregistry:0000000000000000000000000000000000000000000000000000000000000001', 'utf-8');
        const value = Buffer.from('{"balance":100}', 'utf-8');

        // Apply update
        const batch = store.batch();
        const cache = new Map();

        const keyHash = sha256(key);
        const valHash = sha256(value);

        root = await trie.update(root, keyHash, valHash, batch, cache);
        await batch.write();

        // The value below is the actual root produced by the Hexary Path-Compressed implementation.
        // If this changes, it's a regression (or intentional fork).
        const EXPECTED_ROOT_1 = '0xb404b30c8366187c180774e5ced0e3b3a65e4e5528d03f893803882c7b14e50b';

        expect(bytesToHex(root)).toBe(EXPECTED_ROOT_1);
    });

    // This test simulates the "Genesis -> Replay" requirement
    it('audit replay: recomputing root from log events matches expectation', async () => {
        const store = new MemoryStore();
        const trie = new DiskMerkleTrie(store);
        const { EMPTY_TREE_ROOT } = await import('@vera/core');
        let root = EMPTY_TREE_ROOT;
        const batch = store.batch();
        const cache = new Map();

        const transactions = [
            { key: 'A', value: '1' },
            { key: 'B', value: '2' },
            { key: 'A', value: '3' }, // Update A
        ];

        for (const tx of transactions) {
            const k = sha256(Buffer.from(tx.key));
            const v = sha256(Buffer.from(tx.value));
            root = await trie.update(root, k, v, batch, cache);
        }
        await batch.write();

        // The final root is the "Checkpoint"
        const checkpoint = bytesToHex(root);

        // --- AUDIT PHASE ---
        // An auditor takes the SAME transaction list and a fresh store
        const auditStore = new MemoryStore();
        const auditTrie = new DiskMerkleTrie(auditStore);
        let auditRoot = EMPTY_TREE_ROOT;
        const auditBatch = auditStore.batch();
        const auditCache = new Map();

        for (const tx of transactions) {
            const k = sha256(Buffer.from(tx.key));
            const v = sha256(Buffer.from(tx.value));
            auditRoot = await auditTrie.update(auditRoot, k, v, auditBatch, auditCache);
        }
        await auditBatch.write();

        // Must match exactly
        expect(bytesToHex(auditRoot)).toBe(checkpoint);
    });

    // M12: Byte-Identical Reconstruction (Determinism Knob)
    it('M12: Byte-Identical Reconstruction (Insertion Order Invariant)', async () => {
        const { EMPTY_TREE_ROOT } = await import('@vera/core');

        const txs = Array.from({ length: 50 }, (_, i) => ({
            key: sha256(Buffer.from(`key-${i}`)),
            value: sha256(Buffer.from(`value-${i}`))
        }));

        const computeRoot = async (list: typeof txs) => {
            const store = new MemoryStore();
            const trie = new DiskMerkleTrie(store);
            let r = EMPTY_TREE_ROOT;
            for (const tx of list) {
                const batch = store.batch();
                r = await trie.update(r, tx.key, tx.value, batch);
                await batch.write();
            }
            return bytesToHex(r);
        };

        const root1 = await computeRoot(txs);

        // 1. Repeat N times - must be identical
        for (let i = 0; i < 5; i++) {
            const rootN = await computeRoot(txs);
            expect(rootN).toBe(root1);
        }

        // 2. Reverse order - MUST be identical in a Merkle Trie
        const rootReverse = await computeRoot([...txs].reverse());
        expect(rootReverse).toBe(root1);

        // 3. Shuffled order - MUST be identical
        const rootShuffled = await computeRoot([...txs].sort(() => Math.random() - 0.5));
        expect(rootShuffled).toBe(root1);
    });
});
