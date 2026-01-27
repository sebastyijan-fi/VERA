/**
 * VERA Node Configuration
 */

import fs from 'node:fs';
import TOML from '@iarna/toml';
import { consola } from 'consola';

export interface NodeConfig {
    port: number;
    dataDir: string;
    peers: string[];
    networkId: string;
    genesisHash: string;
}

export const DEFAULT_CONFIG: NodeConfig = {
    port: 5001,
    dataDir: './data',
    peers: [],
    networkId: 'vera-mainnet',
    genesisHash: '0x0000000000000000000000000000000000000000000000000000000000000000'
};

/**
 * Loads configuration from file and environment variables
 */
export function loadConfig(configPath?: string): NodeConfig {
    let fileConfig: any = {};

    if (configPath && fs.existsSync(configPath)) {
        try {
            const content = fs.readFileSync(configPath, 'utf-8');
            fileConfig = TOML.parse(content);
            consola.info(`Loaded configuration from ${configPath}`);
        } catch (error) {
            consola.error(`Failed to parse config file: ${error}`);
        }
    }

    return {
        port: Number(process.env['VERA_PORT'] || fileConfig.port || DEFAULT_CONFIG.port),
        dataDir: process.env['VERA_DATA_DIR'] || fileConfig.dataDir || DEFAULT_CONFIG.dataDir,
        peers: fileConfig.peers || DEFAULT_CONFIG.peers,
        networkId: process.env['VERA_NETWORK_ID'] || fileConfig.networkId || DEFAULT_CONFIG.networkId,
        genesisHash: process.env['VERA_GENESIS_HASH'] || fileConfig.genesisHash || DEFAULT_CONFIG.genesisHash
    };
}
