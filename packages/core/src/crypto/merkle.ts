/**
 * VERA Merkle Tree
 *
 * Binary Merkle tree with sorted leaves for deterministic ordering.
 * Supports both membership and non-membership proofs.
 */

import {
    type Bytes,
    type Bytes32,
    bytesCompare,
    bytesEqual,
} from '../types/primitives.js';
import { type MerkleProof, type ProofSibling } from '../types/state.js';
import {
    EMPTY_TREE_ROOT,
    hashMerkleInternal,
    hashMerkleLeaf,
    sha256,
} from './hash.js';

// ============================================================================
// Merkle Node Types
// ============================================================================

/**
 * Leaf node in the Merkle tree
 */
export interface LeafNode {
    readonly type: 'leaf';
    readonly key: Bytes;
    readonly valueHash: Bytes32;
    readonly hash: Bytes32;
}

/**
 * Internal node in the Merkle tree
 */
export interface InternalNode {
    readonly type: 'internal';
    readonly left: MerkleNode;
    readonly right: MerkleNode;
    readonly hash: Bytes32;
}

/**
 * Empty node (placeholder for balanced tree)
 */
export interface EmptyNode {
    readonly type: 'empty';
    readonly hash: Bytes32;
}

export type MerkleNode = LeafNode | InternalNode | EmptyNode;

// ============================================================================
// Node Construction
// ============================================================================

/**
 * Creates a leaf node
 */
export function createLeafNode(key: Bytes, valueHash: Bytes32): LeafNode {
    const hash = hashMerkleLeaf(key, valueHash);
    return { type: 'leaf', key, valueHash, hash };
}

/**
 * Creates an internal node from two children
 */
export function createInternalNode(left: MerkleNode, right: MerkleNode): InternalNode {
    const hash = hashMerkleInternal(left.hash, right.hash);
    return { type: 'internal', left, right, hash };
}

/**
 * Creates an empty node
 */
export function createEmptyNode(): EmptyNode {
    return { type: 'empty', hash: EMPTY_TREE_ROOT };
}

// ============================================================================
// Merkle Tree Class
// ============================================================================

/**
 * Entry in the Merkle tree
 */
export interface MerkleEntry {
    readonly key: Bytes;
    readonly value: Bytes;
}

/**
 * Immutable Merkle tree with sorted leaves
 */
export class MerkleTree {
    private readonly entries: Map<string, MerkleEntry>;
    private cachedRoot: Bytes32 | null = null;
    private cachedNode: MerkleNode | null = null;

    constructor(entries: readonly MerkleEntry[] = []) {
        this.entries = new Map();
        for (const entry of entries) {
            this.entries.set(this.keyToString(entry.key), entry);
        }
    }

    /**
     * Gets the root hash of the tree
     */
    get root(): Bytes32 {
        if (this.cachedRoot === null) {
            this.cachedNode = this.buildTree();
            this.cachedRoot = this.cachedNode.hash;
        }
        return this.cachedRoot;
    }

    /**
     * Gets the root node of the tree
     */
    get rootNode(): MerkleNode {
        if (this.cachedNode === null) {
            this.cachedNode = this.buildTree();
            this.cachedRoot = this.cachedNode.hash;
        }
        return this.cachedNode;
    }

    /**
     * Gets an entry by key
     */
    get(key: Bytes): Bytes | null {
        const entry = this.entries.get(this.keyToString(key));
        return entry?.value ?? null;
    }

    /**
     * Checks if a key exists
     */
    has(key: Bytes): boolean {
        return this.entries.has(this.keyToString(key));
    }

    /**
     * Returns a new tree with the entry added/updated
     */
    set(key: Bytes, value: Bytes): MerkleTree {
        const newEntries = Array.from(this.entries.values());
        const keyStr = this.keyToString(key);
        const existingIndex = newEntries.findIndex(
            (e) => this.keyToString(e.key) === keyStr
        );

        if (existingIndex >= 0) {
            newEntries[existingIndex] = { key, value };
        } else {
            newEntries.push({ key, value });
        }

        return new MerkleTree(newEntries);
    }

    /**
     * Returns a new tree with the entry removed
     */
    delete(key: Bytes): MerkleTree {
        const keyStr = this.keyToString(key);
        if (!this.entries.has(keyStr)) {
            return this;
        }

        const newEntries = Array.from(this.entries.values()).filter(
            (e) => this.keyToString(e.key) !== keyStr
        );

        return new MerkleTree(newEntries);
    }

    /**
     * Gets the number of entries
     */
    get size(): number {
        return this.entries.size;
    }

    /**
     * Generates a Merkle proof for a key
     */
    getProof(key: Bytes): MerkleProof {
        const value = this.get(key);
        const siblings = this.computeProofPath(key);

        return {
            key,
            value,
            siblings,
            root: this.root,
        };
    }

    /**
   * Gets all entries in sorted order
   */
    allEntries(): readonly MerkleEntry[] {
        return this.getSortedEntries();
    }

