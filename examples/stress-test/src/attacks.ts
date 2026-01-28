import {
    generateKeyPair,
    signTransaction,
    sha256WithDomain,
    HashDomains,
    encodeCanonicalTransaction,
    zeroBytes32
} from '@vera/core';
import type { RawTransaction } from '@vera/ordering';

export class AttackEngine {
    private keys = generateKeyPair();

    /**
     * Creates a valid transaction for baseline load
     */
    createValidTx(nonce: bigint, payloadSize: number = 32): RawTransaction {
        const payload = new Uint8Array(payloadSize).fill(0xAA);
        const txData = {
            version: 1,
            chainId: zeroBytes32(),
            type: { moduleId: zeroBytes32(), transactionName: 'test' },
            nonce,
            payload,
        };
        const canonical = encodeCanonicalTransaction(txData);
        const hash = sha256WithDomain(HashDomains.TRANSACTION, new Uint8Array(canonical));
        const sig = signTransaction(hash, this.keys.privateKey);

        return {
            hash,
            chainId: txData.chainId,
            sender: this.keys.publicKey,
            function: 'test',
            args: payload,
            nonce,
            signature: sig.signature,
            canonicalTxBytes: new Uint8Array(canonical),
            submittedAt: BigInt(Date.now())
        };
    }

    /**
     * Attack: Signature Forgery
     */
    createForgedSignatureTx(nonce: bigint): RawTransaction {
        const tx = this.createValidTx(nonce);
        tx.signature = new Uint8Array(64).fill(0xEE); // Junk signature
        return tx;
    }

    /**
     * Attack: Byzantine Flood (Invalid Hash)
     */
    createInvalidHashTx(nonce: bigint): RawTransaction {
        const tx = this.createValidTx(nonce);
        tx.hash = new Uint8Array(32).fill(0xBB) as any; // Cast for branded type
        return tx;
    }

    /**
     * Attack: Replay Attack
     */
    createReplayTx(originalTx: RawTransaction): RawTransaction {
        return { ...originalTx };
    }

    /**
     * Attack: Nonce Manipulation (Gap)
     */
    createHighNonceTx(nonce: bigint): RawTransaction {
        return this.createValidTx(nonce + 1000n);
    }

    /**
     * Attack: Memory Bomb
     */
    createMemoryBombTx(nonce: bigint): RawTransaction {
        return this.createValidTx(nonce, 1024 * 64); // 64KB payload
    }

    /**
     * Attack: Malformed Payload (Junk CBOR)
     */
    createMalformedPayloadTx(nonce: bigint): RawTransaction {
        const tx = this.createValidTx(nonce);
        tx.canonicalTxBytes = new Uint8Array([0xFF, 0xFE, 0xFD]); // Invalid CBOR
        return tx;
    }
}
