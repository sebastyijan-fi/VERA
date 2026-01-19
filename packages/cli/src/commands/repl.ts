
import readline from 'node:readline';
import pc from 'picocolors';
import { parse, ParserError } from '@vera/dsl';
import { compileToIR } from '@vera/dsl';
import {
    VirtualMachine,
    GasMeter,
    createExecutionContext,
    createStateJournal,
    EventEmitter
} from '@vera/engine';

export async function repl() {
    console.log(pc.cyan('Welcome to VERA REPL v0.1.0'));
    console.log(pc.dim('Type .exit to quit'));

    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
        prompt: pc.green('> '),
    });

    // Persistent state for the session
    const state = createStateJournal();
    const events = new EventEmitter();

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
            // We use a transaction returns the expression value.
            // Note: DSL 'transaction' returns void usually? 
            // In IR, RET takes a value? 
            // If DSL 'return expr' statement works, then it works.
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
                // If there is a return value (on stack or returned), display it.
                // IR 'execute' returns { success, gasUsed, error, stack? }
                // Check VM result type. 
                // engine/src/types.ts or vm.ts
                // Usually execution result might doesn't explicitly return the top of stack unless programmed.
                // However, for REPL, we want the result.
                // If VM clears stack on return, we can't see it.
                // VM.execute implementation likely returns void or minimal info.
                // BUT, if 'Main' has a return value?
                // VERA VM implementation (from recent memory/tests) handles RET.

                // Let's assume result.result is the value if any?
                // Inspect result object in console for now.
                if ((result as any).result !== undefined) {
                    console.log(pc.yellow(String((result as any).result)));
                } else if ((result as any).stack && (result as any).stack.length > 0) {
                    // If stack not empty
                    console.log(pc.yellow('Stack: ' + (result as any).stack));
                } else {
                    console.log(pc.green('OK'));
                }
            } else {
                console.error(pc.red(`Runtime Error: ${result.error?.message}`));
            }

        } catch (error: any) {
            if (error instanceof ParserError) {
                console.error(pc.red(`Syntax Error: ${error.message}`));
            } else {
                console.error(pc.red(`Error: ${error.message}`));
            }
        }

        rl.prompt();
    });

    rl.on('close', () => {
        console.log(pc.dim('\nGoodbye!'));
        process.exit(0);
    });
}
