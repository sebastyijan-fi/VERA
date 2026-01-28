
import { Worker } from 'node:worker_threads';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { IRProgram } from '@vera/dsl';
import { existsSync } from 'node:fs';

interface WorkerTask {
    txIndex: number;
    program: IRProgram;
    functionName: string;
    args: any[];
    caller: string;
    block: any;
    snapshot: any; // Serialized state
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export class WorkerPool {
    private workers: Worker[] = [];
    private queue: WorkerTask[] = [];
    private activeWorkers = new Set<number>();
    private pendingResolves = new Map<number, (result: any) => void>();
    private pendingRejects = new Map<number, (err: any) => void>();

    constructor(private size: number = 4) {
        this.initialize();
    }

    private initialize() {
        for (let i = 0; i < this.size; i++) {
            this.addWorker(i);
        }
    }

    private addWorker(id: number) {
        // Resolve worker path robustly for both TS(src) and JS(dist) environments
        const currentDir = __dirname;

        let workerScript: string;

        // Check if we are in 'dist' (production/build)
        // dist/parallel/pool.js -> dist/parallel/worker.js
        if (existsSync(join(currentDir, 'worker.js'))) {
            workerScript = join(currentDir, 'worker.js');
        }
        // dist/index.js -> dist/parallel/worker.js (if bundled differently)
        else if (existsSync(join(currentDir, 'parallel', 'worker.js'))) {
            workerScript = join(currentDir, 'parallel', 'worker.js');
        }
        // Check relative to project root for dist (dev/test environment fallback)
        // src/parallel/pool.ts -> ../../dist/parallel/worker.js
        else if (existsSync(join(currentDir, '../../dist/parallel/worker.js'))) {
            workerScript = join(currentDir, '../../dist/parallel/worker.js');
        }
        // Fallback to TS source (requires loader in execArgv)
        else {
            workerScript = join(currentDir, 'worker.ts');
        }

        // console.log(`Worker ${id} script: ${workerScript}`); // Debug


        const worker = new Worker(workerScript, {
            execArgv: process.execArgv
        });

        worker.on('message', (msg) => {
            this.activeWorkers.delete(id);
            const resolve = this.pendingResolves.get(msg.txIndex);
            if (resolve) {
                resolve(msg);
                this.pendingResolves.delete(msg.txIndex);
                this.pendingRejects.delete(msg.txIndex);
            }
            this.processNext(id);
        });

        worker.on('error', (err) => {
            console.error(`Worker ${id} error:`, err);
            this.activeWorkers.delete(id);
            // In a robust system, we would reject the current task and restart the worker
        });

        this.workers[id] = worker;
    }

    async execute(task: WorkerTask): Promise<any> {
        return new Promise((resolve, reject) => {
            this.pendingResolves.set(task.txIndex, resolve);
            this.pendingRejects.set(task.txIndex, reject);
            this.queue.push(task);
            this.processNext(this.getFreeWorker());
        });
    }

    private getFreeWorker(): number {
        for (let i = 0; i < this.size; i++) {
            if (!this.activeWorkers.has(i)) return i;
        }
        return -1;
    }

    private processNext(workerId: number) {
        if (workerId === -1) return;
        if (this.queue.length === 0) return;

        const task = this.queue.shift();
        if (task) {
            this.activeWorkers.add(workerId);
            this.workers[workerId]?.postMessage(task);
        }
    }

    terminate() {
        for (const worker of this.workers) {
            worker.terminate();
        }
    }
}
