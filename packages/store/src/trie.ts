/**
 * VERA Disk-Backed Merkle Trie
 *
 * Implements a Binary Merkle Trie with path compression (simulated by Leaves containing full keys).
 * Suitable for persistent storage using the Store interface.
 */

import {
    type Bytes32,
    bytesEqual,
    bytesToHex,
    hashMerkleInternal,
    hashMerkleLeaf,
    EMPTY_TREE_ROOT,
    type MerkleProof,
    type ProofSibling,
} from '@vera/core';
import { encode, decode } from 'cbor-x';
import type { Store, Batch } from './types.js';

// ============================================================================
// Node Types
// ============================================================================

export type TrieNode = DiskLeafNode | DiskBranchNode;

export interface DiskLeafNode {
    type: 'leaf';
    key: Uint8Array;      // Full Key (hashed path)
    valueHash: Bytes32;
    hash: Bytes32;   // Cached hash
}

export interface DiskBranchNode {
    type: 'branch';
    left: Bytes32;   // Hash of left child
    right: Bytes32;  // Hash of right child
    hash: Bytes32;   // Cached hash
}

// ============================================================================
// Serialization
// ============================================================================

function encodeNode(node: TrieNode): Uint8Array {
    if (node.type === 'leaf') {
        return encode([0, node.key, node.valueHash]);
    } else {
        return encode([1, node.left, node.right]);
    }
}

function decodeNode(data: Uint8Array, hash: Bytes32): TrieNode {
    const decoded = decode(data) as any[];
    if (decoded[0] === 0) {
        return {
            type: 'leaf',
            key: decoded[1],
            valueHash: decoded[2],
            hash,
        };
    } else {
        return {
            type: 'branch',
            left: decoded[1],
            right: decoded[2],
            hash,
        };
    }
}

// ============================================================================
// Trie Implementation
// ============================================================================

export class DiskMerkleTrie {
    constructor(private readonly store: Store) { }
    /**
     * Gets a value hash from the trie
     */
    async get(root: Bytes32, key: Bytes32, cache?: Map<string, TrieNode>): Promise<Bytes32 | null> {
        if (bytesEqual(root, EMPTY_TREE_ROOT)) {
            return null;
        }

        let currentHash = root;
        let depth = 0;

        while (!bytesEqual(currentHash, EMPTY_TREE_ROOT)) {
            const node = await this.getNode(currentHash, cache);
            if (!node) return null;

            if (node.type === 'leaf') {
                return bytesEqual(node.key, key) ? node.valueHash : null;
            }

            const bit = this.getBit(key, depth);
            currentHash = bit === 0 ? node.left : node.right;
            depth++;
        }

        return null;
    }

    /**
     * Updates a value in the trie. Returns the new root.
     */
    async update(root: Bytes32, key: Bytes32, valueHash: Bytes32, batch?: Batch, cache?: Map<string, TrieNode>): Promise<Bytes32> {
        if (bytesEqual(valueHash, EMPTY_TREE_ROOT)) {
            return this.delete(root, key, batch, cache);
        }
        return this.updateRecursive(root, key, valueHash, 0, batch, cache);
    }

    /**
     * Deletes a key from the trie
     */
    async delete(root: Bytes32, key: Bytes32, batch?: Batch, cache?: Map<string, TrieNode>): Promise<Bytes32> {
        return this.deleteRecursive(root, key, 0, batch, cache);
    }

    /**
     * Proves existence/membership
     */
    async prove(root: Bytes32, key: Bytes32): Promise<MerkleProof> {
        const valueHash = await this.get(root, key);
        const siblings: ProofSibling[] = [];

        let currentHash = root;
        let depth = 0;

        while (!bytesEqual(currentHash, EMPTY_TREE_ROOT)) {
            const node = await this.getNode(currentHash);
            if (!node) break;

            if (node.type === 'leaf') {
                break;
            }

            const bit = this.getBit(key, depth);
            const siblingHash = bit === 0 ? node.right : node.left;
            siblings.push({
                hash: siblingHash,
                position: bit === 0 ? 'right' : 'left'
            });

            currentHash = bit === 0 ? node.left : node.right;
            depth++;
        }

        siblings.reverse();

        return {
            key,
            value: valueHash ? new Uint8Array(0) : null,
            siblings,
            root
        };
    }

    /**
     * Prunes unreachable nodes from the store, keeping only those reachable from given root.
     * Returns the number of pruned nodes.
     */
    async prune(root: Bytes32): Promise<number> {
        const reachable = new Set<string>();
        await this.collectReachable(root, reachable);

        let deleted = 0;
        // Iterate over all trie nodes in the store
        // prefix 'trie:' follows 'trie.', so we use 'trie;' as upper bound
        const iterator = this.store.iterator({ gte: 'trie:', lt: 'trie;' });
        try {
            while (true) {
                const entry = await iterator.next();
                if (!entry) break;
                const key = entry[0] as string;
                if (!key.startsWith('trie:')) continue;

                const hashHex = key.slice(5);
                if (!reachable.has(hashHex)) {
                    await this.store.del(key);
                    deleted++;
                }
            }
        } finally {
            await iterator.end();
        }
        return deleted;
    }

    private async collectReachable(hash: Bytes32, reachable: Set<string>): Promise<void> {
        if (bytesEqual(hash, EMPTY_TREE_ROOT)) return;
        const hashHex = bytesToHex(hash);
        if (reachable.has(hashHex)) return;
        reachable.add(hashHex);

        const node = await this.getNode(hash);
        if (node && node.type === 'branch') {
            await this.collectReachable(node.left, reachable);
            await this.collectReachable(node.right, reachable);
        }
    }

