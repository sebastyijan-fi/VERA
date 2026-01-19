/**
 * VERA Hash Functions
 *
 * SHA-256 hashing with domain separation for security.
 * Uses @noble/hashes for audited, constant-time implementation.
 */

import { sha256 as sha256Noble } from '@noble/hashes/sha256';
import { type Bytes, type Bytes32, concat, toBytes32 } from '../types/primitives.js';

// ============================================================================
// Domain Separation Constants
// ============================================================================

/**
 * Domain separation prefixes to prevent cross-context attacks.
 * Each prefix is unique to its use case.
 */
export const HashDomains = {
    /** Merkle tree leaf nodes */
    MERKLE_LEAF: new Uint8Array([0x00]),
    /** Merkle tree internal nodes */
    MERKLE_INTERNAL: new Uint8Array([0x01]),
    /** Transaction ID computation */
    TRANSACTION: new TextEncoder().encode('VERA_TX_V1:'),
    /** Transaction signing */
    SIGNATURE: new TextEncoder().encode('VERA_SIG_V1:'),
    /** Block hash computation */
    BLOCK: new TextEncoder().encode('VERA_BLOCK_V1:'),
    /** State value hashing */
    STATE_VALUE: new TextEncoder().encode('VERA_STATE_V1:'),
    /** Event data hashing */
    EVENT: new TextEncoder().encode('VERA_EVENT_V1:'),
} as const;

// ============================================================================
// Core Hash Functions
// ============================================================================

/**
 * Computes SHA-256 hash of input bytes
 */
export function sha256(data: Bytes): Bytes32 {
    return toBytes32(sha256Noble(data));
}

/**
 * Computes SHA-256 hash with domain separation prefix
 */
export function sha256WithDomain(domain: Bytes, data: Bytes): Bytes32 {
    return sha256(concat(domain, data));
}

/**
 * Double SHA-256 hash (for extra security in critical paths)
 */
export function doubleSha256(data: Bytes): Bytes32 {
    return sha256(sha256(data));
}

// ============================================================================
// Specialized Hash Functions
// ============================================================================

/**
 * Computes hash for a Merkle tree leaf node
 */
export function hashMerkleLeaf(key: Bytes, valueHash: Bytes32): Bytes32 {
    return sha256(concat(HashDomains.MERKLE_LEAF, key, valueHash));
}

/**
 * Computes hash for a Merkle tree internal node
 */
export function hashMerkleInternal(leftHash: Bytes32, rightHash: Bytes32): Bytes32 {
    return sha256(concat(HashDomains.MERKLE_INTERNAL, leftHash, rightHash));
}

/**
 * Computes the hash of a state value
 */
export function hashStateValue(data: Bytes): Bytes32 {
    return sha256WithDomain(HashDomains.STATE_VALUE, data);
}

/**
 * Computes a message hash for signing
 */
export function hashForSigning(transactionId: Bytes32): Bytes32 {
    return sha256(concat(HashDomains.SIGNATURE, transactionId));
}

// ============================================================================
// Empty Tree Root
// ============================================================================

/**
 * The root hash of an empty Merkle tree.
 * Computed as SHA256("VERA_EMPTY_TREE") for determinism.
 */
export const EMPTY_TREE_ROOT: Bytes32 = sha256(
    new TextEncoder().encode('VERA_EMPTY_TREE')
);

// ============================================================================
// Hash Utilities
// ============================================================================

/**
 * Computes hash of multiple values concatenated
 */
export function hashConcat(...values: Bytes[]): Bytes32 {
    return sha256(concat(...values));
}

/**
 * Computes hash of a string (UTF-8 encoded)
 */
export function hashString(str: string): Bytes32 {
    return sha256(new TextEncoder().encode(str));
}

/**
 * Computes hash of a bigint (as 32-byte big-endian)
 */
export function hashBigInt(value: bigint): Bytes32 {
    const bytes = new Uint8Array(32);
    const view = new DataView(bytes.buffer);

    // Write as two 64-bit values (big-endian)
    // Note: This handles values up to 2^256 - 1
    const high = value >> 128n;
    const low = value & ((1n << 128n) - 1n);

    view.setBigUint64(0, high >> 64n, false);
    view.setBigUint64(8, high & ((1n << 64n) - 1n), false);
    view.setBigUint64(16, low >> 64n, false);
    view.setBigUint64(24, low & ((1n << 64n) - 1n), false);

    return sha256(bytes);
}
