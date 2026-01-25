import { type MerkleProof, type Bytes32 } from '@vera/core';
/**
 * VERA Proof Verifier
 *
 * Provides utilities for verifying state proofs off-chain.
 */
export declare class VeraVerifier {
    /**
     * Verifies a Merkle proof against an expected state root.
     *
     * @param proof - The Merkle proof to verify
     * @param expectedRoot - The trusted state root
     * @returns true if the proof is valid, false otherwise
     */
    static verifyProof(proof: MerkleProof, expectedRoot: Bytes32): boolean;
}
//# sourceMappingURL=verifier.d.ts.map