import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
    test: {
        globals: true,
        environment: 'node',
        alias: {
            '@vera/core': resolve(__dirname, '../core/src/index.ts'),
            '@vera/net': resolve(__dirname, '../net/src/index.ts'),
            '@vera/store': resolve(__dirname, '../store/src/index.ts'),
            '@vera/engine': resolve(__dirname, '../engine/src/index.ts')
        }
    }
});
