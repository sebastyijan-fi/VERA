
import { describe, it, expect } from 'vitest';
import { createSingleSequencer } from '../src/single.js';
import {
    zeroBytes32,
    sha256WithDomain,
    HashDomains,
    encodeCanonicalTransaction,
    generateKeyPair,
    sign,
    concat,
    SignatureWorkerPool
} from '@vera/core';
import { createRawTransaction } from '../src/types.js';

describe('Performance: Sequencer Batching', () => {

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

    it('should measure throughput of individual submit calls (Concurrent)', async () => {
        const pool = new SignatureWorkerPool();
        const sequencer = createSingleSequencer({
            chainId: zeroBytes32(),
            signaturePool: pool
        });
        await sequencer.start();

        const count = 200;
        const txs = Array.from({ length: count }, (_, i) => mkTx(BigInt(i + 1), i));

        const start = Date.now();
        // Fire them all concurrently - this tests how the sequencer serializes them
        const results = await Promise.all(txs.map(tx => sequencer.submit(tx)));
        const end = Date.now();

        expect(results.every(r => r.accepted)).toBe(true);
        const tps = (count / ((end - start) / 1000)).toFixed(2);
        console.log(`Sequencer (Concurrent Submits): ${end - start}ms (${tps} tx/sec)`);

        await sequencer.stop();
        await pool.close();
    }, 60000);
});
