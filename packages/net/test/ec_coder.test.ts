
import { describe, it, expect, beforeAll } from 'vitest';
import { ErasureCoder, type Chunk } from '../src/ec/coder.js';

describe('ErasureCoder', () => {
    beforeAll(async () => {
        await ErasureCoder.init();
    });

    // 10 data, 4 parity
    const coder = new ErasureCoder(10, 4);

    // Create random data
    const dataSize = 1024 * 10; // 10KB
    const data = Buffer.alloc(dataSize);
    for (let i = 0; i < dataSize; i++) {
        data[i] = i % 256;
    }

    it('should encode data into chunks', async () => {
        const chunks = await coder.encode(data);
        expect(chunks.length).toBe(14); // 10 + 4

        // Basic structure check
        chunks.forEach(c => {
            expect(c.data).toBeDefined();
            expect(c.index).toBeGreaterThanOrEqual(0);
            expect(c.index).toBeLessThan(14);
        });
    });

    it('should decode from all chunks', async () => {
        const chunks = await coder.encode(data);
        const decoded = await coder.decode(chunks, dataSize);
        expect(Buffer.compare(decoded, data)).toBe(0);
    });

    it('should decode from subset of chunks (missing some data shards)', async () => {
        const chunks = await coder.encode(data); // 0..13

        // Remove 2 data shards (indices 0, 1)
        // Keep all parity shards
        const subset = chunks.filter(c => c.index >= 2);
        // We have 8 data + 4 parity = 12 chunks. Need 10.
        // We have enough.

        const decoded = await coder.decode(subset, dataSize);
        expect(Buffer.compare(decoded, data)).toBe(0);
    });

    it('should decode from subset of chunks (missing some parity shards)', async () => {
        const chunks = await coder.encode(data);

        // Remove 2 parity shards (indices 12, 13)
        const subset = chunks.filter(c => c.index < 12);
        // We have 10 data + 2 parity = 12 chunks. Need 10.

        const decoded = await coder.decode(subset, dataSize);
        expect(Buffer.compare(decoded, data)).toBe(0);
    });

    it('should decode from minimum shards (mixed)', async () => {
        const chunks = await coder.encode(data);

        // Pick specific indices: 7 data, 4 parity -> 11 chunks
        // This checks if we need > k shards for some reason
        const subset = chunks.filter(c => c.index < 7 || c.index >= 10);
        expect(subset.length).toBe(11);

        const decoded = await coder.decode(subset, dataSize);
        expect(Buffer.compare(decoded, data)).toBe(0);
    });

    it('should fail with insufficient chunks', async () => {
        const chunks = await coder.encode(data);
        const subset = chunks.slice(0, 9); // Only 9 chunks

        await expect(coder.decode(subset, dataSize)).rejects.toThrow('Insufficient chunks');
    });
});
