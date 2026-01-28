import { createConnection } from 'node:net';
import { EventEmitter } from 'eventemitter3';
import { Server } from './transport/server.js';
import { Peer, PeerState } from './transport/peer.js';
import { SyncManager } from './sync/manager.js';
import { ErasureCoder } from './ec/coder.js';
import { BlockReconstructor } from './ec/reconstructor.js';
import { MessageType, type BlockChunkMessage } from './protocol/message.js';
import { Buffer } from 'node:buffer';

export interface NetworkOptions {
    networkId: string;
    version: string;
    genesisHash: string;
    // Current Node State
    headHash: string;
    height: bigint;
}

export class NetworkNode extends EventEmitter {
    private server: Server | null = null;
    private peers: Map<string, Peer> = new Map();
    public options: NetworkOptions;
    public syncManager: SyncManager;

    public id: string = Math.random().toString(36).substring(2, 15);

    // Erasure Coding State
    private reconstructors: Map<string, BlockReconstructor> = new Map();

    constructor(options: NetworkOptions) {
        super();
        this.options = options;
        this.syncManager = new SyncManager(this);

        // Handle messages internally
        this.on('message', this.handleMessage.bind(this));
    }

    async start(port: number): Promise<void> {
        // Initialize EC WASM
        await ErasureCoder.init();

        this.server = new Server(port);

        this.server.on('connection', (socket) => {
            const peerId = 'incoming-' + Math.random().toString(36).substring(7);
            const peer = new Peer(socket, {
                id: peerId,
                localNodeId: this.id,
                ...this.options
            });
            this.handlePeer(peer);
        });

        this.server.on('error', (err) => {
            this.emit('error', err);
        });

        await this.server.start();
    }

    async stop() {
        this.server?.stop();
        for (const peer of this.peers.values()) {
            peer.disconnect();
        }
        this.peers.clear();
        this.reconstructors.clear();
    }

    async connect(host: string, port: number): Promise<void> {
        await ErasureCoder.init();

        return new Promise((resolve, reject) => {
            const socket = createConnection({ host, port }, () => {
                const peerId = `outgoing-${host}:${port}`;
                const peer = new Peer(socket, {
                    id: peerId,
                    localNodeId: this.id,
                    ...this.options
                });

                peer.startHandshake();
                this.handlePeer(peer);
                resolve();
            });

            socket.on('error', reject);
        });
    }

    private handlePeer(peer: Peer) {
        peer.on('ready', () => {
            this.peers.set(peer.id, peer);
            this.emit('peer:connect', peer);
        });

        peer.on('disconnect', () => {
            this.peers.delete(peer.id);
            this.emit('peer:disconnect', peer);
        });

        peer.on('error', (err) => {
            this.emit('error', err);
        });

        peer.on('message', (msg) => {
            this.emit('message', msg, peer);
        });
    }

    private async handleMessage(msg: any, peer: Peer) {
        if (msg.type === MessageType.BLOCK_CHUNK) {
            const chunkMsg = msg.payload as BlockChunkMessage;
            const { blockHash, chunkIndex, data } = chunkMsg;

            let chunkData = data;
            if (!(chunkData instanceof Uint8Array) && (chunkData as any).type === 'Buffer') {
                chunkData = Buffer.from((chunkData as any).data);
            } else if (Array.isArray(chunkData)) {
                chunkData = new Uint8Array(chunkData);
            }

            let reconstructor = this.reconstructors.get(blockHash);
            if (!reconstructor) {
                reconstructor = new BlockReconstructor({ k: 10, m: 4 });
                this.reconstructors.set(blockHash, reconstructor);
            }

            await reconstructor.addChunk(blockHash, { index: chunkIndex, data: chunkData });

            const size = 100 * 1024; // Dummy max size
            const block = await reconstructor.reconstruct(blockHash, size);
            if (block) {
                this.reconstructors.delete(blockHash);
                console.log(`Reconstructed block ${blockHash}`);
                this.emit('reconstructed:block', block, blockHash);
            }
        } else if (msg.type === MessageType.VOTE) {
            this.emit('bft:vote', msg.payload, peer);
        } else if (msg.type === MessageType.QUORUM_CERTIFICATE) {
            this.emit('bft:qc', msg.payload, peer);
        } else if (msg.type === MessageType.NEW_VIEW) {
            this.emit('bft:new_view', msg.payload, peer);
        } else if (msg.type === MessageType.BLOCK_PROPOSAL) {
            this.emit('bft:proposal', msg.payload, peer);
        }
    }

    async broadcastBlockChunks(blockData: Uint8Array, blockHash: string) {
        const coder = new ErasureCoder(10, 4);
        const chunks = await coder.encode(blockData);

        const peers = Array.from(this.peers.values());
        if (peers.length === 0) return;

        for (const chunk of chunks) {
            const msg: BlockChunkMessage = {
                blockHash,
                chunkIndex: chunk.index,
                totalChunks: chunks.length,
                data: chunk.data
            };

            const peer = peers[chunk.index % peers.length];
            if (peer && peer.state === PeerState.READY) {
                peer.send({
                    type: MessageType.BLOCK_CHUNK,
                    payload: msg
                });
            }
        }
    }

    broadcastVote(vote: any) {
        this.broadcast(MessageType.VOTE, vote);
    }

    broadcastQC(qc: any) {
        this.broadcast(MessageType.QUORUM_CERTIFICATE, qc);
    }

    broadcastNewView(nv: any) {
        this.broadcast(MessageType.NEW_VIEW, nv);
    }

    broadcastBlockProposal(proposal: any) {
        this.broadcast(MessageType.BLOCK_PROPOSAL, proposal);
    }

    private broadcast(type: MessageType, payload: any) {
        for (const peer of this.peers.values()) {
            if (peer.state === PeerState.READY) {
                peer.send({ type, payload });
            }
        }
    }

    getPeerCount(): number {
        let count = 0;
        for (const p of this.peers.values()) {
            if (p.state === PeerState.READY) count++;
        }
        return count;
    }

    public getHeight(): bigint {
        return this.options.height;
    }

    public setHeight(height: bigint) {
        this.options.height = height;
    }
}
