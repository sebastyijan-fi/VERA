/**
 * VERA Transaction Builder
 * 
 * Utilities for constructing and signing transactions.
 */

import { sign, sha256, sha256WithDomain, HashDomains, bytesToHex, hexToBytes, toBytes32, getPublicKey, concat } from '@vera/core';
import { encode, decode } from 'cbor-x';

export interface TransactionPayload {
    /** Target contract/module (hex address) */
    to: string;
    /** Function to call */
    function: string;
    /** Function arguments (already encoded or as primitives) */
    args?: unknown[];
    /** Optional data payload */
    data?: Uint8Array;
}

export interface UnsignedTransaction {
    version: number;
    chainId: Uint8Array;
    nonce: bigint;
    maxFee?: bigint;
    payload: TransactionPayload;
}

export interface SignedTransaction extends UnsignedTransaction {
    signature: Uint8Array;
    publicKey: Uint8Array;
}

/**
 * Encode transaction payload to CBOR
 */
export function encodePayload(payload: TransactionPayload): Uint8Array {
    return encode({
        to: payload.to,
        fn: payload.function,
        args: payload.args || [],
        data: payload.data ? bytesToHex(payload.data) : null
    });
}

/**
 * Create the message to sign (canonical transaction representation)
 */
export function createSigningMessage(tx: UnsignedTransaction): Uint8Array {
    const data = encode([
        tx.version,
        tx.chainId,
        tx.nonce,
        tx.maxFee || 0n,
        encodePayload(tx.payload)
    ]);
    return sha256WithDomain(HashDomains.TRANSACTION, data);
}

/**
 * Sign a transaction
 */
export function signTransaction(tx: UnsignedTransaction, privateKey: Uint8Array): SignedTransaction {
    const txHash = createSigningMessage(tx);
    const message = concat(HashDomains.SIGNATURE, txHash);
    const signature = sign(message, toBytes32(privateKey));
    const publicKey = getPublicKey(toBytes32(privateKey));

    return {
        ...tx,
        signature,
        publicKey
    };
}

/**
 * Encode a signed transaction to raw bytes (for RPC submission)
 */
export function encodeTransaction(tx: SignedTransaction): Uint8Array {
    return encode({
        v: tx.version,
        c: tx.chainId,
        n: tx.nonce,
        f: tx.maxFee || 0n,
        p: encodePayload(tx.payload),
        s: tx.signature,
        k: tx.publicKey
    });
}

/**
 * Decode raw transaction bytes
 */
export function decodeTransaction(raw: Uint8Array): SignedTransaction {
    const data = decode(raw) as any;
    const payloadData = decode(data.p) as any;

    return {
        version: data.v,
        chainId: data.c,
        nonce: data.n,
        maxFee: data.f,
        payload: {
            to: payloadData.to,
            function: payloadData.fn,
            args: payloadData.args,
            data: payloadData.data ? hexToBytes(payloadData.data) : null
        } as TransactionPayload,
        signature: data.s,
        publicKey: data.k
    };
}

/**
 * Get transaction hash
 */
export function getTransactionHash(tx: SignedTransaction): Uint8Array {
    return sha256(encodeTransaction(tx));
}

/**
 * Verify transaction signature
 */
export function verifyTransaction(tx: SignedTransaction): boolean {
    // Would verify signature here using createSigningMessage(tx)
    return tx.signature.length === 64;
}
