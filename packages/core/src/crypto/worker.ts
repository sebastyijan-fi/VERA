
import { parentPort } from 'worker_threads';
import * as ed25519 from '@noble/ed25519';
import { sha512 } from '@noble/hashes/sha512';
import * as crypto from 'crypto';

// Configure ed25519 to use sha512 (required for sync verification)
ed25519.etc.sha512Sync = (...m) => sha512(ed25519.etc.concatBytes(...m));

if (!parentPort) {
    throw new Error('This script must be run as a worker');
}

interface VerificationItem {
    signature: Uint8Array;
    message: Uint8Array;
    publicKey: Uint8Array;
}

interface WorkerMessage {
    items: VerificationItem[];
    requestId: number;
    chunkIndex: number;
    useBatchVerify?: boolean;
}

/**
 * Batch verify Ed25519 signatures using random linear combination.
 * 
 * This is significantly faster for large batches as it reduces
 * the verification to a single multi-scalar equation:
 * sum(z_i * s_i) * B == sum(z_i * R_i) + sum(z_i * k_i * A_i)
 */
function batchVerify(items: VerificationItem[]): boolean[] {
    if (items.length === 0) return [];
    if (items.length === 1) {
        // Single item - use standard verification
        try {
            return [ed25519.verify(items[0]!.signature, items[0]!.message, items[0]!.publicKey)];
        } catch {
            return [false];
        }
    }

    // For small batches, sequential verification is simpler and reliable
    if (items.length < 8) {
        return items.map(item => {
            try {
                return ed25519.verify(item.signature, item.message, item.publicKey);
            } catch {
                return false;
            }
        });
    }

    // Try true batch verification for larger batches
    try {
        const Point = (ed25519 as any).Point;
        if (!Point) {
            // Fallback to sequential if Point not accessible
            return sequentialVerify(items);
        }

        const B = Point.BASE;
        const L = 0x1000000000000000000000000000000014def9dea2f79cd65812631a5cf5d3edn;
        let sSum = 0n;
        let rSum = Point.ZERO;
        let kaSum = Point.ZERO;

        // Generate random 128-bit scalars
        const randomScalars = items.map(() => {
            const buf = crypto.randomBytes(16);
            let z = 0n;
            for (let i = 0; i < 16; i++) {
                z = (z << 8n) | BigInt(buf[i]!);
            }
            return z + 1n;
        });

        for (let i = 0; i < items.length; i++) {
            const { signature, message, publicKey } = items[i]!;
            const z = randomScalars[i]!;

            // Decode R (first 32 bytes)
            const R = Point.fromHex(bytesToHex(signature.subarray(0, 32)));

            // Decode s (second 32 bytes) as little-endian
            const sBytes = signature.subarray(32, 64);
            let s = 0n;
            for (let j = 0; j < 32; j++) {
                s |= BigInt(sBytes[j]!) << (8n * BigInt(j));
            }

            // Decode public key
            const A = Point.fromHex(bytesToHex(publicKey));

            // Compute challenge k = H(R || A || M) mod L
            const hashInput = new Uint8Array([
                ...signature.subarray(0, 32),
                ...publicKey,
                ...message
            ]);
            const kHash = sha512(hashInput);
            let k = 0n;
            for (let j = 0; j < 64; j++) {
                k |= BigInt(kHash[j]!) << (8n * BigInt(j));
            }
            k = k % L;

            // Accumulate
            sSum = (sSum + z * s) % L;
            rSum = rSum.add(R.multiply(z, false));
            kaSum = kaSum.add(A.multiply((z * k) % L, false));
        }

        // Check equation
        const lhs = B.multiply(sSum, false);
        const rhs = rSum.add(kaSum);
        const batchValid = lhs.clearCofactor().equals(rhs.clearCofactor());

        if (batchValid) {
            // All valid - return array of trues
            return new Array(items.length).fill(true);
        } else {
            // Batch failed - fall back to sequential to identify which failed
            return sequentialVerify(items);
        }
    } catch {
        // On error, fall back to sequential
        return sequentialVerify(items);
    }
}

/**
 * Verify signatures one by one (fallback)
 */
function sequentialVerify(items: VerificationItem[]): boolean[] {
    return items.map(item => {
        try {
            return ed25519.verify(item.signature, item.message, item.publicKey);
        } catch {
            return false;
        }
    });
}

/**
 * Convert bytes to hex string for Point.fromHex
 */
function bytesToHex(bytes: Uint8Array): string {
    return Array.from(bytes)
        .map(b => b.toString(16).padStart(2, '0'))
        .join('');
}

parentPort.on('message', async (data: WorkerMessage) => {
    let results: boolean[];

    // Use batch verification for larger chunks
    if (data.items.length >= 8 || data.useBatchVerify) {
        results = batchVerify(data.items);
    } else {
        results = sequentialVerify(data.items);
    }

    parentPort!.postMessage({
        results,
        requestId: data.requestId,
        chunkIndex: data.chunkIndex
    });
});
