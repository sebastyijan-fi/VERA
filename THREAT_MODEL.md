# VERA Threat Model

This document outlines the security model, assumed threats, and mitigation strategies for the VERA (Verifiable Execution & Registry Architecture) system. It is designed to demonstrate maturity and security awareness to evaluators, referencing **ENISA** guidelines where applicable.

## Scope

This threat model covers the **Execution** and **Ordering** layers of the VERA reference implementation.

**Protected Assets:**

* **Integrity**: The correctness of the global state (ledger).
* **Authenticity**: The validity of transaction origins (signatures).
* **Consistency**: The chronological order of events.

**Explicit Non-Goals:**

* **On-chain Privacy**: Transaction data is assumed to be visible to all node operators (unless separate encryption is applied).
* **Censorship Resistance**: In BFT mode, a transaction is censored only if >1/3 of validators collude to ignore it. In single-node mode, the operator has full censorship power.
* **Quantum Resistance**: Current cryptographic primitives (Ed25519, SHA-256) are standard but not post-quantum secure.

## References

This model aligns with concepts from:

* *ENISA Threat Landscape for Supply Chain Attacks*
* *ENISA Guidelines on Cryptographic Protocols*

## Threat Analysis

### 1. Network & Protocol Attacks

#### 1.1 Replay Attack

* **Threat**: An attacker captures a valid signed transaction and resubmits it to execute it again (e.g., spending funds twice).
* **Mitigation**:
  * **Nonces**: Every account has a strictly increasing nonce. The sequencer rejects any transaction with `nonce <= current_nonce`.
  * **Chain ID**: Transactions sign the `ChainID`. A transaction valid on Testnet cannot be replayed on Mainnet.
* **Component**: `packages/ordering`

#### 1.2 Transaction Equivocation (Double Spend)

* **Threat**: An attacker submits conflicting transactions (same nonce) to different nodes to fork the state.
* **Mitigation**:
  * **Sequencer Finality**: The sequencer imposes a total order. Only the first seen valid transaction for a given nonce is accepted; others are rejected.
  * **Deterministic Execution**: All nodes process the single log in order.
* **Component**: `packages/ordering`

### 2. Infrastructure & implementation Attacks

#### 2.1 Storage Corruption

* **Threat**: Power failure or disk error corrupts the database, leading to partial writes (e.g., account balance updated, but trie root not).
* **Mitigation**:
  * **Atomic Batching**: All state changes (values + trie nodes + metadata) are committed in a single LevelDB batch. The DB is either updated completely or not at all.
  * **Crash Consistency Tests**: Verified via suite `packages/store/test/crash.test.ts`.
* **Component**: `packages/store`

#### 2.2 Supply Chain Compromise (Dependency Injection)

* **Threat**: Malicious code introduced via NPM dependencies.
* **Mitigation**:
  * **Minimal Dependencies**: Core logic (`packages/core`, `packages/engine`) relies on minimal, audited crypto libraries.
  * **Lockfiles**: `pnpm-lock.yaml` ensures deterministic dependency versions.
  * **Build Verification**: CI pipelines verify build reproducibility (planned).

### 3. Consensus Attacks (BFT)

#### 3.1 Safety Violation (Conflicting Blocks)

* **Threat**: Malicious validators (>1/3) attempt to finalize two different blocks at the same height (Fork).
* **Mitigation**:
  * **Quorum Certificates (QC)**: A block is only finalized if 2f+1 validators sign it. Conflicting QCs imply >1/3 malicious voting power (Slashing Condition).
  * **HotStuff Rules**: Validators verify `SafeNode` predicates (commit rule) before voting.

#### 3.2 Liveness Attack (Stalling)

* **Threat**: Malicious leader or network partition prevents block progress (DoS).
* **Mitigation**:
  * **Pacemaker**: If a round times out without a QC, validators move to the next round.
  * **Leader Rotation**: Deterministic Round-Robin ensures a malicious leader is skipped in the next view.

#### 3.3 Key Compromise

* **Threat**: Validator signing keys are stolen.
* **Mitigation**:
  * **Domain Separation**: Usage of 'domain-separated' signing contexts prevents replay across different message types.
  * **Key Rotation**: Governance capability (Future Work).

## Risk Assessment

| Threat | Likelihood | Impact | Mitigation Status |
| :--- | :--- | :--- | :--- |
| Replay | High | Critical | ✅ Solved (Nonces) |
| DB Corruption | Medium | High | ✅ Solved (Atomic Batch) |
| Sequencer Fraud | Low | High | ✅ Solved (Verifiability) |
| Quantum Attack | Low (Current) | Critical | ⚠️ Accepted Risk (Non-goal) |
