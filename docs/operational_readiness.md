# VERA Operational Readiness Statement

This document addresses the operational requirements for deploying VERA as a Trusted Service or Qualified Electronic Ledger (QEL) under eIDAS 2.0.

## 1. Time and Ordering Semantics

### Requirement: Time Ordering

QELs must ensure the correct chronological ordering of records and, where applicable, provide evidence of time.

### VERA Implementation

* **Logical Ordering**: The VERA protocol enforces strict logical ordering via the **Sequencer** and **Account Nonces**. Every transaction is assigned a monotonically increasing sequence number.
* **Timestamping**:
  * **Internal**: Each block/batch includes a timestamp (Unix epoch).
  * **Qualified Integration**: VERA is designed to integrate with **Qualified Trust Service Providers (QTSPs)** for timestamping.
  * **Anchoring Policy**: Operators can periodically anchor the VERA State Root into a public blockchain (e.g., Ethereum) or submit it to a Qualified Time Stamp Authority (QTSA). The QTSA signature over the Merkle Root provides independent proof of existence at a specific time.

## 2. Operator Identity & Governance

### Requirement: Operator Identity

The operation of the ledger must be attributed to a verifiable legal or natural person.

### Governance Model (Reference)

* **Legal Operator**: The entity running the Sequencer and publishing the API endpoint.
* **Key Management**:
  * The Sequencer's signing key (`sequencer_key`) is the root of trust for ordering.
  * **HSM Requirement**: For QEL production deployments, this key MUST be generated and stored in a FIPS 140-2 Level 3 (or equivalent) Hardware Security Module.
* **Registry Governance**:
  * Configuration updates (e.g., changing the sequencer key, upgrading the protocol) are managed via a special `governance` smart contract or entity defined at genesis.

## 3. Change Control & Versioning

### Requirement: Change Control

The system must be maintained with clear change control processes to ensure long-term verifiability.

### Policy

* **Specification Versioning**: VERA uses Semantic Versioning (SemVer) for its protocol specification.
* **Hard Forks**: Any change to the deterministic execution logic (TSP) that results in a different State Root for the same inputs is a **Hard Fork**.
  * **Procedure**: Hard forks require a coordinated software upgrade of all verifying nodes. History prior to the fork remains verifiable under the V1 protocol rules.
* **Long-Term Retention**:
  * Archival nodes must retain the full transaction history.
  * The `vera-cli` includes a `compliance export` command (roadmap) to dump the Verification Context (all transactions + proofs) in a standardized, auditor-friendly format (e.g., JSON/CBOR).

## 4. Disaster Recovery & Business Continuity

### Requirement

The provider must have procedure to recover operations in event of catastrophic failure (e.g., data corruption, data center loss).

### Corruption Recovery Procedure

Since the VERA State Database (`state.db`) is a deterministic projection of the Transaction Log (`sequencer.db`), it can be completely rebuilt if corrupted.

**Recovery Steps:**

1. **Halt Operations**: Stop the Sequencer and API services.
2. **Verify Log Integrity**: Check the `sequencer.db` (or external backup of transaction log) is intact and the latest entry signature is valid.
3. **Purge State**: Delete the corrupted `state.db`.
4. **Rebuild**:
    * Start a fresh `vera-node` instance pointing to the existing `sequencer.db`.
    * The node detects `state.db` is empty but `sequencer.db` has height `N`.
    * **Replay**: The node re-executes all transactions from Sequence `0` to `N` through the TSP Engine.
5. **Validation**: Compare the computed State Root at `N` with the last public anchor/checkpoint.
6. **Resume**: Restart API services.

**RPO/RTO**:

* **RPO (Recovery Point Objective)**: 0 (No data loss if Log is intact).
* **RTO (Recovery Time Objective)**: Function of transaction history size (Replay speed is approx ~X,000 tx/sec).

## 5. Upgrade Policy

### Versioning

All VERA components adhere to strict Semantic Versioning.

* **Protocol Version**: Defined in Genesis. Defines the State Machine rules.
* **Schema Version**: Defines the JSON/encoding structure of transactions.
* **Hashing Primitive**: SHA-256 (Algorithm ID 1).

### Consensus-Critical Changes (Hard Forks)

Any change that alters the **State Root calculation** is a Hard Fork.

* **Policy**: Hard forks must be announced 4 weeks in advance.
* **Coordination**: Operators must upgrade `vera-node` software before the activation block height.

## 6. Audit Verification

Auditors can verify an exported bundle using the reference implementation:

```bash
# Verify reliability of the bundle against the reference TSP
vera verify --bundle ./docs/audit_bundle_example.jsonl
```

See [Audit Bundle Schema](./audit_bundle_schema.md) and [Example Bundle](./audit_bundle_example.jsonl) for details.
