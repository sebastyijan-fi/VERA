import { type NetworkNode } from '../node.js';
import {
    MessageType,
    type GetBlocksMessage,
    type BlocksMessage,
    type Message,
    type GetHeadersMessage,
    type HeadersMessage,
    type BlockHeader,
    type Block
} from '../protocol/message.js';
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

    private async handlePeerConnect(peer: Peer) {
        if (this.isSyncing) return;

        // Check remote height
        // In real Node, we should have a `peer.remoteInfo` populated from Handshake.
        // Assuming it is populated.
        const remoteHeight = peer.remoteInfo?.height || 0n;
        const localHeight = this.node.getHeight();

        if (remoteHeight > localHeight) {
            console.log(`Peer ${peer.id} has higher height (${remoteHeight} > ${localHeight}). Starting sync...`);
            this.startSync(peer, localHeight + 1n);
        }
    }

    private startSync(peer: Peer, fromHeight: bigint) {
        this.isSyncing = true;
        // Step 1: Request Headers first
        const payload: GetHeadersMessage = {
            fromHeight,
            limit: 100 // Fetch headers in bulk
        };

        peer.send({
            type: MessageType.GET_HEADERS,
            payload
        });
    }

    private handleMessage(msg: Message, peer: Peer) {
        switch (msg.type) {
            case MessageType.GET_HEADERS:
                this.handleGetHeaders(msg.payload, peer);
                break;
            case MessageType.HEADERS:
                this.handleHeaders(msg.payload, peer);
                break;
            case MessageType.GET_BLOCKS:
                this.handleGetBlocks(msg.payload, peer);
                break;
            case MessageType.BLOCKS:
                this.handleBlocks(msg.payload, peer);
                break;
        }
    }

    private async handleGetHeaders(payload: GetHeadersMessage, peer: Peer) {
        let headers: BlockHeader[] = [];

        if (this.blockProvider) {
            // Fetch blocks from provider to extract headers
            // In a real optimized node, we'd have a separate getHeaders method.
            const blocks = await this.blockProvider.getBlocks(payload.fromHeight, payload.limit);
            // Blocks are [Header, Tx[]] tuples
            headers = blocks.map((b: any) => b[0]);
        }

        peer.send({
            type: MessageType.HEADERS,
            payload: { headers }
        });
    }

    private handleHeaders(payload: HeadersMessage, peer: Peer) {
        if (!this.isSyncing) return;
        const headers = payload.headers;
        if (headers.length === 0) {
            this.isSyncing = false;
            console.log('Sync finished (no headers).');
            return;
        }

        console.log(`Received ${headers.length} headers. Validating...`);
        // Validate headers (check chain linkage, PoW/PoS, etc)
        // Mock: Accept all.

        // Download Bodies for these headers
        // We can request strictly the blocks we have headers for.
        // Or request in batches.
        const firstHeader = headers[0]!;
        // const lastHeader = headers[headers.length - 1];

        // Request bodies
        const getBlocks: GetBlocksMessage = {
            fromHeight: firstHeader[1], // Index 1 is height
            limit: headers.length
        };

        peer.send({
            type: MessageType.GET_BLOCKS,
            payload: getBlocks
        });
    }

    private async handleGetBlocks(payload: GetBlocksMessage, peer: Peer) {
        let blocks: Block[] = [];

        if (this.blockProvider) {
            blocks = await this.blockProvider.getBlocks(payload.fromHeight, payload.limit);
        }

        peer.send({
            type: MessageType.BLOCKS,
            payload: { blocks }
        });
    }

    private handleBlocks(payload: BlocksMessage, peer: Peer) {
        if (!this.isSyncing) return;
        const blocks = payload.blocks;

        console.log(`Received ${blocks.length} blocks. Applying...`);

        if (blocks.length === 0) {
            this.isSyncing = false;
            return;
        }

        // Checked length > 0 above
        const lastBlock = blocks[blocks.length - 1]!;
        // Block is [Header, Tx[]]. Header is index 0. Height is Header[1].
        const lastHeight = lastBlock[0][1];

        // Update local state (mock)
        // this.node.setHeight(lastHeight);

        // Emit events
        this.node.emit('sync:blocks', blocks);

        // Continue sync?
        // simple logic: if we got full batch, ask for more headers starting next
        if (blocks.length >= 50) { // Limit was 100 headers, maybe we got 100 blocks
            this.startSync(peer, lastHeight + 1n);
        } else {
            this.isSyncing = false;
            console.log('Sync finished.');
        }
    }
}
