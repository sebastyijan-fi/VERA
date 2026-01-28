/**
 * VERA RPC - Introspection Methods (rpc_*)
 */

import type { MethodRegistry } from '../types.js';

export function createRpcMethods(listMethods: () => string[]): MethodRegistry {
    return {
        async rpc_methods(params, ctx) {
            return {
                methods: listMethods(),
                version: '1.0.0'
            };
        },

        async rpc_modules(params, ctx) {
            const methods = listMethods();
            const modules: Record<string, string> = {};

            for (const m of methods) {
                const [ns] = m.split('_');
                modules[ns] = '1.0.0';
            }

            return modules;
        }
    };
}
