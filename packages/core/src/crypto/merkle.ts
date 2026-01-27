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
} from "../types/primitives.js";
import {
  type MerkleProof,
  type ProofSibling,
} from "../types/state.js";
import {
  EMPTY_TREE_ROOT,
  hashMerkleInternal,
  hashMerkleLeaf,
  hashStateValue,
} from "./hash.js";
import { MerkleCommitmentScheme } from "./commitment.js";

// ============================================================================
// Merkle Node Types
// ============================================================================

/**
 * Leaf node in the Merkle tree
 */
export interface LeafNode {
  readonly type: "leaf";
  readonly key: Bytes;
  readonly valueHash: Bytes32;
  readonly hash: Bytes32;
}

/**
 * Internal node in the Merkle tree
 */
export interface InternalNode {
  readonly type: "internal";
  readonly left: MerkleNode;
  readonly right: MerkleNode;
  readonly hash: Bytes32;
}

/**
 * Empty node (placeholder for balanced tree)
 */
export interface EmptyNode {
  readonly type: "empty";
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
  return { type: "leaf", key, valueHash, hash };
}

/**
 * Creates an internal node from two children
 */
export function createInternalNode(
  left: MerkleNode,
  right: MerkleNode,
): InternalNode {
  const hash = hashMerkleInternal(left.hash, right.hash);
  return { type: "internal", left, right, hash };
}

/**
 * Creates an empty node
 */
