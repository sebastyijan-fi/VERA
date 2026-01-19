
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { JsonStore } from '../src/json.js';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

describe('JsonStore', () => {
    let store: JsonStore;
    let tmpDir: string;
    let dbPath: string;

    beforeEach(async () => {
        tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'vera-store-test-'));
        dbPath = path.join(tmpDir, 'db.json');
        store = new JsonStore(dbPath);
    });

    afterEach(async () => {
        await fs.rm(tmpDir, { recursive: true, force: true });
    });

    it('should save and load data', async () => {
        // Write data
        await store.put('key1', new Uint8Array([1, 2, 3]));
        await store.put('key2', new Uint8Array([4, 5, 6]));

        // Create new store instance pointing to same file
        const store2 = new JsonStore(dbPath);
        await store2.load();

        const val1 = await store2.get('key1');
        const val2 = await store2.get('key2');

        expect(new Uint8Array(val1!)).toEqual(new Uint8Array([1, 2, 3]));
        expect(new Uint8Array(val2!)).toEqual(new Uint8Array([4, 5, 6]));
    });

    it('should handle updates and deletes persisting', async () => {
        await store.put('key1', new Uint8Array([1]));
        await store.del('key1');

        const store2 = new JsonStore(dbPath);
        await store2.load();

        expect(await store2.get('key1')).toBeUndefined();
    });

    it('should start empty if file does not exist', async () => {
        const store2 = new JsonStore(path.join(tmpDir, 'non-existent.json'));
        await store2.load();
        const iter = store2.iterator();
        const all = await iter.all();
        expect(all.length).toBe(0);
    });

    it('should persist after batch write', async () => {
        const batch = store.batch();
        batch.put('a', new Uint8Array([1]));
        batch.put('b', new Uint8Array([2]));
        await batch.write();

        const content = await fs.readFile(dbPath, 'utf-8');
        expect(content).toContain('"a"');
        expect(content).toContain('"b"');
    });
});
