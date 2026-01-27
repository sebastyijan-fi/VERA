# @vera/dsl

The Domain Specific Language for VERA smart contracts.

## Overview

@vera/dsl provides the compiler toolchain for the VERA Domain Specific Language. It transforms human-readable `.vera` source code into an Intermediate Representation (IR) suitable for execution on the VERA engine.

## Components

- **Lexer**: Tokenizes source code.
- **Parser**: Builds an Abstract Syntax Tree (AST).
- **IR Compiler**: Transforms AST into register-based IR instructions.
- **Tooling**: Includes utilities for source map generation and error reporting.

## Example

```vera
module Counter;
public entity State[Bytes] { val: UInt }
public transaction increment(key: Bytes) {
    let current = get<State>(key);
    set current = State { val: current.val + 1 };
}
```
