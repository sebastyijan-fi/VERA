# VERA Audit Bundle Schema

This document defines the standard data format for the **Exportable Audit Bundle**. This bundle allows an external auditor to cryptographically verify the integrity and history of a VERA ledger without running a full node.

## Purpose

To provide a self-contained, portable, and machine-readable evidence package that proves:

1. **Completeness**: No transactions are missing from the sequence.
2. **Correctness**: The State Root was computed validly.
3. **Authenticity**: All State Roots are signed by the identified Operator.

## Format Specification

The bundle is a JSON file (or stream of JSON objects) adhering to the following schema.

   ```json
  [ ... see ./audit_bundle_example.jsonl for full example ... ]
   ```

### Root Object

```json
{
  "protocol": "vera",
  "version": "1.0.0",
  "chainId": "0x...",
  "exportedAt": "2024-01-01T12:00:00Z",
  "operatorId": "did:web:example.com",
  "range": {
    "fromSequence": 0,
    "toSequence": 1000
  },
  "genesis": {
    "root": "0x..."
  },
  "blocks": [ ... ]
}
```

### Block Object

Each item in the `blocks` array represents a finalized state transition.

```json
{
  "sequence": 1,
  "timestamp": 1704110400,
  "transactions": [
    {
      "hash": "0x...",
      "nonce": 1,
      "sender": "0x...",
      "function": "registerDocument",
      "args": "0x...",
      "signature": "0x..."
    }
  ],
  "stateRoot": "0x...",
  "size": 1,
  "operatorSignature": "0x..."
}
```

## Verification Procedure (Auditor Algorithm)

An auditor provided with this bundle executes the following algorithm:

1. **Initialize**: Start with an empty VERA State (or the known Genesis State).
2. **Iterate**: For each `block` in `blocks`:
    * **Verify Sequence**: Ensure `block.sequence` is exactly `prev_sequence + 1`.
    * **Verify Signature**: Check `block.operatorSignature` validates against the Operator's Public Key.
    * **Execute**: Run the VERA Virtual Machine (TSP) on the `transactions` array.
    * **Compare**: Assert that the computed State Root matches `block.stateRoot`.
3. **Result**: If all blocks pass, the current state `hash` is valid and the entire history is legitimate.

## Evidence Retention

This file format is designed to be:

* **Long-term Archivable**: Plain text (JSON) or compressed (JSON.gz).
* **Self-Contained**: Contains everything needed to rebuild the proof.
