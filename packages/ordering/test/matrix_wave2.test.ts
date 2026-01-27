
import { describe, it, expect, vi } from 'vitest';
import { createSingleSequencer } from '../src/single.js';
import { createRawTransaction } from '../src/types.js';
import {
    toBytes32,
    bytesToHex,
    encodeCanonicalTransaction,
    sha256WithDomain,
    HashDomains,
    zeroBytes32,
} from '@vera/core';

// ----------------------------------------------------------------------------
// Determinism Helper: Seeded Random
// ----------------------------------------------------------------------------
function mulberry32(a: number) {
    return function () {
        var t = a += 0x6D2B79F5;
        t = Math.imul(t ^ t >>> 15, t | 1);
        t ^= t + Math.imul(t ^ t >>> 7, t | 61);
        return ((t ^ t >>> 14) >>> 0) / 4294967296;
    }
}

describe('Level 4: Transcript Determinism (Matrix Wave 2)', () => {

    // Helper to generate a deterministic workload based on a seed
    const generateWorkload = (seed: number, count: number) => {
        const rand = mulberry32(seed);
        const txs: any[] = [];

        for (let i = 0; i < count; i++) {
            const nonceOffset = Math.floor(rand() * 5); // 0..4 (creates duplicates, low, valid)
            const nonce = BigInt(i - nonceOffset); // Interleaves valid and invalid
            const payload = new Uint8Array([Math.floor(rand() * 255)]);

            const txData = {
                version: 1, chainId: zeroBytes32(), type: { moduleId: zeroBytes32(), transactionName: 'test' },
                nonce: nonce < 0n ? 0n : nonce, payload
            };
            const canonical = encodeCanonicalTransaction(txData);
            const hash = sha256WithDomain(HashDomains.TRANSACTION, new Uint8Array(canonical));
            const sender = toBytes32(Buffer.from('sender-deterministic'.padStart(32, '0')));

            txs.push(createRawTransaction(hash, txData.chainId, sender, 'test', txData.payload, txData.nonce, new Uint8Array(64), new Uint8Array(canonical)));
        }
        return txs;
    };

    // Helper to run a workload and return the Full Transcript
    const runAndCapture = async (workload: any[]) => {
        const sequencer = createSingleSequencer({ chainId: zeroBytes32() });
        await sequencer.start();

        const transcript: any[] = [];

        for (const tx of workload) {
            const res = await sequencer.submit(tx);
            // We capture specific fields that MUST be deterministic
            transcript.push({
                inputHash: bytesToHex(tx.hash, false),
                accepted: res.accepted,
                error: res.error, // Error strings must be identical
                sequenceNumber: res.sequenceNumber?.toString(), // Sequence order must be identical
            });
        }

        const status = await sequencer.getStatus();
        transcript.push({
            finalized: status.finalizedCount,
            lastSeq: status.sequencer.lastSequence.toString()
        });

        return JSON.stringify(transcript);
    };

    it('should produce byte-identical transcripts across independent runs', { timeout: 10000 }, async () => {
        const SEED = 1337;
        const WORKLOAD_SIZE = 50;

        // 1. Generate Deterministic Input Vector
        // (Note: The input vector itself is deterministic by definition of the seeded PRNG)
        const workload = generateWorkload(SEED, WORKLOAD_SIZE);

        // 2. Run 1 (Fresh Machine)
        const transcript1 = await runAndCapture(workload);

        // 3. Run 2 (Fresh Machine)
        const transcript2 = await runAndCapture(workload);

        // 4. Assert Equivalence
        // If this fails, we have non-determinism (e.g. Map iteration order, race conditions, Date.now usage)
        if (transcript1 !== transcript2) {
            const len = Math.min(transcript1.length, transcript2.length);
            let diffIdx = -1;
            for (let i = 0; i < len; i++) {
                if (transcript1[i] !== transcript2[i]) {
                    diffIdx = i; break;
                }
            }
            console.error(`Determinism broke at char index ${diffIdx}`);
        }

        expect(transcript1).toBe(transcript2);
    });

    it('should produce different transcripts for slightly different seeds (Sensitivity)', async () => {
        const w1 = generateWorkload(1234, 100);
        const w2 = generateWorkload(1235, 100); // 1 bit diff in seed

        const t1 = await runAndCapture(w1);
        const t2 = await runAndCapture(w2);

        expect(t1).not.toBe(t2);
    });

});
