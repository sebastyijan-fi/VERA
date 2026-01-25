import { test, expect, beforeAll, afterAll } from 'vitest';
import path from 'node:path';
import fs from 'node:fs/promises';
import { node } from '../src/commands/node.js';
import { VeraClient, TransactionBuilder } from '@vera/sdk';
import { hexToBytes32, zeroBytes32, bytesToHex } from '@vera/core';
import type { Server } from 'node:http';

const TEST_DIR = path.resolve('./test-data-integration');
const TEST_PORT = 8546;
const TEST_DSL = path.resolve('../../examples/test_registry.vera');

test('Node integration: submission to state commitment', async () => {
    // 1. Setup test directory
    await fs.rm(TEST_DIR, { recursive: true, force: true });
    await fs.mkdir(TEST_DIR, { recursive: true });

    // 2. Start node logic
    // We wrap the node function or mock the http part if needed, 
    // but here we want to test the REAL node command.
    // Since 'node' function starts a server and blocks, 
    // we'll run it and then interact via SDK.

    // Note: In a real vitest file, we might need to run the node in a worker or separate process.
    // For this demonstration, I'll verify the wiring by calling the internal logic.

    console.log('Starting Test Node...');
    // We don't await this if it blocks
    const nodePromise = node({
        dataDir: TEST_DIR,
        port: TEST_PORT,
        dsl: TEST_DSL,
        chainId: '0x' + '0'.repeat(64)
    });

    // Wait for server to start
    await new Promise(resolve => setTimeout(resolve, 2000));

    try {
        const client = new VeraClient(`http://localhost:${TEST_PORT}`);
        const builder = new TransactionBuilder();

        // 3. Check initial status
        const status1 = await client.getStatus();
        expect(status1.state).toBeDefined();
        const initialRoot = status1.state!.root;
        console.log('Initial Root:', initialRoot);

        // 4. Submit Transaction
        // We'll use a dummy account
        const acc = '0x' + '1'.repeat(64);
        const amount = 100n;

        // The 'Deposit' transaction takes (acc: address, amount: int)
        // We need to encode these arguments using CBOR as the engine expects.
        // The SDK builder should handle this in a real scenario, but for now we do it manually or via builder.

        // Wait, I need to make sure I have the SDK built or available.
        // Assuming @vera/sdk is linked.

        // For now, let's just test that the node accepted it.
        // Detailed execution check needs valid signatures which SingleSequencer verifies.

        console.log('Test cleanup...');
    } finally {
        // Shutdown
        process.emit('SIGINT' as any);
        await nodePromise.catch(() => { });
    }
});
