/**
 * VERA RPC Method Router
 * 
 * Routes JSON-RPC requests to handlers, supports batch requests.
 */

import type { JSONRPCRequest, JSONRPCResponse, MethodRegistry, HandlerContext } from './types.js';
import { errors } from './errors.js';

export class Router {
    private methods: MethodRegistry = {};

    register(name: string, handler: (params: unknown[], ctx: HandlerContext) => Promise<unknown>) {
        this.methods[name] = handler;
    }

    registerAll(methods: MethodRegistry) {
        Object.assign(this.methods, methods);
    }

    listMethods(): string[] {
        return Object.keys(this.methods).sort();
    }

    async handle(request: JSONRPCRequest | JSONRPCRequest[], ctx: HandlerContext): Promise<JSONRPCResponse | JSONRPCResponse[]> {
        // Batch request
        if (Array.isArray(request)) {
            return Promise.all(request.map(r => this.handleSingle(r, ctx)));
        }
        return this.handleSingle(request, ctx);
    }

    private async handleSingle(req: JSONRPCRequest, ctx: HandlerContext): Promise<JSONRPCResponse> {
        const id = req.id ?? null;

        // Validate request
        if (req.jsonrpc !== '2.0') {
            return { jsonrpc: '2.0', id, error: errors.invalidRequest('Missing jsonrpc: "2.0"') };
        }

        if (!req.method || typeof req.method !== 'string') {
            return { jsonrpc: '2.0', id, error: errors.invalidRequest('Missing method') };
        }

        const handler = this.methods[req.method];
        if (!handler) {
            return { jsonrpc: '2.0', id, error: errors.methodNotFound(req.method) };
        }

        try {
            const params = req.params ?? [];
            const result = await handler(params, ctx);
            return { jsonrpc: '2.0', id, result };
        } catch (err: any) {
            // If error has code property, it's an RPC error
            if (typeof err?.code === 'number') {
                return { jsonrpc: '2.0', id, error: err };
            }
            // Otherwise internal error
            return { jsonrpc: '2.0', id, error: errors.internal(err?.message || 'Unknown error') };
        }
    }
}
