import fs from 'node:fs/promises';
import { VeraVerifier } from '@vera/sdk';
import { hexToBytes32, decode, bytesToHex } from '@vera/core';
import pc from 'picocolors';

export async function verify(
    options: {
        proof: string;
        root: string;
    }
) {
    console.log(pc.cyan('VERA Proof Verification...'));
    console.log(pc.gray(`Proof File: ${options.proof}`));
    console.log(pc.gray(`Target Root: ${options.root}`));

    try {
        // 1. Read and parse proof
        const proofJson = await fs.readFile(options.proof, 'utf8');
        const proof = JSON.parse(proofJson, (_key, value) => {
            // Restore Uint8Arrays from hex strings in JSON
            if (typeof value === 'string' && /^[0-9a-f]{2,}$/i.test(value) && value.length % 2 === 0) {
                // This is a bit risky but good for simple proof files
                const bytes = new Uint8Array(value.length / 2);
                for (let i = 0; i < value.length; i += 2) {
                    bytes[i / 2] = parseInt(value.slice(i, i + 2), 16);
                }
                return bytes;
            }
            return value;
        });

        const root = hexToBytes32(options.root);

        // 2. Run verification
        const isValid = VeraVerifier.verifyProof(proof, root);

        if (isValid) {
            console.log(pc.green('\n✓ Cryptographic Verification SUCCESS'));
            console.log(pc.green('State Root Reconstructed:'), options.root);

            if (proof.value) {
                // 3. Decode Value (informational)
                const decoded = decode(proof.value);
                console.log(pc.cyan('\nDecoded State Value:'));
                console.log(JSON.stringify(decoded, (_k, v) =>
                    typeof v === 'bigint' ? v.toString() :
                        v instanceof Uint8Array ? bytesToHex(v) : v,
                    2));
            } else {
                console.log(pc.yellow('\n(Proof of EXCLUSION: Key does not exist in state)'));
            }
        } else {
            console.log(pc.red('\n✗ Cryptographic Verification FAILED'));
            console.log(pc.red('The proof provided does not match the target state root.'));
            process.exit(1);
        }
    } catch (err: any) {
        console.error(pc.red('\nVerification Error:'), err.message);
        process.exit(1);
    }
}
