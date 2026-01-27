/**
 * VERA Disk-Backed Merkle Trie (Hexary Bridge)
 *
 * Implements a generic N-ary Merkle Trie with Path Compression.
 */

import {
  type Bytes32,
  bytesEqual,
  bytesToHex,
  EMPTY_TREE_ROOT,
  type MerkleProof,
  type TrieProofNode,
  toBytes32,
  concat,
  type CommitmentScheme,
  MerkleCommitmentScheme,
} from "@vera/core";
import { encode, decode } from "cbor-x";
import type { Store, Batch } from "./types.js";

// ============================================================================
// Node Types
// ============================================================================

export type TrieNode = DiskBranchNode | DiskExtensionNode | DiskLeafNode;

export interface DiskBranchNode {
  type: "branch";
  children: (Bytes32 | null)[];
  hash: Bytes32;
}

export interface DiskExtensionNode {
  type: "extension";
  prefix: Uint8Array;
  child: Bytes32;
  hash: Bytes32;
}

export interface DiskLeafNode {
  type: "leaf";
  path: Uint8Array;
  valueHash: Bytes32;
  hash: Bytes32;
}

// ============================================================================
// Serialization
// ============================================================================

function encodeNode(node: TrieNode): Uint8Array {
  if (node.type === "branch") {
    return encode([1, node.children]);
  } else if (node.type === "extension") {
    return encode([2, node.prefix, node.child]);
  } else {
    return encode([3, node.path, node.valueHash]);
  }
}

function decodeNode(data: Uint8Array, hash: Bytes32): TrieNode {
  const decoded = decode(data) as any[];
  const type = decoded[0];

  if (type === 1) {
    return {
      type: "branch",
      children: decoded[1].map((h: any) => (h === null ? null : toBytes32(h))),
      hash,
    };
  } else if (type === 2) {
    return {
      type: "extension",
      prefix: new Uint8Array(decoded[1]),
      child: toBytes32(decoded[2]),
      hash,
    };
  } else if (type === 3) {
    return {
      type: "leaf",
      path: new Uint8Array(decoded[1]),
      valueHash: toBytes32(decoded[2]),
      hash,
    };
  }
  throw new Error(`Invalid trie node type: ${type}`);
}

// ============================================================================
// Trie Implementation
// ============================================================================

export class DiskMerkleTrie {
  constructor(
    private readonly store: Store,
    private readonly commitment: CommitmentScheme = new MerkleCommitmentScheme(),
  ) { }

  private toPaths(bytes: Uint8Array): Uint8Array {
    if (this.commitment.arity === 16) {
      const nibbles = new Uint8Array(bytes.length * 2);
      for (let i = 0; i < bytes.length; i++) {
        nibbles[i * 2] = bytes[i]! >> 4;
        nibbles[i * 2 + 1] = bytes[i]! & 0x0f;
      }
      return nibbles;
    }
    return bytes; // arity 256
  }

  async get(
    root: Bytes32,
    key: Bytes32,
    cache?: Map<string, TrieNode>,
  ): Promise<Bytes32 | null> {
    if (bytesEqual(root, EMPTY_TREE_ROOT)) return null;

    const targetPaths = this.toPaths(key);
    let currentHash = root;
    let pathOffset = 0;
    let currentPath = new Uint8Array(0);

    while (pathOffset <= targetPaths.length) {
      const node = await this.getNode(currentPath, currentHash, cache);
      if (!node) return null;

      if (node.type === "leaf") {
        const remaining = targetPaths.slice(pathOffset);
        return bytesEqual(node.path, remaining) ? node.valueHash : null;
      }

      if (node.type === "extension") {
        const common = commonPrefixLength(
          node.prefix,
          targetPaths.slice(pathOffset),
        );
        if (common !== node.prefix.length) return null;
        currentHash = node.child;
        currentPath = new Uint8Array(concat(currentPath, node.prefix));
        pathOffset += common;
        continue;
      }

      if (pathOffset === targetPaths.length) return null;
      const pathValue = targetPaths[pathOffset]!;
      const childHash = node.children[pathValue];
      if (!childHash) return null;
      currentPath = new Uint8Array(
        concat(currentPath, new Uint8Array([pathValue])),
      );
      currentHash = childHash;
      pathOffset++;
    }
    return null;
  }

