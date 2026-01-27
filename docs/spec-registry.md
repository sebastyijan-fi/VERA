# VERA Spec Registry

This registry tracks the conformance of the codebase to the VERA Whitepaper requirements.

| Guarantee (REQ) | Status | Test File | Failure Contract | Evidence Artifact |
| :--- | :--- | :--- | :--- | :--- |
| **REQ-DET-01**: Transcript Determinism | 🟢 Verified | `packages/engine/test/matrix_wave_engine.test.ts` | Transcript hash equality mismatch | `artifacts/conformance/evidence_det_engine_01_result.json` |
| **REQ-VER-01**: VM Call Frame Soundness | 🟢 Verified | `packages/engine/test/vm_recursion.test.ts` | Stack corruption on recursion | `artifacts/conformance/evidence_vm_recursion_result.json` |
| **REQ-VER-01**: Stateful Processor Continuity | 🟢 Verified | `packages/engine/test/processor_continuity.test.ts` | State root invariant violation | `artifacts/conformance/evidence_continuity_result.json` |
| **REQ-DET-01**: Canonical Tx Boundaries | 🟢 Verified | `packages/core/test/canonical_tx.test.ts` | Hash mismatch on serialization | `artifacts/conformance/evidence_canonical_result.json` |
| **REQ-VER-01**: Merkle Proof Completeness | 🟢 Verified | `packages/store/test/proof_sculpting.test.ts` | Invalid proof rejected | `artifacts/conformance/evidence_merkle_result.json` |
| **REQ-VER-01**: Binary Key Injectivity | 🟢 Verified | `packages/store/test/encoding.test.ts` | Key collision / UTF8 corruption | `artifacts/conformance/evidence_binary_keys_result.json` |
| **REQ-DET-01**: Error Taxonomy Stability | 🟢 Verified | `packages/ordering/test/protocol_safety.test.ts` | Precedence violation | `artifacts/conformance/evidence_safe_01.json` |
| **REQ-DET-01**: Adversarial Schedule | 🟢 Verified | `packages/ordering/test/concurrency.test.ts` | Non-deterministic sequencer output | `artifacts/conformance/evidence_conc_01_result.json` |
| **REQ-AUD-01**: Append-Only Log | 🔴 Missing | `packages/store/test/journal.test.ts` | Hash-chain break | TBD |
| **REQ-GOV-01**: RFC Workflow | 🔴 Missing | `docs/rfcs/` | N/A | TBD |

## Legend

- 🟢 Verified: Tightened test passes with evidence.
- 🟡 Partial: Test exists but needs tightening (e.g. check bytes not just root).
- 🔴 Missing: Gap identified, no rigorous test.
