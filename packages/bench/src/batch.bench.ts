import { generateCorpus } from './generator.js';
import { zeroBytes32, bytesToHex, sha256WithDomain, HashDomains, encodeCanonicalTransaction, signTransaction } from '@vera/core';
import { TransactionStateProcessor } from '@vera/engine';
import pc from 'picocolors';
import { performance } from 'node:perf_hooks';
import http from 'node:http';

async function rpcCall(method: string, params: any[]) {
    return new Promise((resolve, reject) => {
        const data = JSON.stringify({
            jsonrpc: '2.0',
            id: 1,
            method,
            params
        });

        const req = http.request({
            hostname: 'localhost',
            port: 8545,
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': data.length
            }
        }, res => {
            let body = '';
            res.on('data', chunk => body += chunk);
            res.on('end', () => resolve(JSON.parse(body)));
        });

        req.on('error', reject);
        req.write(data);
        req.end();
    });
}

async function runBatchBench() {
    const COUNT = 1000;
    const BATCH_SIZE = 100;

    console.log(pc.cyan(`\nStarting RPC Batch Comparison (${COUNT} txs)...`));

    // Prepare txs
    const corpus = generateCorpus(COUNT);
    const signedTxs: any[] = [];
    for (const item of corpus) {
        const encodedArgs = TransactionStateProcessor.encodeArguments([
            { kind: 'bytes', value: item.payload }
        ]);
        const canonical = encodeCanonicalTransaction({
            version: 1,
            chainId: zeroBytes32(),
            type: { moduleId: zeroBytes32(), transactionName: 'inc' },
            nonce: item.nonce,
            payload: encodedArgs
        });
        const txHash = sha256WithDomain(HashDomains.TRANSACTION, canonical);
        const sig = signTransaction(txHash, item.keyPair.privateKey);

        signedTxs.push({
            version: 1,
            chainId: bytesToHex(zeroBytes32()),
            type: {
                moduleId: bytesToHex(zeroBytes32()),
                transactionName: 'inc'
            },
            nonce: item.nonce.toString(),
            payload: bytesToHex(encodedArgs),
            signatures: [{
                publicKey: bytesToHex(item.keyPair.publicKey),
                signature: bytesToHex(sig.signature)
            }]
        });
    }

    // --- 1. Individual Submissions ---
    console.log(pc.gray('Testing Individual Submissions...'));
    const startIndiv = performance.now();
    for (const tx of signedTxs) {
        await rpcCall('vera_submit', [tx]);
    }
    const endIndiv = performance.now();
    const tpsIndiv = COUNT / ((endIndiv - startIndiv) / 1000);

    // --- 2. Batch Submissions ---
    console.log(pc.gray('Testing Batch Submissions...'));
    const startBatch = performance.now();
    for (let i = 0; i < COUNT; i += BATCH_SIZE) {
        const batch = signedTxs.slice(i, i + BATCH_SIZE);
        await rpcCall('vera_submitBatch', [batch]);
    }
    const endBatch = performance.now();
    const tpsBatch = COUNT / ((endBatch - startBatch) / 1000);

    console.log(pc.green(`\nResults:`));
    console.log(pc.white(`  Individual: ${tpsIndiv.toFixed(0)} TPS`));
    console.log(pc.white(`  Batch (${BATCH_SIZE}): ${tpsBatch.toFixed(0)} TPS`));
    console.log(pc.bold(`  Gain: ${((tpsBatch / tpsIndiv) - 1).toFixed(1)}x faster`));
}

runBatchBench().catch(err => {
    console.error(pc.red('Bench failed:'), err.message);
    console.log(pc.yellow('Make sure a VERA node is running with --experimental-batch-ingest'));
});