  async update(
    root: Bytes32,
    key: Bytes32,
    valueHash: Bytes32,
    batch?: Batch,
    cache?: Map<string, TrieNode>,
  ): Promise<Bytes32> {
    const paths = this.toPaths(key);
    return this.updateRecursive(
      root,
      paths,
      new Uint8Array(0),
      valueHash,
      batch,
      cache,
    );
  }

  async updateBatch(
    root: Bytes32,
    changes: { key: Bytes32; valueHash: Bytes32 | null }[],
    batch?: Batch,
    cache?: Map<string, TrieNode>,
  ): Promise<Bytes32> {
    if (changes.length === 0) return root;

    const entries = changes.map((c) => ({
      path: this.toPaths(c.key),
      valueHash: c.valueHash,
    }));

    entries.sort((a, b) => {
      const minLen = Math.min(a.path.length, b.path.length);
      for (let i = 0; i < minLen; i++) {
        if (a.path[i]! < b.path[i]!) return -1;
        if (a.path[i]! > b.path[i]!) return 1;
      }
      return a.path.length - b.path.length;
    });

    return this.updateBatchRecursive(
      root,
      entries,
      new Uint8Array(0),
      batch,
      cache,
    );
  }

  async delete(
    root: Bytes32,
    key: Bytes32,
    batch?: Batch,
    cache?: Map<string, TrieNode>,
  ): Promise<Bytes32> {
    const paths = this.toPaths(key);
    return this.deleteRecursive(root, paths, new Uint8Array(0), batch, cache);
  }

  async prove(root: Bytes32, key: Bytes32): Promise<MerkleProof> {
    const valueHash = await this.get(root, key);
    const targetPaths = this.toPaths(key);
    const visitedNodes: TrieProofNode[] = [];
    let currentHash = root;
    let currentPath = new Uint8Array(0);
    let pathOffset = 0;

    if (bytesEqual(root, EMPTY_TREE_ROOT)) {
      return {
        key,
        value: valueHash,
        siblings: [],
        root,
        proofType: "trie",
        trieProof: {
          keyPath: targetPaths,
          nodes: visitedNodes,
        },
      };
    }

    while (!bytesEqual(currentHash, EMPTY_TREE_ROOT)) {
      const node = await this.getNode(currentPath, currentHash);
      if (!node) break;

      if (node.type === "leaf") {
        visitedNodes.push({
          type: "leaf",
          hash: node.hash,
          path: node.path,
          valueHash: node.valueHash,
        });
        break;
      }

      if (node.type === "extension") {
        visitedNodes.push({
          type: "extension",
          hash: node.hash,
          prefix: node.prefix,
          child: node.child,
        });

        const slice = targetPaths.slice(
          pathOffset,
          pathOffset + node.prefix.length,
        );

        if (!bytesEqual(slice, node.prefix)) break;

        currentPath = new Uint8Array(concat(currentPath, node.prefix));
        currentHash = node.child;
        pathOffset += node.prefix.length;
        continue;
      }

      const childIndex = targetPaths[pathOffset] ?? -1;
      visitedNodes.push({
        type: "branch",
        hash: node.hash,
        childIndex,
        children: node.children.slice(),
      });

      if (childIndex < 0) break;

      const childHash = node.children[childIndex];
      if (!childHash) break;

      currentPath = new Uint8Array(
        concat(currentPath, new Uint8Array([childIndex])),
      );
      currentHash = childHash;
      pathOffset += 1;
    }

    return {
      key,
      value: valueHash,
      siblings: [],
      root,
      proofType: "trie",
      trieProof: {
        keyPath: targetPaths,
        nodes: visitedNodes,
      },
    };
  }

