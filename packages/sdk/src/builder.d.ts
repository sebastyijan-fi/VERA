import { type Bytes32, type Transaction } from '@vera/core';
export declare class Values {
    static int(value: bigint | number): any;
    static bool(value: boolean): any;
    static string(value: string): any;
    static bytes(value: Uint8Array): any;
    static address(value: string): any;
}
/**
 * Fluent API for building VERA transactions
 */
export declare class TransactionBuilder {
    private _version;
    private _chainId;
    private _type?;
    private _nonce;
    private _maxSequence?;
    private _payload;
    private _signatures;
    constructor();
    version(version: number): this;
    chainId(chainId: Bytes32): this;
    type(moduleId: Bytes32, transactionName: string): this;
    /**
     * Sets the transaction call arguments.
     * Automatically encodes the values to CBOR.
     */
    call(moduleId: Bytes32, functionName: string, args?: any[]): this;
    nonce(nonce: bigint): this;
    maxSequence(max: bigint): this;
    payload(payload: Uint8Array): this;
    /**
     * Computes the Transaction ID (hash of canonical form)
     */
    buildId(): Bytes32;
    /**
     * Signs the transaction and adds the signature
     */
    sign(privateKey: Bytes32): this;
    /**
     * Builds the final Transaction object
     */
    build(): Transaction;
}
//# sourceMappingURL=builder.d.ts.map