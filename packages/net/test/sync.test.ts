import { describe, it, expect, afterEach } from 'vitest';
import { NetworkNode, type NetworkOptions } from '../src/node.js';

const GENESIS = '0x0000000000000000000000000000000000000000000000000000000000000000';

const OPTIONS_A: NetworkOptions = {
    networkId: 'testnet',
    version: '1.0.0',
    genesisHash: GENESIS,
    headHash: GENESIS,
    height: 0n
};

const OPTIONS_B: NetworkOptions = {
    networkId: 'testnet',
    version: '1.0.0',
    genesisHash: GENESIS,
    headHash: '0x123', // Some head hash
    height: 10n        // Higher height
};

describe('Chain Synchronization', () => {
    let nodeA: NetworkNode;
    let nodeB: NetworkNode;

    afterEach(async () => {
        await nodeA?.stop();
        await nodeB?.stop();
    });

    it('should trigger sync when connecting to a node with higher height', async () => {
        nodeA = new NetworkNode(OPTIONS_A);
        nodeB = new NetworkNode(OPTIONS_B);

        await nodeA.start(4001);
        await nodeB.start(4002);

        // Expect Node A to emit sync:blocks
        // Node A has height 0, Node B has height 10.
        // Node A should request from height 1. 
        // SyncManager asks limit 50.
        // Node B should respond with blocks.

        const syncPromise = new Promise<any[]>((resolve) => {
            nodeA.on('sync:blocks', (blocks) => {
                resolve(blocks);
            });
        });

        await nodeA.connect('127.0.0.1', 4002);

        const blocks = await syncPromise;

        expect(blocks.length).toBeGreaterThan(0);
        expect(blocks[0].height).toBe(1n);
        expect(Number(blocks[blocks.length - 1].height)).toBeGreaterThan(0);
    });
});
