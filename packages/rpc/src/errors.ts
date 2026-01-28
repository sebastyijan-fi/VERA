/**
 * VERA RPC Error Definitions
 * 
 * JSON-RPC 2.0 compliant error codes.
 */

// Standard JSON-RPC errors
export const ParseError = -32700;
export const InvalidRequest = -32600;
export const MethodNotFound = -32601;
export const InvalidParams = -32602;
export const InternalError = -32603;

// VERA-specific errors (Transaction)
export const NonceTooLow = -32001;
export const NonceTooHigh = -32002;
export const InvalidSignature = -32003;
export const TxPoolFull = -32004;
export const TxAlreadyKnown = -32005;

// VERA-specific errors (Query)
export const BlockNotFound = -32010;
export const TxNotFound = -32011;
export const StateNotFound = -32020;
export const ProofInvalid = -32021;

// VERA-specific errors (Contract)
export const ContractNotFound = -32030;
export const ExecutionReverted = -32031;

export interface RPCError {
    code: number;
    message: string;
    data?: unknown;
}

export function createError(code: number, message: string, data?: unknown): RPCError {
    return { code, message, data };
}

export const errors = {
    parseError: () => createError(ParseError, 'Parse error'),
    invalidRequest: (msg?: string) => createError(InvalidRequest, msg || 'Invalid request'),
    methodNotFound: (method: string) => createError(MethodNotFound, `Method not found: ${method}`),
    invalidParams: (msg: string) => createError(InvalidParams, msg),
    internal: (msg?: string) => createError(InternalError, msg || 'Internal error'),

    nonceTooLow: (expected: bigint) => createError(NonceTooLow, 'NONCE_TOO_LOW', { expected: `0x${expected.toString(16)}` }),
    nonceTooHigh: () => createError(NonceTooHigh, 'NONCE_TOO_HIGH'),
    invalidSignature: () => createError(InvalidSignature, 'INVALID_SIGNATURE'),
    txPoolFull: () => createError(TxPoolFull, 'TX_POOL_FULL'),
    txAlreadyKnown: () => createError(TxAlreadyKnown, 'TX_ALREADY_KNOWN'),

    blockNotFound: (id: string) => createError(BlockNotFound, `Block not found: ${id}`),
    txNotFound: (hash: string) => createError(TxNotFound, `Transaction not found: ${hash}`),
    stateNotFound: (key: string) => createError(StateNotFound, `State not found: ${key}`),
    proofInvalid: () => createError(ProofInvalid, 'PROOF_INVALID'),

    contractNotFound: (addr: string) => createError(ContractNotFound, `Contract not found: ${addr}`),
    executionReverted: (reason?: string) => createError(ExecutionReverted, reason || 'EXECUTION_REVERTED'),
};
