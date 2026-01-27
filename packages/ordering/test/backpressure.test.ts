
import { describe, it, expect } from 'vitest';
import { createSingleSequencer } from '../src/single.js';
import {
    zeroBytes32,
    generateKeyPair,
    sha256WithDomain,
    HashDomains,
    encodeCanonicalTransaction,
    sign,
    concat
} from '@vera/core';
import { createRawTransaction } from '../src/types.js';

describe('Sequencer: Backpressure Safety', () => {

    const keyPair = generateKeyPair();

    const mkTx = (nonce: bigint) => {
        const txData = {
            version: 1,
            chainId: zeroBytes32(),
            type: { moduleId: zeroBytes32(), transactionName: 'test' },
            nonce,
            payload: new Uint8Array([0x01]),
        };
        const canonical = encodeCanonicalTransaction(txData);
        const hash = sha256WithDomain(HashDomains.TRANSACTION, new Uint8Array(canonical));
        const sig = sign(concat(HashDomains.SIGNATURE, hash) as any, keyPair.privateKey);

        return createRawTransaction(
            hash,
            txData.chainId,
            keyPair.publicKey,
            'test',
            txData.payload,
            txData.nonce,
            sig,
            new Uint8Array(canonical)
        );
    };

    it('should reject transactions when submission queue is full', async () => {
        // We set a very low batch size and timeout to trigger flushes,
        // but we'll floor the sequencer with more than MAX_SUBMISSION_QUEUE_SIZE
        const sequencer = createSingleSequencer({
            chainId: zeroBytes32(),
            maxBatchSize: 1000,
            batchTimeout: 100, // Slight delay to ensure we can queue up
            maxSubmissionQueueSize: 5
        });
        await sequencer.start();

        const LIMIT = 5;

        // Fire 5 transactions (should all be accepted into queue)
        const txPromises = Array.from({ length: LIMIT }, (_, i) => sequencer.submit(mkTx(BigInt(i + 1))));

        // The 6th should be rejected immediately
        const rejectedResult = await sequencer.submit(mkTx(99n));

        expect(rejectedResult.accepted).toBe(false);
        expect(rejectedResult.error).toContain('Backpressure: Submission queue full');

        // Clean up
        await Promise.all(txPromises);
        await sequencer.stop();
    });
});
