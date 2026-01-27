# @vera/net

The peer-to-peer networking layer for VERA.

## Overview

@vera/net implements the communication protocol between VERA nodes, enabling block propagation, transaction gossip, and state synchronization.

## Features

- **P2P Transport**: TCP-based peer-to-peer communication.
- **Binary Protocol**: Compact messaging format based on CBOR.
- **Sync Manager**: Coordinates block synchronization from peers.
- **Peer Management**: Discovery and maintenance of peer connections.

## Components

- `P2PTransport`: The low-level socket-based transport.
- `Protocol`: Defines the binary message structure.
- `SyncManager`: Handles the sync loop and data requests.
