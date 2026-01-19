/**
 * VERA Encoding Module - Public API
 */

export {
    encode,
    decode,
    encodeToBytes,
    encodeWithSortedKeys,
    type CanonicalTransaction,
    encodeCanonicalTransaction,
    encodeStateValue,
    decodeStateValue,
    encodedEqual,
    getEncodedSize,
    decodeString,
    decodeNumber,
    decodeBigInt,
    decodeBoolean,
    decodeBytes,
} from './cbor.js';
