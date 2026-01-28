import { type Bytes32, type PublicKey, type Address, type Bytes64 } from '@vera/core';

/**
 * A validator in the BFT consensus network
 */
export interface Validator {
    id: Address;
    publicKey: PublicKey;
    votingPower: bigint;
}

/**
 * A vote cast by a validator for a specific block and round
 */
export interface Vote {
    /** Target block hash */
    blockHash: Bytes32;
    /** Block height */
    height: bigint;
    /** View/Round number */
    round: bigint;
    /** Validator who cast the vote */
    author: Address;
    /** Ed25519 signature of the vote data */
    signature: Bytes64;
}

/**
 * Representation of the data that is signed in a vote
 */
export interface VoteData {
    blockHash: Bytes32;
    height: bigint;
    round: bigint;
    chainId: string;
}

/**
 * A Quorum Certificate (QC) proving that 2f+1 validators voted for a block
 */
export interface QuorumCertificate {
    /** Block hash finalized/certified */
    blockHash: Bytes32;
    /** Height of the block */
    height: bigint;
    /** Round in which the QC was formed */
    round: bigint;
    /** Map of validator address to their signature */
    signatures: Record<string, Bytes64>;
}

/**
 * A message sent by a validator to trigger a round transition (view change)
 */
export interface NewView {
    /** The round we want to move to */
    round: bigint;
    /** The highest QC known by this validator */
    highestQC: QuorumCertificate;
    /** validator who cast the vote */
    author: Address;
    /** Ed25519 signature of the NewView data */
    signature: Bytes64;
}

/**
 * Persistent state for a BFT node to ensure safety across restarts
 */
export interface BFTState {
    lastVotedRound: bigint;
    lastVotedHash: Bytes32;
    highestQC: QuorumCertificate;
}

/**
 * Finality status levels for a block according to the 3-chain rule
 */
export enum FinalityStatus {
    /** Unknown status */
    UNKNOWN = 0,
    /** Block received and locally verified */
    PENDING = 1,
    /** Block has a direct child with a QC (1-chain) */
    PRE_COMMIT = 2,
    /** Block has a grandchild with a QC (2nd chain) */
    COMMIT = 3,
    /** Block has a great-grandchild with a QC (3rd chain) -> Absolute Finality */
    FINALIZED = 4
}

/**
 * Configuration for the BFT Gadget
 */
export interface BFTConfig {
    /** List of active validators */
    validators: Validator[];
    /** Network/Chain identifier */
    chainId: string;
    /** Callback triggered when a block is finalized */
    onFinalized?: (hash: Bytes32, height: bigint) => void;
}
