/**
 * VERA RPC Types
 * 
 * JSON-RPC 2.0 request/response types.
 */

import type { RPCError } from './errors.js';

export interface JSONRPCRequest {
    jsonrpc: '2.0';
    id?: string | number | null;
    method: string;
    params?: unknown[];
}

export interface JSONRPCResponse {
    jsonrpc: '2.0';
    id: string | number | null;
    result?: unknown;
    error?: RPCError;
}

export type MethodHandler = (params: unknown[], ctx: HandlerContext) => Promise<unknown>;

export interface HandlerContext {
    node: any; // FullNode - typed as any to avoid circular deps
}

export interface MethodRegistry {
    [method: string]: MethodHandler;
}

// Block identifier: hex height, "latest", or "finalized"
export type BlockId = string;

// Transaction call object
export interface CallParams {
    to: string;
    function: string;
    args?: string[];
    from?: string;
}

// RPC server configuration
export interface RPCServerConfig {
    httpPort?: number;      // Default: 8545
    wsPort?: number;        // Default: 8546
    httpEnabled?: boolean;  // Default: true
    wsEnabled?: boolean;    // Default: true
    corsOrigin?: string;    // Default: '*'
}
