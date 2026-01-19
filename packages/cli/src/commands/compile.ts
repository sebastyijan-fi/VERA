
import fs from 'node:fs/promises';
import path from 'node:path';
import pc from 'picocolors';
import { parse, ParserError } from '@vera/dsl';
import { typeCheck, TypeCheckError } from '@vera/dsl';
import { compileToIR } from '@vera/dsl';

// Helper to serialize BigInt for JSON output
function replacer(key: string, value: any) {
    if (typeof value === 'bigint') {
        return value.toString();
    }
    return value;
}

export async function compile(file: string, options: { out: string }) {
    const start = performance.now();
    console.log(pc.cyan(`Compiling ${file}...`));

    try {
        const source = await fs.readFile(file, 'utf-8');

        // 1. Parse
        console.log(pc.dim('Parsing...'));
        const ast = parse(source);

        // 2. Type Check
        console.log(pc.dim('Type checking...'));
        const errors = typeCheck(ast);

        if (errors.length > 0) {
            console.error(pc.red(`\nType Check Failed with ${errors.length} errors:`));
            for (const error of errors) {
                console.error(pc.red(`- ${error.message}`)); // TODO: Add location info
            }
            process.exit(1);
        }

        // 3. Compile to IR
        console.log(pc.dim('Generating IR...'));
        const ir = compileToIR(ast);

        // 4. Output
        const outDir = options.out || 'dist';
        await fs.mkdir(outDir, { recursive: true });

        const baseName = path.basename(file, path.extname(file));
        const outPath = path.join(outDir, `${baseName}.vir.json`); // VERA IR JSON

        const output = JSON.stringify(ir, replacer, 2);
        await fs.writeFile(outPath, output, 'utf-8');

        const duration = (performance.now() - start).toFixed(2);
        console.log(pc.green(`\n✔ Compiled to ${outPath} in ${duration}ms`));

    } catch (error: any) {
        if (error instanceof ParserError) {
            console.error(pc.red(`\nParse Error: ${error.message}`));
            // TODO: Show location context
        } else {
            console.error(pc.red(`\nCompilation failed: ${error.message}`));
        }
        process.exit(1);
    }
}
