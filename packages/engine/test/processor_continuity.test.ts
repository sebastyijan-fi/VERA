
import { describe, it, expect } from 'vitest';
import {
    createProcessor,
    intValue,
    stringValue
} from '../src/index.js';
import { IROpcode, type IRProgram } from '@vera/dsl';

describe('REQ-VER-01: Stateful Processor Continuity', () => {

    it('should maintain state across sequential executions', async () => {
        // Manual IR Construction to avoid DSL parser issues
        const program: IRProgram = {
            id: '0x' + '0'.repeat(64),
            name: 'StateTest',
            entities: [],
            events: [{ name: 'Result', fields: [{ name: 'val', type: 'Integer' }] }],
            functions: [
                {
                    name: 'SetX',
                    isPublic: true,
                    params: ['val'],
                    locals: [], // Unused for params?
                    instructions: [
                        { opcode: IROpcode.PUSH, operand: { kind: 'string', value: 'X' } }, // Key
                        { opcode: IROpcode.LOAD, operand: 'val' },                          // Value
                        { opcode: IROpcode.STATE_SET, operand: 'kv' },
                        { opcode: IROpcode.RET }
                    ]
                },
                {
                    name: 'GetX',
                    isPublic: true,
                    params: [],
                    locals: [],
                    instructions: [
                        { opcode: IROpcode.PUSH, operand: { kind: 'string', value: 'X' } }, // Key
                        { opcode: IROpcode.STATE_GET, operand: 'kv' }, // Pushes Value
                        { opcode: IROpcode.EMIT, operand: 'Result' },
                        { opcode: IROpcode.RET }
                    ]
                }
            ]
        };

        const processor = createProcessor(program);

        // 1. Set X = 100
        const res1 = await processor.execute('SetX', [intValue(100n)], '0x1');

        if (!res1.success) {
            console.error(res1.error);
        }
        expect(res1.success).toBe(true);

        // 2. Get X (Should be 100 if state persists)
        const res2 = await processor.execute('GetX', [], '0x1');

        if (!res2.success) {
            console.error(res2.error);
        }
        expect(res2.success).toBe(true);

        const events = res2.events;
        expect(events.length).toBe(1);

        // Expect 100
        expect(events[0].data).toEqual(intValue(100n));
    });
});
