
import { describe, it, expect } from 'vitest';
import {
    encodeCanonicalTransaction,
    encodedEqual,
    type CanonicalTransaction,
    encode
} from '../src/encoding/cbor.js';
import { zeroBytes32 } from '../src/types/primitives.js';

describe('REQ-DET-01: Canonical Tx Boundaries', () => {

    // Base transaction for testing
    const baseTx: CanonicalTransaction = {
        version: 1,
        chainId: new Uint8Array(32).fill(1),
        type: {
            moduleId: new Uint8Array(32).fill(2),
            transactionName: 'Transfer',
        },
        nonce: 100n,
        payload: new Uint8Array([0xde, 0xad, 0xbe, 0xef]),
    };

    it('should be deterministic regardless of object key creation order', () => {
        // Create same object but different key order
        const tx1: any = {};
        tx1.version = baseTx.version;
        tx1.type = baseTx.type;
        tx1.chainId = baseTx.chainId;
        tx1.payload = baseTx.payload;
        tx1.nonce = baseTx.nonce;

        const tx2: any = {};
        tx2.nonce = baseTx.nonce;
        tx2.payload = baseTx.payload;
        tx2.chainId = baseTx.chainId;
        tx2.type = baseTx.type;
        tx2.version = baseTx.version;

        const enc1 = encodeCanonicalTransaction(tx1 as CanonicalTransaction);
        const enc2 = encodeCanonicalTransaction(tx2 as CanonicalTransaction);

        expect(encodedEqual(enc1, enc2)).toBe(true);
    });

    it('should treat explicit undefined optional fields same as omitted', () => {
        const tx1 = { ...baseTx };
        const tx2 = { ...baseTx, maxSequence: undefined };

        // Even if we stick undefined in, encodeCanonicalTransaction logic filters it out.
        // But what if we bypass encodeCanonicalTransaction and use encodeWithSortedKeys directly?
        // Canonical encoding relies on encodeCanonicalTransaction function to filter.

        const enc1 = encodeCanonicalTransaction(tx1);
        const enc2 = encodeCanonicalTransaction(tx2);

        expect(encodedEqual(enc1, enc2)).toBe(true);
    });

    it('should fail strict equality if BigInt vs Number is mixed (Type Safety)', () => {
        // This validates that the encoder differentiates types, ensuring uniqueness.
        const tx1 = { ...baseTx, nonce: 100n };
        const tx2 = { ...baseTx, nonce: 100 as any }; // Invalid type, but checking encoding

        // encodeCanonicalTransaction might fail TS check, but at runtime:
        const enc1 = encodeCanonicalTransaction(tx1);
        const enc2 = encodeCanonicalTransaction(tx2); // If runtime allows

        // They should NOT be equal bytes. CBOR distinguishes int(100) and bigint(100).
        expect(encodedEqual(enc1, enc2)).toBe(false);
    });

    it('should handle Uint8Array views deterministically', () => {
        const fullBuffer = new Uint8Array([0, 1, 2, 3, 4, 5]);
        const slice1 = fullBuffer.subarray(0, 3); // [0, 1, 2]
        const slice2 = new Uint8Array([0, 1, 2]); // [0, 1, 2]

        const tx1 = { ...baseTx, payload: slice1 };
        const tx2 = { ...baseTx, payload: slice2 };

        const enc1 = encodeCanonicalTransaction(tx1);
        const enc2 = encodeCanonicalTransaction(tx2);

        expect(encodedEqual(enc1, enc2)).toBe(true);
    });

    it('should be deterministic across distinct object instances', () => {
        const tx1 = JSON.parse(JSON.stringify(baseTx, (key, value) =>
            typeof value === 'bigint' ? value.toString() : value
        ));
        // Restore bigint and uint8arrays
        tx1.nonce = BigInt(tx1.nonce);
        tx1.chainId = new Uint8Array(Object.values(tx1.chainId));
        tx1.type.moduleId = new Uint8Array(Object.values(tx1.type.moduleId));
        tx1.payload = new Uint8Array(Object.values(tx1.payload));

        const enc1 = encodeCanonicalTransaction(baseTx);
        const enc2 = encodeCanonicalTransaction(tx1 as CanonicalTransaction);

        expect(encodedEqual(enc1, enc2)).toBe(true);
    });
});
