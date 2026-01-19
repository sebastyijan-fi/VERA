import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        globals: true,
        coverage: {
            provider: 'v8',
            reporter: ['text', 'json', 'html'],
        },
        include: ['test/**/*.test.ts'],
        exclude: ['node_modules', 'dist'],
    },
});
