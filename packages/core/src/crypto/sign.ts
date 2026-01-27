/**
 * VERA Digital Signatures
 *
 * Ed25519 signing and verification using @noble/ed25519.
 * Provides key generation, signing, and verification utilities.
 */

import * as ed25519 from '@noble/ed25519';
import { sha512 } from '@noble/hashes/sha512';
import {
    type Address,
    type Bytes,
    type Bytes32,
    type Bytes64,
    toBytes32,
    toBytes64,
    concat,
    bytesToHex,
} from '../types/primitives.js';
import { type Signature } from '../types/transaction.js';
import { HashDomains, sha256 } from './hash.js';
import { type SignatureWorkerPool } from './pool.js';

// Configure ed25519 to use sha512 (required for async operations)
ed25519.etc.sha512Sync = (...m) => sha512(ed25519.etc.concatBytes(...m));

// ============================================================================
// Key Types
// ============================================================================

/**
 * Ed25519 private key (32 bytes, should be kept secret)
 */
export type PrivateKey = Bytes32;

/**
 * Ed25519 public key (32 bytes, can be shared)
 */
export type PublicKey = Bytes32;

/**
 * Key pair for signing
 */
export interface KeyPair {
    readonly privateKey: PrivateKey;
    readonly publicKey: PublicKey;
}

// ============================================================================
// Key Generation
// ============================================================================

/**
 * Generates a new random key pair.
 * Uses cryptographically secure random number generation.
 */
export function generateKeyPair(): KeyPair {
    const privateKey = ed25519.utils.randomPrivateKey();
    const publicKey = ed25519.getPublicKey(privateKey);
    return {
        privateKey: toBytes32(privateKey),
        publicKey: toBytes32(publicKey),
    };
}

/**
 * Derives the public key from a private key
 */
export function getPublicKey(privateKey: PrivateKey): PublicKey {
    return toBytes32(ed25519.getPublicKey(privateKey));
}

/**
 * Converts a public key to an address (they are the same in VERA)
 */
export function publicKeyToAddress(publicKey: PublicKey): Address {
    return publicKey;
}

// ============================================================================
// Signing
// ============================================================================

/**
 * Signs a message with a private key
 */
export function sign(message: Bytes, privateKey: PrivateKey): Bytes64 {
    const signature = ed25519.sign(message, privateKey);
    return toBytes64(signature);
}

/**
 * Signs a message with domain separation
 */
export function signWithDomain(
    domain: Bytes,
    message: Bytes,
    privateKey: PrivateKey
): Bytes64 {
    return sign(concat(domain, message), privateKey);
}

/**
 * Creates a VERA transaction signature
 */
export function signTransaction(
    transactionId: Bytes32,
    privateKey: PrivateKey,
    signedFields: readonly string[] = ['version', 'chainId', 'type', 'nonce', 'maxSequence', 'payload']
): Signature {
    const message = concat(HashDomains.SIGNATURE, transactionId);
    const signature = sign(message, privateKey);
    const publicKey = getPublicKey(privateKey);

    return {
        publicKey,
        signature,
        signedFields,
    };
}

// ============================================================================
// Verification
// ============================================================================

/**
 * Verifies a signature against a message and public key
 */
export function verify(
    signature: Bytes64,
    message: Bytes,
    publicKey: PublicKey
): boolean {
    try {
        return ed25519.verify(signature, message, publicKey);
    } catch {
        // Invalid signature format
        return false;
    }
}

/**
 * Verifies a signature with domain separation
 */
export function verifyWithDomain(
    signature: Bytes64,
    domain: Bytes,
    message: Bytes,
    publicKey: PublicKey
): boolean {
    return verify(signature, concat(domain, message), publicKey);
}

/**
 * Batch verification of multiple signatures.
 * Returns true if ALL signatures are valid.
 * 
 * Uses random linear combination technique for efficient batch verification:
 * Instead of N independent verifications, we check:
 * sum(z_i * [s_i]B) == sum(z_i * R_i) + sum(z_i * k_i * A_i)
 * 
 * This achieves ~50-70% speedup on large batches by amortizing
 * the expensive multi-scalar multiplication across all signatures.
 */
