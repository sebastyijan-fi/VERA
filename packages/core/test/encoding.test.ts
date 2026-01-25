/**
 * Encoding Module Tests
 */
import { describe, it, expect } from 'vitest';
import {
    encode,
    decode,
    encodeWithSortedKeys,
    encodeCanonicalTransaction,
    encodedEqual,
} from '../src/encoding/cbor.js';
import { bytesEqual, toBytes32, zeroBytes32 } from '../src/types/primitives.js';

describe('CBOR Encoding', () => {
    it('encodes and decodes strings', () => {
        const original = 'hello world';
        const encoded = encode(original);
        const decoded = decode<string>(encoded);
        expect(decoded).toBe(original);
    });

    it('encodes and decodes numbers', () => {
        const original = 12345;
        const encoded = encode(original);
        const decoded = decode<number>(encoded);
        expect(decoded).toBe(original);
    });

    it('encodes and decodes bigints', () => {
        const original = 12345678901234567890n;
        const encoded = encode(original);
        const decoded = decode<bigint>(encoded);
        expect(decoded).toBe(original);
    });

    it('encodes and decodes booleans', () => {
        expect(decode<boolean>(encode(true))).toBe(true);
        expect(decode<boolean>(encode(false))).toBe(false);
    });

    it('encodes and decodes null', () => {
        expect(decode(encode(null))).toBeNull();
    });

    it('encodes and decodes arrays', () => {
        const original = [1, 2, 3, 'hello'];
        const encoded = encode(original);
        const decoded = decode<(number | string)[]>(encoded);
        expect(decoded).toEqual(original);
    });

    it('encodes and decodes objects', () => {
        const original = { a: 1, b: 'hello', c: true };
        const encoded = encode(original);
        const decoded = decode<typeof original>(encoded);
        expect(decoded).toEqual(original);
    });

    it('encodes and decodes Uint8Array', () => {
        const original = new Uint8Array([1, 2, 3, 4, 5]);
        const encoded = encode(original);
        const decoded = decode<Uint8Array>(encoded);
        expect(decoded).toBeInstanceOf(Uint8Array);
        expect(bytesEqual(decoded, original)).toBe(true);
    });

    it('encodes and decodes nested structures', () => {
        const original = {
            name: 'test',
            data: new Uint8Array([1, 2, 3]),
            nested: {
                count: 42n,
                items: ['a', 'b', 'c'],
            },
        };
        const encoded = encode(original);
        const decoded = decode<typeof original>(encoded);
        expect(decoded.name).toBe(original.name);
        expect(bytesEqual(decoded.data, original.data)).toBe(true);
        expect(decoded.nested.count).toBe(original.nested.count);
        expect(decoded.nested.items).toEqual(original.nested.items);
    });
});

describe('Deterministic Encoding', () => {
    it('encodeWithSortedKeys produces consistent output', () => {
        const obj1 = { b: 2, a: 1, c: 3 };
        const obj2 = { a: 1, c: 3, b: 2 };

        const encoded1 = encodeWithSortedKeys(obj1);
        const encoded2 = encodeWithSortedKeys(obj2);

        expect(encodedEqual(encoded1, encoded2)).toBe(true);
    });

    it('same object encodes to same bytes', () => {
        const obj = { key: 'value', num: 42 };
        const encoded1 = encodeWithSortedKeys(obj);
        const encoded2 = encodeWithSortedKeys(obj);
        expect(encodedEqual(encoded1, encoded2)).toBe(true);
    });
});

describe('Transaction Encoding', () => {
    it('encodes canonical transaction deterministically', () => {
        const tx = {
            version: 1,
            chainId: zeroBytes32(),
            type: {
                moduleId: zeroBytes32(),
                transactionName: 'Transfer',
            },
            nonce: 123n,
            payload: new Uint8Array([1, 2, 3]),
        };

        const encoded1 = encodeCanonicalTransaction(tx);
        const encoded2 = encodeCanonicalTransaction(tx);

        expect(encodedEqual(encoded1, encoded2)).toBe(true);
    });

    it('includes maxSequence when present', () => {
        const tx1 = {
            version: 1,
            chainId: zeroBytes32(),
            type: { moduleId: zeroBytes32(), transactionName: 'Test' },
            nonce: 1n,
            payload: new Uint8Array([]),
        };

        const tx2 = {
            ...tx1,
            maxSequence: 100n,
        };

        const encoded1 = encodeCanonicalTransaction(tx1);
        const encoded2 = encodeCanonicalTransaction(tx2);

        expect(encodedEqual(encoded1, encoded2)).toBe(false);
    });
});
