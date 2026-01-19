import { describe, it, expect } from 'vitest';
import { TransactionBuilder } from '../src/builder.js';
import { VeraClient } from '../src/client.js';
import { hexToBytes32 } from '@vera/core';

describe('SDK Integration', () => {
    const client = new VeraClient('http://localhost:8545');

    it('should connect to node and submit transaction', async () => {
        console.log('1. Checking status...');
        const status = await client.getStatus();
        console.log('Status:', JSON.stringify(status, (_k, v) => typeof v === 'bigint' ? v.toString() : v, 2));
        expect(status.sequencer.id).toBe('vera-local-1');

        console.log('\n2. Building transaction...');
        const moduleId = hexToBytes32('01'.repeat(32));
        const privKey = hexToBytes32('02'.repeat(32));

        const builder = new TransactionBuilder()
            .type(moduleId, 'test-call')
            .nonce(BigInt(status.sequencedCount) + 1n)
            .payload(new Uint8Array([0xde, 0xad, 0xbe, 0xef]))
            .sign(privKey);

        const tx = builder.build();
        console.log('Transaction ready.');

        console.log('\n3. Submitting transaction...');
        const hash = await client.submitTransaction(tx);
        console.log('✓ Submitted! Hash:', hash);
        expect(hash).toHaveLength(64); // Hex string length

        console.log('\n4. Checking status again...');
        const newStatus = await client.getStatus();
        console.log('New Status:', JSON.stringify(newStatus, (_k, v) => typeof v === 'bigint' ? v.toString() : v, 2));
        expect(newStatus.pendingCount).toBeGreaterThanOrEqual(status.pendingCount);
    });
});
