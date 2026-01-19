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
} from '../types/primitives.js';
import { type Signature } from '../types/transaction.js';
import { HashDomains, sha256 } from './hash.js';

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
