/// <reference types="node" />
/**
 * VERA Snapshot Manager
 *
 * Manages state persistence via snapshots.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import {
    type StateStore,
    type StateKey,
    type StateValue,
    createStateStore,
    toBytes32,
} from '@vera/core';

// ============================================================================
// Serialization Helpers
// ============================================================================

function keyToString(key: StateKey): string {
    const idHex = Buffer.from(key.id).toString('hex');
    return `${key.namespace}:${idHex}`;
}

function stringToKey(str: string): StateKey {
    const colonIndex = str.indexOf(':');
    const namespace = str.slice(0, colonIndex);
    const idHex = str.slice(colonIndex + 1);
    const id = Buffer.from(idHex, 'hex');
    return { namespace, id: toBytes32(id) };
}

function serializeValue(value: StateValue): any {
    return {
        data: Buffer.from(value.data).toString('hex'),
        lastModified: value.lastModified.toString(),
        schema: {
            moduleId: Buffer.from(value.schema.moduleId).toString('hex'),
            schemaName: value.schema.schemaName,
            version: value.schema.version,
        },
    };
}

function deserializeValue(json: any): StateValue {
    return {
        data: new Uint8Array(Buffer.from(json.data, 'hex')),
        lastModified: BigInt(json.lastModified),
        schema: {
            moduleId: toBytes32(new Uint8Array(Buffer.from(json.schema.moduleId, 'hex'))),
            schemaName: json.schema.schemaName,
            version: json.schema.version,
        },
    };
}

// ============================================================================
// Snapshot Manager
// ============================================================================

export class SnapshotManager {
    /**
     * Saves the state store to a snapshot file
     */
    async save(state: StateStore, filePath: string): Promise<void> {
        const data: Record<string, any> = {
            version: state.version.toString(),
            entries: {},
        };

        for (const { key, value } of state.entries()) {
            data.entries[keyToString(key)] = serializeValue(value);
        }

        const json = JSON.stringify(data, null, 2);

        await fs.mkdir(path.dirname(filePath), { recursive: true });
        await fs.writeFile(filePath, json, 'utf-8');
    }

    /**
     * Loads a state store from a snapshot file
     */
    async load(filePath: string): Promise<StateStore> {
        try {
            const content = await fs.readFile(filePath, 'utf-8');
            const json = JSON.parse(content);

            const entries: { key: StateKey; value: StateValue }[] = [];

            for (const [keyStr, valJson] of Object.entries(json.entries)) {
                entries.push({
                    key: stringToKey(keyStr),
                    value: deserializeValue(valJson),
                });
            }

            const version = BigInt(json.version);
            return createStateStore(entries, version);
        } catch (error: any) {
            throw new Error(`Failed to load snapshot: ${error.message}`);
        }
    }
}
