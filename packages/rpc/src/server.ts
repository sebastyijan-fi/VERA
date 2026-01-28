/**
 * VERA RPC Server
 * 
 * HTTP + WebSocket JSON-RPC server.
 */

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { WebSocketServer, WebSocket } from 'ws';
import { Router } from './router.js';
import { veraMethods } from './methods/vera.js';
import { netMethods } from './methods/net.js';
import { createRpcMethods } from './methods/rpc.js';
import { debugMethods } from './methods/debug.js';
import { errors } from './errors.js';
import type { RPCServerConfig, JSONRPCRequest, HandlerContext } from './types.js';
import { createConsola } from 'consola';

const logger = createConsola({ level: 4 }).withTag('RPC');

export class RPCServer {
    private httpServer: ReturnType<typeof createServer> | null = null;
    private wsServer: WebSocketServer | null = null;
    private router: Router;
    private config: Required<RPCServerConfig>;
    private subscriptions: Map<string, { ws: WebSocket; type: string }> = new Map();
    private subCounter = 0;

    constructor(
        private node: any,
        config: RPCServerConfig = {}
    ) {
        this.config = {
            httpPort: config.httpPort ?? 8545,
            wsPort: config.wsPort ?? 8546,
            httpEnabled: config.httpEnabled ?? true,
            wsEnabled: config.wsEnabled ?? true,
            corsOrigin: config.corsOrigin ?? '*'
        };

        this.router = new Router();
        this.registerMethods();
    }

    private registerMethods() {
        // Core methods
        this.router.registerAll(veraMethods);
        this.router.registerAll(netMethods);
        this.router.registerAll(debugMethods);

        // Introspection (needs access to router)
        this.router.registerAll(createRpcMethods(() => this.router.listMethods()));

        // Subscription methods
        this.router.register('vera_subscribe', this.handleSubscribe.bind(this));
        this.router.register('vera_unsubscribe', this.handleUnsubscribe.bind(this));
    }

    private async handleSubscribe(params: unknown[], ctx: HandlerContext): Promise<string> {
        const [type] = params as [string];
        if (!['newBlocks', 'newTransactions', 'logs'].includes(type)) {
            throw errors.invalidParams(`Unknown subscription type: ${type}`);
        }

        // Generate subscription ID
        const subId = '0x' + (++this.subCounter).toString(16);

        // Note: Actual subscription wiring would happen in WebSocket handler
        return subId;
    }

    private async handleUnsubscribe(params: unknown[]): Promise<boolean> {
        const [subId] = params as [string];
        return this.subscriptions.delete(subId);
    }

    async start(): Promise<void> {
        const ctx: HandlerContext = { node: this.node };

        if (this.config.httpEnabled) {
            this.httpServer = createServer(async (req, res) => {
                await this.handleHttpRequest(req, res, ctx);
            });

            this.httpServer.listen(this.config.httpPort, () => {
                logger.success(`HTTP RPC server listening on port ${this.config.httpPort}`);
            });
        }

        if (this.config.wsEnabled) {
            this.wsServer = new WebSocketServer({ port: this.config.wsPort });

            this.wsServer.on('connection', (ws) => {
                logger.info('WebSocket client connected');

                ws.on('message', async (data) => {
                    await this.handleWsMessage(ws, data.toString(), ctx);
                });

                ws.on('close', () => {
                    // Clean up subscriptions for this client
                    for (const [id, sub] of this.subscriptions.entries()) {
                        if (sub.ws === ws) {
                            this.subscriptions.delete(id);
                        }
                    }
                });
            });

            logger.success(`WebSocket RPC server listening on port ${this.config.wsPort}`);
        }
    }

    async stop(): Promise<void> {
        if (this.httpServer) {
            this.httpServer.close();
            this.httpServer = null;
        }
        if (this.wsServer) {
            this.wsServer.close();
            this.wsServer = null;
        }
        logger.info('RPC servers stopped');
    }

    private async handleHttpRequest(
        req: IncomingMessage,
        res: ServerResponse,
        ctx: HandlerContext
    ): Promise<void> {
        // CORS headers
        res.setHeader('Access-Control-Allow-Origin', this.config.corsOrigin);
        res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

        if (req.method === 'OPTIONS') {
            res.writeHead(204);
            res.end();
            return;
        }

        if (req.method !== 'POST') {
            res.writeHead(405);
            res.end(JSON.stringify({ error: 'Method not allowed' }));
            return;
        }

        // Read body
        const chunks: Buffer[] = [];
        for await (const chunk of req) {
            chunks.push(chunk);
        }
        const body = Buffer.concat(chunks).toString();

        // Parse and handle
        try {
            const request = JSON.parse(body) as JSONRPCRequest | JSONRPCRequest[];
            const response = await this.router.handle(request, ctx);

            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(response));
        } catch (e) {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
                jsonrpc: '2.0',
                id: null,
                error: errors.parseError()
            }));
        }
    }

    private async handleWsMessage(
        ws: WebSocket,
        message: string,
        ctx: HandlerContext
    ): Promise<void> {
        try {
            const request = JSON.parse(message) as JSONRPCRequest | JSONRPCRequest[];
            const response = await this.router.handle(request, ctx);

            // Store subscription if applicable
            if (!Array.isArray(request) && request.method === 'vera_subscribe') {
                const subId = (response as any).result;
                if (subId) {
                    this.subscriptions.set(subId, {
                        ws,
                        type: (request.params as string[])?.[0] || 'unknown'
                    });
                }
            }

            ws.send(JSON.stringify(response));
        } catch (e) {
            ws.send(JSON.stringify({
                jsonrpc: '2.0',
                id: null,
                error: errors.parseError()
            }));
        }
    }

    // Emit to subscribers
    emit(type: string, data: unknown): void {
        for (const [id, sub] of this.subscriptions.entries()) {
            if (sub.type === type && sub.ws.readyState === WebSocket.OPEN) {
                sub.ws.send(JSON.stringify({
                    jsonrpc: '2.0',
                    method: 'vera_subscription',
                    params: {
                        subscription: id,
                        result: data
                    }
                }));
            }
        }
    }
}
