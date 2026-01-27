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
    private readonly queue: RawTransaction[] = []; // Min-heap by submittedAt
    private readonly maxSize: number;
    private readonly maxAge: number;
    private readonly clock: Clock;
    private evictionTimer: NodeJS.Timeout | null = null;

    constructor(config: PoolConfig = {}) {
        this.maxSize = config.maxSize ?? 10000;
        this.maxAge = config.maxAge ?? 60 * 60 * 1000;
        this.clock = config.clock ?? new SystemClock();
    }

    /**
     * Adds a transaction to the pool (O(log N))
     */
    add(tx: RawTransaction): boolean {
        const hashKey = this.hashToKey(tx.hash);

        if (this.pending.has(hashKey)) return false;

        if (this.pending.size >= this.maxSize) {
            if (!this.evictOldest()) return false;
        }

        this.pending.set(hashKey, tx);
        this.heapPush(tx);
        return true;
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
     * Removes a transaction from the pool (O(N) due to heap removal, but O(1) for FIFO pop)
     * Note: Removal of specific hash in middle of heap is O(N). 
     * However, standard sequencing uses FIFO pop which is O(log N).
     */
    remove(hash: Bytes32): boolean {
        const hashKey = this.hashToKey(hash);
        const tx = this.pending.get(hashKey);
        if (!tx) return false;

        this.pending.delete(hashKey);
        // We don't remove from heap immediately to keep it O(1) here?
        // No, if we don't remove, heap grows too large.
        // But the common case is pop() which is O(log N).
        // Let's implement heap search-and-remove for completeness, or just ignore the performance hit for manual remove.
        // For O(1) or O(log N) strictness, we should use a more complex structure (e.g. Heap with Map of indices).
        const idx = this.queue.indexOf(tx);
        if (idx !== -1) {
            this.heapRemoveAt(idx);
        }
        return true;
    }

    /**
     * Gets the next transaction to sequence (O(1))
     */
    peek(): RawTransaction | undefined {
        return this.queue[0];
    }

    /**
     * Removes and returns the next transaction (O(log N))
     */
    pop(): RawTransaction | undefined {
        const tx = this.heapPop();
        if (tx) {
            this.pending.delete(this.hashToKey(tx.hash));
        }
        return tx;
    }

    getAll(): RawTransaction[] {
        // Return sorted copy for consumers
        return [...this.queue].sort((a, b) => Number(a.submittedAt - b.submittedAt));
    }

    get size(): number { return this.pending.size; }
    get capacity(): number { return this.maxSize; }
    get isEmpty(): boolean { return this.pending.size === 0; }
    get isFull(): boolean { return this.pending.size >= this.maxSize; }

    clear(): void {
        this.pending.clear();
        this.queue.length = 0;
    }

    startEviction(intervalMs = 60000): void {
        if (this.evictionTimer !== null) return;
        this.evictionTimer = setInterval(() => this.evictExpired(), intervalMs);
    }

    stopEviction(): void {
        if (this.evictionTimer !== null) {
            clearInterval(this.evictionTimer);
            this.evictionTimer = null;
        }
    }

    evictExpired(): number {
        const now = BigInt(this.clock.now());
        const maxAgeVal = BigInt(this.maxAge);
        let evicted = 0;

        // Efficiently remove from front of heap if expired
        while (this.queue.length > 0 && now - this.queue[0]!.submittedAt > maxAgeVal) {
            this.pop();
            evicted++;
        }
        return evicted;
    }

    private evictOldest(): boolean {
        const tx = this.pop();
        return !!tx;
    }

    // ========================================================================
    // Heap Implementation (Min-Heap by submittedAt)
    // ========================================================================

    private heapPush(tx: RawTransaction): void {
        this.queue.push(tx);
        this.bubbleUp(this.queue.length - 1);
    }

    private heapPop(): RawTransaction | undefined {
        if (this.queue.length === 0) return undefined;
        if (this.queue.length === 1) return this.queue.pop();

        const top = this.queue[0];
        this.queue[0] = this.queue.pop()!;
        this.bubbleDown(0);
        return top;
    }

    private heapRemoveAt(idx: number): void {
        if (idx === this.queue.length - 1) {
            this.queue.pop();
            return;
        }
        this.queue[idx] = this.queue.pop()!;
        this.bubbleDown(idx);
        this.bubbleUp(idx);
    }

    private bubbleUp(idx: number): void {
        while (idx > 0) {
            const parent = (idx - 1) >> 1;
            if (this.queue[idx]!.submittedAt >= this.queue[parent]!.submittedAt) break;
            [this.queue[idx], this.queue[parent]] = [this.queue[parent]!, this.queue[idx]!];
            idx = parent;
        }
    }

    private bubbleDown(idx: number): void {
        while (true) {
            let smallest = idx;
            const left = 2 * idx + 1;
            const right = 2 * idx + 2;

            if (left < this.queue.length &&
                this.queue[left]!.submittedAt < this.queue[smallest]!.submittedAt) {
                smallest = left;
            }
            if (right < this.queue.length &&
                this.queue[right]!.submittedAt < this.queue[smallest]!.submittedAt) {
                smallest = right;
            }

            if (smallest === idx) break;
            [this.queue[idx], this.queue[smallest]] = [this.queue[smallest]!, this.queue[idx]!];
            idx = smallest;
        }
    }

    private hashToKey(hash: Uint8Array): string {
        return Array.from(hash).map(b => b.toString(16).padStart(2, '0')).join('');
    }
}

/**
 * Creates a new transaction pool
 */
export function createPool(config?: PoolConfig): TransactionPool {
    return new TransactionPool(config);
}
