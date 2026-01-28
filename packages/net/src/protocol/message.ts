
export enum MessageType {
    HELLO = 0x00,
    STATUS = 0x01,
    GET_HEADERS = 0x05,
    HEADERS = 0x06,
    GET_BLOCKS = 0x10,
    BLOCKS = 0x11,
    TRANSACTIONS = 0x12,
    BLOCK_CHUNK = 0x13,
    VOTE = 0x20,
    QUORUM_CERTIFICATE = 0x21,
    NEW_VIEW = 0x22,
    BLOCK_PROPOSAL = 0x30,
    DISCONNECT = 0xFF
}

export interface Message {
    type: MessageType;
    payload: any;
}

export interface HelloMessage {
    networkId: string;
    version: string;
    genesisHash: string;
    headHash: string;
    height: bigint;
}

export interface StatusMessage {
    headHash: string;
    height: bigint;
}

// Binary Protocol Types (Tuples for efficient CBOR)
// [Version, Height, PrevHash, MerkleRoot, Timestamp, Nonce]
export type BlockHeader = [number, bigint, string, string, number, bigint];

// [Header, Transactions[]]
export type Block = [BlockHeader, any[]];

export interface GetHeadersMessage {
    fromHeight: bigint;
    limit: number;
}

export interface HeadersMessage {
    headers: BlockHeader[];
}

export interface GetBlocksMessage {
    fromHeight: bigint; // Start height (inclusive)
    limit: number;      // Max number of blocks
}

// Optimized Blocks message
export interface BlocksMessage {
    blocks: Block[];
}

export interface BlockChunkMessage {
    blockHash: string;
    chunkIndex: number;
    totalChunks: number;
    data: Uint8Array; // The chunk data (shard)
}
