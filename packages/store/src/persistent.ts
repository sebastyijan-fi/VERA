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
    MerkleCommitmentScheme,
} from '@vera/core';
import type { Store, Clock } from './types.js';
import { DiskMerkleTrie, type TrieNode } from './trie.js';
import { LRUCache } from './cache.js';

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
    private readonly trieCache: LRUCache<string, TrieNode>;
    private _root: Bytes32;
    private _version: bigint;

    constructor(store: Store, clock: Clock, root: Bytes32 = EMPTY_TREE_ROOT, version: bigint = 0n, trieCache?: LRUCache<string, TrieNode>) {
        this.store = store;
        this.clock = clock;
        this.trieCache = trieCache ?? new LRUCache(10000);
        this.trie = new DiskMerkleTrie(store, new MerkleCommitmentScheme()); // Note: commitment should be configurable ideally
        this._root = root;
        this._version = version;
    }

    /**
     * Loads the store from persistence or initializes a new one.
     */
    static async load(store: Store, clock?: Clock, trieCache?: LRUCache<string, TrieNode>): Promise<PersistentStateStore> {
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

        return new PersistentStateStore(store, sysClock, root, version, trieCache);
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
        const encodedKey = encodeStateKey(key);
        const trieKey = sha256(encodedKey);
        const proof = await this.trie.prove(this._root, trieKey); // prove doesn't take cache currently? wait.

        return {
            value,
            proof: {
                ...proof,
                key: trieKey,
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
        const nsBytes = new TextEncoder().encode(namespace);
        const prefix = new Uint8Array(5 + nsBytes.length);
        prefix[0] = 0x01;
        const view = new DataView(prefix.buffer);
        view.setUint32(1, nsBytes.length, false);
        prefix.set(nsBytes, 5);

        const iterator = this.store.iterator({
            gte: prefix,
            lte: new Uint8Array([...prefix, 0xFF])
        });

        try {
            while (true) {
                const entry = await iterator.next();
                if (!entry) break;
                yield this.fromDbKey(entry[0] as Uint8Array);
            }
        } finally {
            await iterator.end();
        }
    }

    async *entries(): AsyncIterableIterator<{ key: StateKey; value: StateValue }> {
        const iterator = this.store.iterator({
            gte: new Uint8Array([0x01]),
            lte: new Uint8Array([0x02])
        });

        try {
            while (true) {
                const entry = await iterator.next();
                if (!entry) break;
                const dbKey = entry[0] as Uint8Array;
                if (dbKey[0] !== 0x01) break;

                const key = this.fromDbKey(dbKey);
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

    async apply(changes: readonly StateChange[], newVersion: bigint, options?: any): Promise<AsyncStateStore> {
        const batch = this.store.batch();
        let sizeDelta = 0;

        const trieChanges: { key: Bytes32, valueHash: Bytes32 | null }[] = [];
        for (const change of changes) {
            const dbKey = this.toDbKey(change.key);
            const trieKey = sha256(encodeStateKey(change.key));

            if (change.type === 'set') {
                const exists = await this.has(change.key);
                if (!exists) sizeDelta++;

                const valueBytes = serializeStateValue(change.value);
                const valueHash = hashStateValue(valueBytes);

                batch.put(dbKey, valueBytes);
                trieChanges.push({ key: trieKey, valueHash });
            } else {
                const exists = await this.has(change.key);
                if (exists) sizeDelta--;

                batch.del(dbKey);
                trieChanges.push({ key: trieKey, valueHash: null });
            }
        }

        const newRoot = await this.trie.updateBatch(this._root, trieChanges, batch, this.trieCache as any);

        const currentSize = await this.size();
        const newSize = Math.max(0, currentSize + sizeDelta);
        batch.put(Buffer.from('sequencer:state_size'), Buffer.from(newSize.toString()));

        const metadata: StateMetadata = {
            version: newVersion.toString(),
            root: bytesToHex(newRoot),
            timestamp: this.clock.now(),
        };
        batch.put(METADATA_KEY, Buffer.from(JSON.stringify(metadata)));

        await batch.write(options);

        return new PersistentStateStore(this.store, this.clock, newRoot, newVersion, this.trieCache);
    }

    private toDbKey(key: StateKey): Uint8Array {
        const encoded = encodeStateKey(key);
        const result = new Uint8Array(encoded.length + 1);
        result[0] = 0x01; // State prefix
        result.set(encoded, 1);
        return result;
    }

    private fromDbKey(dbKey: Uint8Array): StateKey {
        if (dbKey[0] !== 0x01) throw new Error(`Invalid DB key prefix: ${dbKey[0]}`);
        const view = new DataView(dbKey.buffer, dbKey.byteOffset, dbKey.byteLength);
        const nsLen = view.getUint32(1, false);
        const namespace = new TextDecoder().decode(dbKey.slice(5, 5 + nsLen));
        const id = toBytes32(dbKey.slice(5 + nsLen, 5 + nsLen + 32));
        return { namespace, id };
    }
}
