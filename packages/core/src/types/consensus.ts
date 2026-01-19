/**
 * VERA Consensus Abstractions
 */

import type { Bytes } from './primitives.js';
import type { Block } from './block.js';

/**
 * Interface for consensus engines (e.g., HotStuff, Tendermint, RAFT)
 */
export interface ConsensusEngine {
    /**
     * Propose a payload for the next block
     */
    propose(payload: Bytes): Promise<void>;

    /**
     * Subscribe to finalized blocks
     */
    onFinalize(callback: (block: Block) => Promise<void>): void;

    /**
     * Start the consensus engine
     */
    start(): Promise<void>;

    /**
     * Stop the consensus engine
     */
    stop(): Promise<void>;
}
