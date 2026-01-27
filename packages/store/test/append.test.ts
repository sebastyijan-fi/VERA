/**
 * AppendOnlyStore Tests
 * 
 * Tests for crash recovery and store operations.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { AppendOnlyStore } from '../src/append.js';
import { MemoryStore } from '../src/memory.js';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';

describe('AppendOnlyStore', () => {
    let tempDir: string;
    let walPath: string;
    let baseStore: MemoryStore;

    beforeEach(async () => {
        tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'vera-append-test-'));
        walPath = path.join(tempDir, 'test.wal');
        baseStore = new MemoryStore();
    });

    afterEach(async () => {
        await fs.rm(tempDir, { recursive: true, force: true });
    });

    describe('Basic Operations', () => {
        it('should put and get values', async () => {
            const store = new AppendOnlyStore({
                baseStore,
                wal: { path: walPath },
            });
            await store.open();

            await store.put('key1', new TextEncoder().encode('value1'));
            const result = await store.get('key1');

            expect(result).toBeDefined();
            expect(new TextDecoder().decode(result!)).toBe('value1');

            await store.close();
        });

        it('should delete values', async () => {
            const store = new AppendOnlyStore({
                baseStore,
                wal: { path: walPath },
            });
            await store.open();

            await store.put('key1', new TextEncoder().encode('value1'));
            await store.del('key1');
            const result = await store.get('key1');

            expect(result).toBeUndefined();

            await store.close();
        });

        it('should handle batch operations', async () => {
            const store = new AppendOnlyStore({
                baseStore,
                wal: { path: walPath },
            });
            await store.open();

            const batch = store.batch();
            batch.put('k1', new TextEncoder().encode('v1'));
            batch.put('k2', new TextEncoder().encode('v2'));
            batch.del('k3');
            await batch.write();

            expect(await store.get('k1')).toBeDefined();
            expect(await store.get('k2')).toBeDefined();

            await store.close();
        });
    });

    describe('Crash Recovery', () => {
        it('should recover from WAL after restart', async () => {
            // Write data
            const store1 = new AppendOnlyStore({
                baseStore: new MemoryStore(),
                wal: { path: walPath },
            });
            await store1.open();

            await store1.put('persist-key', new TextEncoder().encode('persist-value'));
            await store1.close();

            // Simulate restart with fresh base store
            const store2 = new AppendOnlyStore({
                baseStore: new MemoryStore(),
                wal: { path: walPath },
            });
            await store2.open();

            const result = await store2.get('persist-key');
            expect(result).toBeDefined();
            expect(new TextDecoder().decode(result!)).toBe('persist-value');

            await store2.close();
        });

        it('should recover deletes after restart', async () => {
            const store1 = new AppendOnlyStore({
                baseStore: new MemoryStore(),
                wal: { path: walPath },
            });
            await store1.open();

            await store1.put('to-delete', new TextEncoder().encode('temp'));
            await store1.del('to-delete');
            await store1.close();

            const store2 = new AppendOnlyStore({
                baseStore: new MemoryStore(),
                wal: { path: walPath },
            });
            await store2.open();

            const result = await store2.get('to-delete');
            expect(result).toBeUndefined();

            await store2.close();
        });
    });

    describe('Checkpointing', () => {
        it('should checkpoint to base store', async () => {
            const sharedBase = new MemoryStore();

            const store = new AppendOnlyStore({
                baseStore: sharedBase,
                wal: { path: walPath },
                checkpointInterval: 5, // Low threshold for testing
            });
            await store.open();

            // Write enough data to trigger checkpoint
            for (let i = 0; i < 10; i++) {
                await store.put(`key${i}`, new TextEncoder().encode(`value${i}`));
            }

            // Manually checkpoint
            await store.checkpoint(new Uint8Array(32), 1n);

            // Data should now be in base store
            const baseValue = await sharedBase.get('key0');
            expect(baseValue).toBeDefined();

            await store.close();
        });
    });

    describe('Snapshots', () => {
        it('should create point-in-time snapshots', async () => {
            const store = new AppendOnlyStore({
                baseStore,
                wal: { path: walPath },
            });
            await store.open();

            await store.put('snap-key', new TextEncoder().encode('snap-v1'));

            const snapshot = store.snapshot();

            // Modify after snapshot
            await store.put('snap-key', new TextEncoder().encode('snap-v2'));

            // Snapshot should have old value
            const snapValue = await snapshot.get('snap-key');
            expect(new TextDecoder().decode(snapValue!)).toBe('snap-v1');

            // Current store should have new value
            const currentValue = await store.get('snap-key');
            expect(new TextDecoder().decode(currentValue!)).toBe('snap-v2');

            await store.close();
        });
    });
});
