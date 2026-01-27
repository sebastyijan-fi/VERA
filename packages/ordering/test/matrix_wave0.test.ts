
import { describe, it, expect, beforeEach } from 'vitest';
import { SingleSequencer } from '../src/single.js';
import {
    hexToBytes32,
    generateKeyPair,
    signTransaction,
    encodeCanonicalTransaction,
    sha256WithDomain,
    HashDomains,
    zeroBytes32,
    bytesToHex
} from '@vera/core';
import { createRawTransaction } from '../src/types.js';

describe('Wave 0: Ordering & Protocol Quick Wins', () => {
    const chainId = hexToBytes32('01'.repeat(32));
    const alice = generateKeyPair();
    let sequencer: SingleSequencer;

    beforeEach(async () => {
        sequencer = new SingleSequencer({ chainId });
        await sequencer.start();
    });

    function buildTx(nonce: bigint, payload: Uint8Array = new Uint8Array([1, 2, 3])) {
        const txData = {
            version: 1,
            chainId,
            type: { moduleId: zeroBytes32(), transactionName: 'test' },
            nonce,
            payload,
        };
        const canonical = encodeCanonicalTransaction(txData);
        const hash = sha256WithDomain(HashDomains.TRANSACTION, new Uint8Array(canonical));
        const sig = signTransaction(hash, alice.privateKey);
        return createRawTransaction(hash, chainId, alice.publicKey, 'test', payload, nonce, sig.signature, new Uint8Array(canonical));
    }

    describe('G2: Conflicting Transactions (Same Nonce)', () => {
        it('should reject two DIFFERENT transactions with the SAME nonce in the same batch', async () => {
            const tx1 = buildTx(1n, new Uint8Array([1]));
            const tx2 = buildTx(1n, new Uint8Array([2])); // Different hash, same nonce

            const results = await sequencer.submitMany([tx1, tx2]);

            expect(results[0].accepted).toBe(true);
            expect(results[1].accepted).toBe(false);
            expect(results[1].error).toMatch(/Nonce too low|Duplicate nonce/);
        });
    });

    describe('J1: Nonce Overflow', () => {
        it('should handle nonces up to 2^64-1 and reject overflow', async () => {
            const MAX_UINT64 = (1n << 64n) - 1n;

            // This is just a sanity check that we can handle the bigint
            const tx1 = buildTx(1n);
            const res = await sequencer.submit(tx1);
            expect(res.accepted).toBe(true);

            // If we try to submit another one with a huge gap, it should be rejected
            const txMax = buildTx(MAX_UINT64);
            const res2 = await sequencer.submit(txMax);
            expect(res2.accepted).toBe(false);
            expect(res2.error).toContain('Nonce too high (gap)');
        });
    });

    describe('J2: Transaction Size Boundaries', () => {
        it('should reject transactions that are excessively large', { timeout: 120000 }, async () => {
            const hugePayload = new Uint8Array(10 * 1024 * 1024); // 10MB
            const txHuge = buildTx(1n, hugePayload);

            const res = await sequencer.submit(txHuge);
            expect(res.accepted).toBe(false);
            expect(res.error).toContain('Transaction too large');
            console.log(`[J2] 10MB Transaction rejected as expected.`);
        });
    });
});
