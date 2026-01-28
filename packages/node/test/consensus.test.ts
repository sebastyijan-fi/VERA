import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { FullNode } from '../src/node.js';
import { generateKeyPair, bytesToHex, sha256, toBytes32 } from '@vera/core';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

describe('BFT Consensus Integration', () => {
    let node1: FullNode;
    let node2: FullNode;
    let dataDir1: string;
    let dataDir2: string;

    const v1Keys = generateKeyPair();
    const v2Keys = generateKeyPair();

    const validators = [
        { id: bytesToHex(v1Keys.publicKey), publicKey: bytesToHex(v1Keys.publicKey), votingPower: 10 },
        { id: bytesToHex(v2Keys.publicKey), publicKey: bytesToHex(v2Keys.publicKey), votingPower: 10 }
    ];

    beforeEach(async () => {
        dataDir1 = path.join(os.tmpdir(), `vera-test-1-${Math.random().toString(36).slice(2)}`);
        dataDir2 = path.join(os.tmpdir(), `vera-test-2-${Math.random().toString(36).slice(2)}`);
        await fs.mkdir(dataDir1, { recursive: true });
        await fs.mkdir(dataDir2, { recursive: true });

        node1 = new FullNode({
            port: 5301,
            dataDir: dataDir1,
            networkId: 'vera-test',
            validators,
            secretKey: bytesToHex(v1Keys.privateKey),
            rpcEnabled: false
        });

        node2 = new FullNode({
            port: 5302,
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

    it('should reach finality across nodes', async () => {
        await node1.start();
        await node2.start();

        await node2.connect('127.0.0.1', 5301);

        const mockBlocks = [];
        let lastHash = bytesToHex(toBytes32(new Uint8Array(32)));

        for (let i = 0n; i <= 6n; i++) {
            const header = [
                1,                  // version
                i,                  // height
                lastHash,           // prevHash
                '0x00',             // stateRoot
                Math.floor(Date.now() / 1000),
                0n
            ];
            mockBlocks.push([header, []]);

            // Recompute lastHash as FullNode does: sha256(`block:${i}`)
            lastHash = bytesToHex(sha256(new TextEncoder().encode(`block:${i}`)));
        }

        const finalizedHeights: bigint[] = [];
        node2.on('finalized', ({ height }) => {
            finalizedHeights.push(height);
        });

        await (node1 as any).handleSyncedBlocks(mockBlocks);
        await (node2 as any).handleSyncedBlocks(mockBlocks);

        for (let i = 0; i < 50; i++) {
            if (finalizedHeights.includes(0n)) break;
            await new Promise(r => setTimeout(r, 100));
        }

        expect(finalizedHeights).toContain(0n);
        expect(finalizedHeights).toContain(1n);
        expect(finalizedHeights).toContain(2n);
    }, 15000);
});
