import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import path from 'path';
import fs from 'fs/promises';
import { execa } from 'execa';

const CLI_PATH = path.resolve(__dirname, '../dist/cli.js');
const TEST_DIR = './tmp/cli_test';
const TEST_FILE = path.join(TEST_DIR, 'document.txt');
const PROOF_FILE = path.join(TEST_DIR, 'proof.json');

describe('CLI Proof of Existence', () => {
    beforeEach(async () => {
        await fs.rm(TEST_DIR, { recursive: true, force: true });
        await fs.mkdir(TEST_DIR, { recursive: true });
        await fs.writeFile(TEST_FILE, 'This is a VERA test document.');
    });

    afterEach(async () => {
        // await fs.rm(TEST_DIR, { recursive: true, force: true });
    });

    it('should notarize and verify a file using generated keys', async () => {
        // 1. Notarize
        const notarizeResult = await execa('node', [CLI_PATH, 'notarize', TEST_FILE, '--out', PROOF_FILE], {
            env: { CONSOLA_LEVEL: '5' }
        });
        expect(notarizeResult.exitCode).toBe(0);

        // 2. Check Proof
        const proofJson = await fs.readFile(PROOF_FILE, 'utf8');
        const proof = JSON.parse(proofJson);
        expect(proof.fileHash).toBeDefined();
        expect(proof.signature).toBeDefined();
        expect(proof.publicKey).toBeDefined();

        // 3. Verify
        const verifyResult = await execa('node', [CLI_PATH, 'verify', '--file', TEST_FILE, '--proof', PROOF_FILE], {
            env: { CONSOLA_LEVEL: '5' }
        });
        expect(verifyResult.exitCode).toBe(0);
        expect(verifyResult.exitCode).toBe(0);
        // Consola writes to stderr/stdout depending on level
        const output = verifyResult.stdout + verifyResult.stderr;
        expect(output).toContain('Signature Verified');
    });

    it('should fail verification if file is modified', async () => {
        // 1. Notarize
        await execa('node', [CLI_PATH, 'notarize', TEST_FILE, '--out', PROOF_FILE]);

        // 2. Modify File
        await fs.appendFile(TEST_FILE, '\nMalicious modification.');

        // 3. Verify
        try {
            await execa('node', [CLI_PATH, 'verify', '--file', TEST_FILE, '--proof', PROOF_FILE]);
            throw new Error('Verification should have failed');
        } catch (e: any) {
            expect(e.exitCode).toBe(1);
            expect(e.stderr + e.stdout).toContain('Hash Mismatch');
        }
    });

    it('should fail verification if proof is tampered', async () => {
        // 1. Notarize
        await execa('node', [CLI_PATH, 'notarize', TEST_FILE, '--out', PROOF_FILE]);

        // 2. Tamper Proof (modify signature)
        const proofJson = await fs.readFile(PROOF_FILE, 'utf8');
        const proof = JSON.parse(proofJson);
        // Flip last char of signature
        const sig = proof.signature;
        const tamperedSig = sig.slice(0, -1) + (sig.endsWith('0') ? '1' : '0');
        proof.signature = tamperedSig;
        await fs.writeFile(PROOF_FILE, JSON.stringify(proof));

        // 3. Verify
        try {
            await execa('node', [CLI_PATH, 'verify', '--file', TEST_FILE, '--proof', PROOF_FILE]);
            throw new Error('Verification should have failed');
        } catch (e: any) {
            expect(e.exitCode).toBe(1);
            expect(e.stderr + e.stdout).toContain('Signature Verification FAILED');
        }
    });
});
