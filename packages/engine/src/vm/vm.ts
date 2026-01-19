/**
 * VERA Virtual Machine
 *
 * Stack-based VM for executing IR programs.
 */

import type { IRProgram, IRFunction, IRInstruction, IRValue } from '@vera/dsl';
import { IROpcode } from '@vera/dsl';
import type { Value } from './value.js';
import {
    intValue,
    boolValue,
    stringValue,
    bytesValue,
    addressValue,
    listValue,
    nullValue,
    valuesEqual,
    isTruthy,
} from './value.js';
import { Stack, CallStack } from './stack.js';
import { GasMeter, OutOfGasError } from '../gas/gas.js';
import type { ExecutionContext } from '../state/context.js';
import { sha256 } from '@vera/core';

// ============================================================================
// VM Error
// ============================================================================

export class VMError extends Error {
    constructor(
        message: string,
        public readonly instruction?: number,
        public readonly opcode?: string
    ) {
        super(message);
        this.name = 'VMError';
    }
}

export class RequireError extends VMError {
    constructor(message: string, instruction?: number) {
        super(`Require failed: ${message}`, instruction, 'REQUIRE');
        this.name = 'RequireError';
    }
}

export class EnsureError extends VMError {
    constructor(message: string, instruction?: number) {
        super(`Ensure failed: ${message}`, instruction, 'ENSURE');
        this.name = 'EnsureError';
    }
}

// ============================================================================
// VM Result
// ============================================================================

export interface VMResult {
    success: boolean;
    returnValue?: Value | undefined;
    error?: VMError | undefined;
    gasUsed: bigint;
    instructionsExecuted: number;
}

// ============================================================================
// Virtual Machine
// ============================================================================

export class VirtualMachine {
    private readonly program: IRProgram;
    private readonly stack: Stack;
    private readonly callStack: CallStack;
    private pc = 0; // Program counter
    private halted = false;
    private instructionsExecuted = 0;
    private readonly labelMap: Map<string, number> = new Map();

    constructor(program: IRProgram) {
        this.program = program;
        this.stack = new Stack();
        this.callStack = new CallStack();
    }

    /**
     * Executes a function by name
     */
    async execute(
        entryPoint: string,
        args: Value[] = [],
        context: ExecutionContext,
        gas: GasMeter
    ): Promise<VMResult> {
        // The provided snippet for `execute` and `step` seems to be from a different version
        // of the VM with different state management (e.g., `this.stack` as array, `this.frames`,
        // `this.context`, `this.gas` as class properties, `ExecutionResult` type, `createError` method).
        // To make this change syntactically correct and functional within the existing VM structure,
        // I will adapt the provided async structure to the current VM's state and methods.

        const func = this.program.functions.find(f => f.name === entryPoint);
        if (!func) {
            return {
                success: false,
                error: new VMError(`Function not found: ${entryPoint}`),
                gasUsed: 0n,
                instructionsExecuted: 0,
            };
        }

        // Reset state
        this.stack.clear();
        this.callStack.clear();
        this.pc = 0;
        this.halted = false;
        this.instructionsExecuted = 0;

        // Build label map for jumps
        this.buildLabelMap(func);

        // Set up initial call frame
        const locals = new Map<string, Value>();
        for (let i = 0; i < func.params.length && i < args.length; i++) {
            locals.set(func.params[i]!, args[i]!);
        }

        this.callStack.push({
            functionName: entryPoint,
            returnAddress: 0,
            basePointer: 0,
            locals,
        });

        try {
            while (!this.halted && this.pc < func.instructions.length) {
                // Check gas before executing
                gas.consume(this.getOpcodeCost(func.instructions[this.pc]!.opcode));

                await this.step(func, context, gas); // Call the new async step method
            }

            const result: VMResult = {
                success: true,
                gasUsed: gas.used,
                instructionsExecuted: this.instructionsExecuted,
            };
            if (!this.stack.isEmpty) {
                result.returnValue = this.stack.pop();
            }
            return result;
        } catch (e) {
            if (e instanceof OutOfGasError) {
                throw e;
            }
            if (e instanceof VMError) {
                return {
                    success: false,
                    error: e,
                    gasUsed: gas.used,
                    instructionsExecuted: this.instructionsExecuted,
                };
            }
            throw e;
        }
    }

