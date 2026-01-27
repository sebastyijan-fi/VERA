import { generateCorpus } from './generator.js';
import pc from 'picocolors';
import { VeraClient } from '@vera/sdk';

async function benchSpam() {
    const COUNT = 1000; // Start small for E2E
    const URL = 'http://localhost:8545';

    console.log(pc.cyan(`\nStarting E2E Spam Cannon (${COUNT} txs) -> ${URL}`));

    const client = new VeraClient(URL);

    // Check connectivity
    try {
        await client.getStatus();
    } catch {
        console.error(pc.red('Error: Node not running at ' + URL));
        process.exit(1);
    }

    console.log(pc.gray('Generating corpus...'));
    const corpus = generateCorpus(COUNT);

    console.log(pc.gray('Firing...'));
    const start = performance.now();

    let sent = 0;
    let errors = 0;

    // Parallelism? 
    // Single threaded loop with await is "Latency" bound (RTT).
    // We want Throughput. So Promise.all or batches.
    const BATCH_SIZE = 50;

    for (let i = 0; i < corpus.length; i += BATCH_SIZE) {
        const batch = corpus.slice(i, i + BATCH_SIZE);
        await Promise.all(batch.map(async (tx) => {
            try {
                // We need to convert bench tx to JSON-RPC request
                // This mimics "eth_sendRawTransaction" roughly
                // But for VERA pilot we used 'vera_submit'.
                // We'll skip SDK 'signTransaction' since we pre-signed in generator.

                // Construct payload manually (quick hack for bench)
                const body = {
                    method: 'vera_submit',
                    params: [{
                        chainId: '00'.repeat(32),
                        nonce: tx.nonce.toString(),
                        payload: Buffer.from(tx.payload).toString('hex'),
                        signatures: [{
                            publicKey: Buffer.from(tx.publicKey).toString('hex'),
                            signature: Buffer.from(tx.signature).toString('hex')
                        }],
                        type: {
                            moduleId: '00'.repeat(32),
                            transactionName: 'bench'
                        },
                        version: 1
                    }],
                    id: 1,
                    jsonrpc: '2.0'
                };

                const res = await fetch(URL, {
                    method: 'POST',
                    body: JSON.stringify(body)
                });

                if (!res.ok) throw new Error(res.statusText);
            } catch (e) {
                errors++;
            }
        }));
        sent += batch.length;
        process.stdout.write(`\rSent: ${sent}/${COUNT} (Errors: ${errors})`);
    }

    const end = performance.now();
    const durationSec = (end - start) / 1000;
    const tps = COUNT / durationSec;

    console.log(pc.green(`\n\n✓ Finished`));
    console.log(pc.bold(`Avg TPS (Client-side): ${tps.toFixed(0)}`));
    console.log(pc.gray(`Note: This measures 'Submit' rate, not 'Commit' rate.`));

    // Generate Report Artifact
    const fs = await import('node:fs/promises');
    const path = await import('node:path');

    const report = {
        timestamp: new Date().toISOString(),
        benchmark: 'e2e_spam_http',
        description: 'Measures submission rate via HTTP JSON-RPC to a running Node.',
        metrics: {
            count: COUNT,
            duration_sec: durationSec,
            tps: Math.round(tps),
            boundary: 'accepted_queued'
        }
    };

    await fs.mkdir('bench-out', { recursive: true });
    await fs.writeFile(
        'bench-out/spam_report.json',
        JSON.stringify(report, null, 2)
    );
}

benchSpam().catch(console.error);
