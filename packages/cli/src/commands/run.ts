
import fs from 'node:fs/promises';
import pc from 'picocolors';
import { parse, ParserError } from '@vera/dsl';
import { compileToIR, type IRProgram } from '@vera/dsl';
import {
    VirtualMachine,
    GasMeter,
    createExecutionContext,
    createStateJournal,
    EventEmitter
} from '@vera/engine';

export async function run(file: string, options: { entry?: string, args?: string[] }) {
    console.log(pc.cyan(`Running ${file}...`));

    try {
        let program: IRProgram;

        // Detect if file is source (.vera) or compiled (.json)
        if (file.endsWith('.json')) {
            const content = await fs.readFile(file, 'utf-8');
            // deserialization of BigInt handling
            program = JSON.parse(content, (key, value) => {
                // Heuristic: if looks like big integer?
                // Or just rely on string parsing if the JSON contains strings for bigints.
                // The JSON generic parser might not revive BigInts automatically.
                // But for now, let's assume we run .vera source mostly for dev experience.
                return value;
            });
            // If program has bigints stored as strings, we might need manual conversion or a reviver helper.
            // Skipping detailed JSON loader implementation for now.
            console.log(pc.yellow('Optimized JSON loading not fully implemented, prefer source file.'));
        } else {
            const source = await fs.readFile(file, 'utf-8');
            const ast = parse(source);
            program = compileToIR(ast);
        }

        const entryPoint = options.entry || 'init'; // Default to init

        // Check if entry point exists
        const func = program.functions.find(f => f.name === entryPoint);
        if (!func) {
            console.error(pc.red(`Entry point '${entryPoint}' not found in module '${program.name}'`));
            process.exit(1);
        }

        const vm = new VirtualMachine(program);
        const gas = new GasMeter(10000000n);
        const state = createStateJournal(); // Ephemeral state for run
        const events = new EventEmitter();

        // Handle args -> VM values
        // Simplification: Parse args as best guess (int, string, bool)
        const args: any[] = (options.args || []).map(arg => {
            if (arg === 'true') return { kind: 'bool', value: true };
            if (arg === 'false') return { kind: 'bool', value: false };
            if (/^\d+$/.test(arg)) return { kind: 'int', value: BigInt(arg) };
            if (/^0x[0-9a-fA-F]+$/.test(arg)) {
                // Convert to bytes? Or keep as string/Address?
                // VM expects values. Address is usually string or bytes.
                // let's assume Address is string for now based on VM tests using strings for addresses.
                return { kind: 'string', value: arg };
            }
            return { kind: 'string', value: arg };
        });

        // Context
        // Mock caller
        const context = createExecutionContext({
            caller: '0x0000000000000000000000000000000000000000',
            state,
            events
        });

        const start = performance.now();
        const result = await vm.execute(entryPoint, args, context, gas);
        const duration = (performance.now() - start).toFixed(2);

        if (result.success) {
            console.log(pc.green(`\n✔ Execution successful in ${duration}ms`));
            console.log(pc.dim(`Gas used: ${result.gasUsed}`));

            if (events.count > 0) {
                console.log(pc.blue(`\nEvents (${events.count}):`));
                for (const event of events.getEvents()) {
                    // Safe logging of event data
                    const dataStr = JSON.stringify(event, (key, value) =>
                        typeof value === 'bigint' ? value.toString() : value
                    );
                    console.log(`- ${event.name}: ${dataStr}`);
                }
            }
        } else {
            console.error(pc.red(`\n✘ Execution failed: ${result.error?.message}`));
        }

    } catch (error: any) {
        if (error instanceof ParserError) {
            console.error(pc.red(`\nParse Error: ${error.message}`));
        } else {
            console.error(pc.red(`\nError: ${error.message}`));
        }
        process.exit(1);
    }
}
