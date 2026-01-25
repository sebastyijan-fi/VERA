import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { LevelDBStore } from '../src/level.js';
import { PersistentStateStore } from '../src/persistent.js';
import { bytesToHex, zeroBytes32, toBytes32, hexToBytes } from '@vera/core';
import fs from 'fs/promises';
import path from 'path';

const TEST_DB_PATH = './crash-test-db';

describe('Crash Consistency (Atomic Batch)', () => {

    beforeEach(async () => {
        await fs.rm(TEST_DB_PATH, { recursive: true, force: true });
        await fs.mkdir(TEST_DB_PATH, { recursive: true });
    });

    afterEach(async () => {
        await fs.rm(TEST_DB_PATH, { recursive: true, force: true });
    });

    it('should either commit ALL or NONE of a batch', async () => {
        const store = new LevelDBStore(TEST_DB_PATH);
        const state = new PersistentStateStore(store, { now: () => 0 });

        // 1. Initial State
        const key1 = { namespace: 'test', id: toBytes32(new Uint8Array(32).fill(1)) };
        const val1 = {
            data: new Uint8Array([1, 2, 3]),
            lastModified: 100n,
            schema: { moduleId: 'm1', schemaName: 's1', version: 1 }
        };

        await state.apply([{ type: 'set', key: key1, value: val1 }], 1n);

        // Verify initial state
        const s1 = await PersistentStateStore.load(store);
        expect(await s1.has(key1)).toBe(true);
        const root1 = s1.root;
        await store.close();

        // 2. Simulate a "Crashed" Batch
        // A batch in LevelDB is atomic. We can't easily simulate "pulling the plug" 
        // inside the C++ LevelDB code from JS, but we CAN verify that if `batch.write()`
        // acts atomically, we never see partial updates.

        // We will mock the behavior by manually creating a batch that *would* be partial
        // but checking standard LevelDB behavior guarantees.
        // Actually, the best test here is to confirm that `apply` creates ONE batch.

        // Let's rely on the design property: `PersistentStateStore.apply` 
        // constructs a SINGLE batch and calls `write()` ONCE.

        const store2 = new LevelDBStore(TEST_DB_PATH);
        const state2 = await PersistentStateStore.load(store2);

        // We track the batch operations
        let batchOpsCount = 0;
        const originalBatch = store2.batch.bind(store2);

        // Spy on batch creation
        store2.batch = () => {
            const batch = originalBatch();
            const originalWrite = batch.write.bind(batch);
            batch.write = async () => {
                batchOpsCount++;
                // In a "partial write" scenario (if logic was flawed), 
                // we might see multiple writes.
                // Crash simulation: If we throw HERE, nothing should be committed.
                throw new Error('SIMULATED_CRASH_DURING_WRITE');
            };
            return batch;
        };

        // Try to apply a complex update (Set Value + Update Root + Update Size)
        const key2 = { namespace: 'test', id: toBytes32(new Uint8Array(32).fill(2)) };
        const val2 = {
            data: new Uint8Array([4, 5, 6]),
            lastModified: 200n,
            schema: { moduleId: 'm1', schemaName: 's1', version: 1 }
        };

        try {
            await state2.apply([{ type: 'set', key: key2, value: val2 }], 2n);
        } catch (e: any) {
            expect(e.message).toBe('SIMULATED_CRASH_DURING_WRITE');
        }

        await store2.close();

        // 3. Recovery Verification
        // Re-open DB. It should be in the state from Step 1 (Root1).
        // Key2 should NOT exist.
        // Metadata should NOT be updated.

        const store3 = new LevelDBStore(TEST_DB_PATH);
        const state3 = await PersistentStateStore.load(store3);

        // Key 1 must still exist
        expect(await state3.has(key1)).toBe(true);

        // Key 2 must NOT exist (Atomicity check)
        expect(await state3.has(key2)).toBe(false);

        // Root must match Step 1 (Rollback successful)
        expect(bytesToHex(state3.root)).toBe(bytesToHex(root1));

        await store3.close();
    });
});
