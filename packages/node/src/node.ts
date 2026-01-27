import { ParallelExecutor } from '@vera/engine';
import { NetworkNode } from '@vera/net';
import { CommitLog, type CommitEntry } from '@vera/store';
import { type BlockProvider } from '@vera/net';
import { type NodeConfig, DEFAULT_CONFIG } from './config.js';
import path from 'path'; // Assuming 'path' module is available for path.join

// Dummy program for executor initialization
const DUMMY_PROGRAM: any = { functions: {}, globals: [] };

/**
 * Full VERA Node - Orchestrates networking, storage, and execution
 */
export class FullNode implements BlockProvider {
    public network: NetworkNode;
    public store: CommitLog;
    public executor: ParallelExecutor;
    private config: NodeConfig;

    constructor(config: Partial<NodeConfig> = {}) {
        this.config = { ...DEFAULT_CONFIG, ...config };
        const dataDir = this.config.dataDir;

        // 1. Initialize Store
        this.store = new CommitLog({
            path: path.join(dataDir, 'commitlog'),
            genesisRoot: Buffer.from(this.config.genesisHash.replace('0x', ''), 'hex')
        });

        // 2. Initialize Executor
        this.executor = new ParallelExecutor(DUMMY_PROGRAM, {
            poolSize: 4 // TODO: Make configurable
        });

        // 3. Initialize Network
        this.network = new NetworkNode({
            networkId: this.config.networkId,
            version: '1.0.0',
            genesisHash: this.config.genesisHash,
            headHash: this.config.genesisHash,
            height: 0n
        });

        // Wire up BlockProvider
        this.network.syncManager.setBlockProvider(this);
    }

    async start() {
        // Start Store
        await this.store.open();
        const head = await this.store.getLatest();

        // Update Network State
        if (head) {
            this.network.setHeight(head.height);
        } else {
            this.network.setHeight(-1n);
        }

        // Wire Sync Events
        this.network.on('sync:blocks', async (blocks: any[]) => {
            console.log(`Node received ${blocks.length} blocks from sync. Processing...`);

            for (const block of blocks) {
                const entry: CommitEntry = {
                    height: block.height,
                    stateRoot: new Uint8Array(32),
                    prevStateRoot: new Uint8Array(32),
                    timestamp: Date.now(),
                    changeCount: 1,
                    walLSN: 0n,
                    metadata: { hash: block.hash }
                };

                try {
                    await this.store.append(entry);
                    this.network.setHeight(entry.height);
                } catch (e) {
                    console.error('Failed to commit block:', e);
                }
            }
        });

        // Start Network
        await this.network.start(this.config.port);
        console.log(`Node ${this.network.id} started on port ${this.config.port}`);
    }

    async stop() {
        await this.network.stop();
        await this.store.close();
        this.executor.terminate();
    }

    // Connect to a peer
    async connect(host: string, port: number) {
        await this.network.connect(host, port);
    }

    // BlockProvider Implementation
    async getBlocks(fromHeight: bigint, limit: number): Promise<any[]> {
        const toHeight = fromHeight + BigInt(limit) - 1n;
        const commits = await this.store.getRange(fromHeight, toHeight);

        return commits.map(c => ({
            height: c.height,
            hash: (c.metadata as any)?.hash || 'unknown',
        }));
    }
}
