/**
 * VM Tests
 */
import { describe, it, expect } from 'vitest';
import { parse, compileToIR } from '@vera/dsl';
import {
    VirtualMachine,
    Stack,
    intValue,
    boolValue,
    stringValue,
    nullValue,
    valuesEqual,
    isTruthy,
    GasMeter,
    createExecutionContext,
    createStateJournal,
    EventEmitter,
} from '../src/index.js';

describe('Stack', () => {
    it('pushes and pops values', () => {
        const stack = new Stack();
        stack.push(intValue(42));
        stack.push(intValue(100));

        expect(stack.depth).toBe(2);
        expect(stack.pop()).toEqual(intValue(100));
        expect(stack.pop()).toEqual(intValue(42));
        expect(stack.isEmpty).toBe(true);
    });

    it('peeks without popping', () => {
        const stack = new Stack();
        stack.push(intValue(42));

        expect(stack.peek()).toEqual(intValue(42));
        expect(stack.depth).toBe(1);
    });

    it('duplicates top value', () => {
        const stack = new Stack();
        stack.push(intValue(42));
        stack.dup();

        expect(stack.depth).toBe(2);
        expect(stack.pop()).toEqual(intValue(42));
        expect(stack.pop()).toEqual(intValue(42));
    });

    it('swaps top two values', () => {
        const stack = new Stack();
        stack.push(intValue(1));
        stack.push(intValue(2));
        stack.swap();

        expect(stack.pop()).toEqual(intValue(1));
        expect(stack.pop()).toEqual(intValue(2));
    });

    it('throws on underflow', () => {
        const stack = new Stack();
        expect(() => stack.pop()).toThrow('underflow');
    });
});

describe('Value Operations', () => {
    it('compares integers', () => {
        expect(valuesEqual(intValue(42), intValue(42))).toBe(true);
        expect(valuesEqual(intValue(42), intValue(43))).toBe(false);
    });

    it('compares booleans', () => {
        expect(valuesEqual(boolValue(true), boolValue(true))).toBe(true);
        expect(valuesEqual(boolValue(true), boolValue(false))).toBe(false);
    });

    it('compares strings', () => {
        expect(valuesEqual(stringValue('hello'), stringValue('hello'))).toBe(true);
        expect(valuesEqual(stringValue('hello'), stringValue('world'))).toBe(false);
    });

    it('checks truthiness', () => {
        expect(isTruthy(boolValue(true))).toBe(true);
        expect(isTruthy(boolValue(false))).toBe(false);
        expect(isTruthy(intValue(1))).toBe(true);
        expect(isTruthy(intValue(0))).toBe(false);
        expect(isTruthy(nullValue())).toBe(false);
    });
});

describe('Virtual Machine', () => {
    function createTestContext() {
        const state = createStateJournal();
        const events = new EventEmitter();
        return createExecutionContext({
            caller: '0x1234567890123456789012345678901234567890',
            state,
            events,
        });
    }

    it('executes simple let statement', async () => {
        const source = `
module Test
transaction Foo() {
  let x = 42;
}`.trim();
        const module = parse(source);
        const ir = compileToIR(module);
        const vm = new VirtualMachine(ir);
        const gas = new GasMeter(100000n);
        const context = createTestContext();

        const result = await vm.execute('Foo', [], context, gas);

        expect(result.success).toBe(true);
        expect(result.gasUsed).toBeGreaterThan(0n);
    });

    it('executes arithmetic', async () => {
        const source = `
module Test
transaction Add() {
  let a = 10;
  let b = 20;
  let c = a + b;
}`.trim();
        const module = parse(source);
        const ir = compileToIR(module);
        const vm = new VirtualMachine(ir);
        const gas = new GasMeter(100000n);
        const context = createTestContext();

        const result = await vm.execute('Add', [], context, gas);

        expect(result.success).toBe(true);
    });

    it('executes require with passing condition', async () => {
        const source = `
module Test
transaction Check() {
  let x = 10;
  require x > 0, "Must be positive";
}`.trim();
        const module = parse(source);
        const ir = compileToIR(module);
        const vm = new VirtualMachine(ir);
        const gas = new GasMeter(100000n);
        const context = createTestContext();

        const result = await vm.execute('Check', [], context, gas);

        expect(result.success).toBe(true);
    });

    it('fails on require with failing condition', async () => {
        const source = `
module Test
transaction Check() {
  let x = 0;
  require x > 0, "Must be positive";
}`.trim();
        const module = parse(source);
        const ir = compileToIR(module);
        const vm = new VirtualMachine(ir);
        const gas = new GasMeter(100000n);
        const context = createTestContext();

        const result = await vm.execute('Check', [], context, gas);

        expect(result.success).toBe(false);
        expect(result.error?.message).toContain('Must be positive');
    });

    it('handles context expressions', async () => {
        const source = `
module Test
transaction GetCaller() {
  let addr = caller;
}`.trim();
        const module = parse(source);
        const ir = compileToIR(module);
        const vm = new VirtualMachine(ir);
        const gas = new GasMeter(100000n);
        const context = createTestContext();

        const result = await vm.execute('GetCaller', [], context, gas);

        expect(result.success).toBe(true);
    });

    it('emits events', async () => {
        const source = `
module Test
transaction EmitTest() {
  emit Transfer(42);
}`.trim();
        const module = parse(source);
        const ir = compileToIR(module);
        const vm = new VirtualMachine(ir);
        const gas = new GasMeter(100000n);
        const state = createStateJournal();
        const events = new EventEmitter();
        const context = createExecutionContext({
            caller: '0x1234',
            state,
            events,
        });

        await vm.execute('EmitTest', [], context, gas);

        expect(events.count).toBe(1);
        expect(events.getEvents()[0]!.name).toBe('Transfer');
    });
});
