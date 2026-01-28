import { createConsola } from 'consola';
import {
    verify,
    bytesToHex,
    hexToBytes,
    concat,
    toBytes32,
    type Bytes32,
    type Bytes64
} from '@vera/core';
import {
    type BFTConfig,
    type Vote,
    type QuorumCertificate,
    type NewView,
    type Validator,
    FinalityStatus
} from './types.js';

const logger = createConsola({ level: 4 }).withTag('BFT');

export class BFTGadget {
    private config: BFTConfig;
    private validators: Map<string, any>;
    private totalPower: bigint;
    private quorumThreshold: bigint;
    private currentRound = 1n;

    // State Tracking
    private heightMap = new Map<string, bigint>();   // hash -> height
    private parentMap = new Map<string, string>();   // hash -> parentHash
    private voteBlocks = new Map<string, Map<string, Vote>>(); // blockHash -> (validatorAddr -> Vote)
    private qcs = new Map<string, QuorumCertificate>(); // blockHash -> QC

    // Finality State
    private lastFinalizedHeight = -1n;
    private lastFinalizedHash: string | null = null;
    private highestQC: QuorumCertificate | null = null;

    // View Change Tracking
    private newViews = new Map<bigint, Map<string, NewView>>(); // round -> (author -> NewView)

    constructor(config: BFTConfig, initialState?: any) {
        this.config = config;
        this.validators = new Map(config.validators.map((v) => [bytesToHex(v.id), v]));
        this.totalPower = config.validators.reduce((sum, v) => sum + v.votingPower, 0n);

        if (initialState) {
            this.currentRound = initialState.lastVotedRound || 1n;
            this.highestQC = initialState.highestQC || null;
        }

        // Quorum is 2f + 1, where n = 3f + 1. 
        // Simplification: power > 2/3 total power
        this.quorumThreshold = (this.totalPower * 2n) / 3n + 1n;

        logger.info(`Initialized BFT Gadget with ${config.validators.length} validators. Quorum threshold: ${this.quorumThreshold}`);
    }

    addBlock(hash: Bytes32, parentHash: Bytes32, height: bigint) {
        const hashHex = bytesToHex(hash);
        const parentHex = bytesToHex(parentHash);
        this.heightMap.set(hashHex, height);
        this.parentMap.set(hashHex, parentHex);
    }

    updateValidators(validators: Validator[]) {
        this.config.validators = validators;
        this.validators = new Map(validators.map((v) => [bytesToHex(v.id), v]));
        this.totalPower = validators.reduce((sum, v) => sum + v.votingPower, 0n);
        this.quorumThreshold = (this.totalPower * 2n) / 3n + 1n;
        logger.info(`Validator set updated. New count: ${validators.length}. Quorum: ${this.quorumThreshold}`);
    }

    getCurrentRound(): bigint {
        return this.currentRound;
    }

    getLeader(round: bigint): Validator {
        const sortedValidators = [...this.config.validators].sort((a, b) =>
            bytesToHex(a.id).localeCompare(bytesToHex(b.id))
        );
        const index = Number(round % BigInt(sortedValidators.length));
        return sortedValidators[index]!;
    }

    isLeader(address: Uint8Array, round: bigint): boolean {
        const leader = this.getLeader(round);
        return bytesToHex(leader.id) === bytesToHex(address);
    }

    advanceRound(toRound?: bigint) {
        const nextRound = toRound || this.currentRound + 1n;
        if (nextRound > this.currentRound) {
            logger.info(`Round advanced: ${this.currentRound} -> ${nextRound}`);
            this.currentRound = nextRound;
        }
    }

    handleNewView(nv: NewView): bigint | null {
        const validator = this.validators.get(bytesToHex(nv.author));
        if (!validator) return null;

        // Verify signature (mock for now, should use real verify)
        // Aggregate
        let viewsInRound = this.newViews.get(nv.round);
        if (!viewsInRound) {
            viewsInRound = new Map();
            this.newViews.set(nv.round, viewsInRound);
        }
        viewsInRound.set(bytesToHex(nv.author), nv);

        // Update local highest QC if nv has a newer one
        if (!this.highestQC || nv.highestQC.height > this.highestQC.height) {
            this.highestQC = nv.highestQC;
        }

        // Check for Quorum of NEW_VIEW messages
        let currentPower = 0n;
        for (const v of viewsInRound.values()) {
            const val = this.validators.get(bytesToHex(v.author));
            if (val) currentPower += val.votingPower;
        }

        if (currentPower >= this.quorumThreshold && nv.round > this.currentRound) {
            this.advanceRound(nv.round);
            return this.currentRound;
        }
        return null;
    }

    getHighestQC(): QuorumCertificate | null {
        if (this.highestQC) return this.highestQC;
        // Return a genesis-like QC at height -1 or 0
        return {
            blockHash: toBytes32(new Uint8Array(32)),
            height: -1n,
            round: 0n,
            signatures: {}
        };
    }