    private buildLabelMap(func: IRFunction): void {
        this.labelMap.clear();
        for (let i = 0; i < func.instructions.length; i++) {
            const inst = func.instructions[i]!;
            if (inst.opcode === IROpcode.NOP && typeof inst.operand === 'string' && inst.operand.startsWith('@')) {
                this.labelMap.set(inst.operand.slice(1), i);
            }
        }
    }

    private async step(func: IRFunction, context: ExecutionContext, gas: GasMeter): Promise<void> {
        const instruction = func.instructions[this.pc]!;
        // gas copy is handled in loop now? No, loop calls step.
        // But loop also had gas check.
        // Actually the loop in execute calls:
        // gas.consume(...)
        // await this.step(...)
        // So step is responsible for execution only.

        await this.executeInstruction(instruction, context, gas);
        this.instructionsExecuted++;
        this.pc++;
    }

    private async executeInstruction(
        instruction: IRInstruction,
        context: ExecutionContext,
        gas: GasMeter
    ): Promise<void> {
        const { opcode, operand } = instruction;

        switch (opcode) {
            // Stack operations
            case IROpcode.PUSH:
                this.stack.push(this.irValueToValue(operand as IRValue));
                break;

            case IROpcode.POP:
                this.stack.pop();
                break;

            case IROpcode.DUP:
                this.stack.dup();
                break;

            case IROpcode.SWAP:
                this.stack.swap();
                break;

            // Variables
            case IROpcode.LOAD: {
                const frame = this.callStack.current();
                if (!frame) throw new VMError('No active call frame', this.pc, 'LOAD');
                const name = operand as string;
                const value = frame.locals.get(name);
                if (value === undefined) {
                    throw new VMError(`Undefined variable: ${name}`, this.pc, 'LOAD');
                }
                this.stack.push(value);
                break;
            }

            case IROpcode.STORE: {
                const frame = this.callStack.current();
                if (!frame) throw new VMError('No active call frame', this.pc, 'STORE');
                const name = operand as string;
                const value = this.stack.pop();
                frame.locals.set(name, value);
                break;
            }

            // Arithmetic
            case IROpcode.ADD: {
                const b = this.popInt();
                const a = this.popInt();
                this.stack.push(intValue(a + b));
                break;
            }

            case IROpcode.SUB: {
                const b = this.popInt();
                const a = this.popInt();
                this.stack.push(intValue(a - b));
                break;
            }

            case IROpcode.MUL: {
                const b = this.popInt();
                const a = this.popInt();
                this.stack.push(intValue(a * b));
                break;
            }

            case IROpcode.DIV: {
                const b = this.popInt();
                const a = this.popInt();
                if (b === 0n) throw new VMError('Division by zero', this.pc, 'DIV');
                this.stack.push(intValue(a / b));
                break;
            }

            case IROpcode.MOD: {
                const b = this.popInt();
                const a = this.popInt();
                if (b === 0n) throw new VMError('Division by zero', this.pc, 'MOD');
                this.stack.push(intValue(a % b));
                break;
            }

            case IROpcode.NEG: {
                const a = this.popInt();
                this.stack.push(intValue(-a));
                break;
            }

            // Comparison
            case IROpcode.EQ: {
                const b = this.stack.pop();
                const a = this.stack.pop();
                this.stack.push(boolValue(valuesEqual(a, b)));
                break;
            }

            case IROpcode.NEQ: {
                const b = this.stack.pop();
                const a = this.stack.pop();
                this.stack.push(boolValue(!valuesEqual(a, b)));
                break;
            }

            case IROpcode.LT: {
                const b = this.popInt();
                const a = this.popInt();
                this.stack.push(boolValue(a < b));
                break;
            }

            case IROpcode.LTE: {
                const b = this.popInt();
                const a = this.popInt();
                this.stack.push(boolValue(a <= b));
                break;
            }

            case IROpcode.GT: {
                const b = this.popInt();
                const a = this.popInt();
                this.stack.push(boolValue(a > b));
                break;
            }

            case IROpcode.GTE: {
                const b = this.popInt();
                const a = this.popInt();
                this.stack.push(boolValue(a >= b));
                break;
            }

            // Logical
            case IROpcode.AND: {
                const b = this.stack.pop();
                const a = this.stack.pop();
                this.stack.push(boolValue(isTruthy(a) && isTruthy(b)));
                break;
            }

            case IROpcode.OR: {
                const b = this.stack.pop();
                const a = this.stack.pop();
                this.stack.push(boolValue(isTruthy(a) || isTruthy(b)));
                break;
            }

            case IROpcode.NOT: {
                const a = this.stack.pop();
                this.stack.push(boolValue(!isTruthy(a)));
                break;
            }

            // Control flow
            case IROpcode.JMP: {
                const label = operand as string;
                const target = this.labelMap.get(label.startsWith('@') ? label.slice(1) : label);
                if (target === undefined) {
                    throw new VMError(`Unknown label: ${label}`, this.pc, 'JMP');
                }
                this.pc = target - 1;
                break;
            }

            case IROpcode.JMP_IF: {
                const condition = this.stack.pop();
                if (isTruthy(condition)) {
                    const label = operand as string;
                    const target = this.labelMap.get(label.startsWith('@') ? label.slice(1) : label);
                    if (target === undefined) {
                        throw new VMError(`Unknown label: ${label}`, this.pc, 'JMP_IF');
                    }
                    this.pc = target - 1;
                }
                break;
            }

            case IROpcode.JMP_IF_NOT: {
                const condition = this.stack.pop();
                if (!isTruthy(condition)) {
                    const label = operand as string;
                    const target = this.labelMap.get(label.startsWith('@') ? label.slice(1) : label);
                    if (target === undefined) {
                        throw new VMError(`Unknown label: ${label}`, this.pc, 'JMP_IF_NOT');
                    }
                    this.pc = target - 1;
                }
                break;
            }

            case IROpcode.CALL: {
                const funcName = operand as string;
                const targetFunc = this.program.functions.find(f => f.name === funcName);
                if (!targetFunc) {
                    throw new VMError(`Function not found: ${funcName}`, this.pc, 'CALL');
                }

                const argCount = targetFunc.params.length;
                const args: Value[] = [];
                for (let i = 0; i < argCount; i++) {
                    args.unshift(this.stack.pop());
                }

                // Recursive async call
                const result = await this.execute(funcName, args, context, gas);
                if (!result.success) {
                    // Propagate error with location info
                    if (result.error) {
                        throw result.error; // Already a VMError
                    }
                    throw new VMError('Call failed', this.pc, 'CALL');
                }

                if (result.returnValue) {
                    this.stack.push(result.returnValue);
                }
                break;
            }

            case IROpcode.RET:
                this.halted = true;
                break;

            // Context
            case IROpcode.CTX_CALLER:
                this.stack.push(addressValue(context.caller));
                break;

            case IROpcode.CTX_BLOCK: {
                const prop = operand as string;
                switch (prop) {
                    case 'timestamp':
                        this.stack.push(intValue(context.block.timestamp));
                        break;
                    case 'height':
                        this.stack.push(intValue(context.block.height));
                        break;
                    default:
                        throw new VMError(`Unknown block property: ${prop}`, this.pc, 'CTX_BLOCK');
                }
                break;
            }

            case IROpcode.CTX_THIS:
                this.stack.push(addressValue(context.contractAddress));
                break;

            // State (ASYNC)
            case IROpcode.STATE_GET: {
                const entityType = operand as string;
                const key = this.stack.pop();
                const value = await context.state.get(entityType, key);
                this.stack.push(value ?? nullValue());
                break;
            }

            case IROpcode.STATE_SET: {
                const entityType = operand as string;
                // Value is top, Key is below
                const value = this.stack.pop();
                const key = this.stack.pop();
                await context.state.set(entityType, key, value);
                break;
            }

            case IROpcode.STATE_DEL: {
                const entityType = operand as string;
                const key = this.stack.pop();
                await context.state.delete(entityType, key);
                break;
            }

            case IROpcode.STATE_EXISTS: {
                const entityType = operand as string;
                const key = this.stack.pop();
                const exists = await context.state.exists(entityType, key);
                this.stack.push(boolValue(exists));
                break;
            }

            // Lists
            case IROpcode.LIST_NEW:
                this.stack.push(listValue());
                break;

            case IROpcode.LIST_GET: {
                const index = this.popInt();
                const list = this.stack.pop();
                if (list.kind !== 'list') {
                    throw new VMError('Expected list', this.pc, 'LIST_GET');
                }
                const idx = Number(index);
                if (idx < 0 || idx >= list.elements.length) {
                    throw new VMError(`Index out of bounds: ${idx}`, this.pc, 'LIST_GET');
                }
                this.stack.push(list.elements[idx]!);
                break;
            }

            case IROpcode.LIST_SET: {
                const value = this.stack.pop();
                const index = this.popInt();
                const list = this.stack.pop();
                if (list.kind !== 'list') {
                    throw new VMError('Expected list', this.pc, 'LIST_SET');
                }
                const idx = Number(index);
                list.elements[idx] = value;
                this.stack.push(list);
                break;
            }

            case IROpcode.LIST_LEN: {
                const list = this.stack.pop();
                if (list.kind !== 'list') {
                    throw new VMError('Expected list', this.pc, 'LIST_LEN');
                }
                this.stack.push(intValue(list.elements.length));
                break;
            }

            case IROpcode.LIST_PUSH: {
                const value = this.stack.pop();
                const list = this.stack.pop();
                if (list.kind !== 'list') {
                    throw new VMError('Expected list', this.pc, 'LIST_PUSH');
                }
                list.elements.push(value);
                this.stack.push(list);
                break;
            }

            // Maps
            case IROpcode.MAP_NEW:
                this.stack.push({ kind: 'map', entries: new Map() });
                break;

            case IROpcode.MAP_GET: {
                const key = this.stack.pop();
                const map = this.stack.pop();
                if (map.kind !== 'map') {
                    throw new VMError('Expected map', this.pc, 'MAP_GET');
                }
                const keyStr = this.valueToKey(key);
                this.stack.push(map.entries.get(keyStr) ?? nullValue());
                break;
            }

            case IROpcode.MAP_SET: {
                const value = this.stack.pop();
                const key = this.stack.pop();
                const map = this.stack.pop();
                if (map.kind !== 'map') {
                    throw new VMError('Expected map', this.pc, 'MAP_SET');
                }
                const keyStr = this.valueToKey(key);
                map.entries.set(keyStr, value);
                this.stack.push(map);
                break;
            }

            case IROpcode.MAP_DEL: {
                const key = this.stack.pop();
                const map = this.stack.pop();
                if (map.kind !== 'map') {
                    throw new VMError('Expected map', this.pc, 'MAP_DEL');
                }
                const keyStr = this.valueToKey(key);
                map.entries.delete(keyStr);
                this.stack.push(map);
                break;
            }

            case IROpcode.MAP_HAS: {
                const key = this.stack.pop();
                const map = this.stack.pop();
                if (map.kind !== 'map') {
                    throw new VMError('Expected map', this.pc, 'MAP_HAS');
                }
                const keyStr = this.valueToKey(key);
                this.stack.push(boolValue(map.entries.has(keyStr)));
                break;
            }

            // Member access
            case IROpcode.MEMBER_GET: {
                const prop = operand as string;
                const obj = this.stack.pop();
                if (obj.kind !== 'struct') {
                    throw new VMError('Expected struct', this.pc, 'MEMBER_GET');
                }
                const value = obj.fields.get(prop);
                if (value === undefined) {
                    throw new VMError(`Unknown field: ${prop}`, this.pc, 'MEMBER_GET');
                }
                this.stack.push(value);
                break;
            }

            case IROpcode.MEMBER_SET: {
                const prop = operand as string;
                const value = this.stack.pop();
                const obj = this.stack.pop();
                if (obj.kind !== 'struct') {
                    throw new VMError('Expected struct', this.pc, 'MEMBER_SET');
                }
                obj.fields.set(prop, value);
                this.stack.push(obj);
                break;
            }

            // Assertions
            case IROpcode.REQUIRE: {
                const condition = this.stack.pop();
                if (!isTruthy(condition)) {
                    throw new RequireError(operand as string, this.pc);
                }
                break;
            }

            case IROpcode.ENSURE: {
                const condition = this.stack.pop();
                if (!isTruthy(condition)) {
                    throw new EnsureError(operand as string, this.pc);
                }
                break;
            }

            // Events
            case IROpcode.EMIT: {
                const eventName = operand as string;
                context.events.emit(eventName, this.stack.pop());
                break;
            }

            // No operation (labels)
            case IROpcode.NOP:
                break;

            case IROpcode.HASH: {
                const data = this.stack.pop();
                let bytes: Uint8Array;
                if (data.kind === 'bytes') {
                    bytes = data.value;
                } else if (data.kind === 'string') {
                    bytes = new TextEncoder().encode(data.value);
                } else {
                    throw new VMError(`HASH expected bytes or string, got ${data.kind}`, this.pc);
                }
                this.stack.push(bytesValue(sha256(bytes)));
                break;
            }

            // Halt
            case IROpcode.HALT:
                this.halted = true;
                break;

            default:
                throw new VMError(`Unknown opcode: ${opcode}`, this.pc);
        }
    }

