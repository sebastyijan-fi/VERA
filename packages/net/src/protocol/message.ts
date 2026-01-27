
export enum MessageType {
    HELLO = 0x00,
    STATUS = 0x01,
    GET_BLOCKS = 0x10,
    BLOCKS = 0x11,
    TRANSACTIONS = 0x12,
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

export interface GetBlocksMessage {
    fromHeight: bigint; // Start height (inclusive)
    limit: number;      // Max number of blocks
}

// For now, Block is just any (will be defined in @vera/core later or we use Buffer)
export interface BlocksMessage {
    blocks: any[];
}
