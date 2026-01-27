
import { describe, it, expect } from 'vitest';
import { parse, compileToIR } from '@vera/dsl';
import {
    VirtualMachine,
    GasMeter,
    createExecutionContext,
    createStateJournal,
    EventEmitter,
    intValue,
} from '../src/index.js';

// Deterministic PRNG
function mulberry32(a: number) {
    return function () {
        var t = a += 0x6D2B79F5;
        t = Math.imul(t ^ t >>> 15, t | 1);
        t ^= t + Math.imul(t ^ t >>> 7, t | 61);
        return ((t ^ t >>> 14) >>> 0) / 4294967296;
    }
}

describe('REQ-DET-01: Engine Replay Determinism (Matrix Wave)', () => {

    const SOURCE_CODE = `
module DeterminismTest
transaction RunCheck(seed: Integer) {
    // Simple calculation
    let val = seed * 1337;
    let val2 = val + 100;
    
    // Write state
    // Note: State writing needs explicit key/value logic if using low-level,
    // but here we just check execution flow and events.
    require val2 > 0, "Wait what?";
}
`.trim();

    const IR = compileToIR(parse(SOURCE_CODE));

    // Helper to run a batch of inputs and capture the transcript
    async function runBatch(seed: number, count: number) {
        const rng = mulberry32(seed);
        const transcript: any[] = [];

        for (let k = 0; k < count; k++) {
            const inputVal = Math.floor(rng() * 100);

            const vm = new VirtualMachine(IR);
            const state = createStateJournal();
            const events = new EventEmitter();
            const gas = new GasMeter(1000000n);
            const context = createExecutionContext({
                caller: '0x1234',
                state,
                events,
            });

            const res = await vm.execute('RunCheck', [intValue(inputVal)], context, gas);

            transcript.push({
                input: inputVal,
                success: res.success,
                gasUsed: res.gasUsed.toString(), // deterministic gas
                error: res.error?.message,
                events: events.getEvents().map(e => ({ name: e.name, data: e.data }))
            });
        }

        return JSON.stringify(transcript);
    }

    it('should produce byte-identical transcripts for engine replay', { timeout: 10000 }, async () => {
        const SEED = 999;
        const COUNT = 50;

        // Run A
        const t1 = await runBatch(SEED, COUNT);

        // Run B (Independent Replay)
        const t2 = await runBatch(SEED, COUNT);

        // Assert
        if (t1 !== t2) {
            console.error('Divergence found!');
            console.log('T1 length:', t1.length);
            console.log('T2 length:', t2.length);
        }
        expect(t1).toBe(t2);
    });

    it('should vary on different inputs', async () => {
        const t1 = await runBatch(1234, 10);
        const t2 = await runBatch(5678, 10);
        expect(t1).not.toBe(t2);
    });
});