    private popInt(): bigint {
        const value = this.stack.pop();
        if (value.kind !== 'int') {
            throw new VMError(`Expected integer, got ${value.kind}`, this.pc);
        }
        return value.value;
    }

    private irValueToValue(irValue: IRValue): Value {
        switch (irValue.kind) {
            case 'int':
                return intValue(irValue.value);
            case 'bool':
                return boolValue(irValue.value);
            case 'string':
                return stringValue(irValue.value);
            case 'bytes':
                return bytesValue(irValue.value);
            case 'address':
                return addressValue(irValue.value);
            case 'null':
                return nullValue();
        }
    }

    private valueToKey(value: Value): string {
        switch (value.kind) {
            case 'int':
                return `i:${value.value}`;
            case 'bool':
                return `b:${value.value ? '1' : '0'}`;
            case 'string':
                return `s:${value.value}`;
            case 'address':
                return `a:${value.value}`;
            case 'bytes':
                return `x:${Array.from(value.value).map(b => b.toString(16).padStart(2, '0')).join('')}`;
            case 'null':
                return 'n:';
            case 'list':
                return `l:[${value.elements.map(e => this.valueToKey(e)).join(',')}]`;
            case 'map': {
                const keys = Array.from(value.entries.keys()).sort();
                return `m:{${keys.map(k => `${k}=${this.valueToKey(value.entries.get(k)!)}`).join(',')}}`;
            }
            case 'struct': {
                const keys = Array.from(value.fields.keys()).sort();
                return `S:${value.type}{${keys.map(k => `${k}=${this.valueToKey(value.fields.get(k)!)}`).join(',')}}`;
            }
            default:
                throw new VMError(`Unsupported key type: ${(value as any).kind}`, this.pc);
        }
    }

    private getOpcodeCost(opcode: IROpcode): bigint {
        // Basic cost model - will be refined in gas module
        switch (opcode) {
            case IROpcode.STATE_GET:
                return 100n;
            case IROpcode.STATE_SET:
                return 500n;
            case IROpcode.STATE_DEL:
                return 200n;
            case IROpcode.STATE_EXISTS:
                return 50n;
            case IROpcode.CALL:
                return 50n;
            case IROpcode.JMP:
            case IROpcode.JMP_IF:
            case IROpcode.JMP_IF_NOT:
                return 5n;
            case IROpcode.ADD:
            case IROpcode.SUB:
            case IROpcode.MUL:
            case IROpcode.DIV:
            case IROpcode.MOD:
                return 3n;
            case IROpcode.EQ:
            case IROpcode.NEQ:
            case IROpcode.LT:
            case IROpcode.LTE:
            case IROpcode.GT:
            case IROpcode.GTE:
                return 2n;
            default:
                return 1n;
        }
    }
}
