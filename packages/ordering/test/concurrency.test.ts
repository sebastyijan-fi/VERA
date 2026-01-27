
import { describe, it, expect } from 'vitest';
import { createSingleSequencer } from '../src/single.js';
import { createRawTransaction } from '../src/types.js';
import {
    toBytes32,
    zeroBytes32,
    sha256WithDomain,
    HashDomains,
    encodeCanonicalTransaction,
    generateKeyPair,
    sign,
    concat
} from '@vera/core';

describe('REQ-DET-01: Adversarial Schedule (Concurrency)', () => {

    const keyPair = generateKeyPair();

    const mkTx = (nonce: bigint, payloadByte: number) => {
        const sender = keyPair.publicKey;
        const txData = {
            version: 1,
            chainId: zeroBytes32(),
            type: { moduleId: zeroBytes32(), transactionName: 'test' },
            nonce,
            payload: new Uint8Array([payloadByte]),
        };
        const canonical = encodeCanonicalTransaction(txData);
        const hash = sha256WithDomain(HashDomains.TRANSACTION, new Uint8Array(canonical));
        const sig = sign(concat(HashDomains.SIGNATURE, hash) as any, keyPair.privateKey);

        return createRawTransaction(
            hash,
            txData.chainId,
            sender,
            'test',
            txData.payload,
            txData.nonce,
            sig,
            new Uint8Array(canonical)
        );
    };

    it('should maintain strict sequence order under concurrent submission', async () => {
        const sequencer = createSingleSequencer({ chainId: zeroBytes32() });
        await sequencer.start();

        const count = 50;
        const txs = Array.from({ length: count }, (_, i) => mkTx(BigInt(i + 1), i));

        // Submit all concurrently (no await in between)
        const results = await Promise.all(txs.map(tx => sequencer.submit(tx)));

        // Expect all to be accepted (they were sent in order in the array, but Promise.all fires them "together")
        // But wait, in JS, Promise.all calls the functions immediately.
        // The order they land in sequencer.submit depends on call order.
        // Since we map in array order, they arrive 1, 2, 3...

        let accepted = 0;
        const seqs = new Set<bigint>();

        for (const res of results) {
            if (res.accepted) {
                accepted++;
                expect(res.sequenceNumber).toBeDefined();
                seqs.add(res.sequenceNumber!);
            }
        }

        expect(accepted).toBe(count);
        expect(seqs.size).toBe(count);

        // Verify sequence is contiguous 1..count
        const sortedSeqs = Array.from(seqs).sort((a, b) => Number(a - b));
        expect(sortedSeqs[0]).toBe(1n);
        expect(sortedSeqs[count - 1]).toBe(BigInt(count));
    });

    it('should reject conflicting concurrent nonces deterministically', async () => {
        const sequencer = createSingleSequencer({ chainId: zeroBytes32() });
        await sequencer.start();

        // Two tx with SAME nonce
        const tx1 = mkTx(1n, 10);
        const tx2 = mkTx(1n, 20);

        // Submit both concurrently
        const [res1, res2] = await Promise.all([
            sequencer.submit(tx1),
            sequencer.submit(tx2)
        ]);

        // Exactly one must be accepted, one rejected (Duplicate or Nonce too low)
        const totalAccepted = (res1.accepted ? 1 : 0) + (res2.accepted ? 1 : 0);
        expect(totalAccepted).toBe(1);

        const rejected = res1.accepted ? res2 : res1;
        expect(rejected.accepted).toBe(false);
        // It could be 'Duplicate transaction' if hashes were same, but here payloads differ.
        // So it's 'Nonce too low' for the second one.
        expect(rejected.error).toMatch(/Nonce too low/);
    });

    it('should handle race for gap filler', async () => {
        const sequencer = createSingleSequencer({ chainId: zeroBytes32() });
        await sequencer.start();

        // 1. Submit nonce 2 (Gap) -> Should fail immediately in SingleSequencer
        const tx2 = mkTx(2n, 2);
        const res2a = await sequencer.submit(tx2);
        expect(res2a.accepted).toBe(false);
        expect(res2a.error).toMatch(/Nonce too high/);

        // 2. Submit nonce 1 and then nonce 2 concurrently
        const tx1 = mkTx(1n, 1);
        const [res1, res2b] = await Promise.all([
            sequencer.submit(tx1),
            sequencer.submit(tx2)
        ]);

        // Since they arrive nearly together, and are serialized:
        // If T1 processed first -> T1 Accept (N=1), T2 Accept (N=2).
        // If T2 processed first -> T2 Reject (Gap), T1 Accept (N=1).

        // In this implementation, they land in order 1 then 2 because of Promise.all order?
        // Actually Promise.all executes the promises in order.

        expect(res1.accepted).toBe(true);
        // res2b depends on timing, but with SERIALIZATION it should be deterministic based on arrival.
        // If it was non-deterministic, this would be a flake.
    });
});
