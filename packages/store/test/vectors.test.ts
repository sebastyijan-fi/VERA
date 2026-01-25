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

        // The value below is the actual root produced by the current implementation (SHA256 path compressed).
        // If this changes, it's a regression (or intentional fork).
        const EXPECTED_ROOT_1 = '0x919390fd1c71e32d647e940f484b3e9919abcbf38bfbcb25be70f13c20162e9d';

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
});
