
import path from 'path';
import fs from 'fs/promises';
import { LevelDBStore, PersistentStateStore } from '@vera/store';
import { createSingleSequencer, createRawTransaction } from '@vera/ordering';
import { createProcessor, TransactionStateProcessor, intValue, bytesValue } from '@vera/engine';
import { compileToIR, Lexer, Parser } from '@vera/dsl';
import {
    generateKeyPair,
    signTransaction,
    sha256WithDomain,
    zeroBytes32,
    HashDomains,
} from '@vera/core';
import pc from 'picocolors';

const OUT_DIR = path.resolve('bench-out/fuzzing');

// Configuration
const DURATION_MS = 60_000; // 1 minute fuzz
const TARGET_TXS = 10_000;
const KEY_SPACE = 100; // Small key space to force collisions/interactions

async function run() {
    console.log(pc.magenta('VERA State Fuzzing (L1/L2)'));
    console.log(pc.dim('-----------------------------'));

    await fs.rm(OUT_DIR, { recursive: true, force: true });
    await fs.mkdir(OUT_DIR, { recursive: true });

    // Setup
    const store = new LevelDBStore(path.join(OUT_DIR, 'store'));
    const stateDb = new LevelDBStore(path.join(OUT_DIR, 'state'));
    let persistentState = await PersistentStateStore.load(stateDb);

    const sequencer = createSingleSequencer({
        store,
        chainId: zeroBytes32(),
        durability: 'logical', // Speed is fine, we want logic coverage
    });
    await sequencer.start();

    // DSL Model
    const dsl = `
        module Fuzz;
        public entity Box[Bytes] { 
            val: Int
        }
        
        public transaction store(k: Bytes, v: Int) { 
            set Box[k] = Box { val: v }; 
        }
        
        public transaction remove(k: Bytes) { 
            delete Box[k]; 
        }
        
        public transaction flip(k: Bytes) { 
            if (exists<Box>(k)) {
                let old = Box[k];
                set Box[k] = Box { val: old.val * -1 };
            }
        }
    `;
    const ir = compileToIR(new Parser(new Lexer(dsl).tokenize()).parseModule());
    const processor = createProcessor(ir);



    const keys = generateKeyPair();
    let globalNonce = 1n;

    let totalTxs = 0;
    const startTime = Date.now();

    console.log(pc.yellow(`Fuzzing for ${DURATION_MS / 1000}s or ${TARGET_TXS} txs...`));

    // Fuzz Loop
    while (Date.now() - startTime < DURATION_MS && totalTxs < TARGET_TXS) {

        // Generate Batch of Random Actions
        const BATCH_SIZE = 50;
        const txs = [];
        const actions = ['store', 'remove', 'flip'];

        for (let i = 0; i < BATCH_SIZE; i++) {
            const action = actions[Math.floor(Math.random() * actions.length)];
            const keyId = Math.floor(Math.random() * KEY_SPACE);
            const key = new Uint8Array(32);
            new DataView(key.buffer).setUint32(0, keyId);

            let payload: Uint8Array;
            if (action === 'store') {
                const val = BigInt(Math.floor(Math.random() * 2000000) - 1000000); // Random int
                payload = TransactionStateProcessor.encodeArguments([
                    bytesValue(key),
                    intValue(val)
                ]);
            } else {
                // remove/flip only take key
                payload = TransactionStateProcessor.encodeArguments([
                    bytesValue(key)
                ]);
            }

            const hash = sha256WithDomain(HashDomains.TRANSACTION, payload);
            const sig = signTransaction(hash, keys.privateKey);

            txs.push(createRawTransaction(
                hash,
                zeroBytes32(),
                keys.publicKey,
                action,
                payload,
                globalNonce++,
                sig.signature,
                new Uint8Array(10)
            ));
        }

        try {
            // Submit
            const res = await sequencer.submitMany(txs);

            // Execute
            const validTxs = [];
            for (let i = 0; i < txs.length; i++) {
                if (res[i].accepted && res[i].sequenceNumber !== undefined) {
                    validTxs.push({ ...txs[i], seq: res[i].sequenceNumber! });
                }
            }

            const atomicBatch = [];
            for (const tx of validTxs) {
                const args = TransactionStateProcessor.decodeArguments(tx.args);
                // We must catch VM errors here - the fuzzer expects some txs might fail logic but NOT crash the node
                try {
                    const result = await processor.execute(tx.function, args, '0x00', {
                        height: tx.seq,
                        timestamp: BigInt(Date.now())
                    });

                    if (result.success) {
                        atomicBatch.push(...result.binaryChanges);
                    }
                } catch (vmErr) {
                    console.error(pc.red(`VM Crash on ${tx.function}:`), vmErr);
                    throw vmErr; // Rethrow to fail test if VM actually crashes (not just logic error)
                }
            }

            if (atomicBatch.length > 0) {
                persistentState = await persistentState.apply(atomicBatch, BigInt(validTxs[validTxs.length - 1].seq)) as PersistentStateStore;
            }

            totalTxs += BATCH_SIZE;
            process.stdout.write(`\rTxs: ${totalTxs} | Status: OK`);

        } catch (err) {
            console.error(pc.red('\nFuzzer detected Critical Failure:'), err);
            process.exit(1);
        }
    }
    console.log(`Final State Root: ${persistentState.root}`);

    // Write success report
    const report = {
        total_txs: totalTxs,
        final_root: persistentState.root,
        crashes: 0
    };
    await fs.writeFile(path.join(OUT_DIR, 'report.json'), JSON.stringify(report, null, 2));

    await sequencer.stop();
    await store.close();
    await stateDb.close();
}

run().catch(console.error);
