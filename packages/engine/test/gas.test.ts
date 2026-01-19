/**
 * Gas System Tests
 */
import { describe, it, expect } from 'vitest';
import { GasMeter, OutOfGasError, GAS_COSTS, getGasCost } from '../src/gas/index.js';
import { IROpcode } from '@vera/dsl';

describe('GasMeter', () => {
    it('tracks gas consumption', () => {
        const meter = new GasMeter(1000n);

        meter.consume(100n);
        expect(meter.used).toBe(100n);
        expect(meter.remaining).toBe(900n);

        meter.consume(50n);
        expect(meter.used).toBe(150n);
    });

    it('throws on out of gas', () => {
        const meter = new GasMeter(100n);

        meter.consume(50n);
        expect(() => meter.consume(100n)).toThrow(OutOfGasError);
    });

    it('provides error details on OOG', () => {
        const meter = new GasMeter(100n);
        meter.consume(50n);

        try {
            meter.consume(100n);
            expect.fail('Should have thrown');
        } catch (e) {
            if (e instanceof OutOfGasError) {
                expect(e.gasLimit).toBe(100n);
                expect(e.gasUsed).toBe(50n);
                expect(e.gasNeeded).toBe(100n);
            }
        }
    });

    it('consumes opcode gas', () => {
        const meter = new GasMeter(1000n);

        meter.consumeOpcode(IROpcode.PUSH);
        meter.consumeOpcode(IROpcode.ADD);

        const expected = GAS_COSTS[IROpcode.PUSH] + GAS_COSTS[IROpcode.ADD];
        expect(meter.used).toBe(expected);
    });

    it('checks if enough gas', () => {
        const meter = new GasMeter(100n);
        meter.consume(50n);

        expect(meter.hasEnough(50n)).toBe(true);
        expect(meter.hasEnough(51n)).toBe(false);
    });

    it('can reset gas used', () => {
        const meter = new GasMeter(100n);
        meter.consume(50n);
        meter.reset();

        expect(meter.used).toBe(0n);
        expect(meter.remaining).toBe(100n);
    });
});

describe('Gas Costs', () => {
    it('has higher costs for state operations', () => {
        expect(GAS_COSTS[IROpcode.STATE_SET]).toBeGreaterThan(GAS_COSTS[IROpcode.ADD]);
        expect(GAS_COSTS[IROpcode.STATE_GET]).toBeGreaterThan(GAS_COSTS[IROpcode.LOAD]);
    });

    it('has costs for all opcodes', () => {
        for (const opcode of Object.values(IROpcode)) {
            expect(getGasCost(opcode)).toBeGreaterThanOrEqual(0n);
        }
    });

    it('control flow costs more than basic ops', () => {
        expect(GAS_COSTS[IROpcode.JMP]).toBeGreaterThan(GAS_COSTS[IROpcode.PUSH]);
        expect(GAS_COSTS[IROpcode.CALL]).toBeGreaterThan(GAS_COSTS[IROpcode.JMP]);
    });
});
