# @vera/rpc

JSON-RPC 2.0 Server and Router for VERA nodes.

## Features

- **Transports**: HTTP and WebSocket support.
- **Validation**: Zod-based schema validation for inputs.
- **Methods**: Standard Ethereum-like method names (prefixed with `vera_`).

## API Methods

| Method | Description |
| :--- | :--- |
| `vera_blockNumber` | Get current chain height |
| `vera_chainId` | Get Chain ID |
| `vera_sendRawTransaction` | Submit a signed transaction |
| `vera_getBalance` | Get account balance |
| `vera_call` | Simulate a function call |

## Usage

```typescript
import { RPCServer } from '@vera/rpc';

const server = new RPCServer({
    port: 8545,
    host: '0.0.0.0'
});

await server.start();
```
