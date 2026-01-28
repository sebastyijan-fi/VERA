/**
 * VERA RPC - Debug Methods
 */

import type { MethodRegistry } from '../types.js';
import { errors } from '../errors.js';

export const debugMethods: MethodRegistry = {
    async debug_traceTransaction(params, ctx) {
        const [txHash] = params as [string];
        if (!txHash) throw errors.invalidParams('Expected transaction hash');

        // Would return step-by-step execution trace
        return {
            gas: '0x5208',
            returnValue: '0x',
            structLogs: []
        };
    },

    async debug_replayBlock(params, ctx) {
        const [blockId] = params as [string];
        if (!blockId) throw errors.invalidParams('Expected block identifier');

        // Would re-execute block and return all state changes
        return {
            blockHeight: blockId,
            stateChanges: [],
            gasUsed: '0x0'
        };
    }
};
