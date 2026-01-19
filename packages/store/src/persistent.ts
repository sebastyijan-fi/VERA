import {
    type AsyncStateStore,
    type StateKey,
    type StateValue,
    type StateChange,
    type StateQueryResult,
    type Bytes32,
    bytesToHex,
    hexToBytes,
    encodeStateKey,
    serializeStateValue,
    deserializeStateValue,
    sha256,
    hashStateValue,
    EMPTY_TREE_ROOT,
    toBytes32,
} from '@vera/core';
import type { Store, Clock } from './types.js';
import { DiskMerkleTrie } from './trie.js';

const METADATA_KEY = Buffer.from('__metadata__');

interface StateMetadata {
    version: string;
    root: string;
    timestamp: number;
}

export class PersistentStateStore implements AsyncStateStore {
    private readonly store: Store;
    private readonly trie: DiskMerkleTrie;
    private readonly clock: Clock;
    private _root: Bytes32;
    private _version: bigint;

    constructor(store: Store, clock: Clock, root: Bytes32 = EMPTY_TREE_ROOT, version: bigint = 0n) {
        this.store = store;
        this.clock = clock;
        this.trie = new DiskMerkleTrie(store);
        this._root = root;
        this._version = version;
    }

    /**
     * Loads the store from persistence or initializes a new one.
     */
    static async load(store: Store, clock?: Clock): Promise<PersistentStateStore> {
        const metaBytes = await store.get(METADATA_KEY);
        let root = EMPTY_TREE_ROOT;
        let version = 0n;

        // Default clock if not provided (SystemClock equivalent)
        const sysClock: Clock = clock ?? { now: () => Date.now() };

        if (metaBytes) {
            const meta = JSON.parse(Buffer.from(metaBytes).toString()) as StateMetadata;
            root = toBytes32(hexToBytes(meta.root));
            version = BigInt(meta.version);
        }

        return new PersistentStateStore(store, sysClock, root, version);
    }

    get root(): Bytes32 {
        return this._root;
    }

    get version(): bigint {
        return this._version;
    }

    async get(key: StateKey): Promise<StateValue | null> {
        // Fast path: direct DB lookup
        const dbKey = this.toDbKey(key);
        const data = await this.store.get(dbKey);
        if (!data) return null;
        return deserializeStateValue(data);
    }

    async getWithProof(key: StateKey): Promise<StateQueryResult> {
        const value = await this.get(key);
        const trieKey = sha256(encodeStateKey(key));
        const proof = await this.trie.prove(this._root, trieKey);

        return {
            value,
            proof: {
                ...proof,
                value: value ? serializeStateValue(value) : null
            }
        };
    }

    async has(key: StateKey): Promise<boolean> {
        const dbKey = this.toDbKey(key);
        const data = await this.store.get(dbKey);
        return !!data;
    }

    async *keys(namespace: string): AsyncIterableIterator<StateKey> {
        const prefix = `state:${namespace}:`;
        const iterator = this.store.iterator({
            gte: prefix,
            lte: prefix + '\uffff'
        });

        try {
            while (true) {
                const entry = await iterator.next();
                if (!entry) break;

                const keyStr = typeof entry[0] === 'string' ? entry[0] : Buffer.from(entry[0]).toString('utf-8');
                if (!keyStr.startsWith(prefix)) break;

                yield this.fromDbKey(keyStr);
            }
        } finally {
            await iterator.end();
        }
    }

    async *entries(): AsyncIterableIterator<{ key: StateKey; value: StateValue }> {
        const iterator = this.store.iterator({
            gte: 'state:',
            lte: 'state:\uffff'
        });

        try {
            while (true) {
                const entry = await iterator.next();
                if (!entry) break;

                const keyStr = typeof entry[0] === 'string' ? entry[0] : Buffer.from(entry[0]).toString('utf-8');
                if (!keyStr.startsWith('state:')) continue;

                const key = this.fromDbKey(keyStr);
                const value = deserializeStateValue(entry[1]);
                yield { key, value };
            }
        } finally {
            await iterator.end();
        }
    }

    async size(): Promise<number> {
        const sizeBytes = await this.store.get(Buffer.from('sequencer:state_size'));
        if (!sizeBytes) return 0;
        return parseInt(Buffer.from(sizeBytes).toString('utf-8'));
    }

    async apply(changes: readonly StateChange[], newVersion: bigint): Promise<AsyncStateStore> {
        const batch = this.store.batch();
        const trieCache = new Map<string, any>();
        let newRoot = this._root;
        let sizeDelta = 0;

        // 1. Process Changes
        for (const change of changes) {
            const dbKey = this.toDbKey(change.key);
            const trieKey = sha256(encodeStateKey(change.key));

            if (change.type === 'set') {
                const exists = await this.has(change.key);
                if (!exists) sizeDelta++;

                const valueBytes = serializeStateValue(change.value);
                const valueHash = hashStateValue(valueBytes);

                // Stage DB Update
                batch.put(dbKey, valueBytes);
                // Stage Trie Update
                newRoot = await this.trie.update(newRoot, trieKey, valueHash, batch, trieCache);
            } else {
                const exists = await this.has(change.key);
                if (exists) sizeDelta--;

                // Stage DB Update
                batch.del(dbKey);
                // Stage Trie Update
                newRoot = await this.trie.delete(newRoot, trieKey, batch, trieCache);
            }
        }

        // 2. Update Size Metadata
        const currentSize = await this.size();
        const newSize = Math.max(0, currentSize + sizeDelta);
        batch.put(Buffer.from('sequencer:state_size'), Buffer.from(newSize.toString()));

        // 3. Update Root Metadata
        const metadata: StateMetadata = {
            version: newVersion.toString(),
            root: bytesToHex(newRoot),
            timestamp: this.clock.now(),
        };
        batch.put(METADATA_KEY, Buffer.from(JSON.stringify(metadata)));

        // 4. Commit All Atomically
        await batch.write();

        return new PersistentStateStore(this.store, this.clock, newRoot, newVersion);
    }

    // ========================================================================
    // Helpers
    // ========================================================================

    private toDbKey(key: StateKey): string {
        return `state:${key.namespace}:${bytesToHex(key.id)}`;
    }

    private fromDbKey(dbKey: string): StateKey {
        // Format: state:<namespace>:<hexId>
        const parts = dbKey.split(':');
        if (parts.length < 3) throw new Error(`Invalid DB key: ${dbKey}`);

        const namespace = parts[1]!;
        const hexId = parts[2]!;

        return {
            namespace,
            id: toBytes32(hexToBytes(hexId))
        };
    }
}
