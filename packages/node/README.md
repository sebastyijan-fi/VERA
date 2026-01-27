# @vera/node

The reference implementation of a VERA Full Node and integrated CLI.

## Overview

@vera/node is the primary integration point for the VERA system. It orchestrates networking, storage, and execution into a single, cohesive unit.

## Features

- **Full Node**: Implements block synchronization, peer discovery, and gossip.
- **Unified CLI**: Integrated tools for:
  - `vera compile`: Compile VERA DSL to IR.
  - `vera repl`: Interactive development environment for DSL.
  - `vera verify`: Offline proof verification.
  - `vera run`: Start a full node.
- **Config Management**: Support for TOML-based configuration and environment variables.

## Usage

### Development

```bash
# Build the package
pnpm build

# Run tests
pnpm test
```

### CLI Commands

```bash
# Start a node
node dist/cli.js run --port 5001 --data ./data

# Compile a program
node dist/cli.js compile my_program.vera
```

## Configuration

Default configuration is defined in `src/config.ts`. You can override it via a `vera.config.toml` file in your data directory.
