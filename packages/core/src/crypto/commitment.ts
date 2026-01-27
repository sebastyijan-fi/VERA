/**
 * VERA Commitment Schemes
 *
 * Defines the abstraction for cryptographic commitments used in state tries.
 * Supports standard Merkle (Hashing) and Polynomial (Verkle) schemes.
 */

import { type Bytes32, concat } from '../types/primitives.js';
import { sha256, HashDomains } from './hash.js';

/**
 * Abstract interface for trie node commitments.
 */
export interface CommitmentScheme {
    /** Number of children in a branch node (e.g. 16 for Hexary, 256 for Verkle) */
    readonly arity: number;

    /**
     * Computes the commitment (or hash) for a leaf node.
     */
    commitLeaf(path: Uint8Array, valueHash: Bytes32): Bytes32;

    /**
     * Computes the commitment (or hash) for an extension node.
     */
    commitExtension(prefix: Uint8Array, childHash: Bytes32): Bytes32;

    /**
     * Computes the commitment (or hash) for a branch node.
     */
    commitBranch(children: (Bytes32 | null)[]): Bytes32;
}

/**
 * Standard Merkle Hashing scheme.
 * Used for the VERA Hexary Bridge.
 */
export class MerkleCommitmentScheme implements CommitmentScheme {
    readonly arity = 16;
    commitLeaf(path: Uint8Array, valueHash: Bytes32): Bytes32 {
        return sha256(concat(HashDomains.MERKLE_LEAF, path, valueHash));
    }

    commitExtension(prefix: Uint8Array, childHash: Bytes32): Bytes32 {
        return sha256(concat(HashDomains.MERKLE_INTERNAL, prefix, childHash));
    }

    commitBranch(children: (Bytes32 | null)[]): Bytes32 {
        const buf = new Uint8Array(16 * 32);
        for (let i = 0; i < 16; i++) {
            if (children[i]) {
                buf.set(children[i]!, i * 32);
            }
        }
        return sha256(concat(HashDomains.MERKLE_INTERNAL, buf));
    }
}

/**
 * Simulated IPA (Polynomial) Commitment Scheme.
 * Models Verkle Tree behavior using distinct domain separation.
 */
export class SimulatedIPACommitmentScheme implements CommitmentScheme {
    readonly arity = 256;
    private readonly COMMIT_DOMAIN = new Uint8Array([0x56, 0x45, 0x52, 0x4b, 0x4c, 0x45]); // "VERKLE"

    commitLeaf(path: Uint8Array, valueHash: Bytes32): Bytes32 {
        return sha256(concat(this.COMMIT_DOMAIN, path, valueHash));
    }

    commitExtension(prefix: Uint8Array, childHash: Bytes32): Bytes32 {
        return sha256(concat(this.COMMIT_DOMAIN, prefix, childHash));
    }

    commitBranch(children: (Bytes32 | null)[]): Bytes32 {
        const buf = new Uint8Array(256 * 32);
        for (let i = 0; i < 256; i++) {
            if (children[i]) {
                buf.set(children[i]!, i * 32);
            }
        }
        return sha256(concat(this.COMMIT_DOMAIN, buf));
    }
}

/**
 * Dual Commitment Scheme for migration.
 * Maintains two cryptographic roots simultaneously.
 */
export class DualCommitmentScheme implements CommitmentScheme {
    constructor(
        private readonly primary: CommitmentScheme,
        private readonly secondary: CommitmentScheme
    ) { }

    get arity(): number {
        return this.primary.arity;
    }

    commitLeaf(path: Uint8Array, valueHash: Bytes32): Bytes32 {
        return this.combine(
            this.primary.commitLeaf(path, valueHash),
            this.secondary.commitLeaf(path, valueHash)
        );
    }

    commitExtension(prefix: Uint8Array, childHash: Bytes32): Bytes32 {
        return this.combine(
            this.primary.commitExtension(prefix, childHash),
            this.secondary.commitExtension(prefix, childHash)
        );
    }

    commitBranch(children: (Bytes32 | null)[]): Bytes32 {
        return this.combine(
            this.primary.commitBranch(children),
            this.secondary.commitBranch(children)
        );
    }

    private combine(h1: Bytes32, h2: Bytes32): Bytes32 {
        return sha256(concat(h1, h2));
    }
}
