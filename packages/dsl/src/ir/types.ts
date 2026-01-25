/**
 * VERA DSL Intermediate Representation (IR)
 *
 * Low-level representation suitable for execution by the TSP.
 * IR is designed for deterministic execution with gas metering.
 */

import type { SourceSpan } from '../lexer/tokens.js';

// ============================================================================
// IR Opcodes
// ============================================================================

/**
 * All supported IR operation codes
 */
export enum IROpcode {
    // Stack operations
    PUSH = 'PUSH',           // Push constant onto stack
    POP = 'POP',             // Pop top of stack
    DUP = 'DUP',             // Duplicate top of stack
    SWAP = 'SWAP',           // Swap top two stack elements

    // Variables
    LOAD = 'LOAD',           // Load variable onto stack
    STORE = 'STORE',         // Store stack top to variable

    // Arithmetic
    ADD = 'ADD',             // a + b
    SUB = 'SUB',             // a - b
    MUL = 'MUL',             // a * b
    DIV = 'DIV',             // a / b
    MOD = 'MOD',             // a % b
    NEG = 'NEG',             // -a

    // Comparison
    EQ = 'EQ',               // a == b
    NEQ = 'NEQ',             // a != b
    LT = 'LT',               // a < b
    LTE = 'LTE',             // a <= b
    GT = 'GT',               // a > b
    GTE = 'GTE',             // a >= b

    // Logical
    AND = 'AND',             // a && b
    OR = 'OR',               // a || b
    NOT = 'NOT',             // !a

    // Control flow
    JMP = 'JMP',             // Unconditional jump
    JMP_IF = 'JMP_IF',       // Jump if top of stack is true
    JMP_IF_NOT = 'JMP_IF_NOT', // Jump if top of stack is false
    CALL = 'CALL',           // Call function
    RET = 'RET',             // Return from function

    // State operations
    STATE_GET = 'STATE_GET',     // Get state value
    STATE_SET = 'STATE_SET',     // Set state value
    STATE_DEL = 'STATE_DEL',     // Delete state value
    STATE_EXISTS = 'STATE_EXISTS', // Check if state exists

    // Context
    CTX_CALLER = 'CTX_CALLER',   // Push caller address
    CTX_BLOCK = 'CTX_BLOCK',     // Push block property
    CTX_THIS = 'CTX_THIS',       // Push this reference

    // Collections
    LIST_NEW = 'LIST_NEW',       // Create new list
    LIST_GET = 'LIST_GET',       // Get list element
    LIST_SET = 'LIST_SET',       // Set list element
    LIST_LEN = 'LIST_LEN',       // Get list length
    LIST_PUSH = 'LIST_PUSH',     // Push to list
    MAP_NEW = 'MAP_NEW',         // Create new map
    MAP_GET = 'MAP_GET',         // Get map value
    MAP_SET = 'MAP_SET',         // Set map value
    MAP_DEL = 'MAP_DEL',         // Delete map key
    MAP_HAS = 'MAP_HAS',         // Check map has key

    // Structs
    STRUCT_NEW = 'STRUCT_NEW',   // Create new struct instance

    // Member access
    MEMBER_GET = 'MEMBER_GET',   // Get object member
    MEMBER_SET = 'MEMBER_SET',   // Set object member

    // Assertions
    REQUIRE = 'REQUIRE',     // Require condition (revert if false)
    ENSURE = 'ENSURE',       // Ensure condition (post-check)

    // Events
    EMIT = 'EMIT',           // Emit event

    // No operation (for debugging/padding)
    NOP = 'NOP',

    // Crypto
    HASH = 'HASH',           // SHA-256 hash of data

    // Halt execution
    HALT = 'HALT',
}

// ============================================================================
// IR Values
// ============================================================================

/**
 * Represents a constant value in IR
 */
export type IRValue =
    | { kind: 'int'; value: bigint }
    | { kind: 'bool'; value: boolean }
    | { kind: 'string'; value: string }
    | { kind: 'bytes'; value: Uint8Array }
    | { kind: 'address'; value: string }
    | { kind: 'null' };

// ============================================================================
// IR Instructions
// ============================================================================

/**
 * Base instruction with source mapping
 */
export interface IRInstruction {
    opcode: IROpcode;
    operand?: IRValue | string | number;
    span?: SourceSpan;
}

/**
 * Creates an IR instruction
 */
export function ir(
    opcode: IROpcode,
    operand?: IRValue | string | number,
    span?: SourceSpan
): IRInstruction {
    const inst: IRInstruction = { opcode };
    if (operand !== undefined) {
        inst.operand = operand;
    }
    if (span !== undefined) {
        inst.span = span;
    }
    return inst;
}

// ============================================================================
// IR Program
// ============================================================================

/**
 * Function definition in IR
 */
export interface IRFunction {
    name: string;
    params: string[];
    locals: string[];
    instructions: IRInstruction[];
    isPublic: boolean;
}

/**
 * Entity definition in IR
 */
export interface IREntity {
    name: string;
    keyType: string;
    fields: { name: string; type: string }[];
}

/**
 * Event definition in IR
 */
export interface IREvent {
    name: string;
    fields: { name: string; type: string }[];
}

/**
 * Complete IR program
 */
export interface IRProgram {
    name: string;
    entities: IREntity[];
    events: IREvent[];
    functions: IRFunction[];
}

/**
 * Creates an empty IR program
 */
export function createIRProgram(name: string): IRProgram {
    return {
        name,
        entities: [],
        events: [],
        functions: [],
    };
}
