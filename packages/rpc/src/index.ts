/**
 * VERA RPC Package
 * 
 * JSON-RPC 2.0 server for VERA nodes.
 */

export { RPCServer } from './server.js';
export { Router } from './router.js';
export { errors, type RPCError } from './errors.js';
export type {
    JSONRPCRequest,
    JSONRPCResponse,
    RPCServerConfig,
    MethodHandler,
    HandlerContext
} from './types.js';

// Re-export method collections for custom servers
export { veraMethods } from './methods/vera.js';
export { netMethods } from './methods/net.js';
export { debugMethods } from './methods/debug.js';
export { createRpcMethods } from './methods/rpc.js';
