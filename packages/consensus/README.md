# @vera/consensus

A robust implementation of **Chained HotStuff BFT Consensus** for the VERA protocol.

## Features

- **Linear Communication**: O(n) message complexity in the happy path.
- **Pipelined Finality**: 3-chain commit rule (SafeNode predicate).
- **Pacemaker**: Automatic view synchronization and leader rotation on timeout.
- **Vote/QC Management**: Handling of Quorum Certificates and Votes.

## Usage

Internal use by `@vera/node`.

```typescript
import { BFTGadget } from '@vera/consensus';

const bft = new BFTGadget({
    validators: [...],
    id: myId,
    secretKey: myKey
});

// Event handling
bft.on('finalized', (hash, height) => {
    console.log(`Block ${hash} finalized at ${height}`);
});
```
