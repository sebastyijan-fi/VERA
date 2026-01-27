/**
 * Crypto Module Tests
 */
import { describe, it, expect } from 'vitest';
import {
    sha256,
    sha256WithDomain,
    doubleSha256,
    hashMerkleLeaf,
    hashMerkleInternal,
    EMPTY_TREE_ROOT,
    HashDomains,
} from '../src/crypto/hash.js';
import {
    generateKeyPair,
    getPublicKey,
    sign,
    verify,
    verifyBatch,
    signTransaction,
    verifyTransactionSignature,
    deriveKeyPairFromSeed,
} from '../src/crypto/sign.js';
import {
    MerkleTree,
    verifyMerkleProof,
} from '../src/crypto/merkle.js';
import {
    bytesEqual,
    hexToBytes,
    bytesToHex,
    toBytes32,
    concat,
} from '../src/types/primitives.js';

describe('Hash Functions', () => {
    it('sha256 produces 32 bytes', () => {
        const data = new TextEncoder().encode('hello');
        const hash = sha256(data);
        expect(hash.length).toBe(32);
    });

    it('sha256 is deterministic', () => {
        const data = new TextEncoder().encode('test');
        const hash1 = sha256(data);
        const hash2 = sha256(data);
        expect(bytesEqual(hash1, hash2)).toBe(true);
    });

    it('sha256 produces different hashes for different inputs', () => {
        const hash1 = sha256(new TextEncoder().encode('hello'));
        const hash2 = sha256(new TextEncoder().encode('world'));
        expect(bytesEqual(hash1, hash2)).toBe(false);
    });

    it('doubleSha256 is deterministic', () => {
        const data = new TextEncoder().encode('test');
        const hash1 = doubleSha256(data);
        const hash2 = doubleSha256(data);
        expect(bytesEqual(hash1, hash2)).toBe(true);
    });

    it('domain-separated hashes differ from raw hashes', () => {
        const data = new TextEncoder().encode('test');
        const rawHash = sha256(data);
        const domainHash = sha256WithDomain(HashDomains.TRANSACTION, data);
        expect(bytesEqual(rawHash, domainHash)).toBe(false);
    });

    it('EMPTY_TREE_ROOT is deterministic', () => {
        const expected = sha256(new TextEncoder().encode('VERA_EMPTY_TREE'));
        expect(bytesEqual(EMPTY_TREE_ROOT, expected)).toBe(true);
    });
});

describe('Ed25519 Signing', () => {
    it('generates valid key pairs', () => {
        const keyPair = generateKeyPair();
        expect(keyPair.privateKey.length).toBe(32);
        expect(keyPair.publicKey.length).toBe(32);
    });

    it('derives correct public key from private key', () => {
        const keyPair = generateKeyPair();
        const derivedPubKey = getPublicKey(keyPair.privateKey);
        expect(bytesEqual(derivedPubKey, keyPair.publicKey)).toBe(true);
    });

    it('signs and verifies messages', () => {
        const keyPair = generateKeyPair();
        const message = new TextEncoder().encode('test message');
        const signature = sign(message, keyPair.privateKey);

        expect(signature.length).toBe(64);
        expect(verify(signature, message, keyPair.publicKey)).toBe(true);
    });

    it('rejects tampered signatures', () => {
        const keyPair = generateKeyPair();
        const message = new TextEncoder().encode('test message');
        const signature = sign(message, keyPair.privateKey);

        // Tamper with signature
        const tamperedSig = new Uint8Array(signature);
        tamperedSig[0] ^= 0xff;

        expect(verify(tamperedSig as any, message, keyPair.publicKey)).toBe(false);
    });

    it('rejects wrong public key', () => {
        const keyPair1 = generateKeyPair();
        const keyPair2 = generateKeyPair();
        const message = new TextEncoder().encode('test message');
        const signature = sign(message, keyPair1.privateKey);

        expect(verify(signature, message, keyPair2.publicKey)).toBe(false);
    });

    it('deriveKeyPairFromSeed is deterministic', () => {
        const seed = new TextEncoder().encode('my seed phrase');
        const keyPair1 = deriveKeyPairFromSeed(seed);
        const keyPair2 = deriveKeyPairFromSeed(seed);

        expect(bytesEqual(keyPair1.privateKey, keyPair2.privateKey)).toBe(true);
        expect(bytesEqual(keyPair1.publicKey, keyPair2.publicKey)).toBe(true);
    });

    it('signTransaction creates valid signatures', () => {
        const keyPair = generateKeyPair();
        const txId = sha256(new TextEncoder().encode('transaction'));
        const sig = signTransaction(txId, keyPair.privateKey);

        expect(sig.publicKey.length).toBe(32);
        expect(sig.signature.length).toBe(64);
        expect(verifyTransactionSignature(sig, txId)).toBe(true);
    });
});

