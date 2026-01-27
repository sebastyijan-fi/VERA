
import { describe, it, expect, vi } from 'vitest';
import { createSingleSequencer } from '../src/single.js';
import { createRawTransaction } from '../src/types.js';
import {
    toBytes32,
    bytesToHex,
    encodeCanonicalTransaction,
    sha256WithDomain,
    HashDomains,
    zeroBytes32,
} from '@vera/core';

// Mock dependencies
vi.mock('@vera/core', async () => {
    const actual = await vi.importActual('@vera/core');
    return {
        ...actual,
        verifyTransactionSignature: () => true, // Default to true, we'll mock failure specifically
        verifyBatch: async () => true,
    };
});

describe('Level 2: Total Contracts (Error Precedence)', () => {

    // Helper to create a tx with specific flaws
    const createFlawedTx = (flaws: {
        badHash?: boolean;
        badChainId?: boolean;
        badSig?: boolean;
        lowNonce?: boolean;
    }) => {
        const i = 1;
        const txData = {
            version: 1,
            chainId: flaws.badChainId ? toBytes32(Buffer.from('BAD'.padEnd(32))) : zeroBytes32(),
            type: { moduleId: zeroBytes32(), transactionName: 'test' },
            nonce: flaws.lowNonce ? 0n : BigInt(i), // Assume current nonce is 10
            payload: new Uint8Array([i]),
        };

        const canonical = encodeCanonicalTransaction(txData);
        let hash = sha256WithDomain(HashDomains.TRANSACTION, new Uint8Array(canonical));

        if (flaws.badHash) {
            // Mutate hash so it doesn't match payload
            hash[0] ^= 0xFF;
        }

        const sender = toBytes32(Buffer.from('sender'.padStart(32, '0')));

        return createRawTransaction(
            hash,
            txData.chainId,
            sender,
            'test',
            txData.payload,
            txData.nonce,
            new Uint8Array(64), // signature
            new Uint8Array(canonical) // payload
        );
    };

    it('Precedence 1: Integrity (Hash) > Everything', async () => {
        const sequencer = createSingleSequencer({ chainId: zeroBytes32() });
        await sequencer.start();
        const tx = createFlawedTx({ badHash: true, badChainId: true });

        const results = await sequencer.submit(tx);

        expect(results.accepted).toBe(false);
        expect(results.error).toBe('Invalid transaction hash');
    });

    it('Precedence 2: Pre-Execution (ChainID/Size) > Signature', async () => {
        const sequencer = createSingleSequencer({ chainId: zeroBytes32() });
        await sequencer.start();
        const tx = createFlawedTx({ badChainId: true, badSig: true });

        const results = await sequencer.submit(tx);

        expect(results.accepted).toBe(false);
        expect(results.error).toBe('Invalid chain ID');
    });

    it('Precedence 3: Signature > State (Nonce)', async () => {
        const sequencer = createSingleSequencer({ chainId: zeroBytes32() });
        await sequencer.start();

        // Exact sender key match
        const senderBytes = toBytes32(Buffer.from('sender'.padStart(32, '0')));
        const senderHex = bytesToHex(senderBytes, false);

        // Set Nonce to 10
        (sequencer as any).nonces.set(senderHex, 10n);

        // Mock verify false
        const verifySpy = vi.spyOn(await import('@vera/core'), 'verifyTransactionSignature').mockReturnValue(false);
        const batchSpy = vi.spyOn(await import('@vera/core'), 'verifyBatch').mockResolvedValue(false);

        const tx = createFlawedTx({ lowNonce: true });

        const results = await sequencer.submit(tx);

        expect(results.accepted).toBe(false);
        expect(results.error).toBe('Invalid signature');

        verifySpy.mockRestore();
        batchSpy.mockRestore();
    });

});
