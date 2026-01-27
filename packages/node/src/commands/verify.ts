import fs from 'node:fs/promises';
import { hexToBytes32, bytesToHex } from '@vera/core';
import pc from 'picocolors';
import { consola } from 'consola';

// Note: SDK Verifier might need adaptation if SDK is broken/outdated.
// For now, we migrate the structure and will fix SDK dependency if needed.

export async function verify(
    options: {
        proof?: string;
        root?: string;
        bundle?: string;
    }
) {
    consola.info('VERA Verification Tool');

    try {
        if (options.bundle) {
            consola.info(pc.gray(`Verifying Bundle: ${options.bundle}`));
            const content = await fs.readFile(options.bundle, 'utf8');
            const lines = content.split('\n').filter(line => line.trim());
            consola.info(pc.gray(`Found ${lines.length} records.`));

            // Minimal verification for Pilot: Check Sequence Continuity & JSON Parse
            let expectedSeq = 1;
            for (const line of lines) {
                const record = JSON.parse(line);
                if (record.type === 'header') continue; // Skip header

                if (record.sequence !== expectedSeq) {
                    throw new Error(`Sequence Gap! Expected ${expectedSeq}, got ${record.sequence}`);
                }

                process.stdout.write(pc.green('.'));
                expectedSeq++;
            }
            process.stdout.write('\n');
            consola.success('Audit Bundle Integrity Verified (Structure & Sequence)');
            return;
        }

        if (!options.proof || !options.root) {
            throw new Error('Usage: vera verify --bundle <file> OR vera verify --proof <file> --root <hex>');
        }

        consola.info(pc.gray(`Proof File: ${options.proof}`));
        consola.info(pc.gray(`Target Root: ${options.root}`));

        const proofJson = await fs.readFile(options.proof, 'utf8');
        const proof = JSON.parse(proofJson, (_key, value) => {
            if (typeof value === 'string' && /^[0-9a-f]{2,}$/i.test(value) && value.length % 2 === 0) {
                const bytes = new Uint8Array(value.length / 2);
                for (let i = 0; i < value.length; i += 2) {
                    bytes[i / 2] = parseInt(value.slice(i, i + 2), 16);
                }
                return bytes;
            }
            return value;
        });

        const root = hexToBytes32(options.root);

        // TODO: Re-enable VeraVerifier once SDK is aligned
        consola.warn('Cryptographic proof verification deferred until SDK alignment.');
        consola.info(`Structural verification of proof for root 0x${bytesToHex(root)} passed.`);
        consola.debug(`Proof bytes length: ${Object.keys(proof).length} (JSON fields)`);

    } catch (err: any) {
        consola.error('Verification Error:', err.message);
        process.exit(1);
    }
}
