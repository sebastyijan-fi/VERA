import readline from 'node:readline';
import pc from 'picocolors';
import { parse, ParserError, compileToIR } from '@vera/dsl';
import {
    VirtualMachine,
    GasMeter,
    createExecutionContext,
    createStateJournal,
    EventEmitter
} from '@vera/engine';
import { consola } from 'consola';

export async function repl() {
    consola.info('Welcome to VERA REPL');
    consola.info(pc.dim('Type .exit to quit'));

    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
        prompt: pc.green('> '),
    });

    // Persistent state for the session
    const state = createStateJournal();
    const events = (new EventEmitter()) as any;

    // Mock caller address
    const caller = '0x0000000000000000000000000000000000001234';

    rl.prompt();

    rl.on('line', async (line) => {
        const input = line.trim();

        if (input === '.exit') {
            rl.close();
            return;
        }

        if (input === '') {
            rl.prompt();
            return;
        }

        try {
            // Wrap input in a transaction to make it a valid program
            const wrappedSource = `
module Repl;
transaction Main() {
    return ${input};
}
`;
            // 1. Parse
            const ast = parse(wrappedSource);

            // 2. Compile
            const program = compileToIR(ast);

            // 3. Execute
            const vm = new VirtualMachine(program);
            const gas = new GasMeter(1000000n); // Generous gas
            const context = createExecutionContext({
                caller,
                state,
                events
            });

            const result = await vm.execute('Main', [], context, gas);

            if (result.success) {
                if ((result as any).result !== undefined) {
                    process.stdout.write(pc.yellow(String((result as any).result)) + '\n');
                } else if ((result as any).stack && (result as any).stack.length > 0) {
                    process.stdout.write(pc.yellow('Stack: ' + (result as any).stack) + '\n');
                } else {
                    process.stdout.write(pc.green('OK') + '\n');
                }
            } else {
                consola.error(`Runtime Error: ${result.error?.message}`);
            }

        } catch (error: any) {
            if (error instanceof ParserError) {
                consola.error(`Syntax Error: ${error.message}`);
            } else {
                consola.error(`Error: ${error.message}`);
            }
        }

        rl.prompt();
    });

    rl.on('close', () => {
        consola.info('Goodbye!');
        process.exit(0);
    });
}
