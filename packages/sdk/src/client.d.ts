import { type Bytes32, type Transaction, type StateQueryResult } from '@vera/core';
export interface SequencerStatus {
    sequencer: {
        id: string;
        address: string;
        isActive: boolean;
        lastSequence: string;
        epoch: string;
    };
    pendingCount: number;
    sequencedCount: number;
    finalizedCount: number;
    state?: {
        root: string;
        version: string;
        size: number;
    };
}
/**
 * Client for interacting with a VERA node
 */
export declare class VeraClient {
    private readonly nodeUrl;
    private readonly fetch;
    constructor(nodeUrl: string, fetchImpl?: typeof globalThis.fetch);
    /**
     * Submits a signed transaction to the node
     */
    submitTransaction(tx: Transaction): Promise<Bytes32>;
    /**
     * Gets the current status of the node's sequencer
     */
    getStatus(): Promise<SequencerStatus>;
    /**
     * Gets a state entry with a Merkle proof
     */
    getProof(namespace: string, id: string): Promise<StateQueryResult>;
    private rpc;
    private bytesToHex;
}
//# sourceMappingURL=client.d.ts.map