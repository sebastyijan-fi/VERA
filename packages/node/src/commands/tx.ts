/**
 * VERA CLI - Transaction Commands
 * 
 * Send, inspect, and manage transactions.
 */

import { Command } from 'commander';
import { consola } from 'consola';
import { generateKeyPair, bytesToHex, hexToBytes } from '@vera/core';
import {
    signTransaction,
    encodeTransaction,
    getTransactionHash,
    type TransactionPayload,
    type UnsignedTransaction
} from '../tx/builder.js';
import fs from 'node:fs';

const TX_VERSION = 1;

export function setupTxCommands(program: Command) {
    const tx = program
        .command('tx')
        .description('Transaction operations');

    // Send a transaction
    tx.command('send')
        .description('Construct, sign, and send a transaction')
        .requiredOption('--to <address>', 'Target contract address')
        .requiredOption('--function <name>', 'Function to call')
        .option('--args <json>', 'Function arguments as JSON array', '[]')
        .option('--key <hex>', 'Private key (hex) - or uses $VERA_PRIVATE_KEY')
        .option('--keyfile <path>', 'Path to keyfile')
        .option('--rpc <url>', 'RPC endpoint', 'http://localhost:8545')
        .option('--nonce <number>', 'Transaction nonce (auto-fetched if omitted)')
        .option('--chain-id <hex>', 'Chain ID (auto-fetched if omitted)')
        .option('--dry-run', 'Print transaction without sending')
        .action(async (options) => {
            try {
                // Get private key
                let privateKey: Uint8Array;
                if (options.key) {
                    privateKey = hexToBytes(options.key.replace('0x', ''));
                } else if (options.keyfile) {
                    const content = fs.readFileSync(options.keyfile, 'utf-8').trim();
                    privateKey = hexToBytes(content.replace('0x', ''));
                } else if (process.env.VERA_PRIVATE_KEY) {
                    privateKey = hexToBytes(process.env.VERA_PRIVATE_KEY.replace('0x', ''));
                } else {
                    consola.error('No private key provided. Use --key, --keyfile, or $VERA_PRIVATE_KEY');
                    process.exit(1);
                }

                // Parse function arguments
                let args: unknown[];
                try {
                    args = JSON.parse(options.args);
                } catch {
                    consola.error('Invalid --args JSON');
                    process.exit(1);
                }

                // Get chain ID from RPC if not provided
                let chainId: Uint8Array;
                if (options.chainId) {
                    chainId = hexToBytes(options.chainId.replace('0x', '').padStart(64, '0'));
                } else {
                    const chainIdHex = await rpcCall(options.rpc, 'vera_chainId', []);
                    chainId = hexToBytes(chainIdHex.replace('0x', '').padStart(64, '0'));
                }

                // Get nonce from RPC if not provided
                let nonce: bigint;
                if (options.nonce !== undefined) {
                    nonce = BigInt(options.nonce);
                } else {
                    // For now, use 0 - in production would fetch from vera_getNonce
                    nonce = 0n;
                }

                // Build transaction
                const payload: TransactionPayload = {
                    to: options.to,
                    function: options.function,
                    args
                };

                const unsignedTx: UnsignedTransaction = {
                    version: TX_VERSION,
                    chainId,
                    nonce,
                    payload
                };

                // Sign transaction
                const signedTx = signTransaction(unsignedTx, privateKey);
                const rawTx = encodeTransaction(signedTx);
                const txHash = getTransactionHash(signedTx);

                consola.info('Transaction constructed:');
                console.log(`  Hash: ${bytesToHex(txHash)}`);
                console.log(`  To: ${options.to}`);
                console.log(`  Function: ${options.function}`);
                console.log(`  Args: ${JSON.stringify(args)}`);
                console.log(`  Nonce: ${nonce}`);
                console.log(`  Raw: ${bytesToHex(rawTx).slice(0, 66)}...`);
                console.log('');

                if (options.dryRun) {
                    consola.info('Dry run - transaction not sent');
                    console.log(`\nFull raw tx: ${bytesToHex(rawTx)}`);
                    return;
                }

                // Send via RPC
                consola.info(`Sending to ${options.rpc}...`);
                const result = await rpcCall(options.rpc, 'vera_sendRawTransaction', [bytesToHex(rawTx)]);

                consola.success('Transaction submitted!');
                console.log(`  Hash: ${result.hash}`);
                if (result.sequenceNumber) {
                    console.log(`  Sequence: ${result.sequenceNumber}`);
                }

            } catch (error: any) {
                consola.error('Failed to send transaction:', error.message);
                process.exit(1);
            }
        });

    // Generate a new keypair
    tx.command('keygen')
        .description('Generate a new keypair')
        .option('--output <path>', 'Save to file')
        .action((options) => {
            const keypair = generateKeyPair();

            console.log('');
            console.log('=== New VERA Keypair ===');
            console.log('');
            console.log(`  Address:     ${bytesToHex(keypair.publicKey)}`);
            console.log(`  Private Key: ${bytesToHex(keypair.privateKey)}`);
            console.log('');

            if (options.output) {
                fs.writeFileSync(options.output, bytesToHex(keypair.privateKey));
                consola.success(`Private key saved to ${options.output}`);
            } else {
                consola.warn('⚠️  Save your private key securely! It will not be shown again.');
            }
        });

    // Inspect a raw transaction
    tx.command('decode <rawTx>')
        .description('Decode and inspect a raw transaction')
        .action((rawTx) => {
            try {
                const { decodeTransaction } = require('../tx/builder.js');
                const bytes = hexToBytes(rawTx.replace('0x', ''));
                const tx = decodeTransaction(bytes);

                console.log('');
                console.log('=== Decoded Transaction ===');
                console.log('');
                console.log(`  Version:  ${tx.version}`);
                console.log(`  Chain ID: ${bytesToHex(tx.chainId)}`);
                console.log(`  Nonce:    ${tx.nonce}`);
                console.log(`  To:       ${tx.payload.to}`);
                console.log(`  Function: ${tx.payload.function}`);
                console.log(`  Args:     ${JSON.stringify(tx.payload.args)}`);
                console.log(`  Signer:   ${bytesToHex(tx.publicKey)}`);
                console.log('');

            } catch (error: any) {
                consola.error('Failed to decode transaction:', error.message);
                process.exit(1);
            }
        });
}

/**
 * Make an RPC call
 */
async function rpcCall(url: string, method: string, params: unknown[]): Promise<any> {
    const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            jsonrpc: '2.0',
            id: 1,
            method,
            params
        })
    });

    const json = await response.json() as any;


    if (json.error) {
        throw new Error(json.error.message || JSON.stringify(json.error));
    }

    return json.result;
}
