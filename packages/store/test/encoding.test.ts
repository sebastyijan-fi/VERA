
import { describe, it, expect } from 'vitest';
import {
    createStateKey,
    encodeStateKey,
    stateKeysEqual,
} from '@vera/core';
import { zeroBytes32, bytesEqual } from '@vera/core';

describe('REQ-VER-01: Binary Key Injectivity', () => {

    it('should be injective for standard inputs', () => {
        const k1 = createStateKey("A", zeroBytes32());
        const k2 = createStateKey("B", zeroBytes32());
        const enc1 = encodeStateKey(k1);
        const enc2 = encodeStateKey(k2);

        expect(bytesEqual(enc1, enc2)).toBe(false);
    });

    it('should handle boundary overlaps via length prefixing', () => {
        // Namespace "user:1", ID "balance" (simulated suffix)
        // vs Namespace "user", ID "1:balance"
        // Here ID is fixed 32 bytes, so this exact overlap isn't possible normally unless ID absorbs namespace structure?
        // But let's verify length prefix works.
        const k1 = createStateKey("user:1", zeroBytes32());
        const k2 = createStateKey("user", zeroBytes32());
        // k1 encoded: [0,0,0,6] "user:1" [00...]
        // k2 encoded: [0,0,0,4] "user"   [00...]

        const enc1 = encodeStateKey(k1);
        const enc2 = encodeStateKey(k2);

        // enc2 starts with len(4), "user".
        // If we deliberately manually concatenated without len, it might look like "user..."

        expect(bytesEqual(enc1, enc2)).toBe(false);

        // Verify prefix presence
        const view1 = new DataView(enc1.buffer, enc1.byteOffset, enc1.byteLength);
        expect(view1.getUint32(0, false)).toBe(6);
    });

    it('should prevent UTF-8 replacement character collision', () => {
        // Use hex escapes to avoid TS/editor replacement
        const badStr = 'test-\u{D800}';
        const collisionStr = 'test-\u{FFFD}';

        // Javascript treats these as distinct strings
        expect((badStr as any) !== (collisionStr as any)).toBe(true);

        const k1 = createStateKey(badStr, zeroBytes32());
        const k2 = createStateKey(collisionStr, zeroBytes32());

        // If encodeStateKey uses TextEncoder freely, both might encode to same bytes
        // causing hash collision in Merkle Tree
        let enc1: Uint8Array;
        let enc2: Uint8Array;

        try {
            enc1 = encodeStateKey(k1);
            enc2 = encodeStateKey(k2);
        } catch (e) {
            // If implementation throws on bad unicode, good!
            return;
        }

        // If we reached here, both encoded successfully.
        // They MUST be different bytes.
        expect(bytesEqual(enc1, enc2)).toBe(false);
    });
});
