# @vera/store

The high-performance storage layer for VERA.

## Overview

@vera/store provides the persistence foundation for VERA, implementing a "Firewood-style" append-only storage architecture with crash-safe guarantees.

## Features

- **LevelDB Integration**: Efficient key-value storage.
- **Write-Ahead Log (WAL)**: Ensures atomicity and durability for state updates.
- **Snapshots**: Point-in-time consistent views of the state.
- **Commit Log**: Sequential binary log of all state changes.
- **AppendOnlyStore**: Optimized storage primitive for high-throughput logging.

## Usage

```typescript
import { LevelDBStore, PersistentStateStore } from '@vera/store';

const db = new LevelDBStore('./data');
const store = await PersistentStateStore.load(db);
```
