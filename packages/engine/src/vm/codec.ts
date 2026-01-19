/**
 * VERA Value Codec
 * 
 * Handles serialization of runtime Value types to bytes using CBOR.
 */

import { encode, decode } from '@vera/core';
import {
    type Value,
    intValue,
    boolValue,
    stringValue,
    bytesValue,
    addressValue,
    listValue,
    mapValue,
    nullValue,
    structValue,
} from './value.js';

/**
 * Encodes a VM Value to CBOR bytes
 */
export function encodeValue(value: Value): Uint8Array {
    const prepared = prepareForEncoding(value);
    return encode(prepared);
}

/**
 * Decodes CBOR bytes to a VM Value
 */
export function decodeValue(bytes: Uint8Array): Value {
    const raw = decode(bytes);
    return restoreFromDecoding(raw);
}

export function prepareForEncoding(value: Value): any {
    switch (value.kind) {
        case 'int':
        case 'bool':
        case 'string':
        case 'bytes':
        case 'address':
        case 'null':
            return value;
        case 'list':
            return {
                kind: 'list',
                elements: value.elements.map(prepareForEncoding)
            };
        case 'map': {
            const entries: Record<string, any> = {};
            for (const [k, v] of value.entries) {
                entries[k] = prepareForEncoding(v);
            }
            return {
                kind: 'map',
                entries
            };
        }
        case 'struct': {
            const fields: Record<string, any> = {};
            for (const [k, v] of value.fields) {
                fields[k] = prepareForEncoding(v);
            }
            return {
                kind: 'struct',
                type: value.type,
                fields
            };
        }
    }
}

export function restoreFromDecoding(raw: any): Value {
    if (!raw || typeof raw !== 'object') return nullValue();

    const kind = raw.kind;
    switch (kind) {
        case 'int':
            return intValue(raw.value);
        case 'bool':
            return boolValue(raw.value);
        case 'string':
            return stringValue(raw.value);
        case 'bytes':
            return bytesValue(new Uint8Array(raw.value));
        case 'address':
            return addressValue(raw.value);
        case 'null':
            return nullValue();
        case 'list':
            return listValue(raw.elements.map(restoreFromDecoding));
        case 'map': {
            const entries = new Map<string, Value>();
            for (const [k, v] of Object.entries(raw.entries)) {
                entries.set(k, restoreFromDecoding(v));
            }
            return mapValue(entries);
        }
        case 'struct': {
            const fields = new Map<string, Value>();
            for (const [k, v] of Object.entries(raw.fields)) {
                fields.set(k, restoreFromDecoding(v));
            }
            return structValue(raw.type, fields);
        }
        default:
            return nullValue();
    }
}
