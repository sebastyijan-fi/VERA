
import path from 'node:path';
import fs from 'node:fs/promises';
import { LevelDBStore, PersistentStateStore } from '../src/index.js';
import {
    sha256,
    toBytes32,
    EMPTY_TREE_ROOT,
    type StateKey,
    type StateChange,
    hashStateValue,
    serializeStateValue
} from '@vera/core';

const OUT_DIR = path.resolve('bench-out/durability');
const COUNT = 1000;

describe('Bench: LevelDB Durability & Tuning', () => {

    const generateChanges = (n: number, offset: number = 0) => {
        const changes: StateChange[] = [];
        for (let i = 0; i < n; i++) {
            const key: StateKey = {
                namespace: 'Account',
                id: sha256(new Uint8Array([(i + offset) % 256, Math.floor((i + offset) / 256)]))
            };
            changes.push({
                type: 'set',
                key,
                value: {
                    data: new Uint8Array([i % 256]),
                    lastModified: BigInt(Date.now()),
                    schema: { moduleId: new Uint8Array(32) as any, schemaName: 'Account', version: 1 }
                }
            });
        }
        return changes;
    };

    const runBench = async (name: string, storeOptions: any, sync: boolean) => {
        const dbPath = path.join(OUT_DIR, `db_${name.replace(/\s+/g, '_')}`);
        await fs.rm(dbPath, { recursive: true, force: true });
        await fs.mkdir(dbPath, { recursive: true });

        const store = new LevelDBStore(dbPath, storeOptions);
        const stateStore = await PersistentStateStore.load(store);

        const changes = generateChanges(COUNT);

        const start = performance.now();
        await stateStore.apply(changes, 1n, { sync });
        const end = performance.now();

        const duration = end - start;
        const tps = COUNT / (duration / 1000);

        console.log(`${name} | sync=${sync} | ${tps.toFixed(2)} tx/s | ${duration.toFixed(2)}ms`);

        await store.close();
    };

    it('should compare different configurations', async () => {
        console.log('\nLevelDB Durability & Tuning Comparison:');

        await fs.mkdir(OUT_DIR, { recursive: true });

        // Baseline: Default options, async
        await runBench('Baseline (64MB Buf)', {}, false);

        // Strict: Default options, sync
        await runBench('Strict Persistence', {}, true);

        // Tuning: Small buffer, async
        await runBench('Small Buffer (4MB)', { writeBufferSize: 4 * 1024 * 1024 }, false);

        // Tuning: Large cache, async
        await runBench('Large Cache (64MB)', { cacheSize: 64 * 1024 * 1024 }, false);

        // Tuning: No compression
        await runBench('No Compression', { compression: false }, false);
    }, 60000);
});
