# @vera/engine

The high-performance execution layer for VERA.

## Overview

@vera/engine implements the modular execution environment for VERA. It processes transactions against a current state to produce deterministic state changes.

## Features

- **Transaction State Processor (TSP)**: The core state transition function.
- **Parallel Executor**: Optimistic parallel execution of transactions using Read-After-Write (RAW) conflict detection.
- **Virtual Machine**: Register-based VM for executing compiled VERA IR.
- **Worker Pool**: Multi-threaded execution support for high throughput.

## Components

- `TransactionStateProcessor`: Manages the lifecycle of transaction execution.
- `ParallelExecutor`: Coordinates multiple workers and detects dependency conflicts.
- `WorkerPool`: Manages a pool of Node.js worker threads for execution.
