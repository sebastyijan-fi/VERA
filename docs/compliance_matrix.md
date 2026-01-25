# VERA Compliance Matrix: eIDAS & QEL Requirements

This document maps the technical features of the VERA architecture to the regulatory requirements for **Qualified Electronic Ledgers (QEL)** as defined in eIDAS 2.0 (Article 45a). It serves as a guide for evaluators and compliance officers to verify the system's capabilities.

## QEL Requirements Mapping

| eIDAS / QEL Requirement | Whitepaper Ref | VERA Feature | Responsibility | Evidence / Artifact |
| :--- | :--- | :--- | :--- | :--- |
| **Unique Identification of Records** | **[REQ-VER-01]** | **Data Structure**: Merkle Trie. Values hashed. | **VERA (Tech)** | `packages/core/src/state/trie.ts` |
| **Chronological Ordering** | **[REQ-DET-01]** | **Sequencing**: Strict order + Nonces. | **VERA (Tech)** | `packages/ordering/src/single.ts` |
| **Tamper Evidence** | **[REQ-VER-01]** | **Integrity**: Merkle Roots + Hashing. | **VERA (Tech)** | `packages/core/src/crypto/hash.ts` |
| **Authenticity of Origin** | **[REQ-VER-01]** | **Signatures**: Ed25519/Secp256k1 checks. | **Shared** (Tech: Check / Ops: Keys) | `packages/engine/src/processor.ts` |
| **Correctness of Execution** | **[REQ-DET-01]** | **Determinism**: TSP Engine. | **VERA (Tech)** | `vectors.test.ts` |
| **Auditability** | **[REQ-AUD-01]** | **Logs**: Full history + Proofs. | **VERA (Tech)** | `audit_bundle_schema.md` |

## Additional Assurance

| Requirement | Whitepaper Ref | Implementation Strategy | Responsibility | Documentation |
| :--- | :--- | :--- | :--- | :--- |
| **Time Accuracy** | **[REQ-DET-01]** | Integration with QTSA (Timestamping). | **QTSP (Ops)** | [Operational Readiness](./operational_readiness.md) |
| **Data Minimization (GDPR)** | **[REQ-GOV-01]** | Off-chain storage + On-chain hash. | **Operator (Ops)** | [Data Policy](./data_policy.md) |
| **Disaster Recovery** | **[REQ-AUD-01]** | Replay from Log Procedure. | **Operator (Ops)** | [Operational Readiness](./operational_readiness.md) |

## Evaluator Notes

* **Verifiability**: Any third party with access to the transaction log can reconstruct the state and verify the Merkle Root matches the published root.
* **Neutrality**: The VERA standard implementation does not depend on a native token for security, aligning with institutional requirements for predictable costs.
