import path from 'node:path';
import http from 'node:http';
import {
    createSingleSequencer,
} from '@vera/ordering';
import {
    LevelDBStore,
    PersistentStateStore,
} from '@vera/store';
import {
    hexToBytes,
    hexToBytes32,
    zeroBytes32,
    sha256WithDomain,
    HashDomains,
    encodeCanonicalTransaction,
} from '@vera/core';
import pc from 'picocolors';

export async function node(
    options: {
        dataDir?: string;
        port?: number;
        chainId?: string;
    }
) {
    const dataDir = path.resolve(options.dataDir || './data');
    const port = options.port || 8545;
    const chainId = options.chainId ? hexToBytes32(options.chainId) : zeroBytes32();

    console.log(pc.cyan('VERA Node Starting...'));
    console.log(pc.gray(`Data Directory: ${dataDir}`));
    console.log(pc.gray(`Chain ID: ${options.chainId || '00...00'}`));

    try {
        // 1. Initialize Stores
        const stateDbPath = path.join(dataDir, 'state.db');
        const seqDbPath = path.join(dataDir, 'sequencer.db');

        const statePersistence = new LevelDBStore(stateDbPath);
        const seqPersistence = new LevelDBStore(seqDbPath);

        // 2. Initialize State Store
        const stateStore = await PersistentStateStore.load(statePersistence);
        console.log(pc.green(`✓ State Loaded (Version: ${stateStore.version})`));

        // 3. Initialize Sequencer
        const sequencer = createSingleSequencer({
            id: 'vera-local-1',
            chainId,
            store: seqPersistence,
        });

        // 4. Start Server
        const server = http.createServer(async (req, res) => {
            // Helper to send JSON
            const sendJson = (code: number, data: any) => {
                if (res.headersSent) return;
                res.writeHead(code, {
                    'Content-Type': 'application/json',
                    'Access-Control-Allow-Origin': '*',
                    'Access-Control-Allow-Methods': 'POST, OPTIONS'
                });
                const replacer = (_key: string, value: any) =>
                    typeof value === 'bigint' ? value.toString() :
                        value instanceof Uint8Array ?
                            Array.from(value).map(b => b.toString(16).padStart(2, '0')).join('') :
                            value;
                res.end(JSON.stringify(data, replacer));
            };

            // CORS Preflight
            if (req.method === 'OPTIONS') {
                res.writeHead(200, {
                    'Access-Control-Allow-Origin': '*',
                    'Access-Control-Allow-Methods': 'POST, OPTIONS',
                    'Access-Control-Allow-Headers': 'Content-Type'
                });
                res.end();
                return;
            }

            if (req.method !== 'POST') {
                if (res.headersSent) return;
                res.writeHead(405, { 'Access-Control-Allow-Origin': '*' });
                res.end('Method Not Allowed');
                return;
            }

            let body = '';
            req.on('data', chunk => body += chunk);
            req.on('end', async () => {
                try {
                    const payloadText = body.trim();
                    if (!payloadText) throw new Error('Empty request body');

                    const payload = JSON.parse(payloadText);
                    const { method, params, id } = payload;
                    console.log(pc.gray(`RPC Request: ${method}`));

                    let result;
                    if (method === 'eth_sendRawTransaction' || method === 'vera_submit') {
                        const txData = params[0];
                        if (!txData) throw new Error('Missing transaction data');

                        // Convert hex back to bytes and prepare raw tx for sequencer
                        const chainIdBytes = hexToBytes32(txData.chainId);
                        const senderBytes = hexToBytes32(txData.signatures[0].publicKey);
                        const payloadBytes = hexToBytes(txData.payload);
                        const signatureBytes = hexToBytes(txData.signatures[0].signature);
                        const nonce = BigInt(txData.nonce);

                        // Re-compute hash from txData (canonical)
                        const canonical = encodeCanonicalTransaction({
                            version: Number(txData.version),
                            chainId: chainIdBytes,
                            type: {
                                moduleId: hexToBytes32(txData.type.moduleId),
                                transactionName: txData.type.transactionName,
                            },
                            nonce: nonce,
                            maxSequence: txData.maxSequence ? BigInt(txData.maxSequence) : undefined,
                            payload: payloadBytes,
                        });

                        const hash = sha256WithDomain(HashDomains.TRANSACTION, new Uint8Array(canonical));

                        const rawTx = {
                            hash,
                            chainId: chainIdBytes,
                            sender: senderBytes,
                            function: txData.type.transactionName,
                            args: payloadBytes,
                            nonce: nonce,
                            signature: signatureBytes,
                            submittedAt: BigInt(Date.now()),
                        };

                        result = await sequencer.submit(rawTx as any);
                        console.log(pc.green(`✓ Transaction Submitted: ${txData.type.transactionName} (Nonce: ${nonce})`));
                    } else if (method === 'vera_status') {
                        result = await sequencer.getStatus();
                    } else {
                        throw new Error(`Method ${method} not found`);
                    }

                    sendJson(200, { jsonrpc: '2.0', id, result });
                } catch (err: any) {
                    console.error(pc.red('RPC Error:'), err.message);
                    sendJson(500, { jsonrpc: '2.0', id: null, error: err.message });
                }
            });
        });

        await sequencer.start();

        server.listen(port, () => {
            console.log(pc.green(`✓ RPC Server listening on http://localhost:${port}`));
        });

        // Handle Shutdown
        const shutdown = async () => {
            console.log(pc.yellow('\nShutting down...'));
            server.close();
            await sequencer.stop();
            await statePersistence.close();
            await seqPersistence.close();
            process.exit(0);
        };

        process.on('SIGINT', shutdown);
        process.on('SIGTERM', shutdown);

    } catch (err: any) {
        console.error(pc.red('Fatal Error:'), err.message);
        process.exit(1);
    }
}
