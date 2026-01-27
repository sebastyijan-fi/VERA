/**
 * CommitLog and BinarySnapshot Tests
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { CommitLog, type CommitEntry } from '../src/commitlog.js';
import { BinarySnapshotManager, type SnapshotEntry } from '../src/binarysnapshot.js';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';

describe('CommitLog', () => {
    let tempDir: string;
    let logPath: string;

    beforeEach(async () => {
        tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'vera-commitlog-test-'));
        logPath = path.join(tempDir, 'commits.vlog');
    });

    afterEach(async () => {
        await fs.rm(tempDir, { recursive: true, force: true });
    });

    describe('Basic Operations', () => {
        it('should create a new commit log', async () => {
            const log = new CommitLog({ path: logPath });
            await log.open();

            expect(log.height).toBe(-1n);

            await log.close();
        });

        it('should append commits sequentially', async () => {
            const log = new CommitLog({ path: logPath });
            await log.open();

            const entry: CommitEntry = {
                height: 0n,
                stateRoot: new Uint8Array(32).fill(0x01),
                prevStateRoot: new Uint8Array(32),
                timestamp: Date.now(),
                changeCount: 10,
                walLSN: 1n,
            };

            await log.append(entry);
            expect(log.height).toBe(0n);

            await log.close();
        });

        it('should reject non-sequential commits', async () => {
            const log = new CommitLog({ path: logPath });
            await log.open();

            const entry: CommitEntry = {
                height: 5n, // Skip to height 5
                stateRoot: new Uint8Array(32).fill(0x01),
                prevStateRoot: new Uint8Array(32),
                timestamp: Date.now(),
                changeCount: 10,
                walLSN: 1n,
            };

            await expect(log.append(entry)).rejects.toThrow('Non-sequential');

            await log.close();
        });
    });

    describe('Recovery', () => {
        it('should recover commits after restart', async () => {
            // Write commits
            const log1 = new CommitLog({ path: logPath });
            await log1.open();

            for (let i = 0n; i < 5n; i++) {
                await log1.append({
                    height: i,
                    stateRoot: new Uint8Array(32).fill(Number(i + 1n)),
                    prevStateRoot: new Uint8Array(32).fill(Number(i)),
                    timestamp: Date.now(),
                    changeCount: 10,
                    walLSN: i,
                });
            }
            await log1.close();

            // Reopen and verify
            const log2 = new CommitLog({ path: logPath });
            await log2.open();

            expect(log2.height).toBe(4n);

            const entry = await log2.get(2n);
            expect(entry).toBeDefined();
            expect(entry!.stateRoot[0]).toBe(3);

            await log2.close();
        });
    });

    describe('Chain Verification', () => {
        it('should verify a valid chain', async () => {
            const log = new CommitLog({ path: logPath });
            await log.open();

            let prevRoot = new Uint8Array(32);
            for (let i = 0n; i < 3n; i++) {
                const newRoot = new Uint8Array(32).fill(Number(i + 1n));
                await log.append({
                    height: i,
                    stateRoot: newRoot,
                    prevStateRoot: prevRoot,
                    timestamp: Date.now(),
                    changeCount: 5,
                    walLSN: i,
                });
                prevRoot = newRoot;
            }

            const result = await log.verify();
            expect(result.valid).toBe(true);
            expect(result.lastValidHeight).toBe(2n);

            await log.close();
        });
    });
});

describe('BinarySnapshotManager', () => {
    let tempDir: string;

    beforeEach(async () => {
        tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'vera-snapshot-test-'));
    });

    afterEach(async () => {
        await fs.rm(tempDir, { recursive: true, force: true });
    });

    describe('Save and Load', () => {
        it('should save and load a snapshot', async () => {
            const manager = new BinarySnapshotManager({ directory: tempDir });

            const entries: SnapshotEntry[] = [
                {
                    key: { namespace: 'test', id: new Uint8Array(32).fill(1) },
                    value: {
                        data: new TextEncoder().encode('hello'),
                        lastModified: 100n,
                        schema: {
                            moduleId: new Uint8Array(32).fill(2),
                            schemaName: 'TestSchema',
                            version: 1,
                        },
                    },
                },
                {
                    key: { namespace: 'test', id: new Uint8Array(32).fill(3) },
                    value: {
                        data: new TextEncoder().encode('world'),
                        lastModified: 200n,
                        schema: {
                            moduleId: new Uint8Array(32).fill(4),
                            schemaName: 'TestSchema',
                            version: 1,
                        },
                    },
                },
            ];

            const stateRoot = new Uint8Array(32).fill(0xAB);
            const filePath = await manager.save(10n, stateRoot, entries);

            expect(filePath).toContain('snapshot_');
            expect(filePath).toContain('.vsnap');

            // Load and verify
            const loaded: SnapshotEntry[] = [];
            for await (const entry of manager.load(filePath)) {
                loaded.push(entry);
            }

            expect(loaded).toHaveLength(2);
            expect(loaded[0]?.key.namespace).toBe('test');
            expect(new TextDecoder().decode(loaded[0]?.value.data)).toBe('hello');
        });

        it('should read metadata without loading entries', async () => {
            const manager = new BinarySnapshotManager({ directory: tempDir });

            const entries: SnapshotEntry[] = [
                {
                    key: { namespace: 'ns', id: new Uint8Array(32) },
                    value: {
                        data: new Uint8Array(10),
                        lastModified: 0n,
                        schema: { moduleId: new Uint8Array(32), schemaName: 's', version: 1 },
                    },
                },
            ];

            const stateRoot = new Uint8Array(32).fill(0xCD);
            const filePath = await manager.save(42n, stateRoot, entries);

            const header = await manager.getMetadata(filePath);
            expect(header.height).toBe(42n);
            expect(header.entryCount).toBe(1);
            expect(header.stateRoot[0]).toBe(0xCD);
        });
    });

    describe('Listing and Pruning', () => {
        it('should list snapshots in height order', async () => {
            const manager = new BinarySnapshotManager({ directory: tempDir });

            const entry: SnapshotEntry = {
                key: { namespace: 'x', id: new Uint8Array(32) },
                value: {
                    data: new Uint8Array(1),
                    lastModified: 0n,
                    schema: { moduleId: new Uint8Array(32), schemaName: 's', version: 1 },
                },
            };

            await manager.save(5n, new Uint8Array(32), [entry]);
            await manager.save(2n, new Uint8Array(32), [entry]);
            await manager.save(10n, new Uint8Array(32), [entry]);

            const list = await manager.list();
            expect(list).toHaveLength(3);
            expect(list[0]?.height).toBe(2n);
            expect(list[1]?.height).toBe(5n);
            expect(list[2]?.height).toBe(10n);
        });

        it('should find closest snapshot', async () => {
            const manager = new BinarySnapshotManager({ directory: tempDir });

            const entry: SnapshotEntry = {
                key: { namespace: 'x', id: new Uint8Array(32) },
                value: {
                    data: new Uint8Array(1),
                    lastModified: 0n,
                    schema: { moduleId: new Uint8Array(32), schemaName: 's', version: 1 },
                },
            };

            await manager.save(5n, new Uint8Array(32), [entry]);
            await manager.save(10n, new Uint8Array(32), [entry]);

            const closest = await manager.findClosest(8n);
            expect(closest).toBeDefined();
            expect(closest!.height).toBe(5n);
        });

        it('should prune old snapshots', async () => {
            const manager = new BinarySnapshotManager({ directory: tempDir });

            const entry: SnapshotEntry = {
                key: { namespace: 'x', id: new Uint8Array(32) },
                value: {
                    data: new Uint8Array(1),
                    lastModified: 0n,
                    schema: { moduleId: new Uint8Array(32), schemaName: 's', version: 1 },
                },
            };

            for (let i = 0n; i < 5n; i++) {
                await manager.save(i, new Uint8Array(32), [entry]);
            }

            const deleted = await manager.prune(2);
            expect(deleted).toBe(3);

            const remaining = await manager.list();
            expect(remaining).toHaveLength(2);
            expect(remaining[0]?.height).toBe(3n);
            expect(remaining[1]?.height).toBe(4n);
        });
    });
});
