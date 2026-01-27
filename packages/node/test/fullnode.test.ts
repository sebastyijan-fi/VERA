import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { FullNode } from '../src/node.js';
import * as fs from 'fs/promises';
import { CommitEntry } from '@vera/store';
import path from 'path';

const TEST_DIR = './tmp/fullnode_test';
const WORKER_SCRIPT = '../../engine/dist/parallel/worker.js'; // Adjust relative to execution

const HASH_ZERO = '0x' + '0'.repeat(64);

describe('FullNode Integration', () => {
    let nodeA: FullNode;
    let nodeB: FullNode;

    beforeEach(async () => {
        await fs.rm(TEST_DIR, { recursive: true, force: true });
        await fs.mkdir(TEST_DIR, { recursive: true });
        await fs.mkdir(`${TEST_DIR}/nodeA`);
        await fs.mkdir(`${TEST_DIR}/nodeB`);
    });

    afterEach(async () => {
        await nodeA?.stop();
        await nodeB?.stop();
    });

    it('should sync blocks from Node A to Node B', async () => {
        // Setup Node A (The Seeder)
        nodeA = new FullNode({
            dataDir: `${TEST_DIR}/nodeA`,
            networkId: 'testnet',
            genesisHash: HASH_ZERO,
            port: 5001
        });

        // Initialize Node A's store with some blocks
        await nodeA.store.open(); // Manually open to preload
        for (let i = 0n; i < 10n; i++) {
            const entry: CommitEntry = {
                height: i,
                stateRoot: new Uint8Array(32),
                prevStateRoot: new Uint8Array(32),
                timestamp: Date.now(),
                changeCount: 0,
                walLSN: 0n,
                metadata: { hash: `block-${i}` }
            };
            await nodeA.store.append(entry);
        }
        await nodeA.store.close();

        // Start Node A proper
        await nodeA.start();
        expect(nodeA.network.getHeight()).toBe(9n);

        // Setup Node B (The Leecher)
        nodeB = new FullNode({
            dataDir: `${TEST_DIR}/nodeB`,
            networkId: 'testnet',
            genesisHash: HASH_ZERO,
            port: 5002
        });

        await nodeB.start();
        expect(nodeB.network.getHeight()).toBe(-1n);
        // Actually height is 0n in constructor options placeholder, but store empty means... access fails?
        // FullNode.start reads head. If empty? 
        // We should handle empty store in FullNode.start.

        // Connect B to A
        console.log('Connecting Node B to Node A...');
        await nodeB.network.connect('127.0.0.1', 5001);

        // Wait for sync
        console.log('Waiting for Node B to reach height 9...');
        await new Promise<void>((resolve, reject) => {
            const start = Date.now();
            const check = () => {
                const h = nodeB.network.getHeight();
                console.log(`Current Node B height: ${h}`);
                if (h >= 9n) {
                    console.log('Sync complete!');
                    resolve();
                } else if (Date.now() - start > 25000) {
                    reject(new Error(`Timeout waiting for sync. Height stayed at ${h}`));
                } else {
                    setTimeout(check, 500);
                }
            };
            check();
        });

        // Verify Node B has the blocks
        const headB = await nodeB.store.getLatest();
        expect(headB).toBeDefined();
        expect(headB?.height).toBe(9n);
        expect((headB?.metadata as any).hash).toBe('block-9');
    }, 30000);
});
