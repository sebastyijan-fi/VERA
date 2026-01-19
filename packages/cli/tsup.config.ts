import { defineConfig } from 'tsup';

export default defineConfig({
    entry: ['src/bin.ts'],
    format: ['esm'],
    dts: false, // Binaries don't need dts usually, but maybe for API usage?
    clean: true,
    sourcemap: true,
    platform: 'node',
});
