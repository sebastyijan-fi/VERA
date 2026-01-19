/**
 * Source Map Tests
 */
import { describe, it, expect } from 'vitest';
import { parse } from '../src/parser/index.js';
import { compileToIR } from '../src/ir/index.js';
import { buildSourceMap, querySourceMap, formatError, type SourcedError } from '../src/sourcemap/index.js';

describe('Source Maps', () => {
    describe('Source Map Builder', () => {
        it('builds source map from IR program', () => {
            const source = `
module Test
transaction Foo() {
  let x = 42;
}`.trim();
            const module = parse(source);
            const ir = compileToIR(module);
            const sourceMap = buildSourceMap(ir, 'test.vera');

            expect(sourceMap.source).toBe('test.vera');
            expect(sourceMap.module).toBe('Test');
            expect(sourceMap.mappings.length).toBeGreaterThan(0);
        });

        it('includes function names in mappings', () => {
            const source = `
module Test
transaction Alpha() {
  let x = 1;
}
transaction Beta() {
  let y = 2;
}`.trim();
            const module = parse(source);
            const ir = compileToIR(module);
            const sourceMap = buildSourceMap(ir, 'test.vera');

            const functions = new Set(sourceMap.mappings.map(m => m.function));
            expect(functions.has('Alpha')).toBe(true);
            expect(functions.has('Beta')).toBe(true);
        });
    });

    describe('Source Map Query', () => {
        it('gets location for instruction index', () => {
            const source = `
module Test
transaction Foo() {
  let x = 42;
}`.trim();
            const module = parse(source);
            const ir = compileToIR(module);
            const sourceMap = buildSourceMap(ir, 'test.vera');
            const query = querySourceMap(sourceMap);

            const location = query.getLocation('Foo', 0);
            expect(location).toBeDefined();
        });

        it('formats location as string', () => {
            const source = `
module Test
transaction Foo() {
  let x = 42;
}`.trim();
            const module = parse(source);
            const ir = compileToIR(module);
            const sourceMap = buildSourceMap(ir, 'test.vera');
            const query = querySourceMap(sourceMap);

            const location = query.getLocation('Foo', 0);
            if (location) {
                const formatted = query.formatLocation(location);
                expect(formatted).toContain('test.vera');
                expect(formatted).toMatch(/:\d+:/);
            }
        });
    });

    describe('Error Formatting', () => {
        it('formats error with location', () => {
            const source = `
module Test
transaction Foo() {
  let x = 42;
}`.trim();
            const module = parse(source);
            const ir = compileToIR(module);
            const sourceMap = buildSourceMap(ir, 'test.vera');
            const query = querySourceMap(sourceMap);

            const error: SourcedError = {
                message: 'Test error',
                code: 'TEST_ERROR',
                functionName: 'Foo',
                instructionIndex: 0,
            };

            const formatted = formatError(error, query);
            expect(formatted).toContain('Test error');
            expect(formatted).toContain('TEST_ERROR');
        });

        it('includes source context when provided', () => {
            const source = `
module Test
transaction Foo() {
  let x = 42;
}`.trim();
            const module = parse(source);
            const ir = compileToIR(module);
            const sourceMap = buildSourceMap(ir, 'test.vera');
            const query = querySourceMap(sourceMap);

            const error: SourcedError = {
                message: 'Division by zero',
                code: 'DIV_ZERO',
                functionName: 'Foo',
                instructionIndex: 0,
            };

            const formatted = formatError(error, query, source);
            expect(formatted).toContain('Division by zero');
        });
    });
});
