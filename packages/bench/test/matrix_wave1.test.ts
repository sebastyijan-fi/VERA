
import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import { LevelDBStore, PersistentStateStore } from '@vera/store';
import { zeroBytes32, bytesToHex, sha256WithDomain, HashDomains, encodeCanonicalTransaction, signTransaction, generateKeyPair } from '@vera/core';
import { compileToIR, Lexer, Parser } from '@vera/dsl';
import { createProcessor, TransactionStateProcessor } from '@vera/engine';
import { createSingleSequencer } from '@vera/ordering';
import { ReplayVerifier, TransactionLogger } from '../src/metrics.js';

describe('Wave 1: Integrity & Reconstructability (Matrix A1/A2)', () => {
    const benchDir = path.resolve('./bench-out/matrix-wave1');
    const dslSource = `
            module Test;
            public entity Counter[Bytes] { val: UInt }
            public transaction inc(key: Bytes) {
                let currentVal = 0;
                if (exists<Counter>(key)) {
                    set currentVal = get<Counter>(key).val;
                }
                set get<Counter>(key) = Counter { val: currentVal + 1 };
            }
        `;

    beforeEach(async () => {
        await fs.rm(benchDir, { recursive: true, force: true });
        await fs.mkdir(benchDir, { recursive: true });
    }, 30000);

    it('A1: should reconstruct the exact same state using only the ordering log', async () => {
        const seqDb = new LevelDBStore(path.join(benchDir, 'sequencer.db'));
        const stateDb = new LevelDBStore(path.join(benchDir, 'state.db'));
        const auditLogPath = path.join(benchDir, 'audit.jsonl');

        console.log(`[A1] DSL: ${dslSource}`);
        const ir = compileToIR(new Parser(new Lexer(dslSource).tokenize()).parseModule());
        const processor = createProcessor(ir);

        let stateStore = await PersistentStateStore.load(stateDb);
        let finalizedCount = 0;

        const sequencer = createSingleSequencer({
            chainId: zeroBytes32(),
            store: seqDb,
            finality: { confirmationDepth: 0, autoFinalizeMs: 10 }
        });
        const logger = new TransactionLogger(auditLogPath);
        await logger.start();

        sequencer.onFinality(async (tx) => {
            console.log(`[A1] Finality callback for seq ${tx.sequenceNumber}`);
            logger.log(tx);
            const args = TransactionStateProcessor.decodeArguments(tx.tx.args);
            const res = await processor.execute('inc', args, bytesToHex(tx.tx.sender), { height: tx.sequenceNumber, timestamp: tx.sequencedAt });

            if (res.success) {
                stateStore = await stateStore.apply(res.binaryChanges, tx.sequenceNumber) as PersistentStateStore;
                console.log(`[A1] Applied tx ${tx.sequenceNumber}, new root: ${bytesToHex(stateStore.root)}`);
            } else {
                console.error(`[A1] EXECUTION FAILED for seq ${tx.sequenceNumber}:`, res.error);
            }
            finalizedCount++;
        });

        await sequencer.start();
        console.log(`[A1] Sequencer started`);

        // 2. Transact
        const alice = generateKeyPair();
        const key = new Uint8Array(32).fill(0xAA);
        for (let i = 0; i < 5; i++) {
            const args = TransactionStateProcessor.encodeArguments([{ kind: 'bytes', value: key }]);
            const canonicalTx = encodeCanonicalTransaction({
                version: 1, chainId: zeroBytes32(),
                type: { moduleId: zeroBytes32(), transactionName: 'inc' },
                nonce: BigInt(i + 1), maxSequence: 0n, payload: args
            });
            const hash = sha256WithDomain(HashDomains.TRANSACTION, canonicalTx);
            const sig = signTransaction(hash, alice.privateKey);

            const req = {
                hash, chainId: zeroBytes32(), sender: alice.publicKey,
                function: 'inc', args, nonce: BigInt(i + 1),
                signature: sig.signature, canonicalTxBytes: canonicalTx, submittedAt: BigInt(Date.now())
            };

            const submitRes = await sequencer.submit(req as any);
            console.log(`[A1] Submitted tx ${i + 1}, accepted: ${submitRes.accepted}, error: ${submitRes.error}`);
            if (!submitRes.accepted) throw new Error(`Submission failed: ${submitRes.error}`);
        }

        // Wait for 5 commits
        console.log(`[A1] Waiting for 5 finalizations...`);
        let waitLoops = 0;
        while (finalizedCount < 5) {
            await new Promise(r => setTimeout(r, 200));
            waitLoops++;
            if (waitLoops % 10 === 0) console.log(`[A1] Still waiting... finalizedCount: ${finalizedCount}`);
            if (waitLoops > 100) throw new Error("Timed out waiting for finalizations");
        }

        const originalRoot = bytesToHex(stateStore.root);
        console.log(`[A1] Original Final Root: ${originalRoot}`);

        await logger.stop();
        await sequencer.stop();
        await seqDb.close();
        await stateDb.close();

        // 3. NUCLEAR WIPE (except audit log)
        console.log(`[A1] Wiping state DB...`);
        await fs.rm(path.join(benchDir, 'state.db'), { recursive: true, force: true });
        await fs.rm(path.join(benchDir, 'sequencer.db'), { recursive: true, force: true });

        // 4. RECONSTRUCT from Log
        console.log(`[A1] Replaying from log: ${auditLogPath}`);
        const replayResult = await ReplayVerifier.verify(
            auditLogPath,
            processor,
            originalRoot,
            benchDir
        );

        console.log(`[A1] Replay Match: ${replayResult.match}`);
        expect(replayResult.match).toBe(true);
    }, 30000);
});
