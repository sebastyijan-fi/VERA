
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createSingleSequencer, SingleSequencer } from '../src/single.js';
import { createRawTransaction, type RawTransaction } from '../src/types.js';

import {
    toBytes32,
    bytesToHex,
    encodeCanonicalTransaction,
    sha256WithDomain,
    HashDomains,
    zeroBytes32,
} from '@vera/core';

vi.mock('@vera/core', async () => {
    const actual = await vi.importActual('@vera/core');
    return {
        ...actual,
        verifyTransactionSignature: () => true,
    };
});

describe('SingleSequencer', () => {
    let sequencer: SingleSequencer;

    const createTx = (i: number): RawTransaction => {
        const txData = {
            version: 1,
            chainId: zeroBytes32(),
            type: {
                moduleId: zeroBytes32(),
                transactionName: 'test',
            },
            nonce: BigInt(i),
            payload: new Uint8Array([i]),
        };

        const canonical = encodeCanonicalTransaction(txData);
        const hash = sha256WithDomain(HashDomains.TRANSACTION, new Uint8Array(canonical));
        const sender = toBytes32(Buffer.from(`sender`.padStart(32, '0')));

        return createRawTransaction(
            hash,
            txData.chainId,
            sender,
            'test',
            txData.payload,
            txData.nonce,
            new Uint8Array(64), // signature
            new Uint8Array(canonical)
        );
    };

    beforeEach(async () => {
        sequencer = createSingleSequencer();
        await sequencer.start();
    });

    describe('submit', () => {
        it('should accept and sequence valid transaction', async () => {
            const tx = createTx(1);
            const statusBefore = await sequencer.getStatus();

            const result = await sequencer.submit(tx);

            expect(result.accepted).toBe(true);
            expect(result.sequenceNumber).toBe(1n);

            const statusAfter = await sequencer.getStatus();
            expect(statusAfter.sequencer.lastSequence).toBe(1n);
            expect(statusAfter.finalizedCount).toBe(Number(statusBefore.finalizedCount) + 1);
        });

        it('should reject duplicate transaction and have NO side effects', async () => {
            const tx = createTx(1);
            await sequencer.submit(tx);
            const statusMid = await sequencer.getStatus();

            const result = await sequencer.submit(tx);
            expect(result.accepted).toBe(false);
            expect(result.error).toMatch(/Duplicate|Nonce too low/);

            const statusFinal = await sequencer.getStatus();
            expect(statusFinal.sequencer.lastSequence).toBe(statusMid.sequencer.lastSequence);
            expect(statusFinal.finalizedCount).toBe(statusMid.finalizedCount);
        });

        it('should implement monotonic sequencing', async () => {
            const res1 = await sequencer.submit(createTx(1));
            const res2 = await sequencer.submit(createTx(2));
            const res3 = await sequencer.submit(createTx(3));

            expect(res1.sequenceNumber).toBe(1n);
            expect(res2.sequenceNumber).toBe(2n);
            expect(res3.sequenceNumber).toBe(3n);
        });
    });

    describe('retrieval', () => {
        it('should retrieve ordered transaction by sequence', async () => {
            const tx = createTx(1);
            await sequencer.submit(tx);

            const ordered = await sequencer.getBySequence(1n);
            expect(ordered).toBeDefined();
            expect(ordered?.tx.hash).toEqual(tx.hash);
            expect(ordered?.sequenceNumber).toBe(1n);
        });

        it('should return undefined for non-existent sequence', async () => {
            const ordered = await sequencer.getBySequence(999n);
            expect(ordered).toBeUndefined();
        });

        it('should retrieve range of transactions', async () => {
            await sequencer.submit(createTx(1));
            await sequencer.submit(createTx(2));
            await sequencer.submit(createTx(3));

            const range = await sequencer.getRange(1n, 2n);
            expect(range.length).toBe(2);
            expect(range[0].sequenceNumber).toBe(1n);
            expect(range[1].sequenceNumber).toBe(2n);
        });
    });

    describe('subscriptions', () => {
        it('should emit new transactions', async () => {
            const tx = createTx(1);
            let emittedSeq = 0n;

            sequencer.onTransaction((t) => {
                emittedSeq = t.sequenceNumber;
            });

            await sequencer.submit(tx);
            expect(emittedSeq).toBe(1n);
        });
    });

    describe('status', () => {
        it('should report correct status', async () => {
            await sequencer.submit(createTx(1));
            await sequencer.submit(createTx(2));

            const status = await sequencer.getStatus();
            expect(status.sequencer.isActive).toBe(true);
            expect(status.sequencer.lastSequence).toBe(2n);
            expect(status.finalizedCount).toBe(2); // SingleSequencer is immediate finality by default
        });
    });
});

