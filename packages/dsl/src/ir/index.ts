/**
 * VERA DSL IR Module - Public API
 */

export {
    IROpcode,
    type IRValue,
    type IRInstruction,
    type IRFunction,
    type IREntity,
    type IREvent,
    type IRProgram,
    ir,
    createIRProgram,
} from './types.js';

export {
    IRCompiler,
    compileToIR,
} from './compiler.js';
