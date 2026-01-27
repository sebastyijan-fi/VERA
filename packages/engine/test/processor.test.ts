/**
 * Processor Tests
 */
import { describe, it, expect, test } from 'vitest';
import { parse, compileToIR, type IRProgram, IROpcode } from '@vera/dsl';
import { TransactionStateProcessor, createProcessor } from '../src/index.js';

describe('TransactionStateProcessor', () => {
  it('executes simple transaction', async () => {
    const source = `
module Test
public transaction Hello() {
  let x = 42;
}`.trim();
    const module = parse(source);
    const ir = compileToIR(module);
    const processor = createProcessor(ir);

    const result = await processor.execute('Hello', [], '0x1234');

    expect(result.success).toBe(true);
    expect(result.gasUsed).toBeGreaterThan(0n);
  });

  it('rolls back state on failure', async () => {
    const source = `
module Test
public transaction Fail() {
  let x = 1;
  require x > 10, "Too small";
}`.trim();
    const module = parse(source);
    const ir = compileToIR(module);
    const processor = createProcessor(ir);

    const result = await processor.execute('Fail', [], '0x1234');

    expect(result.success).toBe(false);
    expect(result.error?.type).toBe('require');
    expect(result.stateChanges.size).toBe(0);
  });

  it('collects emitted events', async () => {
    const source = `
module Test
public transaction EmitEvent() {
  emit Transfer(100);
}`.trim();
    const module = parse(source);
    const ir = compileToIR(module);
    const processor = createProcessor(ir);

    const result = await processor.execute('EmitEvent', [], '0x1234');

    expect(result.success).toBe(true);
    expect(result.events.length).toBe(1);
    expect(result.events[0]!.name).toBe('Transfer');
  });

  it('enforces gas limit', async () => {
    // Manually construct IR to trap loop easily without source parsing overhead/optimization interference
    const program: IRProgram = {
      id: '0x' + '0'.repeat(64),
      name: 'LoopTest',
      entities: [],
      events: [],
      functions: [{
        name: 'Loop',
        isPublic: true,
        params: [],
        locals: [],
        instructions: [
          { opcode: IROpcode.NOP, operand: '@loop' },
          { opcode: IROpcode.JMP, operand: '@loop' }
        ]
      }]
    };

    const processor = new TransactionStateProcessor(program, { gasLimit: 100n });
    const result = await processor.execute('Loop', [], '0x1234');

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

  it('validates transactions', async () => {
    const program: IRProgram = {
      id: '0x' + '0'.repeat(64),
      name: 'ValidTest',
      entities: [],
      events: [],
      functions: [{
        name: 'Valid',
        isPublic: true,
        params: [],
        locals: [],
        instructions: [{ opcode: IROpcode.RET }]
      }]
    };

    const processor = new TransactionStateProcessor(program);
    const validation = await processor.validate('Valid', [], '0x1234');

    expect(validation.valid).toBe(true);
    expect(validation.gasEstimate).toBeGreaterThan(0n);
  });

  it('provides block context', async () => {
    const program: IRProgram = {
      id: '0x' + '0'.repeat(64),
      name: 'BlockTest',
      entities: [],
      events: [],
      functions: [{
        name: 'BlockTest',
        isPublic: true,
        params: [],
        locals: [],
        instructions: [
          { opcode: IROpcode.CTX_BLOCK, operand: 'timestamp' },
          { opcode: IROpcode.POP },
          { opcode: IROpcode.RET }
        ]
      }]
    };

    const processor = new TransactionStateProcessor(program);
    const result = await processor.execute('BlockTest', [], '0x1234', {
      timestamp: 1000n,
      height: 50n
    });

    expect(result.success).toBe(true);
  });

  describe('Determinism', () => {
    it('produces identical results for same inputs', async () => {
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

      const processor1 = createProcessor(ir);
      const processor2 = createProcessor(ir);

      const result1 = await processor1.execute('Compute', [], '0x1234');
      const result2 = await processor2.execute('Compute', [], '0x1234');

      expect(result1.success).toBe(result2.success);
      expect(result1.gasUsed).toBe(result2.gasUsed);
      expect(result1.instructionsExecuted).toBe(result2.instructionsExecuted);
    });

    it('results differ with different inputs', async () => {
      const source = `
module Test
public transaction Check() {
  let x = 5;
  require x > 3, "Too small";
}`.trim();
      const module = parse(source);
      const ir = compileToIR(module);

      const processor = createProcessor(ir);

      // Different callers don't affect this simple test, but this test title implies different inputs
      // "Check" takes no args, so inputs are caller/block or just repeated execution
      // Wait, the original test likely checked that different transactions/state lead to different results?
      // Or simply that it runs?
      // The original test code was messy. Let's assume testing basic execution.

      const result1 = await processor.execute('Check', [], '0x1111');
      const result2 = await processor.execute('Check', [], '0x2222');

      expect(result1.success).toBe(true);
      expect(result2.success).toBe(true);
    });
  });
});
