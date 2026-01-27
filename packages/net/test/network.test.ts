import { describe, it, expect, afterEach } from 'vitest';
import { NetworkNode, type NetworkOptions } from '../src/node.js';
import { PeerState } from '../src/transport/peer.js';

const TEST_OPTIONS: NetworkOptions = {
    networkId: 'testnet',
    version: '1.0.0',
    genesisHash: '0x0000000000000000000000000000000000000000000000000000000000000000',
    headHash: '0x0000000000000000000000000000000000000000000000000000000000000000',
    height: 0n
};

describe('P2P Network', () => {
    let node1: NetworkNode;
    let node2: NetworkNode;

    afterEach(async () => {
        await node1?.stop();
        await node2?.stop();
    });

    it('should establish connection and complete handshake', async () => {
        node1 = new NetworkNode(TEST_OPTIONS);
        node2 = new NetworkNode(TEST_OPTIONS);

        await node1.start(3001);
        await node2.start(3002);

        const connectionPromise = new Promise<void>((resolve) => {
            let connectedCount = 0;
            const check = () => {
                connectedCount++;
                if (connectedCount === 2) resolve();
            };

            node1.on('peer:connect', (peer) => {
                expect(peer.state).toBe(PeerState.READY);
                expect(peer.remoteInfo?.networkId).toBe(TEST_OPTIONS.networkId);
                check();
            });

            node2.on('peer:connect', (peer) => {
                expect(peer.state).toBe(PeerState.READY);
                check();
            });
        });

        await node1.connect('127.0.0.1', 3002);

        await connectionPromise;

        expect(node1.getPeerCount()).toBe(1);
        expect(node2.getPeerCount()).toBe(1);
    });

    it('should reject peer with wrong network ID', async () => {
        node1 = new NetworkNode(TEST_OPTIONS);
        node2 = new NetworkNode({
            ...TEST_OPTIONS,
            networkId: 'badnet'
        });

        await node1.start(3003);
        await node2.start(3004);

        // Try to connect
        await node1.connect('127.0.0.1', 3004);

        // Wait a bit for handshake failure
        await new Promise((r) => setTimeout(r, 500));

        // Should not be connected
        expect(node1.getPeerCount()).toBe(0);
        expect(node2.getPeerCount()).toBe(0);
    });
});
