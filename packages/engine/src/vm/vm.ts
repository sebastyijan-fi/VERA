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
    structValue,
    valuesEqual,
    isTruthy,
} from './value.js';
import { Stack, CallStack, type CallFrame } from './stack.js';
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
    private halted = false;
    private instructionsExecuted = 0;

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
        const func = this.program.functions.find(f => f.name === entryPoint);
        if (!func) {
            return {
                success: false,
                error: new VMError(`Function not found: ${entryPoint}`),
                gasUsed: 0n,
                instructionsExecuted: 0,
            };
        }

        // Reset state for new execution
        this.stack.clear();
        this.callStack.clear();
        this.instructionsExecuted = 0;
        this.halted = false;

        // Push initial frame
        this.pushFrame(entryPoint, args, 0);

        try {
            while (!this.halted && this.callStack.depth > 0) {
                const frame = this.callStack.current()!;
                const currentFunc = this.program.functions.find(f => f.name === frame.functionName)!;

                if (frame.pc >= currentFunc.instructions.length) {
                    this.callStack.pop();
                    continue;
                }

                const inst = currentFunc.instructions[frame.pc]!;

                // Gas check
                gas.consumeOpcode(inst.opcode);

                // Execute
                await this.executeInstruction(inst, frame, context);

                // Increment PC (if not jumped/halted)
                if (!this.halted && this.callStack.current() === frame) {
                    frame.pc++;
                }
                this.instructionsExecuted++;
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
            if (e instanceof OutOfGasError) throw e;
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

    private pushFrame(functionName: string, args: Value[], returnAddress: number): void {
        const func = this.program.functions.find(f => f.name === functionName);
        if (!func) throw new VMError(`Function not found: ${functionName}`);

        const locals = new Map<string, Value>();
        for (let i = 0; i < func.params.length && i < args.length; i++) {
            locals.set(func.params[i]!, args[i]!);
        }

        this.callStack.push({
            functionName,
            pc: 0,
            returnAddress,
            basePointer: this.stack.depth,
            locals,
            labelMap: this.buildLabelMap(func),
        });
    }

    private buildLabelMap(func: IRFunction): Map<string, number> {
        const labelMap = new Map<string, number>();
        for (let i = 0; i < func.instructions.length; i++) {
            const inst = func.instructions[i]!;
            if (inst.opcode === IROpcode.NOP && typeof inst.operand === 'string' && inst.operand.startsWith('@')) {
                labelMap.set(inst.operand.slice(1), i);
            }
        }
        return labelMap;
    }


    private async executeInstruction(
        instruction: IRInstruction,
        frame: CallFrame,
        context: ExecutionContext
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
                const name = operand as string;
                const value = frame.locals.get(name);
                if (value === undefined) {
                    throw new VMError(`Undefined variable: ${name}`, frame.pc, 'LOAD');
                }
                this.stack.push(value);
                break;
            }

            case IROpcode.STORE: {
                const name = operand as string;
                const value = this.stack.pop();
                frame.locals.set(name, value);
                break;
            }

            // Arithmetic
            case IROpcode.ADD: {
                const b = this.popInt(frame.pc);
                const a = this.popInt(frame.pc);
                this.stack.push(intValue(a + b));
                break;
            }

            case IROpcode.SUB: {
                const b = this.popInt(frame.pc);
                const a = this.popInt(frame.pc);
                this.stack.push(intValue(a - b));
                break;
            }

            case IROpcode.MUL: {
                const b = this.popInt(frame.pc);
                const a = this.popInt(frame.pc);
                this.stack.push(intValue(a * b));
                break;
            }

            case IROpcode.DIV: {
                const b = this.popInt(frame.pc);
                const a = this.popInt(frame.pc);
                if (b === 0n) throw new VMError('Division by zero', frame.pc, 'DIV');
                this.stack.push(intValue(a / b));
                break;
            }

            case IROpcode.MOD: {
                const b = this.popInt(frame.pc);
                const a = this.popInt(frame.pc);
                if (b === 0n) throw new VMError('Division by zero', frame.pc, 'MOD');
                this.stack.push(intValue(a % b));
                break;
            }

            case IROpcode.NEG: {
                const a = this.popInt(frame.pc);
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
                const b = this.popInt(frame.pc);
                const a = this.popInt(frame.pc);
                this.stack.push(boolValue(a < b));
                break;
            }

            case IROpcode.LTE: {
                const b = this.popInt(frame.pc);
                const a = this.popInt(frame.pc);
                this.stack.push(boolValue(a <= b));
                break;
            }

            case IROpcode.GT: {
                const b = this.popInt(frame.pc);
                const a = this.popInt(frame.pc);
                this.stack.push(boolValue(a > b));
                break;
            }

            case IROpcode.GTE: {
                const b = this.popInt(frame.pc);
                const a = this.popInt(frame.pc);
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
                const target = frame.labelMap.get(label.startsWith('@') ? label.slice(1) : label);
                if (target === undefined) {
                    throw new VMError(`Unknown label: ${label}`, frame.pc, 'JMP');
                }
                frame.pc = target - 1;
                break;
            }

            case IROpcode.JMP_IF: {
                const condition = this.stack.pop();
                if (isTruthy(condition)) {
                    const label = operand as string;
                    const target = frame.labelMap.get(label.startsWith('@') ? label.slice(1) : label);
                    if (target === undefined) {
                        throw new VMError(`Unknown label: ${label}`, frame.pc, 'JMP_IF');
                    }
                    frame.pc = target - 1;
                }
                break;
            }

            case IROpcode.JMP_IF_NOT: {
                const condition = this.stack.pop();
                if (!isTruthy(condition)) {
                    const label = operand as string;
                    const target = frame.labelMap.get(label.startsWith('@') ? label.slice(1) : label);
                    if (target === undefined) {
                        throw new VMError(`Unknown label: ${label}`, frame.pc, 'JMP_IF_NOT');
                    }
                    frame.pc = target - 1;
                }
                break;
            }

            case IROpcode.CALL: {
                const funcName = operand as string;
                const targetFunc = this.program.functions.find(f => f.name === funcName);
                if (!targetFunc) {
                    throw new VMError(`Function not found: ${funcName}`, frame.pc, 'CALL');
                }

                const argCount = targetFunc.params.length;
                const args: Value[] = [];
                for (let i = 0; i < argCount; i++) {
                    args.unshift(this.stack.pop());
                }

                // Advance caller PC so we return to the NEXT instruction
                frame.pc++;
                this.pushFrame(funcName, args, frame.pc);
                break;
            }

            case IROpcode.RET:
                this.callStack.pop();
                // Return value is left on shared stack
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
                        throw new VMError(`Unknown block property: ${prop}`, frame.pc, 'CTX_BLOCK');
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
                const index = this.popInt(frame.pc);
                const list = this.stack.pop();
                if (list.kind !== 'list') {
                    throw new VMError('Expected list', frame.pc, 'LIST_GET');
                }
                const idx = Number(index);
                if (idx < 0 || idx >= list.elements.length) {
                    throw new VMError(`Index out of bounds: ${idx}`, frame.pc, 'LIST_GET');
                }
                this.stack.push(list.elements[idx]!);
                break;
            }

            case IROpcode.LIST_SET: {
                const value = this.stack.pop();
                const index = this.popInt(frame.pc);
                const list = this.stack.pop();
                if (list.kind !== 'list') {
                    throw new VMError('Expected list', frame.pc, 'LIST_SET');
                }
                const idx = Number(index);
                list.elements[idx] = value;
                this.stack.push(list);
                break;
            }

            case IROpcode.LIST_LEN: {
                const list = this.stack.pop();
                if (list.kind !== 'list') {
                    throw new VMError('Expected list', frame.pc, 'LIST_LEN');
                }
                this.stack.push(intValue(list.elements.length));
                break;
            }

            case IROpcode.LIST_PUSH: {
                const value = this.stack.pop();
                const list = this.stack.pop();
                if (list.kind !== 'list') {
                    throw new VMError('Expected list', frame.pc, 'LIST_PUSH');
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
                    throw new VMError('Expected map', frame.pc, 'MAP_GET');
                }
                const keyStr = this.valueToKey(key, frame.pc);
                this.stack.push(map.entries.get(keyStr) ?? nullValue());
                break;
            }

            case IROpcode.MAP_SET: {
                const value = this.stack.pop();
                const key = this.stack.pop();
                const map = this.stack.pop();
                if (map.kind !== 'map') {
                    throw new VMError('Expected map', frame.pc, 'MAP_SET');
                }
                const keyStr = this.valueToKey(key, frame.pc);
                map.entries.set(keyStr, value);
                this.stack.push(map);
                break;
            }

            case IROpcode.MAP_DEL: {
                const key = this.stack.pop();
                const map = this.stack.pop();
                if (map.kind !== 'map') {
                    throw new VMError('Expected map', frame.pc, 'MAP_DEL');
                }
                const keyStr = this.valueToKey(key, frame.pc);
                map.entries.delete(keyStr);
                this.stack.push(map);
                break;
            }

            case IROpcode.MAP_HAS: {
                const key = this.stack.pop();
                const map = this.stack.pop();
                if (map.kind !== 'map') {
                    throw new VMError('Expected map', frame.pc, 'MAP_HAS');
                }
                const keyStr = this.valueToKey(key, frame.pc);
                this.stack.push(boolValue(map.entries.has(keyStr)));
                break;
            }

            // Member access
            case IROpcode.MEMBER_GET: {
                const prop = operand as string;
                const obj = this.stack.pop();
                if (obj.kind !== 'struct') {
                    throw new VMError('Expected struct', frame.pc, 'MEMBER_GET');
                }
                const value = obj.fields.get(prop);
                if (value === undefined) {
                    throw new VMError(`Unknown field: ${prop}`, frame.pc, 'MEMBER_GET');
                }
                this.stack.push(value);
                break;
            }

            case IROpcode.MEMBER_SET: {
                const prop = operand as string;
                const value = this.stack.pop();
                const obj = this.stack.pop();
                if (obj.kind !== 'struct') {
                    throw new VMError('Expected struct', frame.pc, 'MEMBER_SET');
                }
                obj.fields.set(prop, value);
                this.stack.push(obj);
                break;
            }

            case IROpcode.STRUCT_NEW: {
                const descriptor = (operand as string) || '';
                const [typeName, fieldsStr] = descriptor.split(':');
                const fieldNames = fieldsStr ? fieldsStr.split(',') : [];
                const fields = new Map<string, Value>();

                for (let i = fieldNames.length - 1; i >= 0; i--) {
                    const fieldName = fieldNames[i];
                    if (fieldName) {
                        fields.set(fieldName, this.stack.pop());
                    }
                }

                this.stack.push(structValue(typeName || 'Unknown', fields));
                break;
            }

            // Assertions
            case IROpcode.REQUIRE: {
                const condition = this.stack.pop();
                if (!isTruthy(condition)) {
                    throw new RequireError(operand as string, frame.pc);
                }
                break;
            }

            case IROpcode.ENSURE: {
                const condition = this.stack.pop();
                if (!isTruthy(condition)) {
                    throw new EnsureError(operand as string, frame.pc);
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
                    throw new VMError(`HASH expected bytes or string, got ${data.kind}`, frame.pc);
                }
                this.stack.push(bytesValue(sha256(bytes)));
                break;
            }

            // Halt
            case IROpcode.HALT:
                this.halted = true;
                break;

            default:
                throw new VMError(`Unknown opcode: ${opcode}`, frame.pc);
        }
    }

    private popInt(pc: number): bigint {
        const value = this.stack.pop();
        if (value.kind !== 'int') {
            throw new VMError(`Expected integer, got ${value.kind}`, pc);
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

    private valueToKey(value: Value, pc: number): string {
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
                return `l:[${value.elements.map(e => this.valueToKey(e, pc)).join(',')}]`;
            case 'map': {
                const keys = Array.from(value.entries.keys()).sort();
                return `m:{${keys.map(k => `${k}=${this.valueToKey(value.entries.get(k)!, pc)}`).join(',')}}`;
            }
            case 'struct': {
                const keys = Array.from(value.fields.keys()).sort();
                return `S:${value.type}{${keys.map(k => `${k}=${this.valueToKey(value.fields.get(k)!, pc)}`).join(',')}}`;
            }
            default:
                throw new VMError(`Unsupported key type: ${(value as any).kind}`, pc);
        }
    }
}
