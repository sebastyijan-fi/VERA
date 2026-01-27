
import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import { LevelDBStore, PersistentStateStore } from '@vera/store';
import { zeroBytes32, bytesToHex, sha256WithDomain, HashDomains, encodeCanonicalTransaction, signTransaction, generateKeyPair } from '@vera/core';
import { compileToIR, Lexer, Parser } from '@vera/dsl';
import { createProcessor, TransactionStateProcessor } from '@vera/engine';
import { createSingleSequencer } from '@vera/ordering';
import { TransactionLogger } from '../src/metrics.js';

describe('Wave 1: Cross-Platform Parity (Matrix D1)', () => {
    const evidenceDir = path.resolve('./test/evidence');
    const benchDir = path.resolve('./bench-out/matrix-d1');
    const dslSource = `
        module Parity;
        public entity State[Bytes] { val: UInt }
        public transaction update(key: Bytes, val: UInt) {
            set get<State>(key) = State { val: val };
        }
    `;

    beforeEach(async () => {
        await fs.mkdir(evidenceDir, { recursive: true });
        await fs.rm(benchDir, { recursive: true, force: true });
        await fs.mkdir(benchDir, { recursive: true });
    }, 30000);

    it('D1: should produce a deterministic root for a fixed corpus (Evidence Generation)', async () => {
        const seqDb = new LevelDBStore(path.join(benchDir, 'sequencer.db'));
        const stateDb = new LevelDBStore(path.join(benchDir, 'state.db'));
        const auditLogPath = path.join(benchDir, 'audit.jsonl');

        console.log(`[D1] Initializing system...`);
        const ir = compileToIR(new Parser(new Lexer(dslSource).tokenize()).parseModule());
        const processor = createProcessor(ir);
        let stateStore = await PersistentStateStore.load(stateDb);
        const sequencer = createSingleSequencer({
            chainId: zeroBytes32(),
            store: seqDb,
            finality: { confirmationDepth: 0, autoFinalizeMs: 10 }
        });
        const logger = new TransactionLogger(auditLogPath);
        await logger.start();

        let finalizedCount = 0;
        sequencer.onFinality(async (tx) => {
            console.log(`[D1] Finalized tx ${tx.sequenceNumber}`);
            logger.log(tx);
            const args = TransactionStateProcessor.decodeArguments(tx.tx.args);
            const res = await processor.execute('update', args, bytesToHex(tx.tx.sender), { height: tx.sequenceNumber, timestamp: tx.sequencedAt });
            if (res.success) {
                stateStore = await stateStore.apply(res.binaryChanges, tx.sequenceNumber) as PersistentStateStore;
            }
            finalizedCount++;
        });

        await sequencer.start();
        console.log(`[D1] Sequencer started`);

        // Use a REAL keypair for valid signatures
        const alice = generateKeyPair();
        const key = new Uint8Array(32).fill(0xCC);

        for (let i = 0; i < 5; i++) {
            const val = BigInt((i + 1) * 100);
            const args = TransactionStateProcessor.encodeArguments([
                { kind: 'bytes', value: key },
                { kind: 'uint', value: val }
            ]);
            const canonicalTx = encodeCanonicalTransaction({
                version: 1, chainId: zeroBytes32(),
                type: { moduleId: zeroBytes32(), transactionName: 'update' },
                nonce: BigInt(i + 1), maxSequence: 0n, payload: args
            });
            const hash = sha256WithDomain(HashDomains.TRANSACTION, canonicalTx);
            const sig = signTransaction(hash, alice.privateKey);

            const submitRes = await sequencer.submit({
                hash, chainId: zeroBytes32(), sender: alice.publicKey,
                function: 'update', args, nonce: BigInt(i + 1),
                signature: sig.signature,
                canonicalTxBytes: canonicalTx, submittedAt: BigInt(Date.now())
            } as any);
            console.log(`[D1] Submitted tx ${i + 1}, accepted: ${submitRes.accepted}`);
        }

        console.log(`[D1] Waiting for finalizations...`);
        let loops = 0;
        while (finalizedCount < 5) {
            await new Promise(r => setTimeout(r, 100));
            loops++;
            if (loops % 20 === 0) console.log(`[D1] still waiting... finalizedCount: ${finalizedCount}`);
            if (loops > 200) throw new Error("Timed out waiting for finalizations");
        }

        const finalRoot = bytesToHex(stateStore.root);
        console.log(`[D1] Deterministic Root: ${finalRoot}`);

        // Write evidence for CI comparison
        const evidence = {
            os: process.platform,
            node: process.version,
            arch: process.arch,
            root: finalRoot,
            txCount: 5,
            timestamp: new Date().toISOString()
        };

        await fs.writeFile(
            path.join(evidenceDir, 'cross-platform-roots.json'),
            JSON.stringify(evidence, null, 2)
        );

        await logger.stop();
        await sequencer.stop();
        await seqDb.close();
        await stateDb.close();

        expect(finalRoot).toBeDefined();
    }, 45000); // Increased timeout
});
