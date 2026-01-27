
import { describe, it, expect } from 'vitest';
import { ParallelExecutor } from '../src/parallel/executor.js';
import { type IRProgram, IROpcode } from '@vera/dsl';
import { stringValue, intValue, type Value } from '../src/vm/value.js';

describe('ParallelExecutor', () => {
    // Construct a simple program with Read/Write capabilities
    // Params are simple string names in IRFunction
    // Arguments are loaded by name using LOAD
    const program: IRProgram = {
        id: '0x' + '0'.repeat(64),
        name: 'ParallelTest',
        entities: [],
        events: [],
        functions: [
            {
                name: 'Write',
                isPublic: true,
                params: ['key', 'val'],
                locals: [],
                instructions: [
                    { opcode: IROpcode.LOAD, operand: 'key' },
                    { opcode: IROpcode.LOAD, operand: 'val' },
                    { opcode: IROpcode.STATE_SET, operand: 'test' },
                    { opcode: IROpcode.RET }
                ]
            },
            {
                name: 'Read',
                isPublic: true,
                params: ['key'],
                locals: [],
                instructions: [
                    { opcode: IROpcode.LOAD, operand: 'key' },
                    { opcode: IROpcode.STATE_GET, operand: 'test' },
                    { opcode: IROpcode.POP },
                    { opcode: IROpcode.RET }
                ]
            },
            {
                name: 'ReadWrite',
                isPublic: true,
                params: ['rKey', 'wKey', 'val'],
                locals: [],
                instructions: [
                    { opcode: IROpcode.LOAD, operand: 'rKey' },
                    { opcode: IROpcode.STATE_GET, operand: 'test' },
                    { opcode: IROpcode.POP }, // Consume read
                    { opcode: IROpcode.LOAD, operand: 'wKey' },
                    { opcode: IROpcode.LOAD, operand: 'val' },
                    { opcode: IROpcode.STATE_SET, operand: 'test' },
                    { opcode: IROpcode.RET }
                ]
            }
        ]
    };

    const block = {
        timestamp: 1000n,
        height: 1n,
        parentHash: '0x' + '0'.repeat(64)
    };

    it('should execute disjoint transactions in one round', async () => {
        const executor = new ParallelExecutor(program);
        const txs = [
            { functionName: 'Write', args: [stringValue('A'), intValue(1n)], caller: 'alice' },
            { functionName: 'Write', args: [stringValue('B'), intValue(2n)], caller: 'bob' }
        ];

        const { results, stats } = await executor.executeBlock(txs, block);

        expect(stats.rounds).toBe(1);
        expect(stats.conflictsDetected).toBe(0);
        expect(results[0]!.success).toBe(true);
        expect(results[1]!.success).toBe(true);
    });

    it('should detect Read-After-Write conflict and re-execute', async () => {
        const executor = new ParallelExecutor(program);
        // Tx 0: Write A = 10
        // Tx 1: Read A (Expect 10, but in parallel it reads 0/null) -> Conflict
        const txs = [
            { functionName: 'Write', args: [stringValue('A'), intValue(10n)], caller: 'alice' },
            { functionName: 'Read', args: [stringValue('A')], caller: 'bob' }
        ];

        const { results, stats } = await executor.executeBlock(txs, block);

        expect(stats.conflictsDetected).toBeGreaterThanOrEqual(1); // 1 conflicts with 0
        expect(stats.rounds).toBe(2); // Initial + Fallback

        // Results should be successful
        expect(results[0]!.success).toBe(true);
        expect(results[1]!.success).toBe(true);
    });

    it('should ignore Anti-Dependencies (WAR)', async () => {
        const executor = new ParallelExecutor(program);
        // Tx 0: Read A
        // Tx 1: Write A
        // This is safe in parallel (Tx 0 reads old value)
        const txs = [
            { functionName: 'Read', args: [stringValue('A')], caller: 'alice' },
            { functionName: 'Write', args: [stringValue('A'), intValue(20n)], caller: 'bob' }
        ];

        const { results, stats } = await executor.executeBlock(txs, block);

        expect(stats.conflictsDetected).toBe(0);
        expect(stats.rounds).toBe(1);
    });

    it('should handle chains of conflicts', async () => {
        const executor = new ParallelExecutor(program);
        // 0: Write A
        // 1: Read A, Write B
        // 2: Read B
        // 1 conflicts with 0. 2 conflicts with 1 (potentially, but definitely 1 is invalid so 2 might be re-executed too)
        const txs = [
            { functionName: 'Write', args: [stringValue('A'), intValue(1n)], caller: 'a' },
            { functionName: 'ReadWrite', args: [stringValue('A'), stringValue('B'), intValue(2n)], caller: 'b' },
            { functionName: 'Read', args: [stringValue('B')], caller: 'c' }
        ];

        const { results, stats } = await executor.executeBlock(txs, block);

        // Conflict set should definitely include 1.
        expect(stats.conflictsDetected).toBeGreaterThanOrEqual(1);
        expect(stats.rounds).toBe(2);

        expect(results[0]!.success).toBe(true);
        expect(results[1]!.success).toBe(true);
        expect(results[2]!.success).toBe(true);
    });
});
