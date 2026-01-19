
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SnapshotManager } from '../src/snapshot.js';
import { createStateStore, createStateKey, toBytes32, type StateStore } from '@vera/core';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

describe('SnapshotManager', () => {
    let manager: SnapshotManager;
    let tmpDir: string;
    let snapshotPath: string;

    beforeEach(async () => {
        tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'vera-snapshot-test-'));
        snapshotPath = path.join(tmpDir, 'snapshot.json');
        manager = new SnapshotManager();
    });

    afterEach(async () => {
        await fs.rm(tmpDir, { recursive: true, force: true });
    });

    it('should save and load state', async () => {
        // Create initial state
        const key1 = createStateKey('test', toBytes32(new Uint8Array(32).fill(1)));
        const val1 = {
            data: new Uint8Array([1, 2, 3]),
            lastModified: 100n,
            schema: {
                moduleId: toBytes32(new Uint8Array(32).fill(0)),
                schemaName: 'Test',
                version: 1,
            }
        };

        const state = createStateStore([
            { key: key1, value: val1 }
        ], 1n);

        // Save
        await manager.save(state, snapshotPath);

        // Load
        const loaded = await manager.load(snapshotPath);

        // Verify
        expect(loaded.version).toBe(1n);
        expect(loaded.size()).toBe(1);

        const loadedVal = loaded.get(key1);
        expect(loadedVal).toBeDefined();
        expect(loadedVal?.data).toEqual(val1.data);
        expect(loadedVal?.lastModified).toBe(val1.lastModified);
        expect(loadedVal?.schema).toEqual(val1.schema);
    });

    it('should handle large data', async () => {
        const entries = [];
        for (let i = 0; i < 100; i++) {
            entries.push({
                key: createStateKey('bench', toBytes32(new Uint8Array(32).fill(i))),
                value: {
                    data: new Uint8Array(100).fill(i),
                    lastModified: BigInt(i),
                    schema: {
                        moduleId: toBytes32(new Uint8Array(32)),
                        schemaName: 'Bench',
                        version: 1,
                    }
                }
            });
        }

        const state = createStateStore(entries, 10n);
        await manager.save(state, snapshotPath);

        const loaded = await manager.load(snapshotPath);
        expect(loaded.size()).toBe(100);
        expect(loaded.version).toBe(10n);
    });

    it('should fail cleanly on invalid file', async () => {
        await fs.writeFile(snapshotPath, 'invalid json');
        await expect(manager.load(snapshotPath)).rejects.toThrow();
    });
});