describe('Batch Verification', () => {
    it('verifies empty batch as true', async () => {
        const result = await verifyBatch([]);
        expect(result).toBe(true);
    });

    it('verifies single signature correctly', async () => {
        const keyPair = generateKeyPair();
        const message = new TextEncoder().encode('test message');
        const signature = sign(message, keyPair.privateKey);

        const result = await verifyBatch([
            { signature, message, publicKey: keyPair.publicKey }
        ]);
        expect(result).toBe(true);
    });

    it('verifies multiple valid signatures', async () => {
        const items = [];
        for (let i = 0; i < 10; i++) {
            const keyPair = generateKeyPair();
            const message = new TextEncoder().encode(`message ${i}`);
            const signature = sign(message, keyPair.privateKey);
            items.push({ signature, message, publicKey: keyPair.publicKey });
        }

        const result = await verifyBatch(items);
        expect(result).toBe(true);
    });

    it('detects invalid signature in batch', async () => {
        const keyPair1 = generateKeyPair();
        const keyPair2 = generateKeyPair();

        const message1 = new TextEncoder().encode('message 1');
        const message2 = new TextEncoder().encode('message 2');

        const sig1 = sign(message1, keyPair1.privateKey);
        const sig2 = sign(message2, keyPair2.privateKey);

        // Include a valid signature with wrong public key (invalid)
        const wrongKeyPair = generateKeyPair();

        const result = await verifyBatch([
            { signature: sig1, message: message1, publicKey: keyPair1.publicKey },
            { signature: sig2, message: message2, publicKey: wrongKeyPair.publicKey }, // Wrong key!
        ]);
        expect(result).toBe(false);
    });

    it('handles larger batch efficiently', async () => {
        const items = [];
        for (let i = 0; i < 50; i++) {
            const keyPair = generateKeyPair();
            const message = new TextEncoder().encode(`batch message ${i}`);
            const signature = sign(message, keyPair.privateKey);
            items.push({ signature, message, publicKey: keyPair.publicKey });
        }

        const start = performance.now();
        const result = await verifyBatch(items);
        const elapsed = performance.now() - start;

        expect(result).toBe(true);
        // Just log timing for reference - batch should be reasonably fast
        console.log(`Batch verification of 50 signatures: ${elapsed.toFixed(2)}ms`);
    });
});