    // ============================================================================
    // Private Methods
    // ============================================================================

    private keyToString(key: Bytes): string {
        return Array.from(key)
            .map((b) => b.toString(16).padStart(2, '0'))
            .join('');
    }

    private getSortedEntries(): MerkleEntry[] {
        return Array.from(this.entries.values()).sort((a, b) =>
            bytesCompare(a.key, b.key)
        );
    }

    private buildTree(): MerkleNode {
        const sortedEntries = this.getSortedEntries();

        if (sortedEntries.length === 0) {
            return createEmptyNode();
        }

        // Create leaf nodes
        const leaves: MerkleNode[] = sortedEntries.map((entry) =>
            createLeafNode(entry.key, sha256(entry.value))
        );

        // Build tree bottom-up
        return this.buildTreeFromNodes(leaves);
    }

    private buildTreeFromNodes(nodes: MerkleNode[]): MerkleNode {
        if (nodes.length === 0) {
            return createEmptyNode();
        }

        if (nodes.length === 1) {
            return nodes[0]!;
        }

        // Pair up nodes
        const nextLevel: MerkleNode[] = [];

        for (let i = 0; i < nodes.length; i += 2) {
            const left = nodes[i]!;
            const right = nodes[i + 1] ?? createEmptyNode();
            nextLevel.push(createInternalNode(left, right));
        }

        return this.buildTreeFromNodes(nextLevel);
    }

    private computeProofPath(key: Bytes): ProofSibling[] {
        const sortedEntries = this.getSortedEntries();

        if (sortedEntries.length === 0) {
            return [];
        }

        // Find index of key (or where it would be)
        let targetIndex = sortedEntries.findIndex((e) => bytesEqual(e.key, key));

        if (targetIndex < 0) {
            // Key not found - for non-membership proof, find insertion point
            targetIndex = sortedEntries.findIndex((e) => bytesCompare(e.key, key) > 0);
            if (targetIndex < 0) {
                targetIndex = sortedEntries.length;
            }
        }

        // Build tree and collect siblings along the path
        const leaves: MerkleNode[] = sortedEntries.map((entry) =>
            createLeafNode(entry.key, sha256(entry.value))
        );

        return this.collectSiblings(leaves, targetIndex);
    }

    private collectSiblings(nodes: MerkleNode[], targetIndex: number): ProofSibling[] {
        if (nodes.length <= 1) {
            return [];
        }

        const siblings: ProofSibling[] = [];
        let currentNodes = nodes;
        let currentIndex = targetIndex;

        while (currentNodes.length > 1) {
            const isRightChild = currentIndex % 2 === 1;
            const siblingIndex = isRightChild ? currentIndex - 1 : currentIndex + 1;

            if (siblingIndex < currentNodes.length) {
                const siblingNode = currentNodes[siblingIndex]!;
                siblings.push({
                    hash: siblingNode.hash,
                    position: isRightChild ? 'left' : 'right',
                });
            } else {
                // Sibling doesn't exist (odd number of nodes)
                siblings.push({
                    hash: EMPTY_TREE_ROOT,
                    position: 'right',
                });
            }

            // Move to parent level
            const nextLevel: MerkleNode[] = [];
            for (let i = 0; i < currentNodes.length; i += 2) {
                const left = currentNodes[i]!;
                const right = currentNodes[i + 1] ?? createEmptyNode();
                nextLevel.push(createInternalNode(left, right));
            }

            currentNodes = nextLevel;
            currentIndex = Math.floor(currentIndex / 2);
        }

        return siblings;
    }
}

// ============================================================================
// Proof Verification
// ============================================================================

/**
 * Verifies a Merkle proof
 */
export function verifyMerkleProof(proof: MerkleProof): boolean {
    let currentHash: Bytes32;

    if (proof.value === null) {
        // Non-membership proof - would need more complex verification
        // For now, return false for non-membership proofs
        return false;
    }

    // Compute leaf hash
    const valueHash = sha256(proof.value);
    currentHash = hashMerkleLeaf(proof.key, valueHash);

    // Walk up the tree using siblings
    for (const sibling of proof.siblings) {
        if (sibling.position === 'left') {
            currentHash = hashMerkleInternal(sibling.hash, currentHash);
        } else {
            currentHash = hashMerkleInternal(currentHash, sibling.hash);
        }
    }

    return bytesEqual(currentHash, proof.root);
}

/**
 * Computes what the root would be with a given value
 */
export function computeRootWithValue(
    proof: MerkleProof,
    newValue: Bytes
): Bytes32 {
    const valueHash = sha256(newValue);
    let currentHash = hashMerkleLeaf(proof.key, valueHash);

    for (const sibling of proof.siblings) {
        if (sibling.position === 'left') {
            currentHash = hashMerkleInternal(sibling.hash, currentHash);
        } else {
            currentHash = hashMerkleInternal(currentHash, sibling.hash);
        }
    }

    return currentHash;
}
