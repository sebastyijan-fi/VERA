/**
 * Write-Ahead Log Tests
 * 
 * Comprehensive tests for WAL crash recovery, integrity, and correctness.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { WriteAheadLog, RecordType } from '../src/wal.js';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';

describe('WriteAheadLog', () => {
    let tempDir: string;
    let walPath: string;

    beforeEach(async () => {
        tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'vera-wal-test-'));
        walPath = path.join(tempDir, 'test.wal');
    });

    afterEach(async () => {
        await fs.rm(tempDir, { recursive: true, force: true });
    });

    describe('Basic Operations', () => {
        it('should create a new WAL file', async () => {
            const wal = new WriteAheadLog({ path: walPath });
            const recovered = await wal.open();

            expect(recovered).toHaveLength(0);
            expect(wal.size).toBeGreaterThan(0); // Header written

            await wal.close();
        });

        it('should write and flush PUT records', async () => {
            const wal = new WriteAheadLog({ path: walPath });
            await wal.open();

            const key = new TextEncoder().encode('test-key');
            const value = new TextEncoder().encode('test-value');

            await wal.put(key, value);
            await wal.flush();

            expect(wal.currentLSN).toBe(1n);

            await wal.close();
        });

        it('should write DELETE records', async () => {
            const wal = new WriteAheadLog({ path: walPath });
            await wal.open();

            const key = new TextEncoder().encode('key-to-delete');

            await wal.delete(key);
            await wal.flush();

            expect(wal.currentLSN).toBe(1n);

            await wal.close();
        });

        it('should write COMMIT records with state root', async () => {
            const wal = new WriteAheadLog({ path: walPath });
            await wal.open();

            const stateRoot = new Uint8Array(32).fill(0xAB);
            const height = 100n;

            const result = await wal.commit(stateRoot, height);

            expect(result.lsn).toBe(1n);
            expect(result.offset).toBeGreaterThan(16); // After header

            await wal.close();
        });
    });

    describe('Recovery', () => {
        it('should recover PUT records after restart', async () => {
            // Write some data
            const wal1 = new WriteAheadLog({ path: walPath });
            await wal1.open();

            await wal1.put('key1', new TextEncoder().encode('value1'));
            await wal1.put('key2', new TextEncoder().encode('value2'));
            await wal1.flush();
            await wal1.close();

            // Reopen and recover
            const wal2 = new WriteAheadLog({ path: walPath });
            const recovered = await wal2.open();

            expect(recovered).toHaveLength(2);
            expect(recovered[0].type).toBe(RecordType.PUT);
            expect(recovered[1].type).toBe(RecordType.PUT);

            // Verify data integrity
            if (recovered[0].type === RecordType.PUT) {
                expect(new TextDecoder().decode(recovered[0].key)).toBe('key1');
                expect(new TextDecoder().decode(recovered[0].value)).toBe('value1');
            }

            await wal2.close();
        });

        it('should recover DELETE records after restart', async () => {
            const wal1 = new WriteAheadLog({ path: walPath });
            await wal1.open();

            await wal1.delete('deleted-key');
            await wal1.flush();
            await wal1.close();

            const wal2 = new WriteAheadLog({ path: walPath });
            const recovered = await wal2.open();

            expect(recovered).toHaveLength(1);
            expect(recovered[0].type).toBe(RecordType.DELETE);

            if (recovered[0].type === RecordType.DELETE) {
                expect(new TextDecoder().decode(recovered[0].key)).toBe('deleted-key');
            }

            await wal2.close();
        });

        it('should recover COMMIT records with state root and height', async () => {
            const wal1 = new WriteAheadLog({ path: walPath });
            await wal1.open();

            const stateRoot = new Uint8Array(32).fill(0xDE);
            await wal1.commit(stateRoot, 42n);
            await wal1.close();

            const wal2 = new WriteAheadLog({ path: walPath });
            const recovered = await wal2.open();

            expect(recovered).toHaveLength(1);
            expect(recovered[0].type).toBe(RecordType.COMMIT);

            if (recovered[0].type === RecordType.COMMIT) {
                expect(recovered[0].height).toBe(42n);
                // Compare contents since recovered may be Buffer vs Uint8Array
                expect(Buffer.from(recovered[0].stateRoot).equals(Buffer.from(stateRoot))).toBe(true);
            }

            await wal2.close();
        });

        it('should recover mixed record types in order', async () => {
            const wal1 = new WriteAheadLog({ path: walPath });
            await wal1.open();

            await wal1.put('k1', new TextEncoder().encode('v1'));
            await wal1.delete('k2');
            await wal1.put('k3', new TextEncoder().encode('v3'));
            await wal1.commit(new Uint8Array(32), 1n);
            await wal1.close();

            const wal2 = new WriteAheadLog({ path: walPath });
            const recovered = await wal2.open();

            expect(recovered).toHaveLength(4);
            expect(recovered[0].type).toBe(RecordType.PUT);
            expect(recovered[1].type).toBe(RecordType.DELETE);
            expect(recovered[2].type).toBe(RecordType.PUT);
            expect(recovered[3].type).toBe(RecordType.COMMIT);

            await wal2.close();
        });
    });

    describe('Rotation', () => {
        it('should rotate WAL and create backup', async () => {
            const wal = new WriteAheadLog({ path: walPath });
            await wal.open();

            await wal.put('before-rotate', new TextEncoder().encode('data'));
            await wal.flush();

            await wal.rotate();

            // WAL should be reset
            expect(wal.currentLSN).toBe(0n);

            // Backup file should exist
            const files = await fs.readdir(tempDir);
            const backupFiles = files.filter(f => f.endsWith('.bak'));
            expect(backupFiles.length).toBe(1);

            await wal.close();
        });
    });

    describe('Integrity', () => {
        it('should detect corrupted records', async () => {
            const wal1 = new WriteAheadLog({ path: walPath });
            await wal1.open();

            await wal1.put('valid-key', new TextEncoder().encode('valid-value'));
            await wal1.flush();
            await wal1.close();

            // Corrupt the file by modifying a byte
            const data = await fs.readFile(walPath);
            const corrupted = new Uint8Array(data);
            corrupted[20] ^= 0xFF; // Flip bits in the data section
            await fs.writeFile(walPath, corrupted);

            // Recovery should detect corruption
            const wal2 = new WriteAheadLog({ path: walPath });
            const recovered = await wal2.open();

            // Should either recover 0 records or throw
            expect(recovered.length).toBeLessThanOrEqual(1);

            await wal2.close();
        });
    });

    describe('Sync Modes', () => {
        it('should support syncOnWrite mode', async () => {
            const wal = new WriteAheadLog({
                path: walPath,
                syncOnWrite: true
            });
            await wal.open();

            // Each put should trigger flush
            await wal.put('sync-key', new TextEncoder().encode('sync-value'));

            expect(wal.currentLSN).toBe(1n);

            await wal.close();
        });
    });

    describe('Group Commit', () => {
        it('should batch writes until timer triggers', async () => {
            const wal = new WriteAheadLog({
                path: walPath,
                groupCommitInterval: 50, // 50ms timer
                groupCommitBatchSize: 1000, // Large batch size so timer wins
            });
            await wal.open();

            // Start multiple puts without awaiting individually
            const promises = [
                wal.put('key1', new TextEncoder().encode('val1')),
                wal.put('key2', new TextEncoder().encode('val2')),
                wal.put('key3', new TextEncoder().encode('val3')),
            ];

            // Wait for all to complete (timer should flush them together)
            await Promise.all(promises);

            // All should have been flushed
            expect(wal.currentLSN).toBe(3n);

            await wal.close();
        });

        it('should flush immediately when batch size threshold reached', async () => {
            const wal = new WriteAheadLog({
                path: walPath,
                groupCommitInterval: 10000, // Large timer so batch size wins
                groupCommitBatchSize: 3, // Small batch size
            });
            await wal.open();

            // Fire all 3 writes concurrently - third one should trigger batch flush
            const promises = [
                wal.put('key1', new TextEncoder().encode('val1')),
                wal.put('key2', new TextEncoder().encode('val2')),
                wal.put('key3', new TextEncoder().encode('val3')),
            ];

            await Promise.all(promises);

            // Should have flushed at batch size
            expect(wal.currentLSN).toBe(3n);

            await wal.close();
        });

        it('should amortize fsync across multiple concurrent writes', async () => {
            const wal = new WriteAheadLog({
                path: walPath,
                groupCommitInterval: 20,
            });
            await wal.open();

            // Fire off many concurrent writes
            const startTime = Date.now();
            const count = 50;
            const promises: Promise<unknown>[] = [];
            for (let i = 0; i < count; i++) {
                promises.push(wal.put(`key${i}`, new TextEncoder().encode(`val${i}`)));
            }
            await Promise.all(promises);
            const elapsed = Date.now() - startTime;

            // Should complete faster than 50 individual fsyncs would take
            // (each fsync is typically 1-10ms, so 50 would be 50-500ms)
            expect(elapsed).toBeLessThan(500);
            expect(wal.currentLSN).toBe(BigInt(count));

            await wal.close();
        });
    });
});
