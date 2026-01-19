/**
 * VERA VM Runtime Values
 *
 * Type-safe runtime values for the stack VM.
 */

// ============================================================================
// Value Types
// ============================================================================

/**
 * Runtime value kinds
 */
export type ValueKind = 'int' | 'bool' | 'string' | 'bytes' | 'address' | 'list' | 'map' | 'null' | 'struct';

/**
 * Base value interface
 */
export interface BaseValue {
    readonly kind: ValueKind;
}

/**
 * Integer value (arbitrary precision)
 */
export interface IntValue extends BaseValue {
    readonly kind: 'int';
    readonly value: bigint;
}

/**
 * Boolean value
 */
export interface BoolValue extends BaseValue {
    readonly kind: 'bool';
    readonly value: boolean;
}

/**
 * String value
 */
export interface StringValue extends BaseValue {
    readonly kind: 'string';
    readonly value: string;
}

/**
 * Bytes value
 */
export interface BytesValue extends BaseValue {
    readonly kind: 'bytes';
    readonly value: Uint8Array;
}

/**
 * Address value
 */
export interface AddressValue extends BaseValue {
    readonly kind: 'address';
    readonly value: string;
}

/**
 * List value
 */
export interface ListValue extends BaseValue {
    readonly kind: 'list';
    readonly elements: Value[];
}

/**
 * Map value
 */
export interface MapValue extends BaseValue {
    readonly kind: 'map';
    readonly entries: Map<string, Value>;
}

/**
 * Null value
 */
export interface NullValue extends BaseValue {
    readonly kind: 'null';
}

/**
 * Struct/entity value
 */
export interface StructValue extends BaseValue {
    readonly kind: 'struct';
    readonly type: string;
    readonly fields: Map<string, Value>;
}

/**
 * Union of all value types
 */
export type Value =
    | IntValue
    | BoolValue
    | StringValue
    | BytesValue
    | AddressValue
    | ListValue
    | MapValue
    | NullValue
    | StructValue;

// ============================================================================
// Value Constructors
// ============================================================================

export function intValue(value: bigint | number): IntValue {
    return { kind: 'int', value: BigInt(value) };
}

export function boolValue(value: boolean): BoolValue {
    return { kind: 'bool', value };
}

export function stringValue(value: string): StringValue {
    return { kind: 'string', value };
}

export function bytesValue(value: Uint8Array): BytesValue {
    return { kind: 'bytes', value };
}

export function addressValue(value: string): AddressValue {
    return { kind: 'address', value };
}

export function listValue(elements: Value[] = []): ListValue {
    return { kind: 'list', elements };
}

export function mapValue(entries: Map<string, Value> = new Map()): MapValue {
    return { kind: 'map', entries };
}

export function nullValue(): NullValue {
    return { kind: 'null' };
}

export function structValue(type: string, fields: Map<string, Value> = new Map()): StructValue {
    return { kind: 'struct', type, fields };
}

// ============================================================================
// Value Operations
// ============================================================================

/**
 * Checks if two values are equal
 */
export function valuesEqual(a: Value, b: Value): boolean {
    if (a.kind !== b.kind) return false;

    switch (a.kind) {
        case 'int':
            return a.value === (b as IntValue).value;
        case 'bool':
            return a.value === (b as BoolValue).value;
        case 'string':
            return a.value === (b as StringValue).value;
        case 'address':
            return a.value === (b as AddressValue).value;
        case 'null':
            return true;
        case 'bytes': {
            const bBytes = b as BytesValue;
            if (a.value.length !== bBytes.value.length) return false;
            for (let i = 0; i < a.value.length; i++) {
                if (a.value[i] !== bBytes.value[i]) return false;
            }
            return true;
        }
        case 'list': {
            const bList = b as ListValue;
            if (a.elements.length !== bList.elements.length) return false;
            for (let i = 0; i < a.elements.length; i++) {
                if (!valuesEqual(a.elements[i]!, bList.elements[i]!)) return false;
            }
            return true;
        }
        case 'map': {
            const bMap = b as MapValue;
            if (a.entries.size !== bMap.entries.size) return false;
            for (const [key, val] of a.entries) {
                const bVal = bMap.entries.get(key);
                if (!bVal || !valuesEqual(val, bVal)) return false;
            }
            return true;
        }
        case 'struct': {
            const bStruct = b as StructValue;
            if (a.type !== bStruct.type) return false;
            if (a.fields.size !== bStruct.fields.size) return false;
            for (const [key, val] of a.fields) {
                const bVal = bStruct.fields.get(key);
                if (!bVal || !valuesEqual(val, bVal)) return false;
            }
            return true;
        }
    }
}

/**
 * Converts value to boolean for conditionals
 */
export function isTruthy(value: Value): boolean {
    switch (value.kind) {
        case 'bool':
            return value.value;
        case 'int':
            return value.value !== 0n;
        case 'string':
            return value.value.length > 0;
        case 'bytes':
            return value.value.length > 0;
        case 'null':
            return false;
        case 'list':
            return value.elements.length > 0;
        case 'map':
            return value.entries.size > 0;
        default:
            return true;
    }
}

/**
 * Gets a string representation of a value for debugging
 */
export function valueToString(value: Value): string {
    switch (value.kind) {
        case 'int':
            return value.value.toString();
        case 'bool':
            return value.value.toString();
        case 'string':
            return `"${value.value}"`;
        case 'address':
            return `@${value.value}`;
        case 'bytes':
            return `0x${Array.from(value.value).map(b => b.toString(16).padStart(2, '0')).join('')}`;
        case 'null':
            return 'null';
        case 'list':
            return `[${value.elements.map(valueToString).join(', ')}]`;
        case 'map':
            return `{${[...value.entries].map(([k, v]) => `${k}: ${valueToString(v)}`).join(', ')}}`;
        case 'struct':
            return `${value.type}{${[...value.fields].map(([k, v]) => `${k}: ${valueToString(v)}`).join(', ')}}`;
    }
}