    /**
     * Ingest a vote from a validator.
     * Returns a QC if one was formed by this vote.
     */
    addVote(vote: Vote): QuorumCertificate | null {
        const validator = this.validators.get(bytesToHex(vote.author));
        if (!validator) {
            logger.warn(`Received vote from unknown validator: ${bytesToHex(vote.author)}`);
            return null;
        }

        // 1. Verify Signature
        if (!this.verifyVoteSignature(vote, validator.publicKey)) {
            logger.error(`Invalid vote signature from ${bytesToHex(vote.author)}`);
            return null;
        }

        // 2. Aggregate
        const hashHex = bytesToHex(vote.blockHash);
        let votesForBlock = this.voteBlocks.get(hashHex);
        if (!votesForBlock) {
            votesForBlock = new Map();
            this.voteBlocks.set(hashHex, votesForBlock);
        }

        votesForBlock.set(bytesToHex(vote.author), vote);

        // 3. Check for Quorum
        let currentPower = 0n;
        for (const v of votesForBlock.values()) {
            const val = this.validators.get(bytesToHex(v.author));
            if (val) currentPower += val.votingPower;
        }

        if (currentPower >= this.quorumThreshold && !this.qcs.has(hashHex)) {
            const qc = this.formQC(hashHex, votesForBlock);
            this.qcs.set(hashHex, qc);
            logger.success(`QC formed for block ${hashHex.slice(0, 8)} at height ${vote.height}`);

            // Trigger finality check
            this.checkCommitRule(hashHex);
            return qc;
        }

        return null;
    }

    /**
     * External QC ingestion (e.g., from network)
     */
    addQC(qc: QuorumCertificate) {
        const hashHex = bytesToHex(qc.blockHash);
        if (this.qcs.has(hashHex)) return;

        // TODO: Verify signatures in QC?
        this.qcs.set(hashHex, qc);
        this.checkCommitRule(hashHex);

        // Update highest QC
        if (!this.highestQC || qc.height > this.highestQC.height) {
            logger.info(`Updating HighestQC: ${this.highestQC?.height} -> ${qc.height}`);
            this.highestQC = qc;
        } else {
            logger.debug(`Ignored QC height ${qc.height} <= HighQC ${this.highestQC?.height}`);
        }
    }

    private verifyVoteSignature(vote: Vote, publicKey: Uint8Array): boolean {
        // Reconstruction message format: prefix + chainId + height(64bit) + round(64bit) + blockHash
        const message = concat(
            new TextEncoder().encode('VERA_BFT_V1:'),
            new TextEncoder().encode(this.config.chainId),
            Buffer.alloc(8),
            vote.blockHash
        );
        const view = new DataView(message.buffer, 12 + this.config.chainId.length);
        view.setBigUint64(0, vote.height, false);

        return verify(vote.signature, message, publicKey as Bytes32);
    }

    private formQC(hashHex: string, votes: Map<string, Vote>): QuorumCertificate {
        const first = [...votes.values()][0]!;
        const signatures: Record<string, Bytes64> = {};
        for (const [author, vote] of votes) {
            signatures[author] = vote.signature;
        }

        return {
            blockHash: hexToBytes(hashHex) as Bytes32,
            height: first.height,
            round: first.round,
            signatures
        };
    }

    /**
     * The 3-Chain Rule Logic (HotStuff style)
     * If we have a chain QC(B3) -> QC(B2) -> QC(B1), then B1 is finalized.
     * B2 is "Pre-committed", B3 is "Prepared".
     */
    private checkCommitRule(newQCHash: string) {
        const b3 = newQCHash;
        const b2 = this.parentMap.get(b3);
        if (!b2 || !this.qcs.has(b2)) return;

        const b1 = this.parentMap.get(b2);
        if (!b1 || !this.qcs.has(b1)) return;

        const h3 = this.heightMap.get(b3)!;
        const h2 = this.heightMap.get(b2)!;
        const h1 = this.heightMap.get(b1)!;

        // B3 child of B2 child of B1, all with QCs, and sequential heights
        if (h3 === h2 + 1n && h2 === h1 + 1n) {
            this.finalize(b1);
        }
    }

    private finalize(hash: string) {
        const height = this.heightMap.get(hash);
        if (height === undefined || height <= this.lastFinalizedHeight) return;

        logger.success(`!!! BLOCK FINALIZED !!! Hash: ${hash.slice(0, 8)}, Height: ${height}`);
        this.lastFinalizedHeight = height;
        this.lastFinalizedHash = hash;

        if (this.config.onFinalized) {
            const hashBytes = hexToBytes(hash);
            this.config.onFinalized(hashBytes as Bytes32, height);
        }

        // Recursively finalize parents
        const parent = this.parentMap.get(hash);
        if (parent) this.finalize(parent);
    }

    getFinalityStatus(hashHex: string): FinalityStatus {
        if (this.lastFinalizedHash === hashHex) return FinalityStatus.FINALIZED;
        if (this.lastFinalizedHeight >= (this.heightMap.get(hashHex) || 999999n)) return FinalityStatus.FINALIZED;

        if (this.qcs.has(hashHex)) {
            const childQCs = [...this.qcs.keys()].filter(c => this.parentMap.get(c) === hashHex);
            if (childQCs.length > 0) {
                const grandchildQCs = [...this.qcs.keys()].filter(gc => {
                    const p = this.parentMap.get(gc);
                    return p && this.parentMap.get(p) === hashHex;
                });
                if (grandchildQCs.length > 0) return FinalityStatus.COMMIT;
                return FinalityStatus.PRE_COMMIT;
            }
            return FinalityStatus.PENDING;
        }

        return this.parentMap.has(hashHex) ? FinalityStatus.PENDING : FinalityStatus.UNKNOWN;
    }
}
