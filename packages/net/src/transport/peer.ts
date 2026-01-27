import { Socket } from 'node:net';
import { EventEmitter } from 'eventemitter3';
import { ProtocolDecoder, encodeMessage } from '../protocol/codec.js';
import { type Message, MessageType, type HelloMessage } from '../protocol/message.js';

export enum PeerState {
    DISCONNECTED,
    CONNECTING,
    HANDSHAKING,
    READY
}

export interface PeerOptions {
    id: string; // Remote Peer ID (if known) or Temporary
    localNodeId: string;
    networkId: string;
    genesisHash: string;
    version: string;
    headHash: string;
    height: bigint;
}

export class Peer extends EventEmitter {
    private socket: Socket;
    private decoder: ProtocolDecoder;
    public id: string;
    public state: PeerState = PeerState.DISCONNECTED;
    private options: PeerOptions;

    // Info about the remote peer after handshake
    public remoteInfo: HelloMessage | null = null;

    constructor(socket: Socket, options: PeerOptions) {
        super();
        this.socket = socket;
        this.id = options.id;
        this.options = options;
        this.decoder = new ProtocolDecoder();

        this.setupSocket();

        // If socket is already writable (incoming), start handshake
        if (!socket.pending) {
            this.state = PeerState.HANDSHAKING;
            // Use setImmediate to allow listeners to attach if needed, though we are in constructor
            // But usually this.setupSocket listens for data.
            // We should send HELLO.
            process.nextTick(() => this.sendHello());
        }
    }

    private setupSocket() {
        this.socket.on('data', (chunk) => {
            this.decoder.push(chunk);
        });

        this.decoder.on('message', (msg: Message) => {
            this.handleMessage(msg);
        });

        this.decoder.on('error', (err) => {
            this.emit('error', err);
            this.disconnect();
        });

        this.socket.on('close', () => {
            this.state = PeerState.DISCONNECTED;
            this.emit('disconnect');
        });

        this.socket.on('error', (err) => {
            this.emit('error', err);
        });

        this.socket.on('connect', () => {
            this.state = PeerState.HANDSHAKING;
            this.sendHello();
        });
    }

    public startHandshake() {
        if (this.state === PeerState.DISCONNECTED) {
            // Outgoing connection logic would go here if we managed socket creation
        } else {
            this.state = PeerState.HANDSHAKING;
            this.sendHello();
        }
    }

    private sendHello() {
        const hello: HelloMessage = {
            networkId: this.options.networkId,
            version: this.options.version,
            genesisHash: this.options.genesisHash,
            headHash: this.options.headHash,
            height: this.options.height
        };

        this.send({
            type: MessageType.HELLO,
            payload: hello
        });
    }

    private handleMessage(msg: Message) {
        if (this.state === PeerState.HANDSHAKING) {
            if (msg.type === MessageType.HELLO) {
                this.handleHello(msg.payload);
            } else {
                // Ignore other messages during handshake
            }
            return;
        }

        this.emit('message', msg);
    }

    private handleHello(payload: HelloMessage) {
        // Validate Network (Basic check)
        if (payload.networkId !== this.options.networkId) {
            console.error(`Peer network mismatch: ${payload.networkId} vs ${this.options.networkId}`);
            this.disconnect();
            return;
        }

        if (payload.genesisHash !== this.options.genesisHash) {
            console.error(`Peer genesis mismatch`);
            this.disconnect();
            return;
        }

        this.remoteInfo = payload;
        this.state = PeerState.READY;
        this.emit('ready');

        // Reply with HELLO if we haven't sent one? 
        // Simpler: Both sides send HELLO on connect.
        // We assume we already sent ours or will send it.
        // The integration test will verify this flow.
    }

    send(msg: Message) {
        if (this.socket.destroyed) return;
        const buf = encodeMessage(msg);
        this.socket.write(buf);
    }

    disconnect() {
        this.state = PeerState.DISCONNECTED;
        this.socket.destroy();
    }
}
