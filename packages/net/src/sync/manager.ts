import { type NetworkNode } from '../node.js';
import { MessageType, type GetBlocksMessage, type BlocksMessage, type Message } from '../protocol/message.js';
import { type Peer } from '../transport/peer.js';

export interface BlockProvider {
    getBlocks(fromHeight: bigint, limit: number): Promise<any[]>;
}

export class SyncManager {
    private node: NetworkNode;
    private isSyncing: boolean = false;
    private blockProvider: BlockProvider | null = null;

    constructor(node: NetworkNode) {
        this.node = node;
        this.setupListeners();
    }

    public setBlockProvider(provider: BlockProvider) {
        this.blockProvider = provider;
    }

    private setupListeners() {
        this.node.on('peer:connect', (peer: Peer) => {
            this.handlePeerConnect(peer);
        });

        this.node.on('message', (msg: Message, peer: Peer) => {
            this.handleMessage(msg, peer);
        });
    }

    private handlePeerConnect(peer: Peer) {
        if (this.isSyncing) return;

        // Check if peer has a higher height
        // For now, we assume we can access local height from node options or similar
        // Let's assume node has a getCurrentHeight() method or we access options
        // But node options might be static.
        // We'll trust the plan: "Triggers sync on connection (if remote height > local height)"
        // We need to know local height.

        // Let's assume for now we look at node.options (which we can't easily access if private)
        // We should add getHeight() to NetworkNode.

        // Placeholder check:
        const remoteHeight = peer.remoteInfo?.height || 0n;
        const localHeight = this.node.getHeight();

        if (remoteHeight > localHeight) {
            console.log(`Peer ${peer.id} has higher height (${remoteHeight} > ${localHeight}). Starting sync...`);
            this.startSync(peer, localHeight + 1n);
        }
    }

    private startSync(peer: Peer, fromHeight: bigint) {
        this.isSyncing = true;

        const payload: GetBlocksMessage = {
            fromHeight,
            limit: 50
        };

        peer.send({
            type: MessageType.GET_BLOCKS,
            payload
        });
    }

    private handleMessage(msg: Message, peer: Peer) {
        switch (msg.type) {
            case MessageType.GET_BLOCKS:
                this.handleGetBlocks(msg.payload, peer);
                break;
            case MessageType.BLOCKS:
                this.handleBlocks(msg.payload, peer);
                break;
        }
    }

    private async handleGetBlocks(payload: GetBlocksMessage, peer: Peer) {
        let blocks: any[] = [];

        if (this.blockProvider) {
            try {
                // Fetch from provider (Store/FullNode)
                blocks = await this.blockProvider.getBlocks(payload.fromHeight, payload.limit);
            } catch (e) {
                console.error('Error fetching blocks from provider:', e);
            }
        } else {
            // Fallback mock response
            for (let i = 0; i < payload.limit; i++) {
                blocks.push({
                    height: payload.fromHeight + BigInt(i),
                    hash: `hash-${payload.fromHeight + BigInt(i)}`
                });
            }
        }

        const response: BlocksMessage = {
            blocks
        };

        peer.send({
            type: MessageType.BLOCKS,
            payload: response
        });
    }

    private handleBlocks(payload: BlocksMessage, peer: Peer) {
        if (!this.isSyncing) return;

        console.log(`Received ${payload.blocks.length} blocks from ${peer.id}`);

        if (payload.blocks.length === 0) {
            this.isSyncing = false;
            console.log('Sync finished (no more blocks).');
            return;
        }

        // Process blocks (mock)
        // In real system: validate and commit

        const lastBlock = payload.blocks[payload.blocks.length - 1];
        const lastHeight = lastBlock.height;

        // Update local height (mock)
        // this.node.updateHeight(lastHeight);

        // Check if we need more
        // In this simple version, we stop or ask for more
        // If we received Limit, ask for more?

        if (payload.blocks.length === 50) {
            this.startSync(peer, lastHeight + 1n);
        } else {
            this.isSyncing = false;
            console.log('Sync finished.');
        }

        this.node.emit('sync:blocks', payload.blocks);
    }
}
