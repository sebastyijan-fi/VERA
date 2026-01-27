import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createSingleSequencer, createRawTransaction } from '@vera/ordering';
import { ReplayVerifier, TransactionLogger } from '../src/metrics.js';
import { TransactionStateProcessor, intValue, bytesValue } from '@vera/engine';
import { IROpcode, type IRProgram } from '@vera/dsl';
import { LevelDBStore } from '@vera/store';
import {
    generateKeyPair,
    signTransaction,
    zeroBytes32,
    bytesToHex,
    sha256WithDomain,
    HashDomains,
    encodeCanonicalTransaction
} from '@vera/core';
import fs from 'fs';
import path from 'path';

describe('Wave 2: Resilience & Chaos', () => {
    const TEMP_DIR = path.join(process.cwd(), 'temp-wave2');
    const STORE_PATH = path.join(TEMP_DIR, 'store');
    const LOG_PATH = path.join(TEMP_DIR, 'audit.jsonl');

    beforeEach(() => {
        if (fs.existsSync(TEMP_DIR)) {
            fs.rmSync(TEMP_DIR, { recursive: true, force: true });
        }
        fs.mkdirSync(TEMP_DIR, { recursive: true });
    });

    afterEach(() => {
        // Cleanup
    });

    it('C1: Kill -9 Recovery - Should restore nextSequence and nonces', async () => {
        const store = new LevelDBStore(STORE_PATH);
        const sequencer = createSingleSequencer({
            store,
            chainId: zeroBytes32(),
            durability: 'strict'
        });

        await sequencer.start();

        const keys = generateKeyPair();
        const sender = keys.publicKey;

        for (let i = 0; i < 5; i++) {
            const payload = new Uint8Array([i]);
            const txData = {
                version: 1,
                chainId: zeroBytes32(),
                type: { moduleId: zeroBytes32(), transactionName: 'test' },
                nonce: BigInt(i + 1),
                payload,
            };
            const canonical = encodeCanonicalTransaction(txData);
            const hash = sha256WithDomain(HashDomains.TRANSACTION, new Uint8Array(canonical));
            const sig = signTransaction(hash, keys.privateKey);
            const tx = createRawTransaction(
                hash,
                txData.chainId,
                sender,
                'test',
                txData.payload,
                txData.nonce,
                sig.signature,
                new Uint8Array(canonical)
            );
            const res = await sequencer.submitMany([tx]);
            expect(res[0].accepted).toBe(true);
        }

        const statusBefore = await sequencer.getStatus();
        expect(statusBefore.sequencer.lastSequence).toBe(5n);

        await store.close();

        const store2 = new LevelDBStore(STORE_PATH);
        const sequencer2 = createSingleSequencer({
            store: store2,
            chainId: zeroBytes32(),
            durability: 'strict'
        });

        await sequencer2.start();
        const statusAfter = await sequencer2.getStatus();
        expect(statusAfter.sequencer.lastSequence).toBe(5n);

        const payload = new Uint8Array([99]);
        const txData = {
            version: 1,
            chainId: zeroBytes32(),
            type: { moduleId: zeroBytes32(), transactionName: 'test' },
            nonce: 5n,
            payload,
        };
        const canonical = encodeCanonicalTransaction(txData);
        const hash = sha256WithDomain(HashDomains.TRANSACTION, new Uint8Array(canonical));
        const sig = signTransaction(hash, keys.privateKey);
        const oldTx = createRawTransaction(
            hash,
            txData.chainId,
            sender,
            'test',
            txData.payload,
            txData.nonce,
            sig.signature,
            new Uint8Array(canonical)
        );
        const result = await sequencer2.submitMany([oldTx]);
        expect(result[0].accepted).toBe(false);
        expect(result[0].error).toContain('Nonce too low');

        await store2.close();
    });

    it('B1: Large Payload Stability - Should handle 1MB transactions', async () => {
        const sequencer = createSingleSequencer({
            chainId: zeroBytes32(),
            pool: { maxSize: 100 }
        });
        await sequencer.start();

        const keys = generateKeyPair();
        const largePayload = new Uint8Array(1024 * 1024 - 1024);
        const txData = {
            version: 1,
            chainId: zeroBytes32(),
            type: { moduleId: zeroBytes32(), transactionName: 'heavy' },
            nonce: 1n,
            payload: largePayload,
        };
        const canonical = encodeCanonicalTransaction(txData);
        const hash = sha256WithDomain(HashDomains.TRANSACTION, new Uint8Array(canonical));
        const sig = signTransaction(hash, keys.privateKey);

        const tx = createRawTransaction(
            hash,
            txData.chainId,
            keys.publicKey,
            'heavy',
            txData.payload,
            txData.nonce,
            sig.signature,
            new Uint8Array(canonical)
        );

        const result = await sequencer.submitMany([tx]);
        expect(result[0].accepted).toBe(true);
    }, 20000);

    it('B2: Sustained Throughput - Should handle burst of 1000 transactions', async () => {
        const sequencer = createSingleSequencer({
            chainId: zeroBytes32(),
            pool: { maxSize: 2000 }
        });
        await sequencer.start();

        const keys = generateKeyPair();
        const txs = [];
        for (let i = 0; i < 1000; i++) {
            const payload = new Uint8Array([i % 256, Math.floor(i / 256)]);
            const txData = {
                version: 1,
                chainId: zeroBytes32(),
                type: { moduleId: zeroBytes32(), transactionName: 'test' },
                nonce: BigInt(i + 1),
                payload,
            };
            const canonical = encodeCanonicalTransaction(txData);
            const hash = sha256WithDomain(HashDomains.TRANSACTION, new Uint8Array(canonical));
            const sig = signTransaction(hash, keys.privateKey);
            txs.push(createRawTransaction(
                hash,
                txData.chainId,
                keys.publicKey,
                'test',
                txData.payload,
                txData.nonce,
                sig.signature,
                new Uint8Array(canonical)
            ));
        }

        const startTime = Date.now();
        const results = await sequencer.submitMany(txs);
        const endTime = Date.now();

        expect(results.every(r => r.accepted)).toBe(true);
        process.stdout.write(`Sequenced 1000 txs in ${endTime - startTime}ms\n`);
    }, 30000);

    it('C2: Bit-flip Detection - Should detect tampered log', async () => {
        const logger = new TransactionLogger(LOG_PATH);
        await logger.start();

        const sequencer = createSingleSequencer({
            chainId: zeroBytes32(),
        });
        await sequencer.start();

        sequencer.onTransaction(tx => logger.log(tx));

        const keys = generateKeyPair();

        // Manual IR to ensure STATE_SET is called and produces changes
        const program: IRProgram = {
            id: '0x' + '0'.repeat(64),
            name: 'Test',
            entities: [{ name: 'Counter', keyType: 'bytes', fields: [{ name: 'val', type: 'uint' }] }],
            events: [],
            functions: [{
                name: 'update',
                isPublic: true,
                params: ['key', 'n'], // Order of params in IR
                locals: [],
                instructions: [
                    { opcode: IROpcode.LOAD, operand: 'key' },
                    { opcode: IROpcode.LOAD, operand: 'n' },
                    // Stack: [key, n]
                    { opcode: IROpcode.STRUCT_NEW, operand: 'Counter:val' },
                    // Stack: [key, struct]
                    { opcode: IROpcode.STATE_SET, operand: 'Counter' },
                    { opcode: IROpcode.RET }
                ]
            }]
        };
        const processor = new TransactionStateProcessor(program);

        // Submit one tx
        const key = new Uint8Array(32).fill(0xAA);
        const args = [bytesValue(key), intValue(10n)];
        const payload = TransactionStateProcessor.encodeArguments(args);
        const txData = {
            version: 1,
            chainId: zeroBytes32(),
            type: { moduleId: zeroBytes32(), transactionName: 'update' },
            nonce: 1n,
            payload,
        };
        const canonical = encodeCanonicalTransaction(txData);
        const hash = sha256WithDomain(HashDomains.TRANSACTION, new Uint8Array(canonical));
        const sig = signTransaction(hash, keys.privateKey);
        const tx = createRawTransaction(
            hash,
            txData.chainId,
            keys.publicKey,
            'update',
            txData.payload,
            txData.nonce,
            sig.signature,
            new Uint8Array(canonical)
        );

        await sequencer.submitMany([tx]);
        await logger.stop();

        // Get expected root from a clean replay
        const result1 = await ReplayVerifier.verify(LOG_PATH, processor, '', TEMP_DIR);
        const expectedRoot = result1.actual_root;
        process.stdout.write(`Clean Replay Root: ${expectedRoot}\n`);

        // Ensure changes WERE applied (root is not the empty root)
        expect(expectedRoot).not.toBe('0x03bf54dc70cfb5e7db27be39ca1f38fa90d66314ad846078fc3d9045b5076a1d');

        // Tamper with the log file
        const logContent = fs.readFileSync(LOG_PATH, 'utf-8');
        const originalArgs = bytesToHex(payload);

        // Flip the last byte of the payload
        const lastChar = originalArgs[originalArgs.length - 1];
        const newChar = lastChar === '0' ? '1' : '0';
        const tamperedArgs = originalArgs.slice(0, -1) + newChar;

        process.stdout.write(`Tampering Payload: ${originalArgs} -> ${tamperedArgs}\n`);

        expect(logContent).toContain(originalArgs);
        const newLogContent = logContent.replace(originalArgs, tamperedArgs);
        expect(newLogContent).not.toBe(logContent);
        fs.writeFileSync(LOG_PATH, newLogContent);

        // Verify tampering is detected
        const result2 = await ReplayVerifier.verify(LOG_PATH, processor, expectedRoot, TEMP_DIR);
        process.stdout.write(`Tampered Replay Root: ${result2.actual_root}\n`);

        expect(result2.match).toBe(false);
        expect(result2.actual_root).not.toBe(expectedRoot);
    });
});