    // ========================================================================
    // Private Helpers
    // ========================================================================

    private async updateRecursive(
        nodeHash: Bytes32,
        key: Bytes32,
        valueHash: Bytes32,
        depth: number,
        batch?: Batch,
        cache?: Map<string, TrieNode>
    ): Promise<Bytes32> {
        if (bytesEqual(nodeHash, EMPTY_TREE_ROOT)) {
            return this.createLeaf(key, valueHash, batch, cache);
        }

        const node = await this.getNode(nodeHash, cache);
        if (!node) throw new Error(`Missing node ${bytesToHex(nodeHash)}`);

        if (node.type === 'leaf') {
            if (bytesEqual(node.key, key)) {
                return this.createLeaf(key, valueHash, batch, cache);
            }
            return this.splitLeaf(node, key, valueHash, depth, batch, cache);
        }

        const bit = this.getBit(key, depth);
        let left = node.left;
        let right = node.right;

        if (bit === 0) {
            left = await this.updateRecursive(left, key, valueHash, depth + 1, batch, cache);
        } else {
            right = await this.updateRecursive(right, key, valueHash, depth + 1, batch, cache);
        }

        return this.createBranch(left, right, batch, cache);
    }

    private async deleteRecursive(
        nodeHash: Bytes32,
        key: Bytes32,
        depth: number,
        batch?: Batch,
        cache?: Map<string, TrieNode>
    ): Promise<Bytes32> {
        if (bytesEqual(nodeHash, EMPTY_TREE_ROOT)) {
            return EMPTY_TREE_ROOT;
        }

        const node = await this.getNode(nodeHash, cache);
        if (!node) throw new Error(`Missing node ${bytesToHex(nodeHash)}`);

        if (node.type === 'leaf') {
            if (bytesEqual(node.key, key)) {
                return EMPTY_TREE_ROOT;
            }
            return nodeHash;
        }

        const bit = this.getBit(key, depth);
        let left = node.left;
        let right = node.right;

        if (bit === 0) {
            left = await this.deleteRecursive(left, key, depth + 1, batch, cache);
        } else {
            right = await this.deleteRecursive(right, key, depth + 1, batch, cache);
        }

        if (bytesEqual(left, EMPTY_TREE_ROOT) && bytesEqual(right, EMPTY_TREE_ROOT)) {
            return EMPTY_TREE_ROOT;
        }

        return this.createBranch(left, right, batch, cache);
    }

    private async splitLeaf(
        existingLeaf: DiskLeafNode,
        newKey: Bytes32,
        newValueHash: Bytes32,
        depth: number,
        batch?: Batch,
        cache?: Map<string, TrieNode>
    ): Promise<Bytes32> {
        const bit1 = this.getBit(existingLeaf.key, depth);
        const bit2 = this.getBit(newKey, depth);

        if (bit1 === bit2) {
            const child = await this.splitLeaf(existingLeaf, newKey, newValueHash, depth + 1, batch, cache);
            return this.createBranch(
                bit1 === 0 ? child : EMPTY_TREE_ROOT,
                bit1 === 1 ? child : EMPTY_TREE_ROOT,
                batch,
                cache
            );
        } else {
            const newLeafHash = await this.createLeaf(newKey, newValueHash, batch, cache);
            const left = bit1 === 0 ? existingLeaf.hash : newLeafHash;
            const right = bit1 === 0 ? newLeafHash : existingLeaf.hash;
            return this.createBranch(left, right, batch, cache);
        }
    }

    private async createLeaf(key: Bytes32, valueHash: Bytes32, batch?: Batch, cache?: Map<string, TrieNode>): Promise<Bytes32> {
        const hash = hashMerkleLeaf(key, valueHash);
        const node: DiskLeafNode = { type: 'leaf', key, valueHash, hash };
        await this.saveNode(node, batch, cache);
        return hash;
    }

    private async createBranch(left: Bytes32, right: Bytes32, batch?: Batch, cache?: Map<string, TrieNode>): Promise<Bytes32> {
        const hash = hashMerkleInternal(left, right);
        const node: DiskBranchNode = { type: 'branch', left, right, hash };
        await this.saveNode(node, batch, cache);
        return hash;
    }

    private async getNode(hash: Bytes32, cache?: Map<string, TrieNode>): Promise<TrieNode | undefined> {
        if (cache) {
            const cached = cache.get(bytesToHex(hash));
            if (cached) return cached;
        }
        const data = await this.store.get(this.nodeKey(hash));
        if (!data) return undefined;
        return decodeNode(data, hash);
    }

    private async saveNode(node: TrieNode, batch?: Batch, cache?: Map<string, TrieNode>): Promise<void> {
        if (cache) {
            cache.set(bytesToHex(node.hash), node);
        }
        const data = encodeNode(node);
        if (batch) {
            batch.put(this.nodeKey(node.hash), data);
        } else {
            await this.store.put(this.nodeKey(node.hash), data);
        }
    }

    private nodeKey(hash: Bytes32): string {
        return `trie:${bytesToHex(hash)}`;
    }

    private getBit(key: Uint8Array, depth: number): number {
        const byteIndex = Math.floor(depth / 8);
        const bitIndex = 7 - (depth % 8);
        if (byteIndex >= key.length) return 0;
        return (key[byteIndex]! >> bitIndex) & 1;
    }
}
