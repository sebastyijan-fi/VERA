import { describe, it, expect, vi } from 'vitest';
import { TransactionBuilder } from '../src/builder.js';
import { VeraClient } from '../src/client.js';
import { hexToBytes32 } from '@vera/core';

describe('SDK Integration', () => {
    // Mock Fetch
    const mockFetch = vi.fn();
    const client = new VeraClient('http://localhost:8545', mockFetch as any);

    it('should connect to node and submit transaction', async () => {
        // Mock getStatus response
        mockFetch.mockResolvedValueOnce({
            ok: true,
            json: async () => ({
                result: {
                    sequencer: { id: 'vera-mock-1', isActive: true },
                    pendingCount: 0,
                    sequencedCount: 10,
                    finalizedCount: 5,
                    state: { root: '0x123', version: '1', size: 100 }
                }
            })
        });

        console.log('1. Checking status...');
        const status = await client.getStatus();
        expect(status.sequencer.id).toBe('vera-mock-1');

        // Mock submitTransaction response
        mockFetch.mockResolvedValueOnce({
            ok: true,
            json: async () => ({
                result: { hash: '0x' + 'a'.repeat(64) }
            })
        });

        console.log('\n2. Building transaction...');
        const moduleId = hexToBytes32('01'.repeat(32));
        const privKey = hexToBytes32('02'.repeat(32));

        const builder = new TransactionBuilder()
            .type(moduleId, 'test-call')
            .nonce(BigInt(status.sequencedCount) + 1n)
            .payload(new Uint8Array([0xde, 0xad, 0xbe, 0xef]))
            .sign(privKey);

        const tx = builder.build();

        console.log('\n3. Submitting transaction...');
        const hash = await client.submitTransaction(tx);
        console.log('✓ Submitted! Hash:', hash);
        expect(hash).toEqual('0x' + 'a'.repeat(64));

        // Mock getStatus again
        mockFetch.mockResolvedValueOnce({
            ok: true,
            json: async () => ({
                result: {
                    sequencer: { id: 'vera-mock-1', isActive: true },
                    pendingCount: 1, // Increased
                    sequencedCount: 10,
                    finalizedCount: 5
                }
            })
        });

        console.log('\n4. Checking status again...');
        const newStatus = await client.getStatus();
        expect(newStatus.pendingCount).toBeGreaterThanOrEqual(status.pendingCount);
    });
});
