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

### 1. Setup

```bash
pnpm install
pnpm build
```

### 2. Run Local Devnet (3 Nodes)

The devnet script launches a 3-node cluster with BFT consensus and generates validator keys.

```bash
# Compile the example contract
pnpm --filter @vera/node vera compile examples/hello-world/contract.vera

# Start the devnet with the contract loaded
npx tsx scripts/devnet.ts --nodes 3 --clean --contract examples/hello-world/dist/contract.vir.json
```

### 3. Interact via CLI

Open a new terminal to send transactions. You will need a validator private key from `.devnet/keys.json`.

```bash
# Get a validator key
cat .devnet/keys.json

# Send a transaction to call SetGreeting
node packages/node/dist/cli.js tx send \
  --rpc http://localhost:8545 \
  --to 0x00 \
  --function SetGreeting \
  --args '["Hello VERA 0.1"]' \
  --key <YOUR_VALIDATOR_KEY>

# Check the logs of the running devnet to see the execution confirmation!
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
- ✅ BFT Consensus (HotStuff)
- ✅ JSON-RPC API
- ✅ CLI tooling

## Licensing

VERA is licensed under **AGPL-3.0**. If you run a modified version as a network service, you must publish your changes.

See [LICENSE](./LICENSE) for full terms.

## Contributing

We welcome contributions! See [CONTRIBUTING.md](./CONTRIBUTING.md).
