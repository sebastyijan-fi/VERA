# VERA: Hello World Guide

This guide will help you get started with **VERA** (Verifiable Execution & Registry Architecture). You will learn how to compile a contract, run it locally, and start a VERA node.

## Prerequisites

- **Node.js**: v20 or higher
- **pnpm**: v9 or higher

## 1. Installation

If you are working with the source code:

```bash
# Install dependencies
pnpm install

# Build the project
pnpm build
```

The CLI binary is located at `packages/cli/dist/bin.js`. You can alias it for convenience:

```bash
alias vera="./packages/cli/dist/bin.js"
```

## 2. Writing a Contract

VERA uses a specialized Domain Specific Language (DSL). Here is a simple Token contract (found in `examples/token.vera`):

```vera
module TestContract;

entity Balances [Address] {
  amount: UInt<64>
}

event Transfer {
  src: Address,
  to: Address,
  amount: UInt<64>
}

transaction init(supply: UInt<64>) {
  // Initialize the contract state
  emit Transfer(0x0000000000000000000000000000000000000000, caller, supply);
}

transaction transfer(to: Address, amount: UInt<64>) {
  require amount > 0, "Amount must be positive";
  emit Transfer(caller, to, amount);
}
```

## 3. Compiling

Compile your DSL code into the VERA Intermediate Representation (IR):

```bash
vera compile examples/token.vera
```

Output:

- `dist/token.vir.json`: The compiled contract.

## 4. Running Locally (Execution Engine)

You can execute a single transaction against an ephemeral state using `vera run`. This is great for testing logic without spinning up a blockchain.

```bash
# Execute the 'init' transaction with an argument of 1000
vera run dist/token.vir.json --entry init --args 1000
```

Expected Output:

```text
✔ Execution successful in 1.16ms
Gas used: 5
Events (1):
- Transfer: {"kind":"int","value":"1000"} ...
```

## 5. Starting a Local Node

To run a persistent single-node chain:

```bash
vera node --dsl examples/token.vera --data-dir ./data
```

This starts a JSON-RPC server on `http://localhost:8545`.

### Interact via RPC

Check if the node is alive:

```bash
curl -X POST -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"system_health","params":[],"id":1}' \
  http://localhost:8545
```
