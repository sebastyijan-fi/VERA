/**
 * VERA Networking - Public API
 */

export { NetworkNode, type NetworkOptions } from './node.js';
export { Peer, PeerState, type PeerOptions } from './transport/peer.js';
export { Server } from './transport/server.js';
export { SyncManager, type BlockProvider } from './sync/manager.js';
export * from './protocol/message.js';
export { ProtocolDecoder, encodeMessage } from './protocol/codec.js';
