/**
 * VERA RPC - Core vera_* Methods
 * 
 * Transaction, block, and state query methods.
 */

import type { MethodRegistry, HandlerContext, BlockId } from '../types.js';
import { errors } from '../errors.js';
import { bytesToHex, hexToBytes } from '@vera/core';
import { decode, encode } from 'cbor-x';

function toHex(value: bigint | number): string {
    return '0x' + BigInt(value).toString(16);
}

function parseBlockId(id: BlockId): bigint | 'latest' | 'finalized' {
    if (id === 'latest' || id === 'finalized') return id;
    return BigInt(id);
}

export const veraMethods: MethodRegistry = {
    // =========================================================================
    // Transaction Lifecycle
    // =========================================================================

    async vera_sendRawTransaction(params, ctx) {
        const [rawTxHex] = params as [string];
        if (!rawTxHex || typeof rawTxHex !== 'string') {
            throw errors.invalidParams('Expected hex-encoded transaction');
        }

        const txBytes = hexToBytes(rawTxHex.replace('0x', ''));

        // Decode CBOR transaction
        const { decode } = await import('cbor-x');
        const { sha256WithDomain, HashDomains } = await import('@vera/core');

        let txData: any;
        try {
            txData = decode(txBytes);
        } catch {
            throw errors.invalidParams('Invalid CBOR-encoded transaction');
        }

        // Extract fields from decoded tx
        // Format: { v: version, c: chainId, n: nonce, f: maxFee, p: payload, s: signature, k: publicKey }
        const chainIdBytes = txData.c || new Uint8Array(32);
        const nonce = BigInt(txData.n || 0);
        const signature = txData.s || new Uint8Array(64);
        const publicKey = txData.k || new Uint8Array(32);

        // Re-construct unsigned data array for hashing/canonical representation
        // The signature signs: sha256WithDomain(TRANSACTION, unsignedBytes)
        // so we must provide unsignedBytes as canonicalTxBytes for the sequencer to validate the hash,
        // and the hash itself (TxID) must be the hash of the unsigned data.
        const unsignedData = [
            txData.v,
            txData.c,
            BigInt(txData.n),
            BigInt(txData.f || 0),
            Buffer.from(txData.p) // Convert to Buffer to avoid Tag 64 (Uint8Array gets tagged, Buffer doesn't)
        ];
        const unsignedBytes = encode(unsignedData);

        // Compute transaction hash (TxID)
        const txHash = sha256WithDomain(HashDomains.TRANSACTION, unsignedBytes);

        // Decode payload to get function name
        let functionName = 'unknown';
        try {
            const payloadData = decode(txData.p);
            functionName = payloadData.fn || 'unknown';
        } catch {
            // Ignore payload decode errors
        }

        // Submit to sequencer
        const result = await ctx.node.sequencer.submit({
            hash: txHash,
            chainId: chainIdBytes,
            sender: publicKey,
            function: functionName,
            args: txBytes, // We keep the full raw tx (signed) in args for execution availability? Or should this be unsigned?
            // Actually, 'args' in RawTransaction seems to be 'Function Arguments'.
            // But passing full txBytes here might be wrong if 'args' is expected to be just function args.
            // However, SingleSequencer definition of RawTransaction says: args: Uint8Array; // Full encoded tx
            // So passing txBytes (full signed tx) seems correct for data availability.

            nonce: nonce,
            signature: signature,
            canonicalTxBytes: unsignedBytes, // MUST be unsigned bytes to match hash
            submittedAt: BigInt(Date.now())
        });

        if (!result.accepted) {
            throw errors.invalidParams(result.error || 'Transaction rejected');
        }

        return {
            hash: bytesToHex(result.hash),
            sequenceNumber: result.sequenceNumber ? toHex(result.sequenceNumber) : null
        };
    },

    async vera_getTransactionReceipt(params, ctx) {
        const [txHash] = params as [string];
        if (!txHash) throw errors.invalidParams('Expected transaction hash');

        const receipt = await ctx.node.sequencer.getReceiptByTxId(
            hexToBytes(txHash.replace('0x', '')) as any
        );

        if (!receipt) {
            throw errors.txNotFound(txHash);
        }

        return {
            hash: txHash,
            status: receipt.status === 1 ? 'finalized' : receipt.status === 0 ? 'pending' : 'failed',
            sequenceNumber: toHex(receipt.sequenceNumber),
            blockHeight: null, // TODO: Link to block
            gasUsed: '0x0',
            events: []
        };
    },

    async vera_getTransactionByHash(params, ctx) {
        const [txHash] = params as [string];
        if (!txHash) throw errors.invalidParams('Expected transaction hash');

        const tx = await ctx.node.sequencer.getBySequence(
            BigInt(txHash) // Simplified - in reality would lookup by hash
        );

        if (!tx) throw errors.txNotFound(txHash);

        return {
            hash: bytesToHex(tx.tx.hash),
            from: bytesToHex(tx.tx.sender),
            function: tx.tx.function,
            nonce: toHex(tx.tx.nonce),
            sequenceNumber: toHex(tx.sequenceNumber)
        };
    },

    async vera_call(params, ctx) {
        const [callParams, blockId] = params as [{ to: string; function: string; args?: string[]; from?: string }, BlockId?];

        if (!callParams?.to || !callParams?.function) {
            throw errors.invalidParams('Expected { to, function, args?, from? }');
        }

        // Execute read-only call via executor
        // This is a simplified implementation - real version would route to DSL interpreter
        const result = await ctx.node.executor.executeBlock([{
            functionName: callParams.function,
            args: callParams.args || [],
            caller: callParams.from || '0x00'
        }], {
            height: 0n,
            timestamp: BigInt(Math.floor(Date.now() / 1000)),
            parentHash: '0x00'
        });

        if (result.results[0]?.success === false) {
            throw errors.executionReverted(result.results[0]?.error?.message);
        }

        return '0x'; // Return data would come from execution result
    },

    async vera_estimateGas(params, ctx) {
        // Simplified - return fixed gas for now
        return '0x5208'; // 21000
    },

    // =========================================================================
    // Block Queries
    // =========================================================================

    async vera_blockNumber(params, ctx) {
        const latest = await ctx.node.store.getLatest();
        return toHex(latest?.height || 0n);
    },

    async vera_getBlockByNumber(params, ctx) {
        const [blockId, includeTxs] = params as [BlockId, boolean?];

        let height: bigint;
        if (blockId === 'latest' || blockId === 'finalized') {
            const latest = await ctx.node.store.getLatest();
            height = latest?.height || 0n;
        } else {
            height = BigInt(blockId);
        }

        const block = await ctx.node.store.get(height);
        if (!block) throw errors.blockNotFound(blockId);

        return {
            height: toHex(block.height),
            stateRoot: bytesToHex(block.stateRoot),
            timestamp: toHex(Math.floor(block.timestamp / 1000)),
            changeCount: block.changeCount,
            transactions: includeTxs ? [] : undefined
        };
    },

    async vera_getBlockByHash(params, ctx) {
        const [blockHash, includeTxs] = params as [string, boolean?];
        // Would need hash-to-height index - for now, return error
        throw errors.blockNotFound(blockHash);
    },

    // =========================================================================
    // State Queries
    // =========================================================================

    async vera_getState(params, ctx) {
        const [key] = params as [string];
        if (!key) throw errors.invalidParams('Expected state key');

        const value = await ctx.node.stateStore.get(hexToBytes(key.replace('0x', '')));
        if (!value) throw errors.stateNotFound(key);

        return bytesToHex(value);
    },

    async vera_getStateWithProof(params, ctx) {
        const [key] = params as [string];
        if (!key) throw errors.invalidParams('Expected state key');

        const keyBytes = hexToBytes(key.replace('0x', ''));
        const value = await ctx.node.stateStore.get(keyBytes);

        // Get proof from trie
        const proof = await ctx.node.stateStore.getProof?.(keyBytes) || [];

        return {
            value: value ? bytesToHex(value) : null,
            proof: proof.map((p: Uint8Array) => bytesToHex(p)),
            root: bytesToHex(ctx.node.stateStore.root)
        };
    },

    async vera_getStateRoot(params, ctx) {
        return bytesToHex(ctx.node.stateStore.root);
    },

    async vera_getNonce(params, ctx) {
        const [address] = params as [string];
        if (!address) throw errors.invalidParams('Expected address');

        // Would get nonce from account state
        return '0x0';
    },

    async vera_getStateAt(params, ctx) {
        const [key, blockId] = params as [string, BlockId];
        if (!key || !blockId) throw errors.invalidParams('Expected key and blockHeight');

        // Would need historical state access
        // For now, just get current state
        return veraMethods.vera_getState([key], ctx);
    },

    async vera_getStateRootAt(params, ctx) {
        const [blockId] = params as [BlockId];

        let height: bigint;
        if (blockId === 'latest' || blockId === 'finalized') {
            const latest = await ctx.node.store.getLatest();
            height = latest?.height || 0n;
        } else {
            height = BigInt(blockId);
        }

        const block = await ctx.node.store.get(height);
        if (!block) throw errors.blockNotFound(blockId);

        return bytesToHex(block.stateRoot);
    },

    async vera_verifyProof(params, ctx) {
        const [proofData] = params as [{ key: string; value: string; proof: string[]; root: string }];

        if (!proofData?.key || !proofData?.proof || !proofData?.root) {
            throw errors.invalidParams('Expected { key, value, proof, root }');
        }

        // Would verify Merkle proof
        // Simplified - always return true for now
        return true;
    },

    // =========================================================================
    // Account & Contract Queries
    // =========================================================================

    async vera_getAccount(params, ctx) {
        const [address] = params as [string];
        if (!address) throw errors.invalidParams('Expected address');

        // Would fetch account from state
        return {
            address,
            nonce: '0x0',
            codeHash: null
        };
    },

    async vera_getCode(params, ctx) {
        const [address] = params as [string];
        if (!address) throw errors.invalidParams('Expected contract address');

        // Would fetch contract code from state
        return null;
    },

    // =========================================================================
    // Network Info
    // =========================================================================

    async vera_chainId(params, ctx) {
        return bytesToHex(ctx.node.chainId);
    },

    async vera_syncing(params, ctx) {
        const syncState = ctx.node.network?.syncManager?.getSyncState?.();
        if (!syncState || syncState.isSynced) {
            return false;
        }
        return {
            currentBlock: toHex(syncState.currentHeight),
            highestBlock: toHex(syncState.targetHeight)
        };
    }
};
