import { defineConfig } from 'tsup';

export default defineConfig({
    entry: [
        'src/index.ts',
        'src/lexer/index.ts',
        'src/parser/index.ts',
        'src/ast/index.ts',
        'src/checker/index.ts',
        'src/ir/index.ts',
        'src/sourcemap/index.ts',
    ],
    format: ['esm'],
    dts: true,
    clean: true,
    sourcemap: true,
    splitting: false,
    treeshake: true,
});
