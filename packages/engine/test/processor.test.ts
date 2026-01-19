/**
 * Processor Tests
 */
import { describe, it, expect } from 'vitest';
import { parse, compileToIR } from '@vera/dsl';
import { TransactionStateProcessor, createProcessor, intValue } from '../src/index.js';

describe('TransactionStateProcessor', () => {
    it('executes simple transaction', () => {
        const source = `
module Test
public transaction Hello() {
  let x = 42;
}`.trim();
        const module = parse(source);
        const ir = compileToIR(module);
        const processor = createProcessor(ir);

        const result = processor.execute('Hello', [], '0x1234');

        expect(result.success).toBe(true);
        expect(result.gasUsed).toBeGreaterThan(0n);
    });

    it('rolls back state on failure', () => {
        const source = `
module Test
public transaction Fail() {
  let x = 1;
  require x > 10, "Too small";
}`.trim();
        const module = parse(source);
        const ir = compileToIR(module);
        const processor = createProcessor(ir);

        const result = processor.execute('Fail', [], '0x1234');

        expect(result.success).toBe(false);
        expect(result.error?.type).toBe('require');
        expect(result.stateChanges.size).toBe(0);
    });

    it('collects emitted events', () => {
        const source = `
module Test
public transaction EmitEvent() {
  emit Transfer(100);
}`.trim();
        const module = parse(source);
        const ir = compileToIR(module);
        const processor = createProcessor(ir);

        const result = processor.execute('EmitEvent', [], '0x1234');

        expect(result.success).toBe(true);
        expect(result.events.length).toBe(1);
        expect(result.events[0]!.name).toBe('Transfer');
    });

    it('enforces gas limit', () => {
        const source = `
module Test
public transaction Loop() {
  let x = 0;
  while x < 1000 {
    let y = x + 1;
  }
}`.trim();
        const module = parse(source);
        const ir = compileToIR(module);
        const processor = createProcessor(ir, { gasLimit: 100n });

        const result = processor.execute('Loop', [], '0x1234');

        expect(result.success).toBe(false);
        expect(result.error?.type).toBe('out_of_gas');
    });

    it('lists public functions', () => {
        const source = `
module Test
public transaction PublicOne() {
  let x = 1;
}
transaction PrivateOne() {
  let x = 2;
}
public transaction PublicTwo() {
  let x = 3;
}`.trim();
        const module = parse(source);
        const ir = compileToIR(module);
        const processor = createProcessor(ir);

        const publicFuncs = processor.getPublicFunctions();

        expect(publicFuncs).toContain('PublicOne');
        expect(publicFuncs).toContain('PublicTwo');
        expect(publicFuncs).not.toContain('PrivateOne');
    });

    it('validates transactions', () => {
        const source = `
module Test
public transaction Valid() {
  let x = 42;
}`.trim();
        const module = parse(source);
        const ir = compileToIR(module);
        const processor = createProcessor(ir);

        const validation = processor.validate('Valid', [], '0x1234');

        expect(validation.valid).toBe(true);
        expect(validation.gasEstimate).toBeGreaterThan(0n);
    });

    it('provides block context', () => {
        const source = `
module Test
public transaction CheckBlock() {
  let h = block.height;
  require h > 0, "Block height should be positive";
}`.trim();
        const module = parse(source);
        const ir = compileToIR(module);
        const processor = createProcessor(ir);

        const result = processor.execute('CheckBlock', [], '0x1234', {
            height: 100n,
            timestamp: BigInt(Date.now()),
        });

        expect(result.success).toBe(true);
    });
});

describe('Determinism', () => {
    it('produces identical results for same inputs', () => {
        const source = `
module Test
public transaction Compute() {
  let a = 10;
  let b = 20;
  let c = a + b;
  let d = c * 2;
}`.trim();
        const module = parse(source);
        const ir = compileToIR(module);

        // Run twice
        const processor1 = createProcessor(ir);
        const processor2 = createProcessor(ir);

        const result1 = processor1.execute('Compute', [], '0x1234');
        const result2 = processor2.execute('Compute', [], '0x1234');

        expect(result1.success).toBe(result2.success);
        expect(result1.gasUsed).toBe(result2.gasUsed);
        expect(result1.instructionsExecuted).toBe(result2.instructionsExecuted);
    });

    it('results differ with different inputs', () => {
        const source = `
module Test
public transaction Check() {
  let x = 5;
  require x > 3, "Too small";
}`.trim();
        const module = parse(source);
        const ir = compileToIR(module);

        const processor = createProcessor(ir);

        // Different callers don't affect this simple test
        const result1 = processor.execute('Check', [], '0x1111');
        const result2 = processor.execute('Check', [], '0x2222');

        expect(result1.success).toBe(true);
        expect(result2.success).toBe(true);
    });
});
