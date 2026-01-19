/**
 * VERA CBOR Encoding
 *
 * Deterministic CBOR encoding/decoding for serialization.
 * Uses cbor-x with configuration for deterministic output.
 */

import { Encoder, decode as cborDecode } from 'cbor-x';
import type { Bytes } from '../types/primitives.js';

// ============================================================================
// Encoder Configuration
// ============================================================================

/**
 * CBOR encoder configured for deterministic output.
 * - Keys are sorted for canonical encoding
 * - Maps preserve insertion order (after sorting)
 */
const deterministicEncoder = new Encoder({
    // Sort keys in maps for deterministic output
    structuredClone: true,
    // Use canonical CBOR encoding
    mapsAsObjects: false,
    // Preserve bigint as CBOR integer
    largeBigIntToFloat: false,
});

// ============================================================================
// Core Encoding Functions
// ============================================================================

/**
 * Encodes a value to deterministic CBOR bytes
 */
export function encode(value: unknown): Bytes {
    return deterministicEncoder.encode(value);
}

/**
 * Decodes CBOR bytes to a value
 */
export function decode<T = unknown>(bytes: Bytes): T {
    return cborDecode(bytes) as T;
}

/**
 * Encodes a value and returns it as a Uint8Array
 */
export function encodeToBytes(value: unknown): Uint8Array {
    return new Uint8Array(encode(value));
}

// ============================================================================
// Specialized Encoding
// ============================================================================

/**
 * Encodes an object with sorted keys for deterministic output
 */
export function encodeWithSortedKeys(obj: Record<string, unknown>): Bytes {
    const sortedObj = sortObjectKeys(obj);
    return encode(sortedObj);
}

/**
 * Recursively sorts object keys for deterministic encoding
 */
function sortObjectKeys(obj: unknown): unknown {
    if (obj === null || obj === undefined) {
        return obj;
    }

    if (obj instanceof Uint8Array) {
        return obj;
    }

    if (Array.isArray(obj)) {
        return obj.map(sortObjectKeys);
    }

    if (typeof obj === 'object') {
        const sorted: Record<string, unknown> = {};
        const keys = Object.keys(obj as Record<string, unknown>).sort();
        for (const key of keys) {
            sorted[key] = sortObjectKeys((obj as Record<string, unknown>)[key]);
        }
        return sorted;
    }

    return obj;
}

// ============================================================================
// Transaction Encoding
// ============================================================================

/**
 * Canonical fields for transaction ID computation
 */
export interface CanonicalTransaction {
    version: number;
    type: {
        moduleId: Uint8Array;
        transactionName: string;
    };
    nonce: bigint;
    maxSequence?: bigint;
    payload: Uint8Array;
}

/**
 * Encodes a transaction in canonical form for hashing
 */
export function encodeCanonicalTransaction(tx: CanonicalTransaction): Bytes {
    const canonical: Record<string, unknown> = {
        version: tx.version,
        type: {
            moduleId: tx.type.moduleId,
            transactionName: tx.type.transactionName,
        },
        nonce: tx.nonce,
        payload: tx.payload,
    };

    if (tx.maxSequence !== undefined) {
        canonical['maxSequence'] = tx.maxSequence;
    }

    return encodeWithSortedKeys(canonical);
}

// ============================================================================
// State Value Encoding
// ============================================================================

/**
 * Encodes a state value for storage
 */
export function encodeStateValue(value: {
    data: Bytes;
    lastModified: bigint;
    schema: {
        moduleId: Bytes;
        schemaName: string;
        version: number;
    };
}): Bytes {
    return encodeWithSortedKeys({
        data: value.data,
        lastModified: value.lastModified,
        schema: {
            moduleId: value.schema.moduleId,
            schemaName: value.schema.schemaName,
            version: value.schema.version,
        },
    });
}

/**
 * Decodes a state value from storage
 */
export function decodeStateValue(bytes: Bytes): {
    data: Uint8Array;
    lastModified: bigint;
    schema: {
        moduleId: Uint8Array;
        schemaName: string;
        version: number;
    };
} {
    const decoded = decode<{
        data: Uint8Array;
        lastModified: bigint;
        schema: {
            moduleId: Uint8Array;
            schemaName: string;
            version: number;
        };
    }>(bytes);
    return decoded;
}

// ============================================================================
// Utilities
// ============================================================================

/**
 * Checks if two CBOR-encoded values are equal
 */
export function encodedEqual(a: Bytes, b: Bytes): boolean {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
        if (a[i] !== b[i]) return false;
    }
    return true;
}

/**
 * Gets the size of a CBOR-encoded value
 */
export function getEncodedSize(value: unknown): number {
    return encode(value).length;
}

// ============================================================================
// Type-Safe Decode Helpers
// ============================================================================

/**
 * Decodes and validates as string
 */
export function decodeString(bytes: Bytes): string {
    const value = decode(bytes);
    if (typeof value !== 'string') {
        throw new Error('Expected string');
    }
    return value;
}

/**
 * Decodes and validates as number
 */
export function decodeNumber(bytes: Bytes): number {
    const value = decode(bytes);
    if (typeof value !== 'number') {
        throw new Error('Expected number');
    }
    return value;
}

/**
 * Decodes and validates as bigint
 */
export function decodeBigInt(bytes: Bytes): bigint {
    const value = decode(bytes);
    if (typeof value !== 'bigint') {
        throw new Error('Expected bigint');
    }
    return value;
}

/**
 * Decodes and validates as boolean
 */
export function decodeBoolean(bytes: Bytes): boolean {
    const value = decode(bytes);
    if (typeof value !== 'boolean') {
        throw new Error('Expected boolean');
    }
    return value;
}

/**
 * Decodes and validates as Uint8Array
 */
export function decodeBytes(bytes: Bytes): Uint8Array {
    const value = decode(bytes);
    if (!(value instanceof Uint8Array)) {
        throw new Error('Expected Uint8Array');
    }
    return value;
}
