import {
    type Bytes32,
    type Transaction,
    type StateQueryResult,
} from '@vera/core';

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
export class VeraClient {
    constructor(private readonly nodeUrl: string) { }

    /**
     * Submits a signed transaction to the node
     */
    async submitTransaction(tx: Transaction): Promise<Bytes32> {
        const response = await this.rpc('vera_submit', [tx]);
        return response.hash;
    }

    /**
     * Gets the current status of the node's sequencer
     */
    async getStatus(): Promise<SequencerStatus> {
        return this.rpc('vera_status', []);
    }

    /**
     * Gets a state entry with a Merkle proof
     */
    async getProof(namespace: string, id: string): Promise<StateQueryResult> {
        return this.rpc('vera_getProof', [{ namespace, id }]);
    }

    private async rpc(method: string, params: any[]): Promise<any> {
        const response = await fetch(this.nodeUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                jsonrpc: '2.0',
                id: Date.now(),
                method,
                params,
            }, (_key, value) =>
                typeof value === 'bigint' ? value.toString() :
                    value instanceof Uint8Array ? this.bytesToHex(value) :
                        value
            ),
        });

        if (!response.ok) {
            throw new Error(`RPC error: ${response.statusText}`);
        }

        const payload = await response.json();
        if (payload.error) {
            throw new Error(`RPC error: ${payload.error}`);
        }

        return payload.result;
    }

    private bytesToHex(bytes: Uint8Array): string {
        return Array.from(bytes)
            .map(b => b.toString(16).padStart(2, '0'))
            .join('');
    }
}
