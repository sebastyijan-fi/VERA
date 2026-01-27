
import { Worker } from 'worker_threads';
import { availableParallelism } from 'os';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import * as fs from 'fs';
import { type Bytes64, type Bytes32 } from '../types/primitives.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

export interface VerificationItem {
    signature: Bytes64;
    message: Uint8Array;
    publicKey: Bytes32;
}

interface PendingRequest {
    resolve: (results: boolean[]) => void;
    reject: (err: Error) => void;
    results: boolean[][];
    receivedChunks: number;
    expectedChunks: number;
}

/**
 * Manages a pool of worker threads for parallel signature verification.
 */
export class SignatureWorkerPool {
    private readonly workers: Worker[] = [];
    private readonly pendingRequests = new Map<number, PendingRequest>();
    private nextRequestId = 0;
    private isClosed = false;

    constructor(poolSize: number = availableParallelism()) {
        // Try to find worker.js relative to this file (works in dist)
        let workerPath = join(__dirname, 'worker.js');

        // If not found, try to find the package root and then the dist folder
        if (!fs.existsSync(workerPath)) {
            let currentDir = __dirname;
            while (currentDir !== dirname(currentDir)) {
                if (fs.existsSync(join(currentDir, 'package.json'))) {
                    const potentialPath = join(currentDir, 'dist/crypto/worker.js');
                    if (fs.existsSync(potentialPath)) {
                        workerPath = potentialPath;
                        break;
                    }
                }
                currentDir = dirname(currentDir);
            }
        }

        if (!fs.existsSync(workerPath)) {
            throw new Error(`Signature worker not found. Searched from ${__dirname}. Did you run 'pnpm build'?`);
        }

        for (let i = 0; i < poolSize; i++) {
            const worker = new Worker(workerPath);
            worker.on('message', (msg: { results: boolean[], requestId: number, chunkIndex: number }) => {
                this.handleWorkerMessage(msg);
            });
            worker.on('error', (err) => {
                console.error(`Signature worker error:`, err);
            });
            this.workers.push(worker);
        }
    }

    private handleWorkerMessage(msg: { results: boolean[], requestId: number, chunkIndex: number }) {
        const pending = this.pendingRequests.get(msg.requestId);
        if (!pending) return;

        pending.results[msg.chunkIndex] = msg.results;
        pending.receivedChunks++;

        if (pending.receivedChunks === pending.expectedChunks) {
            const finalResults = pending.results.flat();
            pending.resolve(finalResults);
            this.pendingRequests.delete(msg.requestId);
        }
    }

    /**
     * Verifies a batch of signatures in parallel.
     */
    async verifyBatch(items: VerificationItem[]): Promise<boolean[]> {
        if (this.isClosed) throw new Error('Worker pool is closed');
        if (items.length === 0) return [];

        const requestId = this.nextRequestId++;
        const numWorkers = this.workers.length;

        // Don't split if batch is too small
        if (items.length < 100) {
            const worker = this.workers[requestId % numWorkers];
            if (!worker) {
                return Promise.reject(new Error(`Worker at index ${requestId % numWorkers} is not initialized`));
            }
            const promise = new Promise<boolean[]>((resolve, reject) => {
                this.pendingRequests.set(requestId, {
                    resolve, reject, results: [], receivedChunks: 0, expectedChunks: 1
                });
            });
            worker.postMessage({ items, requestId, chunkIndex: 0 });
            return promise;
        }

        const chunkSize = Math.ceil(items.length / numWorkers);
        const promise = new Promise<boolean[]>((resolve, reject) => {
            this.pendingRequests.set(requestId, {
                resolve,
                reject,
                results: [],
                receivedChunks: 0,
                expectedChunks: 0
            });
        });

        const pending = this.pendingRequests.get(requestId);
        if (!pending) return promise;

        let chunksSent = 0;

        for (let i = 0; i < numWorkers; i++) {
            const start = i * chunkSize;
            const end = Math.min(start + chunkSize, items.length);
            if (start >= end) break;

            const chunk = items.slice(start, end);
            const worker = this.workers[i];
            if (worker) {
                worker.postMessage({ items: chunk, requestId, chunkIndex: i });
                chunksSent++;
            }
        }

        pending.expectedChunks = chunksSent;
        return promise;
    }

    /**
     * Shuts down all workers.
     */
    async close() {
        this.isClosed = true;
        await Promise.all(this.workers.map(w => w?.terminate()));
    }
}
