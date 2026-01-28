#!/usr/bin/env node
/**
 * VERA CLI - Command Line Interface
 */

import { Command } from 'commander';
import { consola } from 'consola';
import { FullNode } from './node.js';
import { loadConfig } from './config.js';
import { compile } from './commands/compile.js';
import { repl } from './commands/repl.js';
import { verify } from './commands/verify.js';
import { notarize } from './commands/notarize.js';
import { setupTxCommands } from './commands/tx.js';
import fs from 'node:fs';

const program = new Command();

program
    .name('vera')
    .description('Verifiable Execution & Registry Architecture (VERA) Node')
    .version('1.0.0');

program
    .command('run')
    .description('Start a full node')
    .option('-c, --config <path>', 'Path to config file', 'vera.config.toml')
    .option('-p, --port <number>', 'Port to listen on')
    .option('--peer <address>', 'Initial peer to connect to')
    .option('--data <path>', 'Path to data directory')
    .option('--contract <path>', 'Path to compiled contract (.vir.json)')
    .action(async (options) => {
        consola.info('Starting VERA Full Node...');

        // Load config from file
        const config = loadConfig(options.config);

        // Override with CLI options
        if (options.port) config.port = parseInt(options.port);
        if (options.data) config.dataDir = options.data;
        if (options.data) config.dataDir = options.data;
        if (options.peer) config.peers.push(options.peer);
        if (options.contract) config.programPath = options.contract;

        try {
            const node = new FullNode(config);

            await node.start();
            consola.success(`Node listening on port ${config.port}`);

            // Connect to seeds/peers
            for (const peer of config.peers) {
                const [host, peerPort] = peer.split(':');
                if (host && peerPort) {
                    consola.info(`Connecting to peer ${peer}...`);
                    node.connect(host, parseInt(peerPort)).catch((err: any) => {
                        consola.warn(`Failed to connect to peer ${peer}: ${err.message}`);
                    });
                }
            }


            // Handle termination
            process.on('SIGINT', async () => {
                consola.info('Stopping node...');
                await node.stop();
                process.exit(0);
            });

        } catch (error: any) {
            consola.error('Failed to start node:', error);
            process.exit(1);
        }
    });

program
    .command('compile <file>')
    .description('Compile a VERA DSL file to IR')
    .option('-o, --out <dir>', 'Output directory', 'dist')
    .action(async (file, options) => {
        await compile(file, options);
    });

program
    .command('repl')
    .description('Start an interactive VERA shell')
    .action(async () => {
        await repl();
    });

program
    .command('notarize <file>')
    .description('Cryptographically sign a file (Proof of Existence)')
    .option('-s, --secret <hex>', 'Private key (hex)')
    .option('-o, --out <path>', 'Output proof file path')
    .action(async (file, options) => {
        await notarize({ file, ...options });
    });

program
    .command('verify')
    .description('Verify a file proof or audit bundle')
    .option('-f, --file <path>', 'File to verify')
    .option('-p, --proof <path>', 'Proof file (JSON)')
    .option('-b, --bundle <file>', 'Path to audit bundle')
    .option('-r, --root <hex>', 'Expected state root (hex)')
    .action(async (options) => {
        await verify(options);
    });

program
    .command('status')
    .description('Show node status')
    .action(() => {
        consola.info('Command not yet implemented (requires node communication)');
    });

program
    .command('init')
    .description('Generate an example configuration file')
    .action(() => {
        const exampleConfig = `# VERA Configuration Example

port = 5001
dataDir = "./data"

# Initial peers to connect to
# peers = ["localhost:5002"]
`;
        fs.writeFileSync('vera.config.toml', exampleConfig);
        consola.success('Created vera.config.toml');
    });

// Transaction commands
setupTxCommands(program);

program.parse();
