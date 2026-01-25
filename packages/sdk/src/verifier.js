import { bytesEqual, sha256, } from '@vera/core';
/**
 * VERA Proof Verifier
 *
 * Provides utilities for verifying state proofs off-chain.
 */
export class VeraVerifier {
    /**
     * Verifies a Merkle proof against an expected state root.
     *
     * @param proof - The Merkle proof to verify
     * @param expectedRoot - The trusted state root
     * @returns true if the proof is valid, false otherwise
     */
    static verifyProof(proof, expectedRoot) {
        // 1. Verify the starting root matches
        if (!bytesEqual(proof.root, expectedRoot)) {
            return false;
        }
        // 2. Compute the leaf hash
        // If value is null, this is an exclusion proof.
        // If value is present, it's an inclusion proof.
        let currentHash;
        if (proof.value === null) {
            // Non-membership leaf
            currentHash = sha256(new Uint8Array([0, ...proof.key]));
        }
        else {
            // Membership leaf: sha256(0x01 || key || value)
            const combined = new Uint8Array(1 + proof.key.length + proof.value.length);
            combined[0] = 0x01;
            combined.set(proof.key, 1);
            combined.set(proof.value, 1 + proof.key.length);
            currentHash = sha256(combined);
        }
        // 3. Iteratively hash with siblings to reconstruct the root
        for (const sibling of proof.siblings) {
            const combined = new Uint8Array(32 + 32);
            if (sibling.position === 'left') {
                combined.set(sibling.hash, 0);
                combined.set(currentHash, 32);
            }
            else {
                combined.set(currentHash, 0);
                combined.set(sibling.hash, 32);
            }
            currentHash = sha256(combined);
        }
        // 4. Check if reconstructed root matches the expected root
        return bytesEqual(currentHash, expectedRoot);
    }
}
//# sourceMappingURL=verifier.js.map