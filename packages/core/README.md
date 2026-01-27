# @vera/core

The foundational primitives for the VERA system.

## Overview

@vera/core provides the essential types, cryptographic functions, and data structure primitives used throughout the VERA monorepo. It is designed to be lean and dependency-free where possible.

## Features

- **Cryptography**: Ed25519 signature verification and batch verification support.
- **Hashing**: Domain-separated SHA256 hashing.
- **Encoding**: Optimized CBOR-based binary serialization.
- **Merkle Trie**: Sparse Merkle Trie (SMT) implementation for verifiable state commitments.
- **Types**: Shared TypeScript types for Transactions, Blocks, and State.

## Usage

```typescript
import { sha256WithDomain, HashDomains, verifySignature } from '@vera/core';

const hash = sha256WithDomain(HashDomains.TRANSACTION, payload);
const isValid = verifySignature(hash, signature, publicKey);
```
