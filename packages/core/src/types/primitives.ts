/**
 * VERA Core Primitive Types
 *
 * Defines the fundamental types used throughout the VERA architecture.
 * All types are designed to be deterministic and serialization-friendly.
 */

// ============================================================================
// Byte Types
// ============================================================================

/**
 * Generic byte array type
 */
export type Bytes = Uint8Array;

/**
 * 32-byte fixed-length array (used for hashes, addresses, keys)
 */
export type Bytes32 = Uint8Array & { readonly __bytes32: unique symbol };

/**
 * 64-byte fixed-length array (used for signatures)
 */
export type Bytes64 = Uint8Array & { readonly __bytes64: unique symbol };

/**
 * Account/entity identifier (32 bytes)
 */
export type Address = Bytes32;

// ============================================================================
// Type Guards and Constructors
// ============================================================================

/**
 * Creates a Bytes32 from a Uint8Array, validating length
 */
export function toBytes32(bytes: Uint8Array): Bytes32 {
    if (bytes.length !== 32) {
        throw new Error(`Expected 32 bytes, got ${bytes.length}`);
    }
    return bytes as Bytes32;
}

/**
 * Creates a Bytes64 from a Uint8Array, validating length
 */
export function toBytes64(bytes: Uint8Array): Bytes64 {
    if (bytes.length !== 64) {
        throw new Error(`Expected 64 bytes, got ${bytes.length}`);
    }
    return bytes as Bytes64;
}

/**
 * Creates an Address from a Uint8Array
 */
export function toAddress(bytes: Uint8Array): Address {
    return toBytes32(bytes);
}

/**
 * Creates a zero-filled Bytes32
 */
export function zeroBytes32(): Bytes32 {
    return new Uint8Array(32) as Bytes32;
}

/**
 * Creates a zero Address
 */
export function zeroAddress(): Address {
    return zeroBytes32();
}

/**
 * Checks if an address is the zero address
 */
export function isZeroAddress(address: Address): boolean {
    return address.every((b) => b === 0);
}

// ============================================================================
// Byte Utilities
// ============================================================================

/**
 * Concatenates multiple byte arrays
 */
export function concat(...arrays: Uint8Array[]): Uint8Array {
    const totalLength = arrays.reduce((sum, arr) => sum + arr.length, 0);
    const result = new Uint8Array(totalLength);
    let offset = 0;
    for (const arr of arrays) {
        result.set(arr, offset);
        offset += arr.length;
    }
    return result;
}

/**
 * Compares two byte arrays for equality
 */
export function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
        if (a[i] !== b[i]) return false;
    }
    return true;
}

/**
 * Compares two byte arrays lexicographically
 * Returns: negative if a < b, 0 if equal, positive if a > b
 */
export function bytesCompare(a: Uint8Array, b: Uint8Array): number {
    const minLen = Math.min(a.length, b.length);
    for (let i = 0; i < minLen; i++) {
        const diff = (a[i] ?? 0) - (b[i] ?? 0);
        if (diff !== 0) return diff;
    }
    return a.length - b.length;
}

/**
 * Converts a hex string to bytes
 */
export function hexToBytes(hex: string): Uint8Array {
    const cleanHex = hex.startsWith('0x') ? hex.slice(2) : hex;
    if (cleanHex.length % 2 !== 0) {
        throw new Error('Invalid hex string: odd length');
    }
    const bytes = new Uint8Array(cleanHex.length / 2);
    for (let i = 0; i < bytes.length; i++) {
        const byte = parseInt(cleanHex.slice(i * 2, i * 2 + 2), 16);
        if (Number.isNaN(byte)) {
            throw new Error(`Invalid hex character at position ${i * 2}`);
        }
        bytes[i] = byte;
    }
    return bytes;
}

/**
 * Converts bytes to a hex string
 */
export function bytesToHex(bytes: Uint8Array, prefix = true): string {
    const hex = Array.from(bytes)
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('');
    return prefix ? `0x${hex}` : hex;
}

/**
 * Converts a hex string to Bytes32
 */
export function hexToBytes32(hex: string): Bytes32 {
    return toBytes32(hexToBytes(hex));
}

// ============================================================================
// Fixed-Point Arithmetic
// ============================================================================

/**
 * Fixed-point decimal number with configurable precision and scale.
 * Stored as a bigint to ensure deterministic arithmetic.
 *
 * @template P - Total number of digits (precision)
 * @template S - Number of decimal places (scale)
 */
export interface Fixed<P extends number = 18, S extends number = 8> {
    readonly value: bigint;
    readonly precision: P;
    readonly scale: S;
}

/**
 * Creates a Fixed value from a bigint representing the scaled value
 */
export function createFixed<P extends number, S extends number>(
    value: bigint,
    precision: P,
    scale: S
): Fixed<P, S> {
    return { value, precision, scale };
}

/**
 * Converts a number to Fixed (for initialization only, not in execution)
 */
export function toFixed<P extends number, S extends number>(
    num: number,
    precision: P,
    scale: S
): Fixed<P, S> {
    const multiplier = 10n ** BigInt(scale);
    const value = BigInt(Math.round(num * Number(multiplier)));
    return createFixed(value, precision, scale);
}

/**
 * Adds two Fixed values with the same precision and scale
 */
export function addFixed<P extends number, S extends number>(
    a: Fixed<P, S>,
    b: Fixed<P, S>
): Fixed<P, S> {
    return createFixed(a.value + b.value, a.precision, a.scale);
}

/**
 * Subtracts two Fixed values with the same precision and scale
 */
export function subFixed<P extends number, S extends number>(
    a: Fixed<P, S>,
    b: Fixed<P, S>
): Fixed<P, S> {
    return createFixed(a.value - b.value, a.precision, a.scale);
}

/**
 * Multiplies two Fixed values (result scale = a.scale + b.scale, needs adjustment)
 */
export function mulFixed<P extends number, S extends number>(
    a: Fixed<P, S>,
    b: Fixed<P, S>
): Fixed<P, S> {
    // Multiply then divide by scale to maintain precision
    const multiplier = 10n ** BigInt(a.scale);
    const result = (a.value * b.value) / multiplier;
    return createFixed(result, a.precision, a.scale);
}

/**
 * Compares two Fixed values
 */
export function compareFixed<P extends number, S extends number>(
    a: Fixed<P, S>,
    b: Fixed<P, S>
): number {
    if (a.value < b.value) return -1;
    if (a.value > b.value) return 1;
    return 0;
}
