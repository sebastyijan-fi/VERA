
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

// Helper to create valid-looking tx
const createTx = (i: number) => {
    const txData = {
        version: 1,
        chainId: zeroBytes32(),
        type: { moduleId: zeroBytes32(), transactionName: 'test' },
        nonce: BigInt(i),
        payload: new Uint8Array([i]),
    };
    const canonical = encodeCanonicalTransaction(txData);
    const hash = sha256WithDomain(HashDomains.TRANSACTION, new Uint8Array(canonical));
    const sender = toBytes32(Buffer.from('sender'.padStart(32, '0')));

    return createRawTransaction(
        hash, txData.chainId, sender, 'test', txData.payload, txData.nonce, new Uint8Array(64), new Uint8Array(canonical)
    );
};

vi.mock('@vera/core', async () => {
    const actual = await vi.importActual('@vera/core');
    return {
        ...actual,
        verifyTransactionSignature: () => true,
        verifyBatch: async () => true,
    };
});

describe('Dead Code Detective (Redundancy Advisor)', () => {

    it('Scenario 1: loadState Error Swallow', async () => {
        // Source: } catch (error) { // Ignore missing state }
        // Question: Is this catch block ever reachable? Or is it dead code masking bugs?

        const mockStore = {
            iterator: () => ({
                next: async () => { throw new Error('DB CORRUPTION'); }, // Force the error
                end: async () => { }
            })
        };

        const sequencer = createSingleSequencer({ store: mockStore as any, chainId: zeroBytes32() });

        // If the catch block works, this should NOT throw.
        // If the catch block is removed (dead), this WILL throw.
        await expect((sequencer as any).loadState(mockStore as any)).resolves.not.toThrow();

        // Advice: "The error handler successfully swallowed the DB error. It is ALIVE."
        // If this verification failed, it would mean the handler is broken or missing.
    });

    it('Scenario 2: Execution Backpressure Guard', async () => {
        // Source: if (currentBacklog > this.MAX_EXECUTION_BACKLOG)
        // Question: Can we actually hit this limit?

        const sequencer = createSingleSequencer({ chainId: zeroBytes32() });
        await sequencer.start();

        // Artificially inflate the backlog
        // (nextSequence - 1) - finalizedCount
        (sequencer as any).nextSequence = 10005n;
        (sequencer as any).finality = { finalizedCount: 0, getPending: () => [] }; // MAX is 10000

        const tx = createTx(1);
        const results = await sequencer.submit(tx);

        // Advice: "Backpressure guard is working. Code is necessary."
        expect(results.accepted).toBe(false);
        expect(results.error).toMatch(/Backpressure/);
    });

    it('Scenario 3: Transaction Size Guard', async () => {
        // Source: if (tx.canonicalTxBytes.length > this.MAX_TX_SIZE)
        // Question: Is this check redundant given the network layer might block it first?
        // We assert it is reachable here.

        const sequencer = createSingleSequencer({ chainId: zeroBytes32() });
        await sequencer.start();

        const tx = createTx(1);
        // Force oversized payload in the object (bypassing the canonical encoding helper for the test)
        (tx as any).canonicalTxBytes = new Uint8Array(1024 * 1024 + 1); // 1MB + 1 byte

        const results = await sequencer.submit(tx);

        // Advice: "Size guard is active. Keep it."
        expect(results.accepted).toBe(false);
        expect(results.error).toMatch(/Transaction too large/);
    });

});
