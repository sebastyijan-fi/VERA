
import { describe, it } from 'vitest';
import { generateKeyPair, sign, concat, verifyBatch, HashDomains, SignatureWorkerPool } from '../src/index.js';

describe('Performance: Signature Verification', () => {

    const count = 10000;

    it('should measure single-threaded batch verification throughput', async () => {
        const keyPair = generateKeyPair();
        const items = [];

        for (let i = 0; i < count; i++) {
            const hash = new Uint8Array(32).fill(i % 256);
            const signature = sign(concat(HashDomains.SIGNATURE, hash) as any, keyPair.privateKey);
            items.push({
                signature: signature as any,
                message: concat(HashDomains.SIGNATURE, hash),
                publicKey: keyPair.publicKey
            });
        }

        const start = Date.now();
        const ok = await verifyBatch(items);
        const end = Date.now();

        const duration = end - start;
        const tps = (count / (duration / 1000)).toFixed(2);

        console.log(`Single-Threaded: ${duration}ms (${tps} sig/sec)`);
        if (!ok) throw new Error("Verification failed");
    }, 60000);

    it('should measure parallel batch verification throughput', async () => {
        const keyPair = generateKeyPair();
        const items = [];

        for (let i = 0; i < count; i++) {
            const hash = new Uint8Array(32).fill(i % 256);
            const signature = sign(concat(HashDomains.SIGNATURE, hash) as any, keyPair.privateKey);
            items.push({
                signature: signature as any,
                message: concat(HashDomains.SIGNATURE, hash),
                publicKey: keyPair.publicKey
            });
        }

        const pool = new SignatureWorkerPool();
        const start = Date.now();
        const ok = await verifyBatch(items, pool);
        const end = Date.now();

        const duration = end - start;
        const tps = (count / (duration / 1000)).toFixed(2);

        console.log(`Parallel: ${duration}ms (${tps} sig/sec)`);

        await pool.close();
        if (!ok) throw new Error("Verification failed");
    }, 60000);
});
