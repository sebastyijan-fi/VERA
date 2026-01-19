
import { describe, it, expect, beforeEach } from 'vitest';
import { createSingleSequencer, SingleSequencer } from '../src/single.js';
import { createRawTransaction, type RawTransaction } from '../src/types.js';

describe('SingleSequencer', () => {
    let sequencer: SingleSequencer;

    const createTx = (i: number): RawTransaction => {
        const hash = new Uint8Array(32).fill(i);
        return createRawTransaction(
            hash,
            new Uint8Array(20).fill(1),
            'test',
            new Uint8Array(),
            new Uint8Array()
        );
    };

    beforeEach(async () => {
        sequencer = createSingleSequencer();
        await sequencer.start();
    });

    describe('submit', () => {
        it('should accept and sequence valid transaction', async () => {
            const tx = createTx(1);
            const result = await sequencer.submit(tx);

            expect(result.accepted).toBe(true);
            expect(result.sequenceNumber).toBe(1n);
            expect(result.hash).toEqual(tx.hash);
            expect(result.error).toBeUndefined();
        });

        it('should reject duplicate transaction', async () => {
            const tx = createTx(1);
            await sequencer.submit(tx);

            const result = await sequencer.submit(tx);
            expect(result.accepted).toBe(false);
            expect(result.error).toContain('Duplicate');
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
