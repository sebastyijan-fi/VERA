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

describe('Nonce Safety Property', () => {
    const chainId = hexToBytes32('01'.repeat(32));
    const alice = generateKeyPair();
    let sequencer: SingleSequencer;

    beforeEach(async () => {
        sequencer = new SingleSequencer({ chainId });
        await sequencer.start();
    });

    function buildTx(nonce: bigint) {
        const txData = {
            version: 1,
            chainId,
            type: {
                moduleId: zeroBytes32(),
                transactionName: 'test',
            },
            nonce,
            payload: new Uint8Array([1, 2, 3]),
        };

        const canonical = encodeCanonicalTransaction(txData);
        const hash = sha256WithDomain(HashDomains.TRANSACTION, new Uint8Array(canonical));
        const sig = signTransaction(hash, alice.privateKey);

        return createRawTransaction(
            hash,
            chainId,
            alice.publicKey,
            'test',
            txData.payload,
            nonce,
            sig.signature,
            new Uint8Array(canonical)
        );
    }

    it('should maintain monotonicity under concurrent submission simulation', async () => {
        const TOTAL = 100;
        const promises = [];

        // We submit txs with nonces 1..TOTAL in parallel tasks
        // Since JS is single-threaded, they will be processed one by one if they are truly sync,
        // but if submitMany has awaits, they might interleave.
        for (let i = 1; i <= TOTAL; i++) {
            promises.push(sequencer.submit(buildTx(BigInt(i))));
        }

        const results = await Promise.all(promises);
        const accepted = results.filter(r => r.accepted);

        // All should be accepted because we sent 1..100
        expect(accepted.length).toBe(TOTAL);

        const status = await sequencer.getStatus();
        expect(status.sequencer.lastSequence).toBe(BigInt(TOTAL));
    });

    it('should reject out-of-order submissions correctly', async () => {
        // Submit nonce 2 then 1
        const res2 = await sequencer.submit(buildTx(2n));
        expect(res2.accepted).toBe(false);
        expect(res2.error).toContain('Nonce too high');

        const res1 = await sequencer.submit(buildTx(1n));
        expect(res1.accepted).toBe(true);

        const res2Again = await sequencer.submit(buildTx(2n));
        expect(res2Again.accepted).toBe(true);
    });

    it('should reject duplicates in same batch', async () => {
        const tx = buildTx(1n);
        const results = await sequencer.submitMany([tx, tx]);

        expect(results[0].accepted).toBe(true);
        expect(results[1].accepted).toBe(false);
        expect(results[1].error).toBe('Nonce too low'); // Caught by nonce check first
    });

    it('should reject lower nonce in same batch', async () => {
        const tx2 = buildTx(2n);
        const tx1 = buildTx(1n);

        // This is tricky: if we send [2, 1], 2 is rejected, then 1 should be accepted
        const results = await sequencer.submitMany([tx2, tx1]);

        expect(results[0].accepted).toBe(false); // Gap rejected
        expect(results[1].accepted).toBe(true); // Nonce 1 accepted (since 2 failed)
        expect(results[1].hash).toEqual(tx1.hash);
    });
});
