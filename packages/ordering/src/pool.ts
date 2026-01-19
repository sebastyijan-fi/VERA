/// <reference types="node" />
/**
 * VERA Transaction Pool
 *
 * Manages pending transactions before sequencing.
 */

import type { Bytes32 } from '@vera/core';
import type { RawTransaction } from './types.js';
import type { Clock } from './clock.js';
import { SystemClock } from './clock.js';

// ============================================================================
// Pool Configuration
// ============================================================================

export interface PoolConfig {
    /** Maximum number of pending transactions */
    maxSize?: number | undefined;
    /** Maximum transaction age in milliseconds */
    maxAge?: number | undefined;
    /** Enable priority ordering */
    priorityEnabled?: boolean | undefined;
    /** Time source */
    clock?: Clock | undefined;
}

// ============================================================================
// Transaction Pool
// ============================================================================

/**
 * In-memory transaction pool
 */
export class TransactionPool {
    private readonly pending: Map<string, RawTransaction> = new Map();
    private readonly maxSize: number;
    private readonly maxAge: number;
    private readonly clock: Clock;
    private evictionTimer: NodeJS.Timeout | null = null;

    constructor(config: PoolConfig = {}) {
        this.maxSize = config.maxSize ?? 10000;
        this.maxAge = config.maxAge ?? 60 * 60 * 1000; // 1 hour
        this.clock = config.clock ?? new SystemClock();
    }

    /**
     * Adds a transaction to the pool
     * @returns true if added, false if duplicate or pool full
     */
    add(tx: RawTransaction): boolean {
        const hashKey = this.hashToKey(tx.hash);

        // Check for duplicate
        if (this.pending.has(hashKey)) {
            return false;
        }

        // Check pool size
        if (this.pending.size >= this.maxSize) {
            // Evict oldest if at capacity
            if (!this.evictOldest()) {
                return false;
            }
        }

        this.pending.set(hashKey, tx);
        return true;
    }

    /**
     * Removes a transaction from the pool
     */
    remove(hash: Bytes32): boolean {
        return this.pending.delete(this.hashToKey(hash));
    }

    /**
     * Gets a transaction by hash
     */
    get(hash: Bytes32): RawTransaction | undefined {
        return this.pending.get(this.hashToKey(hash));
    }

    /**
     * Checks if transaction exists in pool
     */
    has(hash: Bytes32): boolean {
        return this.pending.has(this.hashToKey(hash));
    }

    /**
     * Gets all pending transactions in submission order
     */
    getAll(): RawTransaction[] {
        return [...this.pending.values()].sort(
            (a, b) => Number(a.submittedAt - b.submittedAt)
        );
    }

    /**
     * Gets the next transaction to sequence (FIFO)
     */
    peek(): RawTransaction | undefined {
        const all = this.getAll();
        return all[0];
    }

    /**
     * Removes and returns the next transaction
     */
    pop(): RawTransaction | undefined {
        const tx = this.peek();
        if (tx) {
            this.remove(tx.hash);
        }
        return tx;
    }

    /**
     * Gets pool size
     */
    get size(): number {
        return this.pending.size;
    }

    /**
     * Gets pool capacity
     */
    get capacity(): number {
        return this.maxSize;
    }

    /**
     * Checks if pool is empty
     */
    get isEmpty(): boolean {
        return this.pending.size === 0;
    }

    /**
     * Checks if pool is full
     */
    get isFull(): boolean {
        return this.pending.size >= this.maxSize;
    }

    /**
     * Clears all transactions
     */
    clear(): void {
        this.pending.clear();
    }

    /**
     * Starts automatic eviction of expired transactions
     */
    startEviction(intervalMs = 60000): void {
        if (this.evictionTimer !== null) return;
        this.evictionTimer = setInterval(() => this.evictExpired(), intervalMs);
    }

    /**
     * Stops automatic eviction
     */
    stopEviction(): void {
        if (this.evictionTimer !== null) {
            clearInterval(this.evictionTimer);
            this.evictionTimer = null;
        }
    }

    /**
     * Evicts expired transactions
     */
    evictExpired(): number {
        const now = BigInt(this.clock.now());
        const maxAgeVal = BigInt(this.maxAge);
        let evicted = 0;

        for (const [key, tx] of this.pending) {
            if (now - tx.submittedAt > maxAgeVal) {
                this.pending.delete(key);
                evicted++;
            }
        }

        return evicted;
    }

    private evictOldest(): boolean {
        const tx = this.peek();
        if (tx) {
            this.remove(tx.hash);
            return true;
        }
        return false;
    }

    private hashToKey(hash: Bytes32): string {
        return Array.from(hash)
            .map((b) => b.toString(16).padStart(2, '0'))
            .join('');
    }
}

/**
 * Creates a new transaction pool
 */
export function createPool(config?: PoolConfig): TransactionPool {
    return new TransactionPool(config);
}