  async prune(root: Bytes32): Promise<number> {
    const reachable = new Set<string>();
    await this.collectReachable(new Uint8Array(0), root, reachable);
    let deleted = 0;
    const iterator = this.store.iterator({ gte: "trie:", lt: "trie;" });
    try {
      while (true) {
        const entry = await iterator.next();
        if (!entry) break;
        const key = entry[0] as string;
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

  private async collectReachable(
    path: Uint8Array,
    hash: Bytes32,
    reachable: Set<string>,
  ): Promise<void> {
    if (bytesEqual(hash, EMPTY_TREE_ROOT)) return;
    const hashHex = bytesToHex(hash);
    if (reachable.has(hashHex)) return;
    reachable.add(hashHex);
    const node = await this.getNode(path, hash);
    if (!node) return;
    if (node.type === "branch") {
      for (let i = 0; i < this.commitment.arity; i++) {
        const child = node.children[i];
        if (child)
          await this.collectReachable(
            concat(path, new Uint8Array([i])),
            child,
            reachable,
          );
      }
    } else if (node.type === "extension") {
      await this.collectReachable(
        concat(path, node.prefix),
        node.child,
        reachable,
      );
    }
  }

  private async updateRecursive(
    nodeHash: Bytes32,
    path: Uint8Array,
    currentPath: Uint8Array,
    valueHash: Bytes32,
    batch?: Batch,
    cache?: Map<string, TrieNode>,
  ): Promise<Bytes32> {
    if (bytesEqual(nodeHash, EMPTY_TREE_ROOT)) {
      return this.createLeaf(currentPath, path, valueHash, batch, cache);
    }

    const node = await this.getNode(currentPath, nodeHash, cache);
    if (!node)
      throw new Error(
        `Missing node ${bytesToHex(nodeHash)} at path ${bytesToHex(currentPath)}`,
      );

    if (node.type === "leaf") {
      const common = commonPrefixLength(node.path, path);
      if (common === node.path.length && common === path.length) {
        return this.createLeaf(currentPath, path, valueHash, batch, cache);
      }
      const branch = new Array(this.commitment.arity).fill(null);
      const commonPath = path.slice(0, common);
      const fullCommonPath = concat(currentPath, commonPath);
      const existingNibble = node.path[common];
      const newNibble = path[common];

      if (existingNibble === undefined || newNibble === undefined) {
        throw new Error("Unexpected key collision or prefix mismatch");
      }

      branch[existingNibble] = await this.createLeaf(
        concat(fullCommonPath, new Uint8Array([existingNibble])),
        node.path.slice(common + 1),
        node.valueHash,
        batch,
        cache,
      );
      branch[newNibble] = await this.createLeaf(
        concat(fullCommonPath, new Uint8Array([newNibble])),
        path.slice(common + 1),
        valueHash,
        batch,
        cache,
      );

      const branchHash = await this.createBranch(
        fullCommonPath,
        branch,
        batch,
        cache,
      );
      return commonPath.length > 0
        ? this.createExtension(
          currentPath,
          commonPath,
          branchHash,
          batch,
          cache,
        )
        : branchHash;
    }

    if (node.type === "extension") {
      const common = commonPrefixLength(node.prefix, path);
      if (common === node.prefix.length) {
        const newChild = await this.updateRecursive(
          node.child,
          path.slice(common),
          concat(currentPath, node.prefix),
          valueHash,
          batch,
          cache,
        );
        return this.createExtension(
          currentPath,
          node.prefix,
          newChild,
          batch,
          cache,
        );
      }
      const branch = new Array(this.commitment.arity).fill(null);
      const commonPath = path.slice(0, common);
      const fullCommonPath = concat(currentPath, commonPath);
      const extNibble = node.prefix[common]!;
      const newNibble = path[common]!;

      branch[extNibble] = await this.createExtension(
        concat(fullCommonPath, new Uint8Array([extNibble])),
        node.prefix.slice(common + 1),
        node.child,
        batch,
        cache,
      );
      branch[newNibble] = await this.createLeaf(
        concat(fullCommonPath, new Uint8Array([newNibble])),
        path.slice(common + 1),
        valueHash,
        batch,
        cache,
      );

      const branchHash = await this.createBranch(
        fullCommonPath,
        branch,
        batch,
        cache,
      );
      return commonPath.length > 0
        ? this.createExtension(
          currentPath,
          commonPath,
          branchHash,
          batch,
          cache,
        )
        : branchHash;
    }

    const nibble = path[0]!;
    const newChildren = new Array(this.commitment.arity).fill(null);
    for (let i = 0; i < node.children.length; i++) {
      newChildren[i] = node.children[i];
    }
    newChildren[nibble] = await this.updateRecursive(
      node.children[nibble] || EMPTY_TREE_ROOT,
      path.slice(1),
      concat(currentPath, new Uint8Array([nibble])),
      valueHash,
      batch,
      cache,
    );
    return this.createBranch(currentPath, newChildren, batch, cache);
  }

  private async deleteRecursive(
    nodeHash: Bytes32,
    path: Uint8Array,
    currentPath: Uint8Array,
    batch?: Batch,
    cache?: Map<string, TrieNode>,
  ): Promise<Bytes32> {
    if (bytesEqual(nodeHash, EMPTY_TREE_ROOT)) return EMPTY_TREE_ROOT;
    const node = await this.getNode(currentPath, nodeHash, cache);
    if (!node) return nodeHash;

    if (node.type === "leaf") {
      return bytesEqual(node.path, path) ? EMPTY_TREE_ROOT : nodeHash;
    }

    if (node.type === "extension") {
      const common = commonPrefixLength(node.prefix, path);
      if (common !== node.prefix.length) return nodeHash;
      const newChild = await this.deleteRecursive(
        node.child,
        path.slice(common),
        concat(currentPath, node.prefix),
        batch,
        cache,
      );
      if (bytesEqual(newChild, EMPTY_TREE_ROOT)) return EMPTY_TREE_ROOT;
      return this.createExtension(
        currentPath,
        node.prefix,
        newChild,
        batch,
        cache,
      );
    }

    const nibble = path[0]!;
    const newChildren = [...node.children];
    newChildren[nibble] = await this.deleteRecursive(
      node.children[nibble] || EMPTY_TREE_ROOT,
      path.slice(1),
      concat(currentPath, new Uint8Array([nibble])),
      batch,
      cache,
    );

    let nonNullCount = 0;
    let lastIdx = -1;
    for (let i = 0; i < this.commitment.arity; i++) {
      if (newChildren[i]) {
        nonNullCount++;
        lastIdx = i;
      }
    }

    if (nonNullCount === 0) return EMPTY_TREE_ROOT;
    if (nonNullCount === 1) {
      const childHash = newChildren[lastIdx]!;
      const childNode = await this.getNode(
        concat(currentPath, new Uint8Array([lastIdx])),
        childHash,
        cache,
      );
      if (childNode) {
        if (childNode.type === "leaf") {
          return this.createLeaf(
            currentPath,
            new Uint8Array([lastIdx, ...childNode.path]),
            childNode.valueHash,
            batch,
            cache,
          );
        }
        if (childNode.type === "extension") {
          return this.createExtension(
            currentPath,
            new Uint8Array([lastIdx, ...childNode.prefix]),
            childNode.child,
            batch,
            cache,
          );
        }
      }
      return this.createExtension(
        currentPath,
        new Uint8Array([lastIdx]),
        childHash,
        batch,
        cache,
      );
    }

    return this.createBranch(currentPath, newChildren, batch, cache);
  }


  private async createLeaf(
    path: Uint8Array,
    keyPath: Uint8Array,
    valueHash: Bytes32,
    batch?: Batch,
    cache?: Map<string, TrieNode>,
  ): Promise<Bytes32> {
    const hash = this.commitment.commitLeaf(keyPath, valueHash);
    const node: DiskLeafNode = { type: "leaf", path: keyPath, valueHash, hash };
    await this.saveNode(node, path, batch, cache);
    return hash;
  }

  private async createExtension(
    path: Uint8Array,
    prefix: Uint8Array,
    child: Bytes32,
    batch?: Batch,
    cache?: Map<string, TrieNode>,
  ): Promise<Bytes32> {
    if (prefix.length === 0) return child;
    const hash = this.commitment.commitExtension(prefix, child);
    const node: DiskExtensionNode = { type: "extension", prefix, child, hash };
    await this.saveNode(node, path, batch, cache);
    return hash;
  }

  private async createBranch(
    path: Uint8Array,
    children: (Bytes32 | null)[],
    batch?: Batch,
    cache?: Map<string, TrieNode>,
  ): Promise<Bytes32> {
    const hash = this.commitment.commitBranch(children);
    const node: DiskBranchNode = { type: "branch", children, hash };
    await this.saveNode(node, path, batch, cache);
    return hash;
  }

  private async getNode(
    _path: Uint8Array,
    hash: Bytes32,
    cache?: Map<string, TrieNode>,
  ): Promise<TrieNode | undefined> {
    if (cache) {
      const cached = cache.get(bytesToHex(hash));
      if (cached) return cached;
    }
    const data = await this.store.get(this.nodeKey(hash));
    if (!data) return undefined;
    const node = decodeNode(data, hash);
    if (cache) cache.set(bytesToHex(hash), node);
    return node;
  }

  private async saveNode(
    node: TrieNode,
    _path: Uint8Array,
    batch?: Batch,
    cache?: Map<string, TrieNode>,
  ): Promise<void> {
    const hashHex = bytesToHex(node.hash);
    if (cache) cache.set(hashHex, node);
    const data = encodeNode(node);
    const key = this.nodeKey(node.hash);
    if (batch) {
      batch.put(key, data);
    } else {
      await this.store.put(key, data);
    }
  }

  private nodeKey(hash: Bytes32): string {
    return `trie:${bytesToHex(hash)}`;
  }

  private async updateBatchRecursive(
    nodeHash: Bytes32,
    entries: { path: Uint8Array; valueHash: Bytes32 | null }[],
    currentPath: Uint8Array,
    batch?: Batch,
    cache?: Map<string, TrieNode>,
  ): Promise<Bytes32> {
    if (entries.length === 0) return nodeHash;

    // Single entry optimization - use fast path
    if (entries.length === 1) {
      const entry = entries[0]!;
      if (entry.valueHash === null) {
        return this.deleteRecursive(nodeHash, entry.path, currentPath, batch, cache);
      } else {
        return this.updateRecursive(nodeHash, entry.path, currentPath, entry.valueHash, batch, cache);
      }
    }

    // Empty root - build from scratch with batched approach
    if (bytesEqual(nodeHash, EMPTY_TREE_ROOT)) {
      // Group by first nibble for parallel-ready construction
      const firstNibbleGroups = this.groupByFirstNibble(entries);

      if (firstNibbleGroups.size === 1) {
        // All entries share first nibble - create extension if prefix is shared
        const [, group] = [...firstNibbleGroups.entries()][0]!;
        const commonPrefix = this.findCommonPrefix(group.map(e => e.path));

        if (commonPrefix.length > 0) {
          // Create extension node, then recurse
          const child = await this.updateBatchRecursive(
            EMPTY_TREE_ROOT,
            group.map(e => ({ ...e, path: e.path.slice(commonPrefix.length) })),
            concat(currentPath, commonPrefix),
            batch,
            cache
          );
          return this.createExtension(currentPath, commonPrefix, child, batch, cache);
        }
      }

      // Multiple groups - create branch node with parallel subtree construction
      const children = new Array(this.commitment.arity).fill(null);
      const groupPromises: Promise<void>[] = [];

      for (const [nibble, group] of firstNibbleGroups.entries()) {
        groupPromises.push((async () => {
          const validEntries = group.filter(e => e.path.length > 0 && e.valueHash !== null);
          if (validEntries.length > 0) {
            children[nibble] = await this.updateBatchRecursive(
              EMPTY_TREE_ROOT,
              validEntries.map(e => ({ ...e, path: e.path.slice(1) })),
              concat(currentPath, new Uint8Array([nibble])),
              batch,
              cache
            );
          }
        })());
      }

      await Promise.all(groupPromises);
      return this.createBranch(currentPath, children, batch, cache);
    }

    const node = await this.getNode(currentPath, nodeHash, cache);
    if (!node) throw new Error(`Missing node ${bytesToHex(nodeHash)}`);

    if (node.type === "branch") {
      const groups = this.groupByFirstNibble(entries);

      const newChildren = [...node.children];

      // Process groups in parallel for independent subtrees
      const updatePromises: Promise<void>[] = [];

      for (const [idx, groupEntries] of groups.entries()) {
        updatePromises.push((async () => {
          const childHash = node.children[idx] || EMPTY_TREE_ROOT;
          newChildren[idx] = await this.updateBatchRecursive(
            childHash,
            groupEntries.map(e => ({ ...e, path: e.path.slice(1) })),
            concat(currentPath, new Uint8Array([idx])),
            batch,
            cache
          );
        })());
      }

      await Promise.all(updatePromises);
      return this.createBranch(currentPath, newChildren, batch, cache);
    }

    if (node.type === "extension") {
      // Find common prefix between extension prefix and all entries
      const extensionPrefix = node.prefix;
      const entryCommon = this.findCommonPrefix(entries.map(e => e.path));
      const sharedWithExtension = commonPrefixLength(extensionPrefix, entryCommon);

      if (sharedWithExtension === extensionPrefix.length) {
        // Entire batch goes down this extension
        const newChild = await this.updateBatchRecursive(
          node.child,
          entries.map(e => ({ ...e, path: e.path.slice(extensionPrefix.length) })),
          concat(currentPath, extensionPrefix),
          batch,
          cache
        );
        return this.createExtension(currentPath, extensionPrefix, newChild, batch, cache);
      }

      // Need to split the extension - create a branch at the divergence point
      if (sharedWithExtension > 0) {
        // Create sub-extension for the shared part
        const sharedPrefix = extensionPrefix.slice(0, sharedWithExtension);
        const newSubtreeHash = await this.buildSplitBranch(
          node,
          entries,
          sharedWithExtension,
          concat(currentPath, sharedPrefix),
          batch,
          cache
        );
        return this.createExtension(currentPath, sharedPrefix, newSubtreeHash, batch, cache);
      }

      // No shared prefix - build branch at current position
      return this.buildSplitBranch(node, entries, 0, currentPath, batch, cache);
    }

    // Leaf node - need to split it with the batch entries
    if (node.type === "leaf") {
      // Insert entries into the structure, potentially splitting the leaf
      let root: Bytes32 = nodeHash;
      for (const entry of entries) {
        if (entry.valueHash === null) {
          root = await this.deleteRecursive(root, entry.path, currentPath, batch, cache);
        } else {
          root = await this.updateRecursive(root, entry.path, currentPath, entry.valueHash, batch, cache);
        }
      }
      return root;
    }

    // Fallback
    let root = nodeHash;
    for (const entry of entries) {
      if (entry.valueHash === null) {
        root = await this.deleteRecursive(root, entry.path, currentPath, batch, cache);
      } else {
        root = await this.updateRecursive(root, entry.path, currentPath, entry.valueHash, batch, cache);
      }
    }
    return root;
  }

  /**
   * Group entries by their first nibble for parallel subtree processing.
   * Entries are already sorted, so groups maintain sort order.
   */
  private groupByFirstNibble(
    entries: { path: Uint8Array; valueHash: Bytes32 | null }[]
  ): Map<number, { path: Uint8Array; valueHash: Bytes32 | null }[]> {
    const groups = new Map<number, typeof entries>();
    for (const entry of entries) {
      const head = entry.path[0];
      if (head === undefined) continue;
      if (!groups.has(head)) groups.set(head, []);
      groups.get(head)!.push(entry);
    }
    return groups;
  }

  /**
   * Find the common prefix shared by all paths.
   */
  private findCommonPrefix(paths: Uint8Array[]): Uint8Array {
    if (paths.length === 0) return new Uint8Array(0);
    if (paths.length === 1) return paths[0]!;

    let common = paths[0]!;
    for (let i = 1; i < paths.length; i++) {
      const len = commonPrefixLength(common, paths[i]!);
      common = common.slice(0, len);
      if (common.length === 0) break;
    }
    return common;
  }

  /**
   * Build a branch node that splits an extension with batch entries.
   */
  private async buildSplitBranch(
    extNode: DiskExtensionNode,
    entries: { path: Uint8Array; valueHash: Bytes32 | null }[],
    prefixOffset: number,
    currentPath: Uint8Array,
    batch?: Batch,
    cache?: Map<string, TrieNode>,
  ): Promise<Bytes32> {
    const children = new Array(this.commitment.arity).fill(null);
    const extPrefix = extNode.prefix;

    // Extension's continuation
    const extNibble = extPrefix[prefixOffset]!;
    const extRemainder = extPrefix.slice(prefixOffset + 1);
    if (extRemainder.length > 0) {
      children[extNibble] = await this.createExtension(
        concat(currentPath, new Uint8Array([extNibble])),
        extRemainder,
        extNode.child,
        batch,
        cache
      );
    } else {
      children[extNibble] = extNode.child;
    }

    // Group entries by nibble at prefixOffset
    const groups = new Map<number, typeof entries>();
    for (const entry of entries) {
      const nibble = entry.path[prefixOffset];
      if (nibble === undefined) continue;
      if (!groups.has(nibble)) groups.set(nibble, []);
      groups.get(nibble)!.push({ ...entry, path: entry.path.slice(prefixOffset + 1) });
    }

    // Build each group (parallel)
    const updatePromises: Promise<void>[] = [];
    for (const [nibble, group] of groups.entries()) {
      if (nibble === extNibble) {
        // Merge with extension's child
        updatePromises.push((async () => {
          children[nibble] = await this.updateBatchRecursive(
            children[nibble] || EMPTY_TREE_ROOT,
            group,
            concat(currentPath, new Uint8Array([nibble])),
            batch,
            cache
          );
        })());
      } else {
        // New subtree
        updatePromises.push((async () => {
          children[nibble] = await this.updateBatchRecursive(
            EMPTY_TREE_ROOT,
            group,
            concat(currentPath, new Uint8Array([nibble])),
            batch,
            cache
          );
        })());
      }
    }

    await Promise.all(updatePromises);
    return this.createBranch(currentPath, children, batch, cache);
  }
}

// ============================================================================
// Helpers
// ============================================================================

function commonPrefixLength(a: Uint8Array, b: Uint8Array): number {
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) {
    i++;
  }
  return i;
}
