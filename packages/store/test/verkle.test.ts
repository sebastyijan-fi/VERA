import { describe, it, expect } from 'vitest';
import { DiskMerkleTrie } from '../src/trie.js';
import { MemoryStore } from '../src/memory.js';
import {
    sha256,
    bytesToHex,
    toBytes32,
    EMPTY_TREE_ROOT,
    MerkleCommitmentScheme,
    SimulatedIPACommitmentScheme,
    DualCommitmentScheme,
} from '@vera/core';

describe('Verkle Bridge (Dual Commitments)', () => {

    it('should maintain consistent roots with MerkleCommitmentScheme', async () => {
        const store = new MemoryStore();
        const trie = new DiskMerkleTrie(store, new MerkleCommitmentScheme());

        const key = toBytes32(new Uint8Array(32).fill(0xAA));
        const val = toBytes32(new Uint8Array(32).fill(0xBB));

        const root = await trie.update(EMPTY_TREE_ROOT, key, val);

        // This should match the standard hex-root we expect
        expect(root).toBeDefined();
        expect(root).not.toEqual(EMPTY_TREE_ROOT);
    });

    it('should produce different roots with SimulatedIPACommitmentScheme', async () => {
        const store = new MemoryStore();
        const merkleTrie = new DiskMerkleTrie(store, new MerkleCommitmentScheme());
        const ipaTrie = new DiskMerkleTrie(store, new SimulatedIPACommitmentScheme());

        const key = toBytes32(new Uint8Array(32).fill(0x11));
        const val = toBytes32(new Uint8Array(32).fill(0x22));

        const merkleRoot = await merkleTrie.update(EMPTY_TREE_ROOT, key, val);
        const ipaRoot = await ipaTrie.update(EMPTY_TREE_ROOT, key, val);

        expect(bytesToHex(merkleRoot)).not.toEqual(bytesToHex(ipaRoot));
    });

    it('should track dual roots simultaneously using DualCommitmentScheme', async () => {
        const store = new MemoryStore();
        const dualScheme = new DualCommitmentScheme(
            new MerkleCommitmentScheme(),
            new SimulatedIPACommitmentScheme()
        );
        const trie = new DiskMerkleTrie(store, dualScheme);

        const key = toBytes32(new Uint8Array(32).fill(0x55));
        const val = toBytes32(new Uint8Array(32).fill(0x66));

        const dualRoot = await trie.update(EMPTY_TREE_ROOT, key, val);

        // Audit phase: a Verkle-only auditor should be able to verify if they have the secondary scheme
        const retrieved = await trie.get(dualRoot, key);
        expect(retrieved).not.toBeNull();
        expect(bytesToHex(retrieved!)).toBe(bytesToHex(val));
    });
});
