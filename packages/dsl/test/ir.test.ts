/**
 * IR Compiler Tests
 */
import { describe, it, expect } from 'vitest';
import { parse } from '../src/parser/index.js';
import { compileToIR, IROpcode } from '../src/ir/index.js';

describe('IR Compiler', () => {
    describe('Entity Compilation', () => {
        it('compiles entity declarations', () => {
            const source = `
module Test
entity Asset[Address] {
  owner: Address,
  balance: UInt,
}`.trim();
            const module = parse(source);
            const ir = compileToIR(module);

            expect(ir.name).toBe('Test');
            expect(ir.entities).toHaveLength(1);
            expect(ir.entities[0]!.name).toBe('Asset');
            expect(ir.entities[0]!.keyType).toBe('Address');
            expect(ir.entities[0]!.fields).toHaveLength(2);
        });
    });

    describe('Transaction Compilation', () => {
        it('compiles simple transaction', () => {
            const source = `
module Test
public transaction Transfer(recipient: Address, amount: UInt) {
  let x = 42;
}`.trim();
            const module = parse(source);
            const ir = compileToIR(module);

            expect(ir.functions).toHaveLength(1);
            const func = ir.functions[0]!;
            expect(func.name).toBe('Transfer');
            expect(func.isPublic).toBe(true);
            expect(func.params).toEqual(['recipient', 'amount']);
        });

        it('generates PUSH and STORE for let statement', () => {
            const source = `
module Test
transaction Foo() {
  let x = 100;
}`.trim();
            const module = parse(source);
            const ir = compileToIR(module);

            const func = ir.functions[0]!;
            const opcodes = func.instructions.map(i => i.opcode);

            expect(opcodes).toContain(IROpcode.PUSH);
            expect(opcodes).toContain(IROpcode.STORE);
            expect(opcodes[opcodes.length - 1]).toBe(IROpcode.HALT);
        });

        it('generates REQUIRE for require statement', () => {
            const source = `
module Test
transaction Foo() {
  require balance > 0, "Insufficient";
}`.trim();
            const module = parse(source);
            const ir = compileToIR(module);

            const func = ir.functions[0]!;
            const requireInst = func.instructions.find(i => i.opcode === IROpcode.REQUIRE);

            expect(requireInst).toBeDefined();
            expect(requireInst!.operand).toBe('Insufficient');
        });

        it('generates EMIT for emit statement', () => {
            const source = `
module Test
transaction Foo() {
  emit Transfer(sender, recipient, amount);
}`.trim();
            const module = parse(source);
            const ir = compileToIR(module);

            const func = ir.functions[0]!;
            const emitInst = func.instructions.find(i => i.opcode === IROpcode.EMIT);

            expect(emitInst).toBeDefined();
            expect(emitInst!.operand).toBe('Transfer');
        });
    });

    describe('Expression Compilation', () => {
        it('compiles binary expressions', () => {
            const source = `
module Test
transaction Foo() {
  let x = 1 + 2;
}`.trim();
            const module = parse(source);
            const ir = compileToIR(module);

            const func = ir.functions[0]!;
            const opcodes = func.instructions.map(i => i.opcode);

            expect(opcodes).toContain(IROpcode.ADD);
        });

        it('compiles logical expressions', () => {
            const source = `
module Test
transaction Foo() {
  let x = a && b;
}`.trim();
            const module = parse(source);
            const ir = compileToIR(module);

            const func = ir.functions[0]!;
            const opcodes = func.instructions.map(i => i.opcode);

            expect(opcodes).toContain(IROpcode.AND);
        });

        it('compiles context expressions', () => {
            const source = `
module Test
transaction Foo() {
  let x = caller;
}`.trim();
            const module = parse(source);
            const ir = compileToIR(module);

            const func = ir.functions[0]!;
            const opcodes = func.instructions.map(i => i.opcode);

            expect(opcodes).toContain(IROpcode.CTX_CALLER);
        });

        it('compiles state access', () => {
            const source = `
module Test
transaction Foo() {
  let asset = get<Asset>(key);
}`.trim();
            const module = parse(source);
            const ir = compileToIR(module);

            const func = ir.functions[0]!;
            const stateInst = func.instructions.find(i => i.opcode === IROpcode.STATE_GET);

            expect(stateInst).toBeDefined();
            expect(stateInst!.operand).toBe('Asset');
        });
    });

    describe('Control Flow', () => {
        it('generates jumps for if statement', () => {
            const source = `
module Test
transaction Foo() {
  if x > 0 {
    let y = 1;
  }
}`.trim();
            const module = parse(source);
            const ir = compileToIR(module);

            const func = ir.functions[0]!;
            const opcodes = func.instructions.map(i => i.opcode);

            expect(opcodes).toContain(IROpcode.JMP_IF_NOT);
            expect(opcodes).toContain(IROpcode.JMP);
        });

        it('generates loop for while statement', () => {
            const source = `
module Test
transaction Foo() {
  while x > 0 {
    let y = 1;
  }
}`.trim();
            const module = parse(source);
            const ir = compileToIR(module);

            const func = ir.functions[0]!;
            const jumpCount = func.instructions.filter(i => i.opcode === IROpcode.JMP).length;

            expect(jumpCount).toBeGreaterThan(0);
        });
    });

    describe('Event Compilation', () => {
        it('compiles event declarations', () => {
            const source = `
module Test
event Transfer {
  sender: Address,
  recipient: Address,
  amount: UInt,
}`.trim();
            const module = parse(source);
            const ir = compileToIR(module);

            expect(ir.events).toHaveLength(1);
            expect(ir.events[0]!.name).toBe('Transfer');
            expect(ir.events[0]!.fields).toHaveLength(3);
        });
    });
});
