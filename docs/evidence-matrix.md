# VERA Evidence Matrix

Mapping of Whitepaper Requirements to Implementation Controls and Third-Party Validation steps.

| ID | Requirement | Implementation Control | Evidence Artifact | Independent Verifier Steps |
| :--- | :--- | :--- | :--- | :--- |
| **REQ-VER-01** | Verifiability (Trust through validation) | Merkle Trie State, Signed Txs, Canonical Encoding | `evidence_ver_01.json` | 1. Fetch proofs from RPC<br>2. Run `vera-verify proof.json`<br>3. Recompute root from leaves |
| **REQ-DET-01** | Determinism (Same rules, same results) | Nonce State Machine, Hermetic VM, Seeded Tests | `evidence_det_01.json` | 1. Pull repo at commit X<br>2. Run `pnpm conformance`<br>3. Verify transcript sha256 matches published |
| **REQ-AUD-01** | Auditability (Complete trace) | Append-Only Journal, Receipt Logs | `evidence_audit_01.json` | 1. Export journal slice<br>2. Verify hash chain continuity<br>3. Replay txs to derive state S' |
| **REQ-GOV-01** | Governance (Spec-driven) | RFC Process, Conformance Gating | `evidence_gov_01.json` | 1. Check `docs/spec-registry.md`<br>2. Verify Test/RFC linkage |
