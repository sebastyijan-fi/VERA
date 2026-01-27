import { describe, it, expect, beforeEach } from 'vitest';
import {
    toBytes32,
    EMPTY_TREE_ROOT,
    bytesToHex,
    verifyMerkleProof,
    sha256,
    hashStateValue,
} from '@vera/core';
import { MemoryStore } from '../src/memory.js';
import { DiskMerkleTrie } from '../src/trie.js';

describe('Proof Self-Containment (Sculpting)', () => {
    let store: MemoryStore;
    let trie: DiskMerkleTrie;

    beforeEach(() => {
        store = new MemoryStore();
        trie = new DiskMerkleTrie(store);
    });

    async function setupTrie() {
        let root = EMPTY_TREE_ROOT;
        const keys = [
            toBytes32(Buffer.from('key1'.padStart(32, '0'))),
            toBytes32(Buffer.from('key2'.padStart(32, '0'))),
            toBytes32(Buffer.from('abc1'.padStart(32, '0'))),
            toBytes32(Buffer.from('abc2'.padStart(32, '0'))),
        ];
        // The data (preimage) used for the trie
        const data = keys.map(k => Buffer.from(`data-for-${bytesToHex(k).slice(0, 8)}`));
        // The valueHash stored in the trie
        const values = data.map(d => hashStateValue(d));

        for (let i = 0; i < keys.length; i++) {
            root = await trie.update(root, keys[i], values[i]);
        }
        return { root, keys, values, data };
    }

    it('M1: Proofs must be self-contained (Context Independence)', async () => {
        const { root, keys, data } = await setupTrie();
        const proof = await trie.prove(root, keys[0]);

        // Verification must succeed using ONLY the proof object
        // We attach the data (preimage) like PersistentStateStore would
        (proof as any).value = data[0];

        const isValid = verifyMerkleProof(proof);
        expect(isValid).toBe(true);
    });

    it('M2: Proof for Key A must NOT verify Key B (Path Integrity)', async () => {
        const { root, keys, data } = await setupTrie();
        const proofA = await trie.prove(root, keys[0]);
        (proofA as any).value = data[0];

        // Attempting to verify Key B with Proof A (by swapping the key in the proof)
        (proofA as any).key = keys[1];
        const isValid = verifyMerkleProof(proofA);
        expect(isValid).toBe(false);
    });

    it('M3: Mangling proof nodes must cause failure (Tamper Resistance)', async () => {
        const { root, keys, data } = await setupTrie();
        const proof = await trie.prove(root, keys[0]);
        (proof as any).value = data[0];

        if (proof.trieProof!.nodes.length === 0) return;

        // Mangle a hash in a branch node within the proof
        const branchIdx = proof.trieProof!.nodes.findIndex(n => n.type === 'branch');
        if (branchIdx !== -1) {
            const node = (proof.trieProof!.nodes[branchIdx] as any);
            const childIdx = (node.childIndex + 1) % 16;
            if (node.children[childIdx]) {
                const mangledChild = new Uint8Array(node.children[childIdx]);
                mangledChild[0] ^= 0xFF;
                node.children[childIdx] = mangledChild;
            } else {
                node.children[childIdx] = toBytes32(new Uint8Array(32).fill(0xFF));
            }
        }

        const isValid = verifyMerkleProof(proof);
        expect(isValid).toBe(false);
    });

    it('M4: Dropping nodes must cause failure (Structure Integrity)', async () => {
        const { root, keys, data } = await setupTrie();
        const proof = await trie.prove(root, keys[2]); // key starting with 'abc' should have some path depth
        (proof as any).value = data[2];

        if (proof.trieProof!.nodes.length < 2) return;

        // Drop the last node
        const shortenedNodes = [...proof.trieProof!.nodes];
        shortenedNodes.pop();
        (proof.trieProof as any).nodes = shortenedNodes;

        const isValid = verifyMerkleProof(proof);
        expect(isValid).toBe(false);
    });

    it('M5: Non-membership proofs must also be robust', async () => {
        const { root } = await setupTrie();
        const missingKey = toBytes32(Buffer.from('nonexistent'.padStart(32, '0')));

        const proof = await trie.prove(root, missingKey);
        expect(proof.value).toBeNull();

        // Sculpting Goal: Support non-membership proofs
        const isValid = verifyMerkleProof(proof);
        expect(isValid).toBe(true); // Should be true once implemented

        // Tamper with the non-membership proof structure
        if (proof.trieProof!.nodes.length > 0) {
            const lastNode = (proof.trieProof!.nodes[proof.trieProof!.nodes.length - 1] as any);
            if (lastNode.type === 'leaf') {
                const mangled = new Uint8Array(lastNode.path);
                mangled[0] ^= 0xFF;
                lastNode.path = mangled;
            } else if (lastNode.type === 'branch') {
                lastNode.childIndex = (lastNode.childIndex + 1) % 16;
            } else if (lastNode.type === 'extension') {
                const mangled = new Uint8Array(lastNode.prefix);
                mangled[0] ^= 0xFF;
                lastNode.prefix = mangled;
            }
        }

        expect(verifyMerkleProof(proof)).toBe(false);
    });

    it('M11: Value Integrity (Preimage Commitment)', async () => {
        const { root, keys, data } = await setupTrie();
        const proof = await trie.prove(root, keys[0]);
        (proof as any).value = new Uint8Array(data[0]);

        expect(verifyMerkleProof(proof)).toBe(true);

        // Mangle the value (preimage)
        (proof.value as Uint8Array)[0] ^= 0xFF;

        expect(verifyMerkleProof(proof)).toBe(false);
    });
});
