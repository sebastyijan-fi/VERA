# VERA Data Policy: GDPR & Minimization

This document defines the data handling policy for VERA deployments, specifically addressing **GDPR compliance**, **Data Minimization**, and the **Right to Erasure**.

## 1. Core Principle: Proof Layer vs. Data Layer

VERA acts as a **Proof Layer**, not a Data Layer.

* **On-Ledger (Immutable)**:
  * Cryptographic Hashes (SHA-256) of documents/data.
  * Public Keys / Addresses.
  * Operational Metadata (Timestamps, Nonces, Signatures).
  * **Policy**: No Personally Identifiable Information (PII) or cleartext personal data should ever be stored in the transaction payload or state.

* **Off-Ledger (Mutable)**:
  * The actual personal data, documents, or identity attributes.
  * Stored in traditional, GDPR-compliant databases (SQL, NoSQL) controlled by the Data Controller.
  * Linked to the ledger via the unique hash.

## 2. Pseudonymization Strategy

According to GDPR Recital 26, personal data that has been pseudonymized (where it can be attributed to a natural person with additional info) is still personal data. However, if the key to re-identify is destroyed, it may be considered anonymous.

* **VERA Posture**:
  * Public Keys/Addresses are pseudonyms.
  * Hashes of data are pseudonyms if the original data exists.

## 3. Right to Erasure ("Right to be Forgotten")

Immutability of the ledger seems to conflict with Article 17 (Right to Erasure). VERA resolves this through the precise definition of what is stored.

### Procedure

When a data subject requests erasure:

1. **Off-Chain Deletion**: The Data Controller deletes the actual personal data from the off-chain database.
2. **Cryptographic Severing**: Without the original input data, the hash stored on-ledger becomes a one-way orphan. It cannot be reversed to reveal the original data (due to Preimage Resistance).
3. **Result**: The mathematical trace remains (proving integrity of the past), but the *informational content* is effectively erased. The hash no longer relates to an identifiable person because the "link" (the off-chain data) is gone.

## 4. State Deletion (Pruning)

VERA supports technical deletion of state via the `delete` opcode in its DSL.

* **Purpose**: To free up storage space for "expired" business objects in the current state (latest view).
* **Compliance**: This removes the item from the *Current State Trie*, but the *Historical Transaction Log* remains immutable for auditability.
* **Note**: This reinforces the rule that **PII must not be on-chain**. Even if `deleted` from state, it would remain in the history. **Therefore, strictly enforcing the Off-Chain Data Model is required for GDPR compliance.**
