import { FullNode } from '@vera/node';
import { MetricsAggregator } from './metrics.js';
import fs from 'node:fs/promises';

export class NodeSimulator {
    private node: FullNode | null = null;
    public headHeight: number = -1;
    public headRoot: string = '---';

    constructor(
        public readonly id: string,
        private readonly port: number,
        private readonly dataDir: string,
        private readonly metrics: MetricsAggregator
    ) { }

    async start() {
        if (this.node) return;

        await fs.mkdir(this.dataDir, { recursive: true });

        this.node = new FullNode({
            port: this.port,
            dataDir: this.dataDir,
            networkId: 'stress-test-net'
        });

        // Monitor head changes
        this.node.network.on('sync:blocks', (blocks: any[]) => {
            if (blocks.length > 0) {
                const last = blocks[blocks.length - 1];
                this.headHeight = Number(last.height);
                // In a real scenario, we'd get the state root from the block
                // For the simulation, we'll update our internal tracking
            }
        });

        await this.node.start();
        this.updateStatus('ok');
    }

    async stop(graceful: boolean = true) {
        if (!this.node) return;

        if (graceful) {
            await this.node.stop();
        } else {
            // "Crash" - just stop networking and storage without clean flush
            // Note: In a real crash, we'd kill the process. 
            // Here we simulate it by closing without awaiting cleanups if possible.
            await this.node.stop();
        }

        this.node = null;
        this.updateStatus('dead');
    }

    private updateStatus(status: 'ok' | 'dead' | 'syncing' | 'behind') {
        this.metrics.nodes.set(this.id, {
            id: this.id,
            status,
            blockHeight: this.headHeight,
            stateRoot: this.headRoot,
            memoryRss: process.memoryUsage().rss, // Local process memory for now
            latencyP99: 0
        });
    }

    async connectTo(other: NodeSimulator) {
        if (this.node) {
            await this.node.connect('localhost', other.port);
        }
    }

    isAlive(): boolean {
        return this.node !== null;
    }

    // Byzantine: Tamper with state root claim
    tamperStateRoot(fakeRoot: string) {
        this.headRoot = fakeRoot;
        this.updateStatus('ok');
    }

    // Update height from external source (e.g., orchestrator)
    updateHeight(height: number) {
        this.headHeight = height;
        this.updateStatus('ok');
    }
}
