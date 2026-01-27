
import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

const ARTIFACTS_DIR = path.join(process.cwd(), 'artifacts', 'conformance');

// Ensure artifacts dir exists
if (!fs.existsSync(ARTIFACTS_DIR)) {
    fs.mkdirSync(ARTIFACTS_DIR, { recursive: true });
}

function getCommitHash() {
    try {
        return execSync('git rev-parse HEAD').toString().trim();
    } catch (e) {
        return 'unknown';
    }
}

function runTest(testPattern: string, outputFile: string) {
    console.log(`Running conformance test: ${testPattern}...`);
    try {
        // Run vitest directly from root for precise path matching
        execSync(`npx --yes vitest run ${testPattern} --reporter=json --outputFile=${outputFile}`, { stdio: 'inherit' });
        return true;
    } catch (e) {
        console.error(`Test failed: ${testPattern}`);
        return false;
    }
}

async function main() {
    const timestamp = new Date().toISOString();
    const commit = getCommitHash();
    const nodeVersion = process.version;

    console.log(`Starting VERA Conformance Suite`);
    console.log(`Time: ${timestamp}`);
    console.log(`Commit: ${commit}`);

    const manifest = {
        meta: {
            timestamp,
            commit,
            nodeVersion,
        },
        results: {} as Record<string, any>
    };

    // 1. REQ-DET-01: Transcript Determinism
    const det01File = path.join(ARTIFACTS_DIR, 'evidence_det_01_result.json');
    const det01Pass = runTest('packages/ordering/test/matrix_wave2.test.ts', det01File);
    if (fs.existsSync(det01File)) {
        manifest.results['REQ-DET-01'] = JSON.parse(fs.readFileSync(det01File, 'utf-8'));
    }

    // 2. REQ-DET-01: Error Precedence (Protocol Safety)
    const safe01File = path.join(ARTIFACTS_DIR, 'evidence_safe_01_result.json');
    const safe01Pass = runTest('packages/ordering/test/protocol_safety.test.ts', safe01File);
    if (fs.existsSync(safe01File)) {
        manifest.results['REQ-DET-01-SAFETY'] = JSON.parse(fs.readFileSync(safe01File, 'utf-8'));
    }

    // 3. REQ-DET-01: Concurrency (Adversarial Schedule)
    const conc01File = path.join(ARTIFACTS_DIR, 'evidence_conc_01_result.json');
    const conc01Pass = runTest('packages/ordering/test/concurrency.test.ts', conc01File);
    if (fs.existsSync(conc01File)) {
        manifest.results['REQ-DET-01-CONCURRENCY'] = JSON.parse(fs.readFileSync(conc01File, 'utf-8'));
    }

    // 4. REQ-DET-01: Engine Replay Determinism
    const detEngineFile = path.join(ARTIFACTS_DIR, 'evidence_det_engine_01_result.json');
    const detEnginePass = runTest('packages/engine/test/matrix_wave_engine.test.ts', detEngineFile);
    if (fs.existsSync(detEngineFile)) {
        manifest.results['REQ-DET-01-ENGINE'] = JSON.parse(fs.readFileSync(detEngineFile, 'utf-8'));
    }

    // 5. REQ-VER-01: VM Call Frame Soundness
    const vmRecFile = path.join(ARTIFACTS_DIR, 'evidence_vm_recursion_result.json');
    const vmRecPass = runTest('packages/engine/test/vm_recursion.test.ts', vmRecFile);
    if (fs.existsSync(vmRecFile)) {
        manifest.results['REQ-VER-01-VM'] = JSON.parse(fs.readFileSync(vmRecFile, 'utf-8'));
    }

    // 6. REQ-VER-01: Stateful Processor Continuity
    const contFile = path.join(ARTIFACTS_DIR, 'evidence_continuity_result.json');
    const contPass = runTest('packages/engine/test/processor_continuity.test.ts', contFile);
    if (fs.existsSync(contFile)) {
        manifest.results['REQ-VER-01-CONT'] = JSON.parse(fs.readFileSync(contFile, 'utf-8'));
    }

    // 7. REQ-DET-01: Canonical Tx Boundaries
    const canFile = path.join(ARTIFACTS_DIR, 'evidence_canonical_result.json');
    const canPass = runTest('packages/core/test/canonical_tx.test.ts', canFile);
    if (fs.existsSync(canFile)) {
        manifest.results['REQ-DET-01-CANONICAL'] = JSON.parse(fs.readFileSync(canFile, 'utf-8'));
    }

    // 8. REQ-VER-01: Merkle Proof Completeness
    const merkleFile = path.join(ARTIFACTS_DIR, 'evidence_merkle_result.json');
    const merklePass = runTest('packages/store/test/proof_sculpting.test.ts', merkleFile);
    if (fs.existsSync(merkleFile)) {
        manifest.results['REQ-VER-01-MERKLE'] = JSON.parse(fs.readFileSync(merkleFile, 'utf-8'));
    }

    // 9. REQ-VER-01: Binary Key Injectivity
    const binFile = path.join(ARTIFACTS_DIR, 'evidence_binary_keys_result.json');
    const binPass = runTest('packages/store/test/encoding.test.ts', binFile);
    if (fs.existsSync(binFile)) {
        manifest.results['REQ-VER-01-BINARY'] = JSON.parse(fs.readFileSync(binFile, 'utf-8'));
    }

    // Write Manifest
    const manifestPath = path.join(ARTIFACTS_DIR, 'conformance_report.json');
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
    console.log(`\nConformance Report written to: ${manifestPath}`);

    if (!det01Pass || !safe01Pass || !conc01Pass || !detEnginePass || !vmRecPass || !contPass || !canPass || !merklePass || !binPass) {
        process.exit(1);
    }
}

main().catch(err => {
    console.error(err);
    process.exit(1);
});
