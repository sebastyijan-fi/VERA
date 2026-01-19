
import { describe, it, expect, beforeEach } from 'vitest';
import { createFinalityTracker, FinalityTracker } from '../src/finality.js';
import type { OrderedTransaction } from '../src/types.js';

describe('FinalityTracker', () => {
    let tracker: FinalityTracker;

    const createTx = (seq: number): OrderedTransaction => {
        return {
            tx: {} as any, // Mock raw tx
            sequenceNumber: BigInt(seq),
            sequencedAt: BigInt(Date.now()),
            finality: 'sequenced'
        };
    };

    describe('Immediate Finality (Depth 0)', () => {
        beforeEach(() => {
            tracker = createFinalityTracker({ confirmationDepth: 0 });
        });

        it('should track and immediately finalize transaction', () => {
            const tx = createTx(1);
            tracker.track(tx);

            expect(tracker.getFinalityState(1n)).toBe('finalized');
            expect(tracker.finalizedCount).toBe(1);
            expect(tracker.getLastFinalized()).toBe(1n);
        });

        it('should emit finality event', () => {
            const tx = createTx(1);
            let eventTx: OrderedTransaction | undefined;

            tracker.onFinality((t) => {
                eventTx = t;
            });

            tracker.track(tx);
            expect(eventTx?.sequenceNumber).toBe(1n);
            expect(eventTx?.finality).toBe('finalized');
        });
    });

    describe('Delayed Finality (Depth > 0)', () => {
        beforeEach(() => {
            tracker = createFinalityTracker({ confirmationDepth: 2 });
        });

        it('should not finalize immediately', () => {
            const tx1 = createTx(1);
            tracker.track(tx1);

            expect(tracker.getFinalityState(1n)).toBe('sequenced');
            expect(tracker.finalizedCount).toBe(0);
        });

        it('should finalize when depth is reached', () => {
            // Track seq 1
            tracker.track(createTx(1));
            expect(tracker.getFinalityState(1n)).toBe('sequenced');

            // Track seq 2 (Depth 1)
            tracker.track(createTx(2));
            expect(tracker.getFinalityState(1n)).toBe('sequenced');

            // Track seq 3 (Depth 2 - Condition met for 1)
            tracker.track(createTx(3));

            // Formula: maxSeq - seq >= depth
            // 3 - 1 = 2 >= 2 -> Finalize 1
            expect(tracker.getFinalityState(1n)).toBe('finalized');
            expect(tracker.getFinalityState(2n)).toBe('sequenced');
            expect(tracker.getFinalityState(3n)).toBe('sequenced');

            expect(tracker.getLastFinalized()).toBe(1n);
        });
    });

    describe('Manual Finality', () => {
        beforeEach(() => {
            tracker = createFinalityTracker({ confirmationDepth: 10 });
        });

        it('should allow manual finalization', () => {
            tracker.track(createTx(1));
            expect(tracker.getFinalityState(1n)).toBe('sequenced');

            expect(tracker.finalize(1n)).toBe(true);
            expect(tracker.getFinalityState(1n)).toBe('finalized');
        });

        it('should finalize up to specific sequence', () => {
            tracker.track(createTx(1));
            tracker.track(createTx(2));
            tracker.track(createTx(3));

            const count = tracker.finalizeUpTo(2n);
            expect(count).toBe(2);

            expect(tracker.getFinalityState(1n)).toBe('finalized');
            expect(tracker.getFinalityState(2n)).toBe('finalized');
            expect(tracker.getFinalityState(3n)).toBe('sequenced');
        });
    });
});
