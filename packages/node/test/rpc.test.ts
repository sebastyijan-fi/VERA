import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { FullNode } from '../src/node.js';
import { generateKeyPair, bytesToHex } from '@vera/core';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

describe('RPC End-to-End', () => {
    let node: FullNode;
    let dataDir: string;
    const rpcPort = 18545; // Use non-standard port for tests

    const v1Keys = generateKeyPair();

    beforeEach(async () => {
        dataDir = path.join(os.tmpdir(), `vera-rpc-test-${Math.random().toString(36).slice(2)}`);
        await fs.mkdir(dataDir, { recursive: true });

        node = new FullNode({
            port: 15001,
            dataDir,
            networkId: 'vera-test',
            validators: [
                { id: bytesToHex(v1Keys.publicKey), publicKey: bytesToHex(v1Keys.publicKey), votingPower: 10 }
            ],
            secretKey: bytesToHex(v1Keys.privateKey),
            rpcPort,
            rpcEnabled: true
        });
    });

    afterEach(async () => {
        await node.stop();
        await fs.rm(dataDir, { recursive: true, force: true });
    });

    it('should return block number via RPC', async () => {
        await node.start();

        // Wait for RPC to be ready
        await new Promise(r => setTimeout(r, 500));

        const response = await fetch(`http://localhost:${rpcPort}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                jsonrpc: '2.0',
                id: 1,
                method: 'vera_blockNumber'
            })
        });

        const result = await response.json();
        expect(result.jsonrpc).toBe('2.0');
        expect(result.id).toBe(1);
        expect(result.result).toBe('0x0'); // Genesis height
    });

    it('should list all methods via rpc_methods', async () => {
        await node.start();
        await new Promise(r => setTimeout(r, 500));

        const response = await fetch(`http://localhost:${rpcPort}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                jsonrpc: '2.0',
                id: 1,
                method: 'rpc_methods'
            })
        });

        const result = await response.json();
        expect(result.result.methods).toContain('vera_blockNumber');
        expect(result.result.methods).toContain('vera_sendRawTransaction');
        expect(result.result.methods).toContain('net_peerCount');
        expect(result.result.methods.length).toBeGreaterThan(20);
    });

    it('should handle batch requests', async () => {
        await node.start();
        await new Promise(r => setTimeout(r, 500));

        const response = await fetch(`http://localhost:${rpcPort}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify([
                { jsonrpc: '2.0', id: 1, method: 'vera_blockNumber' },
                { jsonrpc: '2.0', id: 2, method: 'net_peerCount' }
            ])
        });

        const result = await response.json();
        expect(Array.isArray(result)).toBe(true);
        expect(result.length).toBe(2);
        expect(result[0].id).toBe(1);
        expect(result[1].id).toBe(2);
    });

    it('should return error for unknown method', async () => {
        await node.start();
        await new Promise(r => setTimeout(r, 500));

        const response = await fetch(`http://localhost:${rpcPort}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                jsonrpc: '2.0',
                id: 1,
                method: 'unknown_method'
            })
        });

        const result = await response.json();
        expect(result.error).toBeDefined();
        expect(result.error.code).toBe(-32601); // Method not found
    });
}, 30000);
