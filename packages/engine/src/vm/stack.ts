/**
 * VERA VM Stack
 *
 * Type-safe stack implementation for the VM.
 */

import type { Value } from './value.js';
import { valueToString } from './value.js';

// ============================================================================
// Stack Error
// ============================================================================

export class StackError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'StackError';
    }
}

// ============================================================================
// Stack Implementation
// ============================================================================

/**
 * Maximum stack depth to prevent overflow
 */
const MAX_STACK_DEPTH = 1024;

/**
 * VM execution stack
 */
export class Stack {
    private readonly values: Value[] = [];

    /**
     * Pushes a value onto the stack
     */
    push(value: Value): void {
        if (this.values.length >= MAX_STACK_DEPTH) {
            throw new StackError(`Stack overflow: maximum depth ${MAX_STACK_DEPTH} exceeded`);
        }
        this.values.push(value);
    }

    /**
     * Pops a value from the stack
     */
    pop(): Value {
        const value = this.values.pop();
        if (value === undefined) {
            throw new StackError('Stack underflow: cannot pop from empty stack');
        }
        return value;
    }

    /**
     * Peeks at the top value without removing it
     */
    peek(): Value {
        if (this.values.length === 0) {
            throw new StackError('Stack underflow: cannot peek empty stack');
        }
        return this.values[this.values.length - 1]!;
    }

    /**
     * Peeks at a value at offset from top (0 = top)
     */
    peekAt(offset: number): Value {
        const index = this.values.length - 1 - offset;
        if (index < 0 || index >= this.values.length) {
            throw new StackError(`Stack underflow: cannot peek at offset ${offset}`);
        }
        return this.values[index]!;
    }

    /**
     * Duplicates the top value
     */
    dup(): void {
        this.push(this.peek());
    }

    /**
     * Swaps the top two values
     */
    swap(): void {
        if (this.values.length < 2) {
            throw new StackError('Stack underflow: cannot swap with fewer than 2 values');
        }
        const a = this.values.pop()!;
        const b = this.values.pop()!;
        this.values.push(a);
        this.values.push(b);
    }

    /**
     * Gets the current stack depth
     */
    get depth(): number {
        return this.values.length;
    }

    /**
     * Checks if the stack is empty
     */
    get isEmpty(): boolean {
        return this.values.length === 0;
    }

    /**
     * Clears the stack
     */
    clear(): void {
        this.values.length = 0;
    }

    /**
     * Returns stack contents for debugging
     */
    toArray(): readonly Value[] {
        return [...this.values];
    }

    /**
     * Returns string representation for debugging
     */
    toString(): string {
        if (this.values.length === 0) return '[]';
        return `[${this.values.map(valueToString).join(', ')}]`;
    }
}

// ============================================================================
// Call Stack
// ============================================================================

/**
 * Call frame for function calls
 */
export interface CallFrame {
    /** Function name */
    functionName: string;
    /** Current instruction index */
    pc: number;
    /** Return address (instruction index in caller) */
    returnAddress: number;
    /** Local variable base pointer */
    basePointer: number;
    /** Local variables */
    locals: Map<string, Value>;
    /** Label map for this function */
    labelMap: Map<string, number>;
}

/**
 * Call stack for function invocations
 */
export class CallStack {
    private readonly frames: CallFrame[] = [];
    private readonly maxDepth = 256;

    /**
     * Pushes a new call frame
     */
    push(frame: CallFrame): void {
        if (this.frames.length >= this.maxDepth) {
            throw new StackError(`Call stack overflow: maximum depth ${this.maxDepth} exceeded`);
        }
        this.frames.push(frame);
    }

    /**
     * Pops the current call frame
     */
    pop(): CallFrame {
        const frame = this.frames.pop();
        if (!frame) {
            throw new StackError('Call stack underflow: no frame to return from');
        }
        return frame;
    }

    /**
     * Gets the current call frame
     */
    current(): CallFrame | undefined {
        return this.frames[this.frames.length - 1];
    }

    /**
     * Gets call stack depth
     */
    get depth(): number {
        return this.frames.length;
    }

    /**
     * Clears the call stack
     */
    clear(): void {
        this.frames.length = 0;
    }

    /**
     * Gets stack trace for error reporting
     */
    getStackTrace(): string[] {
        return this.frames.map((f) =>
            `  at ${f.functionName} (instruction ${f.returnAddress})`
        ).reverse();
    }
}
