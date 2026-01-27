/**
 * VERA State Types
 *
 * Defines types for state storage, keys, values, and changes.
 * The state model is a versioned, Merkle-committed key-value store.
 */

import { type Bytes, type Bytes32, hexToBytes32 } from "./primitives.js";
import { sha256 } from "../crypto/index.js";

// ============================================================================
// Schema References
// ============================================================================

/**
 * Reference to a type schema definition
 */
export interface SchemaRef {
  /** Module containing the schema */
  readonly moduleId: Bytes32;
  /** Name of the schema within the module */
  readonly schemaName: string;
  /** Schema version */
  readonly version: number;
}

// ============================================================================
// State Keys and Values
// ============================================================================

/**
 * Key for addressing state entries.
 * Composed of a namespace (for logical grouping) and a unique ID.
 */
export interface StateKey {
  /** Namespace for logical grouping (e.g., "accounts", "assets") */
  readonly namespace: string;
  /** 32-byte unique identifier within the namespace */
  readonly id: Bytes32;
}

/**
 * Value stored in state.
 * Contains the serialized data and metadata about the value.
 */
export interface StateValue {
  /** Serialized value data (CBOR encoded) */
  readonly data: Bytes;
  /** Transaction sequence that last modified this value */
  readonly lastModified: bigint;
  /** Reference to the schema describing this value's type */
  readonly schema: SchemaRef;
}

/**
 * Represents a change to state (set or delete)
 */
export type StateChange =
  | {
    readonly type: "set";
    readonly key: StateKey;
    readonly value: StateValue;
  }
  | {
    readonly type: "delete";
    readonly key: StateKey;
  };

// ============================================================================
// Merkle Proofs
// ============================================================================

/**
 * Sibling node in a Merkle proof path
 */
export interface ProofSibling {
  /** Hash of the sibling node */
  readonly hash: Bytes32;
  /** Position of the sibling relative to the path */
  readonly position: "left" | "right";
}

/**
 * Node encountered in a trie-based proof path
 */
export type TrieProofNode =
  | {
    readonly type: "branch";
    readonly hash: Bytes32;
    readonly childIndex: number;
    readonly children: readonly (Bytes32 | null)[];
  }
  | {
    readonly type: "extension";
    readonly hash: Bytes32;
    readonly prefix: Uint8Array;
    readonly child: Bytes32;
  }
  | {
    readonly type: "leaf";
    readonly hash: Bytes32;
    readonly path: Uint8Array;
    readonly valueHash: Bytes32;
  };

/**
 * Merkle inclusion/exclusion proof
 */
export interface MerkleProof {
  /** Key being proven */
  readonly key: Bytes;
  /** Value if membership proof, null if non-membership proof */
  readonly value: Bytes | null;
  /** Path of siblings from leaf to root */
  readonly siblings: readonly ProofSibling[];
  /** State root the proof is against */
  readonly root: Bytes32;
  /** Type of commitment backing the proof */
  readonly proofType?: "binary" | "trie";
  /** Optional trie-specific witnesses captured along the path */
  readonly trieProof?: {
    /** Nibble-encoded path for the key within the trie */
    readonly keyPath: Uint8Array;
    /** Nodes traversed from root to leaf used to reconstruct the root */
    readonly nodes: readonly TrieProofNode[];
  };
}

// ============================================================================
// State Store Interface
// ============================================================================

/**
 * Result of a state query with proof
 */
export interface StateQueryResult {
  /** The value, or null if not found */
  readonly value: StateValue | null;
  /** Merkle proof for the query */
  readonly proof: MerkleProof;
}

/**
 * Immutable state store interface.
 * All mutations return new StateStore instances.
 */
export interface StateStore {
  /** Monotonically increasing version number */
  readonly version: bigint;

  /** Merkle root commitment of the entire state */
  readonly root: Bytes32;

  /**
   * Gets a value by key
   * @returns The value, or null if not found
   */
  get(key: StateKey): StateValue | null;

  /**
   * Gets a value with a Merkle proof
   * @returns Value (or null) and proof of inclusion/exclusion
   */
  getWithProof(key: StateKey): StateQueryResult;

  /**
   * Checks if a key exists in state
   */
  has(key: StateKey): boolean;

  /**
   * Applies a batch of changes atomically.
   * Returns a new StateStore with the changes applied.
   * @param newVersion - Version number for the new state
   * @param options - Optional write options
   */
  apply(
    changes: readonly StateChange[],
    newVersion: bigint,
    options?: any,
  ): StateStore;