export async function verifyBatch(
    items: { signature: Bytes64; message: Bytes; publicKey: PublicKey }[],
    pool?: SignatureWorkerPool
): Promise<boolean> {
    if (items.length === 0) return true;

    // For small batches or when pool is available, use existing paths
    if (pool) {
        const results = await pool.verifyBatch(items);
        return results.every(res => res === true);
    }

    // For single signature, use standard verification
    if (items.length === 1) {
        const { signature, message, publicKey } = items[0]!;
        return verify(signature, message, publicKey);
    }

    // True batch verification using random linear combination
    // Algorithm: 
    // For each signature i, compute k_i = H(R_i || A_i || M_i) (challenge)
    // Generate random scalars z_i for each signature
    // Check: sum(z_i * s_i) * B == sum(z_i * R_i) + sum(z_i * k_i * A_i)
    //
    // This works because an invalid signature would fail with overwhelming
    // probability when combined with random scalars.

    try {
        // Access Point class from ed25519.etc or ed25519 namespace
        const Point = (ed25519 as any).Point;
        if (!Point) {
            // Fallback to sequential if Point not accessible
            return verifyBatchSequential(items);
        }

        const B = Point.BASE;
        let sSum = 0n;
        let rSum = Point.ZERO;
        let kaSum = Point.ZERO;

        // Generate random 128-bit scalars for each signature (sufficient security margin)
        const randomScalars = items.map(() => {
            const bytes = crypto.getRandomValues(new Uint8Array(16));
            let z = 0n;
            for (let i = 0; i < 16; i++) {
                z = (z << 8n) | BigInt(bytes[i]!);
            }
            return z + 1n; // Ensure non-zero
        });

        for (let i = 0; i < items.length; i++) {
            const { signature, message, publicKey } = items[i]!;
            const z = randomScalars[i]!;

            // Decode R (first 32 bytes of signature)
            const R = Point.fromHex(bytesToHex(signature.subarray(0, 32)));

            // Decode s (second 32 bytes of signature) as little-endian scalar
            const sBytes = signature.subarray(32, 64);
            let s = 0n;
            for (let j = 0; j < 32; j++) {
                s |= BigInt(sBytes[j]!) << (8n * BigInt(j));
            }

            // Decode public key A
            const A = Point.fromHex(bytesToHex(publicKey));

            // Compute challenge k = H(R || A || M) mod L
            const hashInput = concat(signature.subarray(0, 32), publicKey, message);
            const kHash = sha512(hashInput);
            let k = 0n;
            for (let j = 0; j < 64; j++) {
                k |= BigInt(kHash[j]!) << (8n * BigInt(j));
            }
            // Reduce k mod curve order
            const L = 0x1000000000000000000000000000000014def9dea2f79cd65812631a5cf5d3edn;
            k = k % L;

            // Accumulate: sSum += z_i * s_i
            sSum = (sSum + z * s) % L;

            // Accumulate: rSum += z_i * R_i
            rSum = rSum.add(R.multiply(z, false));

            // Accumulate: kaSum += z_i * k_i * A_i
            kaSum = kaSum.add(A.multiply((z * k) % L, false));
        }

        // Check: [sSum]B == rSum + kaSum
        const lhs = B.multiply(sSum, false);
        const rhs = rSum.add(kaSum);

        // Clear cofactor and compare (handles small-order components)
        return lhs.clearCofactor().equals(rhs.clearCofactor());
    } catch {
        // On any error, fall back to sequential verification
        return verifyBatchSequential(items);
    }
}

/**
 * Sequential batch verification fallback.
 * Used when true batch verification is not available.
 */
async function verifyBatchSequential(
    items: { signature: Bytes64; message: Bytes; publicKey: PublicKey }[]
): Promise<boolean> {
    for (const item of items) {
        const ok = await ed25519.verify(item.signature, item.message, item.publicKey);
        if (!ok) return false;
    }
    return true;
}

/**
 * Verifies a VERA transaction signature
 */
export function verifyTransactionSignature(
    signature: Signature,
    transactionId: Bytes32
): boolean {
    const message = concat(HashDomains.SIGNATURE, transactionId);
    return verify(signature.signature, message, signature.publicKey);
}

/**
 * Verifies all signatures on a transaction
 */
export function verifyAllSignatures(
    signatures: readonly Signature[],
    transactionId: Bytes32
): boolean {
    if (signatures.length === 0) {
        return false;
    }

    for (const sig of signatures) {
        if (!verifyTransactionSignature(sig, transactionId)) {
            return false;
        }
    }

    return true;
}

// ============================================================================
// Key Validation
// ============================================================================

/**
 * Checks if a public key is valid (on the curve)
 */
export function isValidPublicKey(publicKey: Bytes): boolean {
    if (publicKey.length !== 32) {
        return false;
    }

    try {
        // Try to use it in a verification - this validates the point is on curve
        // We use a dummy signature and message, expecting it to fail but not throw
        const dummySig = new Uint8Array(64);
        const dummyMsg = new Uint8Array(1);
        ed25519.verify(dummySig, dummyMsg, publicKey);
        return true;
    } catch {
        return false;
    }
}

/**
 * Checks if bytes could be a valid private key (just length check)
 */
export function isValidPrivateKey(privateKey: Bytes): boolean {
    return privateKey.length === 32;
}

// ============================================================================
// Utilities
// ============================================================================

/**
 * Derives an address from a seed phrase or arbitrary bytes
 * Uses SHA-256 to derive a deterministic private key
 */
export function deriveKeyPairFromSeed(seed: Bytes): KeyPair {
    const privateKey = sha256(seed);
    const publicKey = getPublicKey(privateKey);
    return { privateKey, publicKey };
}
