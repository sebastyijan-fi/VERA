import { Encoder } from 'cbor-x';
import { EventEmitter } from 'eventemitter3';
import { type Message, MessageType } from './message.js';

// Setup CBOR encoder with settings matching storage/core if needed
// For now, standard config
const extensionParams = {
    structuredClone: true,
    mapsAsObjects: true,
    useRecords: false
};
const encoder = new Encoder(extensionParams);

/**
 * Encodes a message into a length-prefixed buffer.
 * [Length (4 bytes BE)] [Type (1 byte)] [Payload (CBOR)]
 */
export function encodeMessage(msg: Message): Buffer {
    const payloadBuffer = encoder.encode(msg.payload);
    const length = 1 + payloadBuffer.length; // 1 byte for type

    // Allocate buffer: 4 bytes length + 1 byte type + payload
    const buf = Buffer.allocUnsafe(4 + length);

    // Write Length
    buf.writeUInt32BE(length, 0);

    // Write Type
    buf.writeUInt8(msg.type, 4);

    // Write Payload
    payloadBuffer.copy(buf, 5);

    return buf;
}

/**
 * Decodes a stream of data into messages.
 * Emits 'message' events.
 */
export class ProtocolDecoder extends EventEmitter {
    private buffer: Buffer;

    constructor() {
        super();
        this.buffer = Buffer.alloc(0);
    }

    /**
     * Process incoming chunk of data
     */
    push(chunk: Buffer) {
        this.buffer = Buffer.concat([this.buffer, chunk]);
        this.processBuffer();
    }

    private processBuffer() {
        while (true) {
            // Need at least 4 bytes for length
            if (this.buffer.length < 4) {
                return;
            }

            // Read encoded length
            const length = this.buffer.readUInt32BE(0);

            // Check if we have the full message
            // Total frame size = 4 (length header) + length (body)
            if (this.buffer.length < 4 + length) {
                return;
            }

            // Extract body
            const body = this.buffer.subarray(4, 4 + length);

            // Advance buffer
            this.buffer = this.buffer.subarray(4 + length);

            // Decode body
            try {
                const type = body.readUInt8(0);
                const payloadBytes = body.subarray(1);

                // Decode CBOR payload if present
                let payload = null;
                if (payloadBytes.length > 0) {
                    payload = encoder.decode(payloadBytes);
                }

                const msg: Message = {
                    type: type as MessageType,
                    payload
                };

                this.emit('message', msg);
            } catch (e) {
                this.emit('error', e);
                // In a real system, we might close connection on decode error
                return;
            }
        }
    }
}
