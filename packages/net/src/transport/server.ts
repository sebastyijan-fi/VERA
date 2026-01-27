import { Server as NetServer, createServer } from 'node:net';
import { EventEmitter } from 'eventemitter3';

export class Server extends EventEmitter {
    private server: NetServer;
    private port: number;

    constructor(port: number) {
        super();
        this.port = port;
        this.server = createServer();
    }

    start(): Promise<void> {
        return new Promise((resolve, reject) => {
            this.server.on('connection', (socket) => {
                this.emit('connection', socket);
            });

            this.server.on('error', (err) => {
                this.emit('error', err);
                reject(err);
            });

            this.server.listen(this.port, () => {
                resolve();
            });
        });
    }

    stop() {
        this.server.close();
    }

    getAddress() {
        return this.server.address();
    }
}
