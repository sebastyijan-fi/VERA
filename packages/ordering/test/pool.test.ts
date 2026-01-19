
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createPool, TransactionPool } from '../src/pool.js';
import { createRawTransaction, type RawTransaction } from '../src/types.js';

describe('TransactionPool', () => {
    let pool: TransactionPool;

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

    beforeEach(() => {
        pool = createPool({ maxSize: 10, maxAge: 1000 });
    });

    describe('add', () => {
        it('should add a transaction', () => {
            const tx = createTx(1);
            expect(pool.add(tx)).toBe(true);
            expect(pool.size).toBe(1);
            expect(pool.has(tx.hash)).toBe(true);
        });

        it('should not add duplicate transaction', () => {
            const tx = createTx(1);
            pool.add(tx);
            expect(pool.add(tx)).toBe(false);
            expect(pool.size).toBe(1);
        });

        it('should accept different transactions', () => {
            pool.add(createTx(1));
            pool.add(createTx(2));
            expect(pool.size).toBe(2);
        });

        it('should evict oldest when full', () => {
            // Fill pool
            for (let i = 0; i < 10; i++) {
                pool.add(createTx(i));
            }
            expect(pool.isFull).toBe(true);

            // Add one more
            const txNew = createTx(11);
            expect(pool.add(txNew)).toBe(true);

            // Should still be full (size 10)
            expect(pool.size).toBe(10);

            // Oldest (0) should be gone, New (11) should be present
            expect(pool.has(new Uint8Array(32).fill(0))).toBe(false);
            expect(pool.has(txNew.hash)).toBe(true);
        });
    });

    describe('remove', () => {
        it('should remove existing transaction', () => {
            const tx = createTx(1);
            pool.add(tx);
            expect(pool.remove(tx.hash)).toBe(true);
            expect(pool.size).toBe(0);
        });

        it('should return false when removing non-existent transaction', () => {
            const tx = createTx(1);
            expect(pool.remove(tx.hash)).toBe(false);
        });
    });

    describe('ordering', () => {
        it('should return transactions in FIFO order based on submission time', () => {
            const tx1 = createTx(1);
            const tx2 = createTx(2);
            const tx3 = createTx(3);

            // Artificially space them out
            tx1.submittedAt = 100n;
            tx2.submittedAt = 200n;
            tx3.submittedAt = 300n;

            pool.add(tx3);
            pool.add(tx1);
            pool.add(tx2);

            const all = pool.getAll();
            expect(all[0].hash).toEqual(tx1.hash);
            expect(all[1].hash).toEqual(tx2.hash);
            expect(all[2].hash).toEqual(tx3.hash);
        });

        it('peek should return oldest transaction', () => {
            const tx1 = createTx(1);
            const tx2 = createTx(2);

            tx1.submittedAt = 100n;
            tx2.submittedAt = 200n;

            pool.add(tx2);
            pool.add(tx1);

            expect(pool.peek()?.hash).toEqual(tx1.hash);
        });

        it('pop should return and remove oldest transaction', () => {
            const tx1 = createTx(1);
            const tx2 = createTx(2);

            tx1.submittedAt = 100n;
            tx2.submittedAt = 200n;

            pool.add(tx2);
            pool.add(tx1);

            const popped = pool.pop();
            expect(popped?.hash).toEqual(tx1.hash);
            expect(pool.size).toBe(1);
            expect(pool.peek()?.hash).toEqual(tx2.hash);
        });
    });

    describe('eviction', () => {
        it('should evict expired transactions', () => {
            const tx1 = createTx(1);
            const tx2 = createTx(2);

            const now = BigInt(Date.now());
            tx1.submittedAt = now; // Fresh
            tx2.submittedAt = now - 2000n; // Expired (maxAge is 1000)

            pool.add(tx1);
            pool.add(tx2);

            const evictedCount = pool.evictExpired();
            expect(evictedCount).toBe(1);
            expect(pool.size).toBe(1);
            expect(pool.has(tx1.hash)).toBe(true);
            expect(pool.has(tx2.hash)).toBe(false);
        });
    });
});
