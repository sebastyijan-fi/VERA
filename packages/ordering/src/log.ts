import {
  type Bytes,
  type Bytes32,
  bytesEqual,
  bytesToHex,
  concat,
  sha256,
  toBytes32,
  zeroBytes32,
} from "@vera/core";
import type { Store, Batch } from "@vera/store";
import { type SequenceNumber } from "./types.js";

/**
 * Execution status for a transaction
 */
export enum ExecutionStatus {
  EXEC_OK = 0,
  EXEC_FAIL = 1,
}

/**
 * An entry in the transaction log
 */
export interface LogEntry {
  seq: SequenceNumber;
  txId: Bytes32;
  sender: Bytes32;
  nonce: bigint;
  chainId: Bytes32;
  canonicalTxBytes: Bytes;
}

/**
 * Persistent append-only transaction log with hash chaining
 */
export class TransactionLog {
  private head: Bytes32 = zeroBytes32();
  private readonly CHECKPOINT_INTERVAL = 10000n;

  constructor(private readonly store: Store) {}

  /**
   * Initializes the log by loading the current head
   */
  async open(): Promise<void> {
    const headBytes = await this.store.get("log:hash_head");
    if (headBytes) {
      this.head = headBytes as Bytes32;
    }
  }

  /**
   * Appends a transaction to the log atomically
   */
  append(batch: Batch, entry: LogEntry): Bytes32 {
    const entryHash = this.computeEntryHash(entry);
    this.head = sha256(concat(this.head, entryHash)); // Hash chaining remains

    const seqKey = this.formatSeq(entry.seq);
    const txIdHex = bytesToHex(entry.txId, false);

    // Store the entry
    batch.put(`log:seq:${seqKey}`, this.serializeEntry(entry));

    // Store the lookup by txId
    batch.put(`log:tx:${txIdHex}`, Buffer.from(entry.seq.toString())); // New txId index key

    // Update the head
    batch.put("log:hash_head", this.head);

    // Checkpoint every interval
    if (entry.seq % this.CHECKPOINT_INTERVAL === 0n) {
      batch.put(`log:checkpoint:${this.formatSeq(entry.seq)}`, this.head);
    }

    return this.head;
  }

  /**
   * Records an execution receipt for a transaction
   */
  recordReceipt(
    batch: Batch,
    seq: SequenceNumber,
    status: ExecutionStatus,
  ): void {
    batch.put(`log:rcpt:${this.formatSeq(seq)}`, Buffer.from([status]));
  }

  /**
   * Gets an entry by sequence number
   */
  async getEntry(seq: SequenceNumber): Promise<LogEntry | undefined> {
    const bytes = await this.store.get(`log:seq:${this.formatSeq(seq)}`);
    if (!bytes) return undefined;
    return this.deserializeEntry(bytes);
  }

  /**
   * Gets a receipt by sequence number
   */
  async getReceipt(seq: SequenceNumber): Promise<ExecutionStatus | undefined> {
    const bytes = await this.store.get(`log:rcpt:${this.formatSeq(seq)}`);
    if (!bytes) return undefined;
    return bytes[0] as ExecutionStatus;
  }

  /**
   * Gets a sequence number by transaction ID
   */
  async getSeqByTxId(txId: Bytes32): Promise<SequenceNumber | undefined> {
    const txIdHex = bytesToHex(txId, false);
    const data = await this.store.get(`log:tx:${txIdHex}`);
    if (!data) return undefined;
    return BigInt(Buffer.from(data).toString());
  }

  /**
   * Gets the current log head
   */
  getHead(): Bytes32 {
    return this.head;
  }

  /**
   * Verifies the integrity of the last K entries
   */
  async verifyIntegrity(_k: number = 100): Promise<boolean> {
    const prefix = "log:seq:";
    const iterator = this.store.iterator({
      gte: `${prefix}00000000000000000000`,
      lte: `${prefix}\uffff`,
    });

    let computedHead: Bytes32 = zeroBytes32();
    let processed = 0;
    let iterationFailed = false;

    try {
      while (true) {
        const record = await iterator.next();
        if (!record) break;

        const [rawKey, value] = record;
        const keyStr =
          typeof rawKey === "string"
            ? rawKey
            : rawKey instanceof Uint8Array
              ? Buffer.from(rawKey).toString("utf8")
              : String(rawKey);

        if (!keyStr.startsWith(prefix)) {
          continue;
        }

        try {
          const entry = this.deserializeEntry(value as Uint8Array);
          const entryHash = this.computeEntryHash(entry);
          computedHead = sha256(concat(computedHead, entryHash));
          processed++;
        } catch {
          iterationFailed = true;
          break;
        }
      }
    } catch {
      iterationFailed = true;
    } finally {
      await iterator.end();
    }

    if (iterationFailed) {
      return false;
    }

    const storedHeadBytes = await this.store.get("log:hash_head");

    if (!storedHeadBytes) {
      return processed === 0;
    }

    let expectedHead: Bytes32;
    try {
      expectedHead = toBytes32(storedHeadBytes as Uint8Array);
    } catch {
      return false;
    }

    return bytesEqual(computedHead, expectedHead);
  }

  private computeEntryHash(entry: LogEntry): Bytes32 {
    const seqBytes = Buffer.from(entry.seq.toString());
    const nonceBytes = Buffer.from(entry.nonce.toString());
    return sha256(
      concat(
        seqBytes,
        entry.txId,
        entry.sender,
        nonceBytes,
        entry.chainId,
        entry.canonicalTxBytes,
      ),
    );
  }

  private formatSeq(seq: SequenceNumber): string {
    return seq.toString().padStart(20, "0");
  }

  private serializeEntry(entry: LogEntry): Uint8Array {
    // Simple serialization for log entries:
    // [seq:8][txId:32][sender:32][nonce:8][chainId:32][txLen:4][txBytes:...]
    // Actually, let's use a more robust format or just CBOR if available
    // For Phase 1, we can use a simple concatenation or JSON for ease of debugging,
    // but the plan says "Do not persist any reconstructed JSON view as 'source'".
    // So we use a binary format.

    const result = new Uint8Array(
      8 + 32 + 32 + 8 + 32 + 4 + entry.canonicalTxBytes.length,
    );
    const view = new DataView(result.buffer);

    view.setBigUint64(0, entry.seq, false);
    result.set(entry.txId, 8);
    result.set(entry.sender, 8 + 32);
    view.setBigUint64(8 + 32 + 32, entry.nonce, false);
    result.set(entry.chainId, 8 + 32 + 32 + 8);
    view.setUint32(8 + 32 + 32 + 8 + 32, entry.canonicalTxBytes.length, false);
    result.set(entry.canonicalTxBytes, 8 + 32 + 32 + 8 + 32 + 4);

    return result;
  }

  private deserializeEntry(bytes: Uint8Array): LogEntry {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const seq = view.getBigUint64(0, false);
    const txId = bytes.slice(8, 8 + 32) as Bytes32;
    const sender = bytes.slice(8 + 32, 8 + 32 + 32) as Bytes32;
    const nonce = view.getBigUint64(8 + 32 + 32, false);
    const chainId = bytes.slice(
      8 + 32 + 32 + 8,
      8 + 32 + 32 + 8 + 32,
    ) as Bytes32;
    const txLen = view.getUint32(8 + 32 + 32 + 8 + 32, false);
    const canonicalTxBytes = bytes.slice(
      8 + 32 + 32 + 8 + 32 + 4,
      8 + 32 + 32 + 8 + 32 + 4 + txLen,
    );

    return { seq, txId, sender, nonce, chainId, canonicalTxBytes };
  }
}
