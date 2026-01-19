/**
 * VERA Store Interface
 *
 * Abstract definitions for key-value storage backends.
 */

// ============================================================================
// Core Types
// ============================================================================

/**
 * Byte array key type
 */
export type Key = Uint8Array | string;

/**
 * Byte array value type
 */
export type Value = Uint8Array;

/**
 * Optional store options
 */
export interface StoreOptions {
    /** Namespace/prefix for keys */
    namespace?: string | undefined;
}

/**
 * Iterator options
 */
export interface IteratorOptions {
    /** Start key (inclusive) */
    gt?: Key | undefined;
    gte?: Key | undefined;
    /** End key (exclusive) */
    lt?: Key | undefined;
    lte?: Key | undefined;
    /** Reverse iteration */
    reverse?: boolean | undefined;
    /** Limit number of results */
    limit?: number | undefined;
}

/**
 * Time source interface
 */
export interface Clock {
    now(): number;
}

// ============================================================================
// Store Interface
// ============================================================================

/**
 * Abstract Key-Value Store
 */
export interface Store {
    /**
     * Puts a value for a key
     */
    put(key: Key, value: Value): Promise<void>;

    /**
     * Gets a value for a key
     * Returns undefined if key not found
     */
    get(key: Key): Promise<Value | undefined>;

    /**
     * Deletes a key
     */
    del(key: Key): Promise<void>;

    /**
     * Creates an atomic batch operation
     */
    batch(): Batch;

    /**
     * Creates an iterator over keys/values
     */
    iterator(options?: IteratorOptions): StoreIterator;

    /**
     * Clears the store (mostly for testing)
     */
    clear(): Promise<void>;

    /**
     * Closes the store connection
     */
    close(): Promise<void>;
}

// ============================================================================
// Batch Interface
// ============================================================================

/**
 * Atomic batch operation
 */
export interface Batch {
    /**
     * Adds a put operation to the batch
     */
    put(key: Key, value: Value): Batch;

    /**
     * Adds a delete operation to the batch
     */
    del(key: Key): Batch;

    /**
     * Commits the batch atomically
     */
    write(): Promise<void>;
}

// ============================================================================
// Iterator Interface
// ============================================================================

/**
 * Iterator over store entries
 */
export interface StoreIterator {
    /**
     * Moves to next entry
     */
    next(): Promise<[Key, Value] | undefined>;

    /**
     * Collects all entries into an array
     */
    all(): Promise<Array<[Key, Value]>>;

    /**
     * Closes the iterator
     */
    end(): Promise<void>;
}

// ============================================================================
// Errors
// ============================================================================

export class StoreError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'StoreError';
    }
}
