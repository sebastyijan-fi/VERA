import fs from 'node:fs/promises';
import path from 'node:path';
import pc from 'picocolors';
import { parse, ParserError, typeCheck, compileToIR } from '@vera/dsl';
import { consola } from 'consola';

// Helper to serialize BigInt for JSON output
function replacer(_key: string, value: any) {
    if (typeof value === 'bigint') {
        return value.toString();
    }
    return value;
}

export async function compile(file: string, options: { out?: string }) {
    const start = performance.now();
    consola.info(`Compiling ${file}...`);

    try {
        const source = await fs.readFile(file, 'utf-8');

        // 1. Parse
        consola.debug('Parsing...');
        const ast = parse(source);

        // 2. Type Check
        consola.debug('Type checking...');
        const errors = typeCheck(ast);

        if (errors.length > 0) {
            consola.error(pc.red(`\nType Check Failed with ${errors.length} errors:`));
            for (const error of errors) {
                consola.error(pc.red(`- ${error.message}`));
            }
            process.exit(1);
        }

        // 3. Compile to IR
        consola.debug('Generating IR...');
        const ir = compileToIR(ast);

        // 4. Output
        const outDir = options.out || 'dist';
        await fs.mkdir(outDir, { recursive: true });

        const baseName = path.basename(file, path.extname(file));
        const outPath = path.join(outDir, `${baseName}.vir.json`); // VERA IR JSON

        const output = JSON.stringify(ir, replacer, 2);
        await fs.writeFile(outPath, output, 'utf-8');

        const duration = (performance.now() - start).toFixed(2);
        consola.success(`Compiled to ${outPath} in ${duration}ms`);

    } catch (error: any) {
        if (error instanceof ParserError) {
            consola.error(`Parse Error: ${error.message}`);
        } else {
            consola.error(`Compilation failed: ${error.message}`);
        }
        process.exit(1);
    }
}
