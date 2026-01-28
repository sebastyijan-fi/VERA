/**
 * VERA VM - Public API
 */

export {
    type Value,
    type ValueKind,
    type IntValue,
    type BoolValue,
    type StringValue,
    type BytesValue,
    type AddressValue,
    type ListValue,
    type MapValue,
    type NullValue,
    type StructValue,
    intValue,
    boolValue,
    stringValue,
    bytesValue,
    addressValue,
    listValue,
    mapValue,
    nullValue,
    structValue,
    valuesEqual,
    isTruthy,
    valueToString,
} from './value.js';

export {
    Stack,
    CallStack,
    StackError,
    type CallFrame,
} from './stack.js';

export {
    VirtualMachine,
    VMError,
    RequireError,
    EnsureError,
    type VMResult,
} from './vm.js';

export {
    PRECOMPILES,
    isPrecompile,
    executePrecompile,
    precompileOutputToValue,
    type PrecompileResult,
    type PrecompileFunction,
} from './precompiles.js';