describe('Merkle Tree', () => {
    it('empty tree has correct root', () => {
        const tree = new MerkleTree();
        expect(bytesEqual(tree.root, EMPTY_TREE_ROOT)).toBe(true);
    });

    it('single entry tree has deterministic root', () => {
        const entry = {
            key: new TextEncoder().encode('key1'),
            value: new TextEncoder().encode('value1'),
        };
        const tree1 = new MerkleTree([entry]);
        const tree2 = new MerkleTree([entry]);

        expect(bytesEqual(tree1.root, tree2.root)).toBe(true);
    });

    it('different entries produce different roots', () => {
        const tree1 = new MerkleTree([
            { key: new Uint8Array([1]), value: new Uint8Array([1]) },
        ]);
        const tree2 = new MerkleTree([
            { key: new Uint8Array([2]), value: new Uint8Array([2]) },
        ]);

        expect(bytesEqual(tree1.root, tree2.root)).toBe(false);
    });

    it('order of entries does not affect root (sorted)', () => {
        const entry1 = { key: new Uint8Array([1]), value: new Uint8Array([1]) };
        const entry2 = { key: new Uint8Array([2]), value: new Uint8Array([2]) };

        const tree1 = new MerkleTree([entry1, entry2]);
        const tree2 = new MerkleTree([entry2, entry1]);

        expect(bytesEqual(tree1.root, tree2.root)).toBe(true);
    });

    it('get retrieves correct values', () => {
        const entries = [
            { key: new TextEncoder().encode('a'), value: new TextEncoder().encode('value-a') },
            { key: new TextEncoder().encode('b'), value: new TextEncoder().encode('value-b') },
        ];
        const tree = new MerkleTree(entries);

        const valueA = tree.get(new TextEncoder().encode('a'));
        expect(valueA).not.toBeNull();
        expect(new TextDecoder().decode(valueA!)).toBe('value-a');

        const valueC = tree.get(new TextEncoder().encode('c'));
        expect(valueC).toBeNull();
    });

    it('set returns new tree with updated value', () => {
        const tree1 = new MerkleTree([
            { key: new Uint8Array([1]), value: new Uint8Array([1]) },
        ]);

        const tree2 = tree1.set(new Uint8Array([2]), new Uint8Array([2]));

        // Original tree unchanged
        expect(tree1.size).toBe(1);
        expect(tree1.get(new Uint8Array([2]))).toBeNull();

        // New tree has both entries
        expect(tree2.size).toBe(2);
        expect(tree2.get(new Uint8Array([2]))).not.toBeNull();
    });

    it('delete returns new tree without entry', () => {
        const tree1 = new MerkleTree([
            { key: new Uint8Array([1]), value: new Uint8Array([1]) },
            { key: new Uint8Array([2]), value: new Uint8Array([2]) },
        ]);

        const tree2 = tree1.delete(new Uint8Array([1]));

        expect(tree1.size).toBe(2);
        expect(tree2.size).toBe(1);
        expect(tree2.get(new Uint8Array([1]))).toBeNull();
    });

    it('generates verifiable proofs', () => {
        const entries = [
            { key: new TextEncoder().encode('key1'), value: new TextEncoder().encode('value1') },
            { key: new TextEncoder().encode('key2'), value: new TextEncoder().encode('value2') },
            { key: new TextEncoder().encode('key3'), value: new TextEncoder().encode('value3') },
        ];
        const tree = new MerkleTree(entries);

        const proof = tree.getProof(new TextEncoder().encode('key2'));

        expect(proof.value).not.toBeNull();
        expect(bytesEqual(proof.root, tree.root)).toBe(true);
        expect(verifyMerkleProof(proof)).toBe(true);
    });
});

describe('Primitives', () => {
    it('hexToBytes and bytesToHex round-trip', () => {
        const original = '0x1234567890abcdef';
        const bytes = hexToBytes(original);
        const hex = bytesToHex(bytes);
        expect(hex).toBe(original);
    });

    it('concat joins arrays correctly', () => {
        const a = new Uint8Array([1, 2]);
        const b = new Uint8Array([3, 4]);
        const result = concat(a, b);
        expect(Array.from(result)).toEqual([1, 2, 3, 4]);
    });

    it('toBytes32 validates length', () => {
        expect(() => toBytes32(new Uint8Array(31))).toThrow();
        expect(() => toBytes32(new Uint8Array(33))).toThrow();
        expect(() => toBytes32(new Uint8Array(32))).not.toThrow();
    });
});
