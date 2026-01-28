
import { ErasureCoder, Chunk } from './coder.js';

interface CodecConfig {
    k: number;
    m: number;
}

export class BlockReconstructor {
    private readonly coder: ErasureCoder;
    private readonly chunks = new Map<string, Map<number, Chunk>>();
    private readonly completed = new Set<string>();

    constructor(config: CodecConfig = { k: 10, m: 4 }) {
        this.coder = new ErasureCoder(config.k, config.m);
    }

    async addChunk(blockHash: string, chunk: Chunk, _originalSize?: number): Promise<Uint8Array | null> {
        if (this.completed.has(blockHash)) return null; // Already done

        let blockChunks = this.chunks.get(blockHash);
        if (!blockChunks) {
            blockChunks = new Map();
            this.chunks.set(blockHash, blockChunks);
        }

        if (blockChunks.has(chunk.index)) return null; // Duplicate

        blockChunks.set(chunk.index, chunk);

        // Check if we have enough chunks (at least K)
        // Note: ErasureCoder.k is private, but we passed it config.k
        // We can expose k in ErasureCoder or store it here.
        // Assuming we stored it in config or we infer.
        // Let's assume K=10.
        // But originalSize is needed for decode to truncate.
        // Protocol must send originalSize or we rely on some metadata.
        // Usually the first chunk or metadata message tells size.
        // If originalSize is unknown, we can't fully reconstruct (truncate).
        // For now, assume caller passes it if they know, or we return PADDED block if not?

        // If we don't know original size, we return the padded buffer, and caller handles it?
        // Or we enforce metadata message first.

        // Let's try to decode if count >= k AND originalSize is provided.
        // If originalSize is NOT provided, we might still decode but return padded data?
        // But `coder.decode` requires length.

        return null;
    }

    // Attempt reconstruction if possible
    async reconstruct(blockHash: string, originalSize: number): Promise<Uint8Array | null> {
        const blockChunks = this.chunks.get(blockHash);
        if (!blockChunks) return null;

        const chunksArray = Array.from(blockChunks.values());
        try {
            const data = await this.coder.decode(chunksArray, originalSize);
            this.completed.add(blockHash);
            this.chunks.delete(blockHash); // Cleanup
            return data;
        } catch (e) {
            // Not enough chunks yet or other error
            return null;
        }
    }
}
