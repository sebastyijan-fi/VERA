import { defineConfig } from 'tsup';

export default defineConfig({
    entry: [
        'src/index.ts',
        'src/types/index.ts',
        'src/crypto/index.ts',
        'src/encoding/index.ts',
        'src/state/index.ts',
    ],
    format: ['esm'],
    dts: true,
    clean: true,
    sourcemap: true,
    splitting: false,
    treeshake: true,
});
