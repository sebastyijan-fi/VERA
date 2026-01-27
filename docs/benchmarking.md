# VERA Benchmarking Methodology

This document defines the standard procedures for measuring the performance of VERA components. Adherence to this methodology ensures results are reproducible and meaningful for external auditing.

## 1. Metric Definitions

All benchmarks must define their **Commit Boundary** (when the clock stops).

| Boundary | Meaning | Bottleneck |
| :--- | :--- | :--- |
| **Accepted** | Request parsed by HTTP server and added to Mempool. | Network I/O, JSON Parsing. |
| **Appended** | Validated (Sig/Nonce) and durably written to `sequencer.db` (WAL). | Disk I/O, OS Cache, Signature CPU. |
| **Committed** | Executed by VM and State Root updated in `state.db`. | VM CPU, Trie I/O, Merkle Hashing. |

## 2. Standard Benchmark Suite

The `@vera/bench` package contains the canonical harnesses.

### A. Sequencer Bench (`bench:sequencer`)

* **Measurement**: Appended Throughput.
* **Payload**: 100 bytes + Signature.
* **Verification**: All signatures are verified. Nonces are ordered.
* **Target**: 1,000+ TPS (Single Thread).

### B. End-to-End Spam (`bench:spam`)

* **Measurement**: Accepted Throughput.
* **Method**: High-concurrency client (spam cannon) hitting `vera node` via HTTP.
* **Target**: 200+ TPS.

### C. Full Commit Bench (`bench:commit`)

* **Measurement**: Committed Throughput (Sequencer + VM + State Store).
* **Method**: In-memory loop driving the full execution pipeline.
* **Verification**: Final State Root matches expected deterministic value.
* **Target**: 500+ TPS (Reference).

## 3. Correctness & Durability

### Replay Verification

Every benchmark run must be validated by exporting the final state (or log) and replaying it.

* *Action*: Captured via `report.json` "replay_root_match" field.

### Durability Assumptions

* **LevelDB**: Reports strictly capture `sync` settings.
* **Sequencer**: Uses Append-Only Log. By default, benchmarks run with `sync: false` (OS buffer reliance) effectively measuring "Logical Commit". Benchmarks with `sync: true` measure "Physical Commit".

## 4. Non-Goals

* **Accepted** does not imply **Appended**.
* **Appended** does not imply **Executed**.
* **Byzantine Fault Tolerance**: Not measured (Single Sequencer topology).
* **Privacy**: Zero-knowledge proof generation overhead is not included in standard throughput numbers.

## 5. Artifacts

Benchmarks output a `report.json` to `packages/bench/bench-out/`.

```json
{
  "timestamp": "ISO8601",
  "bench_name": "commit_full",
  "metrics": {
    "tps_sustained": 500,
    "boundary_definition": "committed_state_root",
    "db_settings": { "sync": false }
  },
  "replay_root_match": true
}
```