export function createEmptyNode(): EmptyNode {
  return { type: "empty", hash: EMPTY_TREE_ROOT };
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
      (e) => this.keyToString(e.key) === keyStr,
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
      (e) => this.keyToString(e.key) !== keyStr,
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
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  }

  private getSortedEntries(): MerkleEntry[] {
    return Array.from(this.entries.values()).sort((a, b) =>
      bytesCompare(a.key, b.key),
    );
  }

  private buildTree(): MerkleNode {
    const sortedEntries = this.getSortedEntries();

    if (sortedEntries.length === 0) {
      return createEmptyNode();
    }

    // Create leaf nodes
    const leaves: MerkleNode[] = sortedEntries.map((entry) =>
      createLeafNode(entry.key, hashStateValue(entry.value)),
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
      targetIndex = sortedEntries.findIndex(
        (e) => bytesCompare(e.key, key) > 0,
      );
      if (targetIndex < 0) {
        targetIndex = sortedEntries.length;
      }
    }

    // Build tree and collect siblings along the path
    const leaves: MerkleNode[] = sortedEntries.map((entry) =>
      createLeafNode(entry.key, hashStateValue(entry.value)),
    );

    return this.collectSiblings(leaves, targetIndex);
  }

  private collectSiblings(
    nodes: MerkleNode[],
    targetIndex: number,
  ): ProofSibling[] {
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
          position: isRightChild ? "left" : "right",
        });
      } else {
        // Sibling doesn't exist (odd number of nodes)
        siblings.push({
          hash: EMPTY_TREE_ROOT,
          position: "right",
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
  if (proof.proofType === "trie") {
    return verifyTrieProof(proof);
  }

  if (proof.value === null) {
    // Non-membership proof - would need more complex verification
    // For now, return false for non-membership proofs
    return false;
  }

  // Compute leaf hash
  const valueHash = hashStateValue(proof.value);
  let currentHash = hashMerkleLeaf(proof.key, valueHash);

  // Walk up the tree using siblings
  for (const sibling of proof.siblings) {
    if (sibling.position === "left") {
      currentHash = hashMerkleInternal(sibling.hash, currentHash);
    } else {
      currentHash = hashMerkleInternal(currentHash, sibling.hash);
    }
  }

  return bytesEqual(currentHash, proof.root);
}

function verifyTrieProof(proof: MerkleProof): boolean {
  const trieProof = proof.trieProof;
  if (!trieProof) {
    return false;
  }

  const { nodes, keyPath } = trieProof;
  if (nodes.length === 0) {
    // Empty tree case: root must be EMPTY_TREE_ROOT and value must be null
    return (
      bytesEqual(proof.root, EMPTY_TREE_ROOT) &&
      proof.value === null
    );
  }

  const nibbleKey = bytesToNibbles(proof.key);
  if (!bytesEqual(nibbleKey, keyPath)) {
    return false;
  }

  const rootWitness = nodes[0]!;
  if (!bytesEqual(rootWitness.hash, proof.root)) {
    return false;
  }

  const commitment = new MerkleCommitmentScheme();
  const valueHash = proof.value !== null ? hashStateValue(proof.value) : null;

  let offset = 0;
  let diverged = false;
  let reachedLeaf = false;

  // 1. Path Verification (Top-Down)
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i]!;
    if (diverged || reachedLeaf) {
      console.log('Extra nodes after diverged/reachedLeaf', i);
      return false;
    }

    if (node.type === "extension") {
      const remainingKey = keyPath.slice(offset);
      const common = commonPrefixLength(node.prefix, remainingKey);

      if (common < node.prefix.length) {
        // Divergence point: extension prefix does not match key
        diverged = true;
      } else {
        offset += node.prefix.length;
      }
    } else if (node.type === "branch") {
      if (offset >= keyPath.length) {
        // Non-membership: branch at end of key but no leaf here
        diverged = true;
      } else {
        const nibble = keyPath[offset];
        if (nibble === undefined || nibble < 0 || nibble >= 16) return false;

        if (!node.children[nibble]) {
          // Non-membership: confirmed empty slot in branch
          // BUT: we still require metadata consistency if childIndex is present
          if (node.childIndex !== nibble) return false;
          diverged = true;
        } else {
          // Membership (so far): ensure branch node metadata matches key
          if (node.childIndex !== nibble) return false;
          offset += 1;
        }
      }
    } else if (node.type === "leaf") {
      reachedLeaf = true;
      const remainingKey = keyPath.slice(offset);
      if (!bytesEqual(node.path, remainingKey)) {
        // Divergence point: leaf path does not match remaining key
        diverged = true;
      } else {
        offset += node.path.length;
      }
    } else {
      return false;
    }
  }

  // Final path checks
  if (proof.value !== null) {
    // Membership proof MUST reach a leaf and match full key
    if (!reachedLeaf || diverged || offset !== keyPath.length) {
      return false;
    }
  } else {
    // Non-membership proof MUST have diverged
    if (!diverged) {
      return false;
    }
  }

  // 2. Hash Linkage Verification (Bottom-Up)
  let currentHash: Bytes32 | null = null;
  for (let i = nodes.length - 1; i >= 0; i--) {
    const node = nodes[i]!;
    let computed: Bytes32;

    if (node.type === "leaf") {
      if (i === nodes.length - 1 && proof.value !== null) {
        // Membership leaf: valueHash MUST match
        if (!bytesEqual(node.valueHash, valueHash!)) return false;
      }
      computed = commitment.commitLeaf(node.path, node.valueHash);
    } else if (node.type === "extension") {
      const childHash = (i === nodes.length - 1) ? node.child : currentHash;
      if (!childHash) return false;
      if (currentHash !== null && !bytesEqual(childHash, currentHash)) return false;

      computed = commitment.commitExtension(node.prefix, childHash);
    } else if (node.type === "branch") {
      const children = [...node.children];
      if (currentHash !== null) {
        // Verify currentHash matches what this branch expects at this index
        const declaredChild = children[node.childIndex];
        if (!declaredChild || !bytesEqual(declaredChild, currentHash)) return false;
      }
      computed = commitment.commitBranch(children);
    } else {
      return false;
    }

    if (!bytesEqual(computed, node.hash)) return false;
    currentHash = computed;
  }

  return bytesEqual(currentHash!, proof.root);
}

function bytesToNibbles(bytes: Bytes): Uint8Array {
  const nibbles = new Uint8Array(bytes.length * 2);
  for (let i = 0; i < bytes.length; i++) {
    const byte = bytes[i]!;
    nibbles[i * 2] = byte >> 4;
    nibbles[i * 2 + 1] = byte & 0x0f;
  }
  return nibbles;
}

/**
 * Computes what the root would be with a given value
 */
export function computeRootWithValue(
  proof: MerkleProof,
  newValue: Bytes,
): Bytes32 {
  const valueHash = hashStateValue(newValue);
  let currentHash = hashMerkleLeaf(proof.key, valueHash);

  for (const sibling of proof.siblings) {
    if (sibling.position === "left") {
      currentHash = hashMerkleInternal(sibling.hash, currentHash);
    } else {
      currentHash = hashMerkleInternal(currentHash, sibling.hash);
    }
  }

  return currentHash;
}

function commonPrefixLength(a: Uint8Array, b: Uint8Array): number {
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) {
    i++;
  }
  return i;
}
