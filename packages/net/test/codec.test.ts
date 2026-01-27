import { describe, it, expect } from 'vitest';
import { ProtocolDecoder, encodeMessage } from '../src/protocol/codec.js';
import { MessageType, Message } from '../src/protocol/message.js';

describe('Protocol Codec', () => {
    it('should encode and decode a simple message', () => {
        const msg: Message = {
            type: MessageType.STATUS,
            payload: { height: 100n, headHash: 'abc' }
        };

        const buf = encodeMessage(msg);
        const decoder = new ProtocolDecoder();

        return new Promise<void>((resolve, reject) => {
            decoder.on('message', (decoded: Message) => {
                try {
                    expect(decoded.type).toBe(MessageType.STATUS);
                    // cbor-x might decode small BigInt as Number
                    expect(BigInt(decoded.payload.height)).toBe(100n);
                    expect(decoded.payload.headHash).toBe('abc');
                    resolve();
                } catch (e) { reject(e); }
            });
            decoder.on('error', reject);
            decoder.push(buf);
        });
    });

    it('should handle split packets (fragmentation)', () => {
        const msg: Message = {
            type: MessageType.HELLO,
            payload: { version: '1.0.0' }
        };
        const buf = encodeMessage(msg);

        // Split into two chunks
        const part1 = buf.subarray(0, 4); // Only length header part
        const part2 = buf.subarray(4);    // Rest

        const decoder = new ProtocolDecoder();

        return new Promise<void>((resolve, reject) => {
            decoder.on('message', (decoded) => {
                try {
                    expect(decoded.type).toBe(MessageType.HELLO);
                    expect(decoded.payload.version).toBe('1.0.0');
                    resolve();
                } catch (e) { reject(e); }
            });

            decoder.push(part1);
            decoder.push(part2);
        });
    });

    it('should handle multiple messages in one packet (coalescing)', () => {
        const msg1: Message = { type: MessageType.STATUS, payload: { id: 1 } };
        const msg2: Message = { type: MessageType.STATUS, payload: { id: 2 } };

        const buf1 = encodeMessage(msg1);
        const buf2 = encodeMessage(msg2);
        const combined = Buffer.concat([buf1, buf2]);

        const decoder = new ProtocolDecoder();
        let count = 0;

        return new Promise<void>((resolve, reject) => {
            decoder.on('message', (decoded) => {
                try {
                    count++;
                    if (count === 1) {
                        expect(decoded.payload.id).toBe(1);
                    } else if (count === 2) {
                        expect(decoded.payload.id).toBe(2);
                        resolve();
                    }
                } catch (e) { reject(e); }
            });
            decoder.push(combined);
        });
    });
});
