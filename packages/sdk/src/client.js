/**
 * Client for interacting with a VERA node
 */
export class VeraClient {
    nodeUrl;
    fetch;
    constructor(nodeUrl, fetchImpl) {
        this.nodeUrl = nodeUrl;
        this.fetch = fetchImpl ?? globalThis.fetch.bind(globalThis);
    }
    /**
     * Submits a signed transaction to the node
     */
    async submitTransaction(tx) {
        const response = await this.rpc('vera_submit', [tx]);
        return response.hash;
    }
    /**
     * Gets the current status of the node's sequencer
     */
    async getStatus() {
        return this.rpc('vera_status', []);
    }
    /**
     * Gets a state entry with a Merkle proof
     */
    async getProof(namespace, id) {
        return this.rpc('vera_getProof', [{ namespace, id }]);
    }
    async rpc(method, params) {
        const response = await this.fetch(this.nodeUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                jsonrpc: '2.0',
                id: Date.now(),
                method,
                params,
            }, (_key, value) => typeof value === 'bigint' ? value.toString() :
                value instanceof Uint8Array ? this.bytesToHex(value) :
                    value),
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
    bytesToHex(bytes) {
        return Array.from(bytes)
            .map(b => b.toString(16).padStart(2, '0'))
            .join('');
    }
}
//# sourceMappingURL=client.js.map