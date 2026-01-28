
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SyncManager } from '../src/sync/manager.js';
import { NetworkNode } from '../src/node.js';
import { Peer } from '../src/transport/peer.js';
import { MessageType, type BlockHeader, type Block } from '../src/protocol/message.js';
import { EventEmitter } from 'eventemitter3';

// Mock Node and Peer
class MockNode extends EventEmitter {
    getHeight = vi.fn().mockReturnValue(0n);
    setHeight = vi.fn();
}

class MockPeer extends EventEmitter {
    id = 'peer-1';
    remoteInfo = { height: 100n };
    send = vi.fn();
}

describe('SyncManager (Binary Protocol)', () => {
    let node: any;
    let syncManager: SyncManager;
    let peer: any;

    beforeEach(() => {
        node = new MockNode();
        syncManager = new SyncManager(node as unknown as NetworkNode);
        peer = new MockPeer();
    });

    it('should start sync with GET_HEADERS when peer height is higher', () => {
        // Trigger connect
        node.emit('peer:connect', peer);

        expect(peer.send).toHaveBeenCalledWith(expect.objectContaining({
            type: MessageType.GET_HEADERS,
            payload: { fromHeight: 1n, limit: 100 }
        }));
    });

    it('should request blocks after receiving valid headers', () => {
        // Assume sync started
        syncManager['isSyncing'] = true;

        // Simulate incoming HEADERS
        const headers: BlockHeader[] = [];
        for (let i = 1; i <= 10; i++) {
            headers.push([1, BigInt(i), 'prev', 'root', 12345, 0n]);
        }

        syncManager['handleHeaders']({ headers }, peer);

        expect(peer.send).toHaveBeenCalledWith(expect.objectContaining({
            type: MessageType.GET_BLOCKS,
            payload: { fromHeight: 1n, limit: 10 }
        }));
    });

    it('should process received binary blocks', () => {
        syncManager['isSyncing'] = true;
        const spy = vi.spyOn(node, 'emit');

        // Simulate incoming BLOCKS (binary format)
        const blocks: Block[] = [];
        for (let i = 1; i <= 10; i++) {
            const h: BlockHeader = [1, BigInt(i), 'prev', 'root', 12345, 0n];
            blocks.push([h, []]); // Empty txs
        }

        syncManager['handleBlocks']({ blocks }, peer);

        expect(spy).toHaveBeenCalledWith('sync:blocks', blocks);
        // Expect continuation (since length < 50, it stops)
        // But logic says if < 50, stops.
        expect(peer.send).not.toHaveBeenCalledWith(expect.objectContaining({
            type: MessageType.GET_HEADERS
        }));
    });
});
