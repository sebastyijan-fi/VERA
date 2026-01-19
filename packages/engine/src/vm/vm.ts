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
import type { GasMeter } from '../gas/gas.js';
import type { ExecutionContext } from '../state/context.js';

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
    execute(
        functionName: string,
        args: Value[],
        context: ExecutionContext,
        gas: GasMeter
    ): VMResult {
        const func = this.program.functions.find(f => f.name === functionName);
        if (!func) {
            return {
                success: false,
                error: new VMError(`Function not found: ${functionName}`),
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
            functionName,
            returnAddress: 0,
            basePointer: 0,
            locals,
        });

        try {
            while (!this.halted && this.pc < func.instructions.length) {
                const instruction = func.instructions[this.pc]!;

                // Check gas before executing
                gas.consume(this.getOpcodeCost(instruction.opcode));

                this.executeInstruction(instruction, context, gas);
                this.instructionsExecuted++;
                this.pc++;
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

    private executeInstruction(
        instruction: IRInstruction,
        context: ExecutionContext,
        _gas: GasMeter
    ): void {
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
                const target = this.labelMap.get(label);
                if (target === undefined) {
                    throw new VMError(`Unknown label: ${label}`, this.pc, 'JMP');
                }
                this.pc = target - 1; // -1 because pc++ happens after
                break;
            }

            case IROpcode.JMP_IF: {
                const condition = this.stack.pop();
                if (isTruthy(condition)) {
                    const label = operand as string;
                    const target = this.labelMap.get(label);
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
                    const target = this.labelMap.get(label);
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
                // For now, just push a placeholder - full implementation needs nested execution
                this.stack.push(nullValue());
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

            // State
            case IROpcode.STATE_GET: {
                const entityType = operand as string;
                const key = this.stack.pop();
                const value = context.state.get(entityType, key);
                this.stack.push(value ?? nullValue());
                break;
            }

            case IROpcode.STATE_SET: {
                const entityType = operand as string;
                const key = this.stack.peekAt(1);
                const value = this.stack.pop();
                this.stack.pop(); // pop the key too
                context.state.set(entityType, key, value);
                break;
            }

            case IROpcode.STATE_DEL: {
                const entityType = operand as string;
                const key = this.stack.pop();
                context.state.delete(entityType, key);
                break;
            }

            case IROpcode.STATE_EXISTS: {
                const entityType = operand as string;
                const key = this.stack.pop();
                const exists = context.state.exists(entityType, key);
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
            case 'string':
                return `s:${value.value}`;
            case 'address':
                return `a:${value.value}`;
            default:
                return `o:${JSON.stringify(value)}`;
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
