import { describe, it, expect } from 'vitest';
import { TransactionBuilder } from '../src/builder.js';
import { hexToBytes32 } from '@vera/core';

describe('TransactionBuilder', () => {
    const mockModuleId = hexToBytes32('01'.repeat(32));
    const mockPrivKey = hexToBytes32('02'.repeat(32));

    it('should build a simple transaction', () => {
        const builder = new TransactionBuilder()
            .chainId(hexToBytes32('00'.repeat(32)))
            .type(mockModuleId, 'transfer')
            .nonce(1n)
            .payload(new Uint8Array([1, 2, 3]))
            .sign(mockPrivKey);

        const tx = builder.build();

        expect(tx.version).toBe(1);
        expect(tx.type.transactionName).toBe('transfer');
        expect(tx.nonce).toBe(1n);
        expect(tx.payload).toEqual(new Uint8Array([1, 2, 3]));
        expect(tx.signatures).toHaveLength(1);
    });

    it('should throw if type not set', () => {
        const builder = new TransactionBuilder();
        expect(() => builder.build()).toThrow('Transaction type not set');
    });

    it('should throw if no signatures', () => {
        const builder = new TransactionBuilder()
            .type(mockModuleId, 'test');
        expect(() => builder.build()).toThrow('No signatures added');
    });

    it('should compute consistent IDs', () => {
        const b1 = new TransactionBuilder()
            .type(mockModuleId, 'test')
            .nonce(1n)
            .payload(new Uint8Array([1]));

        const b2 = new TransactionBuilder()
            .type(mockModuleId, 'test')
            .nonce(1n)
            .payload(new Uint8Array([1]));

        expect(b1.buildId()).toEqual(b2.buildId());
    });
});
