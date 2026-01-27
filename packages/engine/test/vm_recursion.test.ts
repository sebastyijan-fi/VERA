
import { describe, it, expect } from 'vitest';
import { parse, compileToIR } from '@vera/dsl';
import {
    VirtualMachine,
    GasMeter,
    createExecutionContext,
    createStateJournal,
    EventEmitter,
    intValue
} from '../src/index.js';

describe('REQ-VER-01: VM Call Frame Soundness', () => {

    it('should preserve caller stack across nested calls', async () => {
        // We define two transactions.
        // CALLER: pushes 42, calls CALLEE, pops result, adds 42 + result.
        // If stack is wiped, the 42 is gone and ADD will fail (underflow) or return wrong result.

        const source = `
module RecursionTest

transaction Callee() {
    return 10;
}

transaction Caller() {
    let x = 42;
    let y = Callee();
    let z = x + y;
    emit Result(z);
}
`.trim();

        // Note: DSL might not define 'Callee' as callable if it's a 'transaction'.
        // But the VM 'CALL' opcode looks up functions by name in 'program.functions'.
        // Both Callee and Caller are functions in IR.
        // The DSL Parser might treat them as entry points.
        // Let's rely on DSL compiling them to functions 'Callee' and 'Caller'.

        const ir = compileToIR(parse(source));
        const vm = new VirtualMachine(ir);
        const state = createStateJournal();
        const events = new EventEmitter();
        const context = createExecutionContext({ caller: '0x1', state, events });
        const gas = new GasMeter(100000n);

        // Execute Caller
        const res = await vm.execute('Caller', [], context, gas);

        expect(res.success).toBe(true);
        expect(res.error).toBeUndefined();

        // Expected: 42 + 10 = 52
        const ev = events.getEvents()[0];
        expect(ev).toBeDefined();
        // Check data value
        expect(ev.data).toEqual(intValue(52n));
    });
});