describe('Level 3: Model Agreement (Reference Semantics)', () => {

    // 1. The Reference Model (Ideal Spec)
    // A simplified, verifiable implementation of the Nonce State Machine.
    class ReferenceSequencer {
        private nonces = new Map<string, bigint>();
        private sequence = 1n;

        submit(tx: RawTransaction): { accepted: boolean, error?: RegExp, expectedSeq?: bigint } {
            const sender = bytesToHex(tx.sender, false);
            const currentNonce = this.nonces.get(sender) ?? 0n;

            if (tx.nonce <= currentNonce) {
                return { accepted: false, error: /Nonce too low/ };
            }
            if (tx.nonce > currentNonce + 1n) {
                return { accepted: false, error: /Nonce too high/ };
            }

            // Accept
            this.nonces.set(sender, tx.nonce);
            const seq = this.sequence++;
            return { accepted: true, expectedSeq: seq };
        }
    }

    it('should match Reference Model output for random workload', async () => {
        const system = createSingleSequencer({ chainId: zeroBytes32() });
        await system.start();
        const model = new ReferenceSequencer();

        // 2. Fuzz Generator
        const workloadSize = 100;
        const senders = ['alice', 'bob', 'charlie'].map(s =>
            toBytes32(Buffer.from(s.padEnd(32, '0')))
        );

        // Helper to make random tx
        const makeRandomTx = (i: number) => {
            const senderIdx = Math.floor(Math.random() * senders.length);
            const sender = senders[senderIdx];
            // Random nonce: sometimes valid, sometimes low, sometimes gap
            const randomness = Math.random();
            let nonceMod = 1; // Valid
            if (randomness < 0.2) nonceMod = 0; // Low
            if (randomness > 0.8) nonceMod = 5; // Gap

            // We need to track actual nonce per sender to generate "interesting" traffic
            // But specifically for this test, we want to test the RESPONSE to arbitrary inputs.
            // So let's just pick a nonce range [1..50].
            const nonce = BigInt(Math.floor(Math.random() * 50) + 1);

            const txData = {
                version: 1, chainId: zeroBytes32(), type: { moduleId: zeroBytes32(), transactionName: 'test' },
                nonce, payload: new Uint8Array([i])
            };
            const canonical = encodeCanonicalTransaction(txData);
            const hash = sha256WithDomain(HashDomains.TRANSACTION, new Uint8Array(canonical));

            return createRawTransaction(hash, txData.chainId, sender, 'test', txData.payload, txData.nonce, new Uint8Array(64), new Uint8Array(canonical));
        };

        // 3. Execution & Comparison
        for (let i = 0; i < workloadSize; i++) {
            const tx = makeRandomTx(i);

            const modelRes = model.submit(tx);
            const sysRes = await system.submit(tx);

            // ASSERT AGREEMENT
            // 1. Acceptance
            expect(sysRes.accepted).toBe(modelRes.accepted);

            // 2. Error Class (if rejected)
            if (!modelRes.accepted) {
                expect(sysRes.error).toMatch(modelRes.error!);
            }

            // 3. Side Effect (Sequence Number if accepted)
            if (modelRes.accepted) {
                expect(sysRes.sequenceNumber).toBe(modelRes.expectedSeq);
            }
        }
    });
});
