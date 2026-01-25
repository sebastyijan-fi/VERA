import { sha256WithDomain, HashDomains, encodeCanonicalTransaction, signTransaction as signTxCore, encode, } from '@vera/core';
// ============================================================================
// Value Helpers
// ============================================================================
export class Values {
    static int(value) {
        return { kind: 'int', value: BigInt(value) };
    }
    static bool(value) {
        return { kind: 'bool', value };
    }
    static string(value) {
        return { kind: 'string', value };
    }
    static bytes(value) {
        return { kind: 'bytes', value };
    }
    static address(value) {
        return { kind: 'address', value };
    }
}
/**
 * Fluent API for building VERA transactions
 */
export class TransactionBuilder {
    _version = 1;
    _chainId = new Uint8Array(32);
    _type;
    _nonce = 0n;
    _maxSequence;
    _payload = new Uint8Array(0);
    _signatures = [];
    constructor() { }
    version(version) {
        this._version = version;
        return this;
    }
    chainId(chainId) {
        this._chainId = chainId;
        return this;
    }
    type(moduleId, transactionName) {
        this._type = { moduleId, transactionName };
        return this;
    }
    /**
     * Sets the transaction call arguments.
     * Automatically encodes the values to CBOR.
     */
    call(moduleId, functionName, args = []) {
        this._type = { moduleId, transactionName: functionName };
        // Prepare arguments for CBOR encoding
        // The VM expects a list of Value objects
        this._payload = encode(args);
        return this;
    }
    nonce(nonce) {
        this._nonce = nonce;
        return this;
    }
    maxSequence(max) {
        this._maxSequence = max;
        return this;
    }
    payload(payload) {
        this._payload = payload;
        return this;
    }
    /**
     * Computes the Transaction ID (hash of canonical form)
     */
    buildId() {
        if (!this._type)
            throw new Error('Transaction type not set');
        const tx = {
            version: this._version,
            chainId: this._chainId,
            type: {
                moduleId: this._type.moduleId,
                transactionName: this._type.transactionName,
            },
            nonce: this._nonce,
            payload: this._payload,
        };
        if (this._maxSequence !== undefined) {
            tx.maxSequence = this._maxSequence;
        }
        const canonical = encodeCanonicalTransaction(tx);
        return sha256WithDomain(HashDomains.TRANSACTION, new Uint8Array(canonical));
    }
    /**
     * Signs the transaction and adds the signature
     */
    sign(privateKey) {
        const txId = this.buildId();
        const signature = signTxCore(txId, privateKey);
        this._signatures.push(signature);
        return this;
    }
    /**
     * Builds the final Transaction object
     */
    build() {
        if (!this._type)
            throw new Error('Transaction type not set');
        if (this._signatures.length === 0)
            throw new Error('No signatures added');
        const tx = {
            version: this._version,
            chainId: this._chainId,
            type: this._type,
            nonce: this._nonce,
            payload: this._payload,
            signatures: this._signatures,
            submittedAt: new Date(),
        };
        if (this._maxSequence !== undefined) {
            tx.maxSequence = this._maxSequence;
        }
        return tx;
    }
}
//# sourceMappingURL=builder.js.map