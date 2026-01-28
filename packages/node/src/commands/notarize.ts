import { consola } from 'consola';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { sign, getPublicKey, generateKeyPair } from '@vera/core';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils';

export interface NotarizeOptions {
    file: string;
    secret?: string; // Hex string of private key
    out?: string;    // Output file path
}

export async function notarize(options: NotarizeOptions) {
    consola.info(`Notarizing file: ${options.file}`);

    if (!fs.existsSync(options.file)) {
        consola.error(`File not found: ${options.file}`);
        process.exit(1);
    }

    try {
        // 1. Hash the file
        const hash = await hashFile(options.file);
        consola.info(`File Hash (SHA-256): ${hash}`);

        // 2. Load or Generate Key
        let privateKey: Uint8Array;
        if (options.secret) {
            privateKey = hexToBytes(options.secret);
        } else {
            consola.warn('No secret key provided. Generating a specific temp key for this session.');
            const keyPair = generateKeyPair();
            privateKey = keyPair.privateKey;
            const publicKey = keyPair.publicKey;
            consola.info(`Generated Temp Private Key: ${bytesToHex(privateKey)}`);
            consola.info(`Generated Temp Public Key:  ${bytesToHex(publicKey)}`);
            consola.warn('SAVE THIS PRIVATE KEY to verify later!');
        }

        // 3. Sign the Hash
        // VERA sign() takes message and private key. 
        // We are signing the HASH of the file, effectively treating the hash as the message.
        // Important: VERA's sign() might hash the message again. 
        // If sign() = Ed25519(SHA512(msg)), we are doing Ed25519(SHA512(SHA256(File))).
        // This is fine and standard.
        const hashBytes = hexToBytes(hash);
        const signature = sign(hashBytes, privateKey);
        const publicKey = getPublicKey(privateKey);

        // 4. Create Proof Object
        const proof = {
            version: "1.0.0",
            filename: options.file.split(/[\\/]/).pop(),
            timestamp: new Date().toISOString(),
            fileHash: hash,
            signature: bytesToHex(signature),
            publicKey: bytesToHex(publicKey),
            algo: "Ed25519(SHA256(File))"
        };

        // 5. Output
        const json = JSON.stringify(proof, null, 2);
        if (options.out) {
            fs.writeFileSync(options.out, json);
            consola.success(`Proof saved to ${options.out}`);
        } else {
            console.log(json);
        }

    } catch (e: any) {
        consola.error(`Notarization failed: ${e.message}`);
        process.exit(1);
    }
}

async function hashFile(filePath: string): Promise<string> {
    return new Promise((resolve, reject) => {
        const hash = createHash('sha256');
        const stream = fs.createReadStream(filePath);

        stream.on('error', err => reject(err));
        stream.on('data', chunk => hash.update(chunk));
        stream.on('end', () => resolve(hash.digest('hex')));
    });
}
