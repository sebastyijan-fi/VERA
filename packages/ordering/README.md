# @vera/ordering

The transaction ordering and sequencing layer for VERA.

## Overview

@vera/ordering manages the lifecycle of transactions from submission to finality, ensuring a deterministic and safe execution sequence.

## Features

- **Single Sequencer**: Reference implementation of a centralized sequencer.
- **Transaction Pool**: Memory pool for pending transactions with nonce management.
- **Finality Engine**: Logic for confirming and finalizing transaction sequences.
- **Persistence**: Durable storage of transaction logs and pool state.

## Components

- `SingleSequencer`: Orchestrates the ordering process.
- `TransactionPool`: Manages pending submissions.
- `FinalityProvider`: Tracks confirmation depth and finalization events.
