import { describe, it, expect, beforeEach } from 'vitest';
import { BFTGadget } from '../src/gadget.js';
import {
    generateKeyPair,
    sign,
    bytesToHex,
    concat,
    type Bytes32,
    type Address,
    type Bytes64
} from '@vera/core';
import { FinalityStatus } from '../src/types.js';

describe('BFTGadget', () => {
    let gadget: BFTGadget;
    let validators: any[];
    const chainId = 'vera-test-1';

    beforeEach(() => {
        validators = [];
        for (let i = 0; i < 4; i++) {
            const keys = generateKeyPair();
            validators.push({
                id: bytesToHex(keys.publicKey).slice(0, 42) as Address,
                publicKey: keys.publicKey,
                privateKey: keys.privateKey,
                votingPower: 10n
            });
        }

        gadget = new BFTGadget({
            validators: validators.map(v => ({ id: v.id, publicKey: v.publicKey, votingPower: v.votingPower })),
            chainId,
        });
    });

    function mockBlockHash(i: number): Bytes32 {
        const hash = new Uint8Array(32);
        hash[31] = i;
        return hash as Bytes32;
    }

    function createVote(val: any, blockHash: Bytes32, height: bigint): any {
        const message = concat(
            new TextEncoder().encode('VERA_BFT_V1:'),
            new TextEncoder().encode(chainId),
            Buffer.alloc(8),
            blockHash
        );
        const view = new DataView(message.buffer, 12 + chainId.length);
        view.setBigUint64(0, height, false);

        const signature = sign(message, val.privateKey);

        return {
            blockHash,
            height,
            round: 1n,
            author: val.id,
            signature
        };
    }

    it('should finalize blocks when a 3-chain is formed', () => {
        const b0 = mockBlockHash(0);
        const b1 = mockBlockHash(1);
        const b2 = mockBlockHash(2);
        const b3 = mockBlockHash(3);

        gadget.addBlock(b1, b0, 1n);
        gadget.addBlock(b2, b1, 2n);
        gadget.addBlock(b3, b2, 3n);

        // 1. QC for B1 (height 1)
        validators.slice(0, 3).forEach(v => gadget.addVote(createVote(v, b1, 1n)));
        expect(gadget.getFinalityStatus(bytesToHex(b1))).toBe(FinalityStatus.PENDING); // Prep

        // 2. QC for B2 (height 2)
        validators.slice(0, 3).forEach(v => gadget.addVote(createVote(v, b2, 2n)));
        expect(gadget.getFinalityStatus(bytesToHex(b1))).toBe(FinalityStatus.PRE_COMMIT);

        // 3. QC for B3 (height 3) -> FINALIZE B1
        validators.slice(0, 3).forEach(v => gadget.addVote(createVote(v, b3, 3n)));
        expect(gadget.getFinalityStatus(bytesToHex(b1))).toBe(FinalityStatus.FINALIZED);
        expect(gadget.getFinalityStatus(bytesToHex(b2))).toBe(FinalityStatus.PRE_COMMIT);
        expect(gadget.getFinalityStatus(bytesToHex(b3))).toBe(FinalityStatus.PENDING);
    });

    it('should not finalize if the chain is broken', () => {
        const b0 = mockBlockHash(0);
        const b1 = mockBlockHash(1);
        const b2 = mockBlockHash(2);
        const b3_fork = mockBlockHash(33);

        gadget.addBlock(b1, b0, 1n);
        gadget.addBlock(b2, b1, 2n);
        gadget.addBlock(b3_fork, b0, 3n); // Not child of b2

        validators.slice(0, 3).forEach(v => gadget.addVote(createVote(v, b1, 1n)));
        validators.slice(0, 3).forEach(v => gadget.addVote(createVote(v, b2, 2n)));
        validators.slice(0, 3).forEach(v => gadget.addVote(createVote(v, b3_fork, 3n)));

        expect(gadget.getFinalityStatus(bytesToHex(b1))).not.toBe(FinalityStatus.FINALIZED);
    });
});
