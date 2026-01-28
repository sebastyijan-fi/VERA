
import { createRequire } from 'module';
import { ReedSolomonErasure } from '@subspace/reed-solomon-erasure.wasm';
import * as path from 'path';
import * as fs from 'fs';

const require = createRequire(import.meta.url);

export interface Chunk {
    index: number;
    data: Uint8Array;
}

export class ErasureCoder {
    private static wasmBytes: Uint8Array | null = null;
    private readonly k: number; // Data shards
    private readonly m: number; // Parity shards

    constructor(k: number = 10, m: number = 4) {
        this.k = k;
        this.m = m;
    }

    /**
     * Initializes the WASM module. Must be called once before usage.
     */
    static async init(): Promise<void> {
        if (ErasureCoder.wasmBytes) return;

        try {
            // Resolve the package entry point to find the WASM file
            const pkgEntry = require.resolve('@subspace/reed-solomon-erasure.wasm');
            const wasmPath = path.join(path.dirname(pkgEntry), 'reed_solomon_erasure_bg.wasm');
            ErasureCoder.wasmBytes = fs.readFileSync(wasmPath);
        } catch (e: any) {
            throw new Error(`Failed to load WASM: ${e.message}`);
        }
    }

    private getEncoder(): ReedSolomonErasure {
        if (!ErasureCoder.wasmBytes) {
            throw new Error('ErasureCoder not initialized. Call ErasureCoder.init() first.');
        }
        // instantiate a fresh encoder every time to avoid shared state corruption
        return ReedSolomonErasure.fromBytes(ErasureCoder.wasmBytes as any);
    }

    /**
     * Encodes data into k + m chunks
     */
    async encode(data: Uint8Array): Promise<Chunk[]> {
        const encoder = this.getEncoder();

        // 1. Calculate shard size
        const minShardSize = Math.ceil(data.length / this.k);
        // Align to 4 bytes (WASM usually likes alignment, though JS TypedArrays handle it)
        // Let's safe align to 8
        const shardSize = Math.ceil(minShardSize / 8) * 8;
        const totalSize = shardSize * (this.k + this.m);

        // 2. Prepare Flat Buffer
        const buffer = new Uint8Array(totalSize);

        // Distribute data into first k shards
        // Since we are using a flat buffer and input data is contiguous,
        // we can simply copy the data into the beginning of the buffer.
        // This corresponds to filling shards 0 to K-1 (partially or fully).
        // Any remaining space in the K data shards is zero-padded by Uint8Array default.
        buffer.set(data);

        // 3. Encode
        const result = encoder.encode(buffer, this.k, this.m);
        if (result !== ReedSolomonErasure.RESULT_OK) {
            throw new Error(`Encoding failed with code ${result}`);
        }

        // 4. Extract Chunks
        const chunks: Chunk[] = [];
        for (let i = 0; i < this.k + this.m; i++) {
            const start = i * shardSize;
            const end = start + shardSize;
            // Create a copy to ensure independent chunks
            chunks.push({
                index: i,
                data: buffer.slice(start, end),
            });
        }

        return chunks;
    }

    /**
     * Decodes chunks back into original data
     */
    async decode(chunks: Chunk[], originalLength: number): Promise<Uint8Array> {
        const encoder = this.getEncoder();

        if (chunks.length === 0) throw new Error('No chunks provided');

        // 1. Determine shard size
        const shardSize = chunks[0]!.data.length;
        const totalSize = shardSize * (this.k + this.m);

        // 2. Prepare Buffer and Availability Map
        const buffer = new Uint8Array(totalSize);
        const shardsAvailable = new Array(this.k + this.m).fill(false);
        let validCount = 0;
        let dataShardsCount = 0;

        for (const chunk of chunks) {
            if (chunk.index < this.k + this.m) {
                const start = chunk.index * shardSize;
                buffer.set(chunk.data, start);
                shardsAvailable[chunk.index] = true;
                validCount++;
                if (chunk.index < this.k) {
                    dataShardsCount++;
                }
            }
        }

        if (dataShardsCount === this.k) {
            // Optimization: We have all data shards, no need to reconstruct.
            return buffer.slice(0, originalLength);
        }

        if (validCount < this.k) {
            throw new Error(`Insufficient chunks. Need ${this.k}, got ${validCount}`);
        }

        // 3. Reconstruct
        const result = encoder.reconstruct(buffer, this.k, this.m, shardsAvailable);
        if (result !== ReedSolomonErasure.RESULT_OK) {
            throw new Error(`Reconstruction failed with code ${result}`);
        }

        // 4. Extract Data
        // The data shards are now fully restored in buffer[0..k*shardSize]
        // We just need to slice up to originalLength.
        return buffer.slice(0, originalLength);
    }
}
