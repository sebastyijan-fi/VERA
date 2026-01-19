/**
 * VERA JSON File Store
 *
 * Simple file-based persistence using atomic JSON writes.
 * Suitable for development and small-scale testing.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import {
    type Store,
    type Batch,
    type StoreIterator,
    type Key,
    type Value,
    type IteratorOptions,
    StoreError,
} from './types.js';
import { MemoryStore } from './memory.js';

export class JsonStore implements Store {
    private readonly memory: MemoryStore;
    private readonly filePath: string;
    private saving = false;

    constructor(filePath: string) {
        this.filePath = filePath;
        this.memory = new MemoryStore();
    }

    /**
     * Loads data from disk
     */
    async load(): Promise<void> {
        try {
            const data = await fs.readFile(this.filePath, 'utf-8');
            const json = JSON.parse(data);

            await this.memory.clear();

            for (const [keyHex, valHex] of Object.entries(json)) {
                if (typeof valHex === 'string') {
                    await this.memory.put(keyHex, Buffer.from(valHex, 'hex'));
                }
            }
        } catch (error: any) {
            if (error.code === 'ENOENT') {
                // File doesn't exist, start empty
                return;
            }
            throw new StoreError(`Failed to load store: ${error.message}`);
        }
    }

    async put(key: Key, value: Value): Promise<void> {
        await this.memory.put(key, value);
        await this.save();
    }

    async get(key: Key): Promise<Value | undefined> {
        return this.memory.get(key);
    }

    async del(key: Key): Promise<void> {
        await this.memory.del(key);
        await this.save();
    }

    batch(): Batch {
        const memBatch = this.memory.batch();

        const proxyBatch: Batch = {
            put: (k, v) => {
                memBatch.put(k, v);
                return proxyBatch;
            },
            del: (k) => {
                memBatch.del(k);
                return proxyBatch;
            },
            write: async () => {
                await memBatch.write();
                await this.save();
            }
        };

        return proxyBatch;
    }

    iterator(options?: IteratorOptions): StoreIterator {
        return this.memory.iterator(options);
    }

    async clear(): Promise<void> {
        await this.memory.clear();
        await this.save();
    }

    async close(): Promise<void> {
        // Ensure final save?
    }

    private async save(): Promise<void> {
        if (this.saving) return; // Debounce simply? Or atomic queue?
        // ideally queue saves. For now, simple await.

        // Dump memory to object
        const exportData: Record<string, string> = {};
        const iter = this.memory.iterator();
        const all = await iter.all();

        for (const [k, v] of all) {
            // MemoryStore iterates with original key type? 
            // check memory.ts: it stores keys as strings (normalized) inside Map<string, Uint8Array>

            // We know memory store normalizeKey converts buffers to hex string.
            // But iterator return [Key, Value].
            // MemoryIterator returns [string, Uint8Array] because it iterates map directly.

            const keyStr = typeof k === 'string' ? k : Buffer.from(k).toString('hex');
            exportData[keyStr] = Buffer.from(v).toString('hex');
        }

        const tempPath = `${this.filePath}.tmp`;
        const data = JSON.stringify(exportData, null, 2);

        await fs.mkdir(path.dirname(this.filePath), { recursive: true });
        await fs.writeFile(tempPath, data, 'utf-8');
        await fs.rename(tempPath, this.filePath);
    }
}
