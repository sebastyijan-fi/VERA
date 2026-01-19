#!/usr/bin/env node
import { cac } from 'cac';
import pc from 'picocolors';
import pkg from '../package.json' with { type: 'json' };
const { version } = pkg;

const cli = cac('vera');

cli
    .command('compile <file>', 'Compile a VERA source file')
    .option('-o, --out <dir>', 'Output directory', { default: 'dist' })
    .action(async (file, options) => {
        try {
            const { compile } = await import('./commands/compile.js');
            await compile(file, options);
        } catch (error: any) {
            console.error(pc.red(`Error: ${error.message}`));
            process.exit(1);
        }
    });

cli
    .command('repl', 'Start the VERA REPL')
    .action(async () => {
        try {
            const { repl } = await import('./commands/repl.js');
            await repl();
        } catch (error: any) {
            console.error(pc.red(`Error: ${error.message}`));
            process.exit(1);
        }
    });

cli.command('node', 'Start a VERA blockchain node')
    .option('--data-dir <dir>', 'Directory to store chain data', { default: './data' })
    .option('--port <port>', 'Port for RPC server', { default: 8545 })
    .option('--dsl <file>', 'VERA DSL registry file to load')
    .action(async (options) => {
        try {
            const { node } = await import('./commands/node.js');
            await node(options);
        } catch (error: any) {
            console.error(pc.red(`Error: ${error.message}`));
            process.exit(1);
        }
    });

cli.command('verify', 'Verify a Merkle state proof')
    .option('--proof <file>', 'JSON proof file')
    .option('--root <hex>', 'Target state root (hex)')
    .action(async (options) => {
        try {
            if (!options.proof || !options.root) {
                throw new Error('Missing --proof or --root');
            }
            const { verify } = await import('./commands/verify.js');
            await verify(options);
        } catch (error: any) {
            console.error(pc.red(`Error: ${error.message}`));
            process.exit(1);
        }
    });

cli.command('run <file>', 'Execute a VERA script')
    .option('--entry <name>', 'Entry point function', { default: 'init' })
    .option('--args <args>', 'Arguments (comma separated)', { type: [String] })
    // cac arrays options behavior might vary. Simple string parsing in run.ts might be safer or use variadic args?
    // Let's stick to what run.ts handled: options.args.
    // cac handles variadic args if [ ...args] ? 
    // run.ts expects options.args as string array?
    // Let's use simple signature.
    .action(async (file, options) => {
        try {
            const { run } = await import('./commands/run.js');
            await run(file, options);
        } catch (error: any) {
            console.error(pc.red(`Error: ${error.message}`));
            process.exit(1);
        }
    });

cli.help();
cli.version(version);

try {
    cli.parse();
} catch (error: any) {
    console.error(pc.red(error.message));
    process.exit(1);
}
