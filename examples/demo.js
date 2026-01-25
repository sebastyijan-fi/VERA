import { VeraClient, TransactionBuilder, Values } from '../packages/sdk/src/index.js';
import { hexToBytes32 } from '../packages/core/src/index.js';
/**
 * VERA SDK Demo
 *
 * Demonstrates:
 * 1. Connecting to a local node
 * 2. Building a transaction with the fluent API
 * 3. Submitting and waiting for confirmation
 */
async function main() {
    // 1. Initialize Client
    const client = new VeraClient('http://localhost:8545');
    console.log('🔌 Connecting to VERA node...');
    try {
        const status = await client.getStatus();
        console.log(`✅ Connected! Network: ${status.sequencer.id}, Height: ${status.sequencedCount}`);
    }
    catch (e) {
        console.error('❌ Failed to connect. Is the node running?');
        console.error('Run: vera node --dsl examples/token.vera');
        process.exit(1);
    }
    // 2. Prepare Transaction Data
    // We will call 'transfer(to, amount)' on the 'TestContract' (module ID 0x01...01 from compilation?)
    // Note: In a real app, module ID would be known. For the token example, let's assume hash of "TestContract"? 
    // Or we use the one from compilation: dist/token.vir.json usually has the ID.
    // For this demo, we'll generate a dummy ID or use a known one if we had it. 
    // Let's use a placeholder and warn the user.
    const moduleId = hexToBytes32('01'.repeat(32)); // Placeholder
    const senderKey = hexToBytes32('02'.repeat(32)); // Dummy private key
    const recipient = '0x' + '11'.repeat(20);
    const amount = 500;
    console.log('\n📝 Building Transaction: TestContract.transfer()');
    console.log(`   To: ${recipient}`);
    console.log(`   Amount: ${amount}`);
    // 3. Build Transaction
    const tx = new TransactionBuilder()
        .version(1)
        .chainId(hexToBytes32('00'.repeat(32)))
        .call(moduleId, 'transfer', [
        Values.address(recipient),
        Values.int(amount)
    ])
        .nonce(BigInt(Date.now())) // Using timestamp as nonce for demo
        .sign(senderKey)
        .build();
    console.log(`   Tx ID: ${new TransactionBuilder().call(moduleId, 'transfer', []).payload(tx.payload).nonce(tx.nonce).type(moduleId, 'transfer').buildId()}`);
    // 4. Submit
    console.log('\n🚀 Submitting to network...');
    try {
        const hash = await client.submitTransaction(tx);
        console.log(`✅ Transaction submitted! Hash: ${hash}`);
    }
    catch (e) {
        console.error(`❌ Submission failed: ${e.message}`);
    }
}
main().catch(console.error);
//# sourceMappingURL=demo.js.map