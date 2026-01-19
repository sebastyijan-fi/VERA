import { describe, it, expect, beforeEach } from 'vitest';
import { SingleSequencer } from '../src/single.js';
import {
    hexToBytes32,
    generateKeyPair,
    signTransaction,
    encodeCanonicalTransaction,
    sha256WithDomain,
    HashDomains,
    zeroBytes32,
} from '@vera/core';
import { createRawTransaction } from '../src/types.js';

describe('Protocol Safety', () => {
    const chainId = hexToBytes32('01'.repeat(32));
    const otherChainId = hexToBytes32('02'.repeat(32));
    const alice = generateKeyPair();
    let sequencer: SingleSequencer;

    beforeEach(async () => {
        sequencer = new SingleSequencer({ chainId });
        await sequencer.start();
    });

    function buildTx(keyPair: any, nonce: bigint, cId = chainId) {
        const txData = {
            version: 1,
            chainId: cId,
            type: {
                moduleId: zeroBytes32(),
                transactionName: 'test',
            },
            nonce,
            payload: new Uint8Array([1, 2, 3]),
        };

        const canonical = encodeCanonicalTransaction(txData);
        const hash = sha256WithDomain(HashDomains.TRANSACTION, new Uint8Array(canonical));
        const sig = signTransaction(hash, keyPair.privateKey);

        return createRawTransaction(
            hash,
            cId,
            keyPair.publicKey,
            'test',
            txData.payload,
            nonce,
            sig.signature
        );
    }

    it('should accept valid transaction and increment nonce', async () => {
        const tx = buildTx(alice, 1n);
        const result = await sequencer.submit(tx);
        expect(result.accepted).toBe(true);

        const status = await sequencer.getStatus();
        expect(status.sequencer.lastSequence).toBe(1n);

        // Second tx from same sender
        const tx2 = buildTx(alice, 2n);
        const result2 = await sequencer.submit(tx2);
        expect(result2.accepted).toBe(true);
    });

    it('should reject mismatched chainId', async () => {
        const tx = buildTx(alice, 1n, otherChainId);
        const result = await sequencer.submit(tx);
        expect(result.accepted).toBe(false);
        expect(result.error).toContain('Invalid chain ID');
    });

    it('should reject invalid signature', async () => {
        const tx = buildTx(alice, 1n);
        tx.signature[0] ^= 0xFF; // Mangle signature
        const result = await sequencer.submit(tx);
        expect(result.accepted).toBe(false);
        expect(result.error).toBe('Invalid signature');
    });

    it('should reject nonce too low (replay)', async () => {
        const tx = buildTx(alice, 1n);
        await sequencer.submit(tx);

        const txReplay = buildTx(alice, 1n);
        const result = await sequencer.submit(txReplay);
        expect(result.accepted).toBe(false);
        expect(result.error).toContain('Nonce too low');
    });

    it('should reject nonce gap', async () => {
        const tx = buildTx(alice, 2n);
        const result = await sequencer.submit(tx);
        expect(result.accepted).toBe(false);
        expect(result.error).toContain('Nonce too high (gap)');
    });
});
