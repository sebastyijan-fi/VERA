import fs from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { createHash } from 'node:crypto';
import { hexToBytes32, bytesToHex, verify as verifySignature } from '@vera/core';
import { hexToBytes } from '@noble/hashes/utils';
import pc from 'picocolors';
import { consola } from 'consola';

export async function verify(
    options: {
        file?: string;
        proof?: string;
        root?: string;
        bundle?: string;
    }
) {
    consola.info('VERA Verification Tool');

    try {
        // Mode 1: File Verification (PoE)
        if (options.file && options.proof) {
            await verifyFile(options.file, options.proof);
            return;
        }

        // Mode 2: Bundle Verification (Legacy/Audit)
        if (options.bundle) {
            await verifyBundle(options.bundle);
            return;
        }

        // Mode 3: State Proof Verification (Placeholder)
        if (options.proof && options.root) {
            // ... existing placeholder logic ...
            consola.warn('State Proof Verification not fully implemented yet.');
            return;
        }

        throw new Error('Invalid usage. \nFile Verify: vera verify --file <path> --proof <path>\nBundle Verify: vera verify --bundle <path>');

    } catch (err: any) {
        consola.error('Verification Error:', err.message);
        process.exit(1);
    }
}

async function verifyFile(filePath: string, proofPath: string) {
    consola.info(`Verifying File: ${pc.cyan(filePath)}`);
    consola.info(`Using Proof:  ${pc.cyan(proofPath)}`);

    // 1. Load Proof
    const proofJson = await fs.readFile(proofPath, 'utf8');
    let proof;
    try {
        proof = JSON.parse(proofJson);
    } catch {
        throw new Error('Invalid JSON in proof file');
    }

    if (!proof.signature || !proof.publicKey || !proof.fileHash) {
        throw new Error('Proof file missing required fields (signature, publicKey, fileHash)');
    }

    // 2. Hash the File
    const calculatedHash = await hashFile(filePath);
    if (calculatedHash !== proof.fileHash) {
        consola.error(pc.red(`Hash Mismatch!`));
        consola.info(`Proof claims:   ${proof.fileHash}`);
        consola.info(`Actual file:    ${calculatedHash}`);
        throw new Error('File integrity check failed.');
    }
    consola.success('File Hash Matches');

    // 3. Verify Signature
    const publicKey = hexToBytes(proof.publicKey);
    const signature = hexToBytes(proof.signature);
    const message = hexToBytes(calculatedHash); // We signed the hash bytes

    const isValid = verifySignature(signature, message, publicKey);

    if (isValid) {
        consola.success(pc.green('Signature Verified'));
        consola.info(`Signed by: ${proof.publicKey}`);
        consola.info(`Timestamp: ${proof.timestamp}`);
    } else {
        consola.error(pc.red('Signature Verification FAILED'));
        throw new Error('Cryptographic signature is invalid.');
    }
}

async function verifyBundle(bundlePath: string) {
    consola.info(pc.gray(`Verifying Bundle: ${bundlePath}`));
    const content = await fs.readFile(bundlePath, 'utf8');
    const lines = content.split('\n').filter(line => line.trim());
    consola.info(pc.gray(`Found ${lines.length} records.`));

    // Minimal verification: Check Sequence Continuity
    let expectedSeq = 1;
    for (const line of lines) {
        const record = JSON.parse(line);
        if (record.type === 'header') continue;

        if (record.sequence !== expectedSeq) {
            throw new Error(`Sequence Gap! Expected ${expectedSeq}, got ${record.sequence}`);
        }

        if (expectedSeq % 100 === 0) process.stdout.write(pc.green('.'));
        expectedSeq++;
    }
    process.stdout.write('\n');
    consola.success('Audit Bundle Integrity Verified (Structure & Sequence)');
}

async function hashFile(filePath: string): Promise<string> {
    return new Promise((resolve, reject) => {
        const hash = createHash('sha256');
        const stream = createReadStream(filePath);
        stream.on('error', err => reject(err));
        stream.on('data', chunk => hash.update(chunk));
        stream.on('end', () => resolve(hash.digest('hex')));
    });
}
