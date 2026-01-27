import { createConnection } from 'node:net';
import { EventEmitter } from 'eventemitter3';
import { Server } from './transport/server.js';
import { Peer, PeerState } from './transport/peer.js';
import { SyncManager } from './sync/manager.js';

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

    // We generated a random ID for this node for now
    public id: string = Math.random().toString(36).substring(2, 15);

    constructor(options: NetworkOptions) {
        super();
        this.options = options;
        this.syncManager = new SyncManager(this);
    }

    async start(port: number): Promise<void> {
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
    }

    async connect(host: string, port: number): Promise<void> {
        return new Promise((resolve, reject) => {
            const socket = createConnection({ host, port }, () => {
                // Connected
                console.log(`Node ${this.id} connected to ${host}:${port}`);
                const peerId = `outgoing-${host}:${port}`;
                const peer = new Peer(socket, {
                    id: peerId,
                    localNodeId: this.id,
                    ...this.options
                });

                // Outgoing peers initiate handshake
                peer.startHandshake();

                this.handlePeer(peer);
                resolve();
            });

            socket.on('error', reject);
        });
    }

    private handlePeer(peer: Peer) {
        // We only add to map when READY? Or track all?
        // Let's track after READY to avoid garbage? 
        // Or track handshake timeout?

        // For now, listen for ready
        peer.on('ready', () => {
            // Use remote Node ID if available in future, for now use generated/assigned ID
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

    getPeerCount(): number {
        // Count only READY peers
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
