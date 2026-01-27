import { deriveKeyPairFromSeed, type KeyPair } from '@vera/core';

export interface BenchItem {
    payload: Uint8Array;
    nonce: bigint;
    keyPair: KeyPair;
}

export function generateCorpus(count: number, seed: string = 'bench-seed'): BenchItem[] {
    const corpus: BenchItem[] = [];
    const kp = deriveKeyPairFromSeed(new Uint8Array(32).fill(1));

    for (let i = 0; i < count; i++) {
        const payload = new Uint8Array(100).fill(i % 255);
        const nonce = BigInt(i + 1);

        corpus.push({
            payload,
            nonce,
            keyPair: kp
        });
    }
    return corpus;
}
