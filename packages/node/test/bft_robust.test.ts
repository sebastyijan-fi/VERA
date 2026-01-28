import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { FullNode } from '../src/node.js';
import { generateKeyPair, bytesToHex, sha256, toBytes32 } from '@vera/core';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

describe('BFT Leader Rotation & Persistence', () => {
    let node1: FullNode;
    let node2: FullNode;
    let dataDir1: string;
    let dataDir2: string;

    const v1Keys = generateKeyPair(); // Likely "higher" ID
    const v2Keys = generateKeyPair(); // Likely "lower" ID

    const validators = [
        { id: bytesToHex(v1Keys.publicKey), publicKey: bytesToHex(v1Keys.publicKey), votingPower: 10 },
        { id: bytesToHex(v2Keys.publicKey), publicKey: bytesToHex(v2Keys.publicKey), votingPower: 10 }
    ].sort((a, b) => a.id.localeCompare(b.id));

    beforeEach(async () => {
        dataDir1 = path.join(os.tmpdir(), `vera-bft-1-${Math.random().toString(36).slice(2)}`);
        dataDir2 = path.join(os.tmpdir(), `vera-bft-2-${Math.random().toString(36).slice(2)}`);
        await fs.mkdir(dataDir1, { recursive: true });
        await fs.mkdir(dataDir2, { recursive: true });

        node1 = new FullNode({
            port: 5401,
            dataDir: dataDir1,
            networkId: 'vera-test',
            validators,
            secretKey: bytesToHex(v1Keys.privateKey),
            rpcEnabled: false
        });

        node2 = new FullNode({
            port: 5402,
            dataDir: dataDir2,
            networkId: 'vera-test',
            validators,
            secretKey: bytesToHex(v2Keys.privateKey),
            rpcEnabled: false
        });
    });

    afterEach(async () => {
        await node1.stop();
        await node2.stop();
        await fs.rm(dataDir1, { recursive: true, force: true });
        await fs.rm(dataDir2, { recursive: true, force: true });
    });

    it('should rotate leaders on timeout', async () => {
        // Set short timeout for testing
        (node1 as any).roundTimerTimeout = 2000;
        (node2 as any).roundTimerTimeout = 2000;

        // Mock the timeout handler to use the short value
        (node1 as any).resetRoundTimer = function () {
            if (this.roundTimer) clearTimeout(this.roundTimer);
            this.roundTimer = setTimeout(() => this.handleRoundTimeout(), 2000);
        };
        (node2 as any).resetRoundTimer = function () {
            if (this.roundTimer) clearTimeout(this.roundTimer);
            this.roundTimer = setTimeout(() => this.handleRoundTimeout(), 2000);
        };

        await node1.start();
        await node2.start();
        await node2.connect('127.0.0.1', 5401);

        const initialRound = node1.gadget.getCurrentRound();
        expect(initialRound).toBe(1n);

        // Wait for timeout (2s) + some margin
        await new Promise(r => setTimeout(r, 3500));

        const newRound1 = node1.gadget.getCurrentRound();
        const newRound2 = node2.gadget.getCurrentRound();

        expect(newRound1).toBeGreaterThan(1n);
        expect(newRound2).toBe(newRound1);

        console.log(`Successfully rotated to round ${newRound1}`);
    }, 15000);

    it('should persist BFT state across restarts', async () => {
        await node1.start();

        // Simulate some state change
        (node1 as any).currentBFTState.lastVotedRound = 5n;
        await (node1 as any).saveBFTState();

        await node1.stop();

        // Restart node
        const restartedNode = new FullNode({
            port: 5401,
            dataDir: dataDir1,
            networkId: 'vera-test',
            validators,
            secretKey: bytesToHex(v1Keys.privateKey),
            rpcEnabled: false
        });

        await restartedNode.start();
        expect(restartedNode.gadget.getCurrentRound()).toBe(5n);
        await restartedNode.stop();
    });
});
