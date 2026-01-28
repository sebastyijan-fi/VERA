#!/usr/bin/env npx tsx
/**
 * VERA Devnet Launcher
 * 
 * One-command script to start a local multi-node network for development.
 * 
 * Usage:
 *   npx tsx scripts/devnet.ts              # Start 3 validators
 *   npx tsx scripts/devnet.ts --nodes 5    # Start 5 validators
 *   npx tsx scripts/devnet.ts --clean      # Clean data dirs first
 */

import { FullNode } from '../packages/node/dist/index.js';
import { generateKeyPair, bytesToHex, sha256 } from '../packages/core/dist/index.js';
import fs from 'node:fs/promises';
import path from 'node:path';

// Simple logging without consola dependency
const log = {
    info: (...args: any[]) => console.log('[info]', ...args),
    success: (...args: any[]) => console.log('✓', ...args),
    error: (...args: any[]) => console.error('[error]', ...args),
    box: (msg: string) => console.log(`\n${'='.repeat(40)}\n  ${msg}\n${'='.repeat(40)}\n`)
};

interface DevnetConfig {
    nodeCount: number;
    basePort: number;
    baseRpcPort: number;
    dataDir: string;
    clean: boolean;
    contractPath?: string;
}

interface ValidatorInfo {
    id: string;
    publicKey: string;
    privateKey: string;
    votingPower: number;
}

interface GenesisConfig {
    chainId: string;
    networkId: string;
    timestamp: number;
    validators: { id: string; publicKey: string; votingPower: number }[];
    genesisHash: string;
}

function parseArgs(): DevnetConfig {
    const args = process.argv.slice(2);
    const config: DevnetConfig = {
        nodeCount: 3,
        basePort: 5001,
        baseRpcPort: 8545,
        dataDir: '.devnet',
        clean: false
    };

    for (let i = 0; i < args.length; i++) {
        if (args[i] === '--nodes' || args[i] === '-n') {
            config.nodeCount = parseInt(args[++i], 10);
        } else if (args[i] === '--clean' || args[i] === '-c') {
            config.clean = true;
        } else if (args[i] === '--data-dir') {
            config.dataDir = args[++i];
        } else if (args[i] === '--contract') {
            config.contractPath = args[++i];
        }
    }

    return config;
}

function generateValidators(count: number): ValidatorInfo[] {
    log.info(`Generating ${count} validator keypairs...`);
    const validators: ValidatorInfo[] = [];

    for (let i = 0; i < count; i++) {
        const keypair = generateKeyPair();
        validators.push({
            id: bytesToHex(keypair.publicKey),
            publicKey: bytesToHex(keypair.publicKey),
            privateKey: bytesToHex(keypair.privateKey),
            votingPower: 10
        });
    }

    // Sort by ID for deterministic leader selection
    validators.sort((a, b) => a.id.localeCompare(b.id));
    return validators;
}

function createGenesis(validators: ValidatorInfo[], networkId: string): GenesisConfig {
    const timestamp = Math.floor(Date.now() / 1000);
    const genesisData = `vera-genesis:${networkId}:${timestamp}:${validators.map(v => v.id).join(',')}`;
    const genesisHash = bytesToHex(sha256(new TextEncoder().encode(genesisData)));

    return {
        chainId: genesisHash,
        networkId,
        timestamp,
        validators: validators.map(v => ({
            id: v.id,
            publicKey: v.publicKey,
            votingPower: v.votingPower
        })),
        genesisHash
    };
}

async function main() {
    const config = parseArgs();
    const nodes: FullNode[] = [];

    log.box(`VERA Devnet - ${config.nodeCount} Nodes`);

    // Clean data directory if requested
    if (config.clean) {
        log.info('Cleaning data directories...');
        await fs.rm(config.dataDir, { recursive: true, force: true });
    }

    // Create data directory
    await fs.mkdir(config.dataDir, { recursive: true });

    // Generate validators
    const validators = generateValidators(config.nodeCount);

    // Create genesis
    const genesis = createGenesis(validators, 'vera-devnet');

    // Save genesis for reference
    await fs.writeFile(
        path.join(config.dataDir, 'genesis.json'),
        JSON.stringify(genesis, null, 2)
    );
    await fs.writeFile(
        path.join(config.dataDir, 'keys.json'),
        JSON.stringify(validators, null, 2)
    );
    log.success('Genesis created:', genesis.genesisHash.slice(0, 18) + '...');

    // Start nodes
    for (let i = 0; i < config.nodeCount; i++) {
        const nodeDataDir = path.join(config.dataDir, `node-${i}`);
        await fs.mkdir(nodeDataDir, { recursive: true });

        const port = config.basePort + i;
        const rpcPort = config.baseRpcPort + (i * 10); // 8545, 8555, 8565...

        const node = new FullNode({
            port,
            dataDir: nodeDataDir,
            networkId: genesis.networkId,
            genesisHash: genesis.genesisHash,
            validators: genesis.validators,
            secretKey: validators[i].privateKey,
            rpcPort,
            rpcEnabled: true,
            programPath: config.contractPath
        });

        try {
            await node.start();
            nodes.push(node);

            // Connect to previous nodes
            for (let j = 0; j < i; j++) {
                await node.connect('127.0.0.1', config.basePort + j);
            }

            log.success(`Node ${i} started (port: ${port}, RPC: ${rpcPort})`);
        } catch (err: any) {
            log.error(`Failed to start node ${i}:`, err.message);
        }
    }

    // Print summary
    log.box('Devnet Running');
    console.log('');
    console.log('  Nodes:');
    for (let i = 0; i < nodes.length; i++) {
        const port = config.basePort + i;
        const rpcPort = config.baseRpcPort + (i * 10);
        const isLeader = i === 0 ? ' (leader)' : '';
        console.log(`    Node ${i}: P2P=${port}, RPC=http://localhost:${rpcPort}${isLeader}`);
    }
    console.log('');
    console.log('  Test with:');
    console.log(`    curl -X POST http://localhost:${config.baseRpcPort} -H 'Content-Type: application/json' \\`);
    console.log(`      -d '{"jsonrpc":"2.0","id":1,"method":"vera_blockNumber"}'`);
    console.log('');
    console.log('  Press Ctrl+C to stop\n');

    // Handle shutdown
    const shutdown = async () => {
        console.log('\n');
        log.info('Shutting down devnet...');
        for (const node of nodes) {
            await node.stop();
        }
        log.success('Devnet stopped');
        process.exit(0);
    };

    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);

    // Keep alive
    await new Promise(() => { });
}

main().catch(err => {
    log.error('Devnet failed:', err);
    process.exit(1);
});