  /**
   * Gets all keys in a namespace (for iteration)
   */
  keys(namespace: string): IterableIterator<StateKey>;

  /**
   * Iterates over all entries (for snapshotting)
   */
  entries(): IterableIterator<{ key: StateKey; value: StateValue }>;

  /**
   * Gets the number of entries in state
   */
  size(): number;
}

/**
 * Async state store interface for disk-based storage.
 * All access methods return Promises.
 */
export interface AsyncStateStore {
  /** Monotonically increasing version number */
  readonly version: bigint;

  /** Merkle root commitment of the entire state */
  readonly root: Bytes32;

  /**
   * Gets a value by key
   */
  get(key: StateKey): Promise<StateValue | null>;

  /**
   * Gets a value with a Merkle proof
   */
  getWithProof(key: StateKey): Promise<StateQueryResult>;

  /**
   * Checks if a key exists in state
   */
  has(key: StateKey): Promise<boolean>;

  /**
   * Applies a batch of changes atomically.
   * Returns a new AsyncStateStore instance representing the new state.
   */
  apply(
    changes: readonly StateChange[],
    newVersion: bigint,
    options?: any,
  ): Promise<AsyncStateStore>;

  /**
   * Gets all keys in a namespace (for iteration)
   */
  keys(namespace: string): AsyncIterableIterator<StateKey>;

  /**
   * Iterates over all entries (for snapshotting)
   */
  entries(): AsyncIterableIterator<{ key: StateKey; value: StateValue }>;

  /**
   * Gets the number of entries in state
   */
  size(): Promise<number>;
}

// ============================================================================
// State Key Utilities
// ============================================================================

/**
 * Derives a deterministic 32-byte ID from a string key.
 * If the key is already a 64-character hex string (0x...), it returns the byte representation.
 * Otherwise, it hashes the UTF-8 bytes of the string.
 */
export function deriveStateId(key: string): Bytes32 {
  if (key.startsWith("0x") && key.length === 66) {
    return hexToBytes32(key);
  }
  return sha256(new TextEncoder().encode(key)) as Bytes32;
}

/**
 * Creates a StateKey from namespace and id
 */
export function createStateKey(namespace: string, id: Bytes32): StateKey {
  return { namespace, id };
}

/**
 * Encodes a StateKey to bytes for hashing/comparison
 */
export function encodeStateKey(key: StateKey): Bytes {
  // Ensure namespace is well-formed unicode to prevent injection attacks
  // via replacement characters (e.g. lone surrogates becoming \uFFFD)
  // We use a manual check for unpaired surrogates to be robust across environments.
  for (let i = 0; i < key.namespace.length; i++) {
    const charCode = key.namespace.charCodeAt(i);
    if (charCode >= 0xD800 && charCode <= 0xDBFF) {
      // High surrogate
      if (i + 1 >= key.namespace.length || key.namespace.charCodeAt(i + 1) < 0xDC00 || key.namespace.charCodeAt(i + 1) > 0xDFFF) {
        throw new Error(`Invalid Unicode in namespace: unpaired high surrogate`);
      }
      i++; // Skip low surrogate
    } else if (charCode >= 0xDC00 && charCode <= 0xDFFF) {
      // Unpaired low surrogate
      throw new Error(`Invalid Unicode in namespace: unpaired low surrogate`);
    }
  }

  const namespaceBytes = new TextEncoder().encode(key.namespace);
  const result = new Uint8Array(4 + namespaceBytes.length + 32);

  // Length-prefix the namespace
  const view = new DataView(result.buffer);
  view.setUint32(0, namespaceBytes.length, false); // big-endian

  result.set(namespaceBytes, 4);
  result.set(key.id, 4 + namespaceBytes.length);

  return result;
}

/**
 * Compares two StateKeys for ordering
 */
export function compareStateKeys(a: StateKey, b: StateKey): number {
  // Compare namespaces first
  if (a.namespace < b.namespace) return -1;
  if (a.namespace > b.namespace) return 1;

  // Then compare IDs lexicographically
  for (let i = 0; i < 32; i++) {
    const diff = (a.id[i] ?? 0) - (b.id[i] ?? 0);
    if (diff !== 0) return diff;
  }

  return 0;
}

/**
 * Checks if two StateKeys are equal
 */
export function stateKeysEqual(a: StateKey, b: StateKey): boolean {
  if (a.namespace !== b.namespace) return false;
  for (let i = 0; i < 32; i++) {
    if (a.id[i] !== b.id[i]) return false;
  }
  return true;
}
