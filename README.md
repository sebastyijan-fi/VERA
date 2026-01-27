# VERA (Verifiable Execution & Registry Architecture)

VERA is an open, general-purpose standard for building shared digital state registries with strong guarantees of verifiability, determinism, and auditability. It provides a modular execution environment distinct from ordering and data availability, designed for high-assurance public and institutional use cases.

## What VERA Is Not

- **Not a blockchain** — No token, no mining, no consensus speculation
- **Not a database** — Optimized for verifiability, not general queries
- **Not production-ready** — Currently in active development

## Core Architecture

VERA is built as a modular monorepo:

- **`@vera/core`**: Essential types, cryptography (Ed25519), and Merkle Trie primitives
- **`@vera/engine`**: Transaction State Processor (TSP) and Parallel VM
- **`@vera/net`**: P2P transport, binary protocol (CBOR), and block synchronization
- **`@vera/store`**: High-performance storage foundation (Firewood-style)
- **`@vera/node`**: Full Node implementation and CLI

## Quick Start

### Installation

```bash
pnpm install
pnpm build
```

### Running the CLI

The `@vera/node` package provides the unified `vera` command-line tool:

```bash
# General help
pnpm --filter @vera/node vera --help

# DSL Compiler
pnpm --filter @vera/node vera compile program.vera

# Interactive REPL
pnpm --filter @vera/node vera repl

# Verify a proof
pnpm --filter @vera/node vera verify proof.json

# Run a full node
pnpm --filter @vera/node vera run --port 5001 --data ./data
```

### Docker

```bash
docker build -t vera-node .
docker run -p 5001:5001 -v $(pwd)/data:/data vera-node
```

## Configuration

VERA can be configured via `vera.config.toml` or environment variables:

| Variable | Config Key | Default |
| :------- | :--------- | :------ |
| `VERA_PORT` | `port` | `5001` |
| `VERA_DATA_DIR` | `dataDir` | `./data` |
| `VERA_NETWORK_ID` | `networkId` | `vera-mainnet` |

See [vera.config.example.toml](./vera.config.example.toml) for details.

## Documentation

- [Architecture Overview](./ARCHITECTURE.md)
- [Running a Node](./docs/running-a-node.md)
- [Building on VERA](./docs/building-on-vera.md)

## Status

- ✅ Ed25519 batch verification
- ✅ Parallel transaction execution
- ✅ P2P sync and binary protocol
- ✅ Crash-safe storage with WAL
- 🚧 CLI tooling
- 🚧 npm package publishing

## Licensing

VERA is licensed under **AGPL-3.0**. If you run a modified version as a network service, you must publish your changes.

See [LICENSE](./LICENSE) for full terms.

## Contributing

We welcome contributions! See [CONTRIBUTING.md](./CONTRIBUTING.md).
