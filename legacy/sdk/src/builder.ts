import {
    type Bytes32,
    type Signature,
    type Transaction,
    type TransactionTypeRef,
    sha256WithDomain,
    HashDomains,
    encodeCanonicalTransaction,
    signTransaction as signTxCore,
    encode,
} from '@vera/core';

// ============================================================================
// Value Helpers
// ============================================================================

export class Values {
    static int(value: bigint | number): any {
        return { kind: 'int', value: BigInt(value) };
    }

    static bool(value: boolean): any {
        return { kind: 'bool', value };
    }

    static string(value: string): any {
        return { kind: 'string', value };
    }

    static bytes(value: Uint8Array): any {
        return { kind: 'bytes', value };
    }

    static address(value: string): any {
        return { kind: 'address', value };
    }
}

/**
 * Fluent API for building VERA transactions
 */
export class TransactionBuilder {
    private _version = 1;
    private _chainId: Bytes32 = new Uint8Array(32) as Bytes32;
    private _type?: TransactionTypeRef;
    private _nonce = 0n;
    private _maxSequence?: bigint;
    private _payload: Uint8Array = new Uint8Array(0);
    private _signatures: Signature[] = [];

    constructor() { }

    version(version: number): this {
        this._version = version;
        return this;
    }

    chainId(chainId: Bytes32): this {
        this._chainId = chainId;
        return this;
    }

    type(moduleId: Bytes32, transactionName: string): this {
        this._type = { moduleId, transactionName };
        return this;
    }

    /**
     * Sets the transaction call arguments.
     * Automatically encodes the values to CBOR.
     */
    call(moduleId: Bytes32, functionName: string, args: any[] = []): this {
        this._type = { moduleId, transactionName: functionName };
        // Prepare arguments for CBOR encoding
        // The VM expects a list of Value objects
        this._payload = encode(args);
        return this;
    }

    nonce(nonce: bigint): this {
        this._nonce = nonce;
        return this;
    }

    maxSequence(max: bigint): this {
        this._maxSequence = max;
        return this;
    }

    payload(payload: Uint8Array): this {
        this._payload = payload;
        return this;
    }

    /**
     * Computes the Transaction ID (hash of canonical form)
     */
    buildId(): Bytes32 {
        if (!this._type) throw new Error('Transaction type not set');

        const tx: any = {
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
    sign(privateKey: Bytes32): this {
        const txId = this.buildId();
        const signature = signTxCore(txId, privateKey);
        this._signatures.push(signature);
        return this;
    }

    /**
     * Builds the final Transaction object
     */
    build(): Transaction {
        if (!this._type) throw new Error('Transaction type not set');
        if (this._signatures.length === 0) throw new Error('No signatures added');

        const tx: Transaction = {
            version: this._version,
            chainId: this._chainId,
            type: this._type,
            nonce: this._nonce,
            payload: this._payload,
            signatures: this._signatures,
            submittedAt: new Date(),
        };

        if (this._maxSequence !== undefined) {
            (tx as any).maxSequence = this._maxSequence;
        }

        return tx;
    }
}
