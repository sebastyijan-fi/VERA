import { describe, it, expect } from 'vitest';
import { SingleSequencer } from '../src/single.js';
import { MemoryStore } from '@vera/store';
import {
    hexToBytes32,
    generateKeyPair,
    signTransaction,
    encodeCanonicalTransaction,
    sha256WithDomain,
    HashDomains,
    zeroBytes32,
    decode,
} from '@vera/core';
import { createRawTransaction } from '../src/types.js';

describe('Log Replay & State Recovery', () => {
    const chainId = hexToBytes32('01'.repeat(32));
    const alice = generateKeyPair();

    function buildTx(nonce: bigint) {
        const txData = {
            version: 1,
            chainId,
            type: {
                moduleId: zeroBytes32(),
                transactionName: 'test',
            },
            nonce,
            payload: new Uint8Array([Number(nonce)]), // Use nonce as payload data
        };
        const canonical = encodeCanonicalTransaction(txData);
        const hash = sha256WithDomain(HashDomains.TRANSACTION, new Uint8Array(canonical));
        const sig = signTransaction(hash, alice.privateKey);

        return createRawTransaction(
            hash,
            chainId,
            alice.publicKey,
            'test',
            txData.payload,
            nonce,
            sig.signature,
            new Uint8Array(canonical)
        );
    }

    it('should be able to rebuild state by replaying receipts and log entries', async () => {
        const seqStore = new MemoryStore();
        const sequencer = new SingleSequencer({ chainId, store: seqStore });
        await sequencer.start();

        // 1. Submit transactions
        const tx1 = buildTx(1n);
        const tx2 = buildTx(2n);

        await sequencer.submit(tx1);
        await sequencer.submit(tx2);

        // 2. Mock execution receipts (recorded by node in real world)
        const batch = seqStore.batch();
        // In SingleSequencer, we exposed recordReceipt
        await sequencer.recordReceipt(1n, true); // tx1 success
        await sequencer.recordReceipt(2n, true); // tx2 success

        // 3. Simulate state rebuilding
        const mockState: any = { version: 0n, data: [] };

        const status = await sequencer.getStatus();
        const lastSeq = status.sequencer.lastSequence;

        expect(lastSeq).toBe(2n);

        // Replay
        await sequencer.replay(1n, lastSeq, async (entry, receipt) => {
            const txData: any = decode(entry.canonicalTxBytes);
            if (receipt === 0) { // EXEC_OK
                mockState.data.push(txData.payload[0]);
            }
            mockState.version = entry.seq;
        });

        expect(mockState.version).toBe(2n);
        expect(mockState.data).toEqual([1, 2]);
    });

    it('should skip state application for failed transaction receipts', async () => {
        const seqStore = new MemoryStore();
        const sequencer = new SingleSequencer({ chainId, store: seqStore });
        await sequencer.start();

        await sequencer.submit(buildTx(1n));
        await sequencer.submit(buildTx(2n));

        await sequencer.recordReceipt(1n, true);  // Success
        await sequencer.recordReceipt(2n, false); // Failure

        const mockState: any = { version: 0n, data: [] };
        const status = await sequencer.getStatus();

        await sequencer.replay(1n, status.sequencer.lastSequence, async (entry, receipt) => {
            const txData: any = decode(entry.canonicalTxBytes);
            if (receipt === 0) {
                mockState.data.push(txData.payload[0]);
            }
            mockState.version = entry.seq;
        });

        expect(mockState.version).toBe(2n);
        expect(mockState.data).toEqual([1]); // Only first tx applied
    });
});
