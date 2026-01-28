/**
 * VERA RPC - Network Methods (net_*)
 */

import type { MethodRegistry } from '../types.js';

export const netMethods: MethodRegistry = {
    async net_peerCount(params, ctx) {
        const count = ctx.node.network?.peers?.size || 0;
        return '0x' + count.toString(16);
    },

    async net_version(params, ctx) {
        return ctx.node.config?.networkId || 'vera-devnet';
    },

    async net_listening(params, ctx) {
        return ctx.node.network?.isListening?.() ?? true;
    }
};
