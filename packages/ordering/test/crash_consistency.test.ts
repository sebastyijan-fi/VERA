import { describe, it, expect, beforeEach } from 'vitest';
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
} from '@vera/core';
import { createRawTransaction } from '../src/types.js';

// Mock a store that fails on write
class FlakyBatch {
    private ops: any[] = [];
    constructor(private realData: Map<string, Uint8Array>, private fail: boolean) { }
    put(k: any, v: any) { this.ops.push({ type: 'put', k, v }); return this; }
    del(k: any) { this.ops.push({ type: 'del', k }); return this; }
    async write() {
        if (this.fail) throw new Error('Crashed during write');
        // Simple atomic-ish apply
        for (const op of this.ops) {
            if (op.type === 'put') this.realData.set(op.k as string, op.v);
            else this.realData.delete(op.k as string);
        }
    }
}

class FlakyStore extends MemoryStore {
    public shouldFail = false;
    private flakyData = new Map<string, Uint8Array>();

    batch(): any {
        return new FlakyBatch(this.flakyData, this.shouldFail);
    }

    async get(k: any): Promise<Uint8Array | undefined> {
        return this.flakyData.get(k as string);
    }
}

describe('Crash Consistency', () => {
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
            payload: new Uint8Array([1, 2, 3]),
        };
        const canonical = encodeCanonicalTransaction(txData);
        const hash = sha256WithDomain(HashDomains.TRANSACTION, new Uint8Array(canonical));
        const sig = signTransaction(hash, alice.privateKey);
        return createRawTransaction(hash, chainId, alice.publicKey, 'test', txData.payload, nonce, sig.signature, new Uint8Array(canonical));
    }

    it('should not persist anything if the batch write fails', async () => {
        const store = new FlakyStore();
        const sequencer = new SingleSequencer({ chainId, store });
        await sequencer.start();

        store.shouldFail = true;

        // This will attempt to save state and fail
        try {
            await sequencer.submit(buildTx(1n));
        } catch (err) {
            // Expected
        }

        // Verify store is empty (except for maybe initial load boilerplate if any)
        const nextSeq = await store.get('sequencer:next_sequence');
        expect(nextSeq).toBeUndefined();

        // Reload a new sequencer from the same store
        const sequencer2 = new SingleSequencer({ chainId, store });
        await sequencer2.start();

        const status = await sequencer2.getStatus();
        expect(status.sequencer.lastSequence).toBe(0n); // Should have reset to 0
    });

    it('should persist everything if the batch write succeeds', async () => {
        const store = new FlakyStore();
        const sequencer = new SingleSequencer({ chainId, store });
        await sequencer.start();

        store.shouldFail = false;
        await sequencer.submit(buildTx(1n));

        const sequencer2 = new SingleSequencer({ chainId, store });
        await sequencer2.start();

        const status = await sequencer2.getStatus();
        expect(status.sequencer.lastSequence).toBe(1n);
    });
});
