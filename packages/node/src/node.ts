import { NetworkNode, type BlockProvider } from '@vera/net';
import { ParallelExecutor } from '@vera/engine';
import {
    CommitLog,
    AppendOnlyStore,
    PersistentStateStore,
    LevelDBStore,
    type CommitEntry
} from '@vera/store';
// import { type BlockProvider } from '@vera/core'; <-- Removed
import { BFTGadget, type Vote, type QuorumCertificate, type NewView } from '@vera/consensus';
import { SingleSequencer } from '@vera/ordering';
import { RPCServer } from '@vera/rpc';
import {
    toBytes32,
    hexToBytes,
    bytesToHex,
    concat,
    sign,
    getPublicKey,
    sha256,
    type Bytes32
} from '@vera/core';
import { stringValue, intValue, boolValue, nullValue } from '@vera/engine';
import { decodeTransaction } from './tx/builder.js';
import { type NodeConfig, DEFAULT_CONFIG } from './config.js';
import path from 'path';
import { createConsola } from 'consola';
import { EventEmitter } from 'eventemitter3';
import fs from 'node:fs/promises';

const logger = createConsola({ level: 4 });

// Default program if none provided
const GENESIS_PROGRAM: any = {
    id: '0x0000000000000000000000000000000000000000000000000000000000000000',
    name: 'genesis',
    functions: [],
    globals: []
};

/**
 * Full VERA Node - Orchestrates networking, storage, and execution
 */
export class FullNode extends EventEmitter implements BlockProvider {
    public network!: NetworkNode;
    public store: CommitLog;
    public stateStore!: PersistentStateStore;
    public executor!: ParallelExecutor;
    public gadget!: BFTGadget;
    private backingStore!: AppendOnlyStore;
    private config: NodeConfig;
    private isStarted = false;
    private bftStatePath: string;
    private roundTimer: NodeJS.Timeout | null = null;
    private currentBFTState = {
        lastVotedRound: 0n,
        lastVotedRoundQC: 0n
    };
    public sequencer!: SingleSequencer;
    private rpcServer: RPCServer | null = null;
    public chainId: Uint8Array;
    private pendingBlocks: Map<string, any> = new Map();

    constructor(config: Partial<NodeConfig> = {}) {
        super();
        this.config = { ...DEFAULT_CONFIG, ...config };
        this.chainId = hexToBytes(this.config.genesisHash.replace('0x', ''));
        const dataDir = this.config.dataDir;

        // Initialize CommitLog (Block Storage)
        this.store = new CommitLog({
            path: path.join(dataDir, 'commitlog'),
            genesisRoot: Buffer.from(this.config.genesisHash.replace('0x', ''), 'hex')
        });

        this.bftStatePath = path.join(dataDir, 'bft_state.json');
    }

    private async loadBFTState() {
        try {
            const data = await fs.readFile(this.bftStatePath, 'utf8');
            const state = JSON.parse(data, (_, v) => typeof v === 'string' && v.endsWith('n') ? BigInt(v.slice(0, -1)) : v);
            this.currentBFTState = state;
        } catch (e) {
            this.currentBFTState = { lastVotedRound: 0n, lastVotedRoundQC: 0n };
        }
    }

    private async saveBFTState() {
        const data = JSON.stringify(this.currentBFTState, (_, v) => typeof v === 'bigint' ? v.toString() + 'n' : v, 2);
        await fs.writeFile(this.bftStatePath, data);
    }

    async start() {
        if (this.isStarted) return;

        logger.info('Starting VERA Full Node...');

        // 1. Open Block Store
        await this.store.open();
        let head = await this.store.getLatest();

        if (!head) {
            logger.info('Initializing Genesis in CommitLog...');
            const genesisEntry: CommitEntry = {
                height: 0n,
                stateRoot: hexToBytes(this.config.genesisHash.replace('0x', '')),
                prevStateRoot: new Uint8Array(32),
                timestamp: Date.now(),
                changeCount: 0,
                walLSN: 0n,
                metadata: { hash: this.config.genesisHash }
            };
            await this.store.append(genesisEntry);
            head = genesisEntry;
        }

        // Load BFT State
        await this.loadBFTState();

        // 2. Initialize Network
        this.network = new NetworkNode({
            networkId: this.config.networkId,
            version: '1.0.0',
            genesisHash: this.config.genesisHash,
            headHash: head ? bytesToHex(head.stateRoot) : this.config.genesisHash,
            height: head ? head.height : 0n
        });

        // 3. Initialize BFT Gadget
        this.gadget = new BFTGadget({
            validators: this.config.validators.map(v => ({
                id: toBytes32(hexToBytes(v.id)) as any,
                publicKey: toBytes32(hexToBytes(v.publicKey)),
                votingPower: BigInt(v.votingPower)
            })),
            chainId: this.config.networkId,
            onFinalized: (hash: Bytes32, height: bigint) => {
                logger.success(`Block ${bytesToHex(hash).slice(0, 8)} finalized at height ${height}`);
                this.emit('finalized', { hash, height });
                this.handleFinalizedBlock(hash, height).catch(e => logger.error('Failed to handle finalistion', e));
            }
        }, this.currentBFTState);

        this.network.syncManager.setBlockProvider(this);

        // 4. Initialize State Store (LevelDB + WAL + Trie)
        const levelPath = path.join(this.config.dataDir, 'state');
        const walPath = path.join(this.config.dataDir, 'wal');

        const levelStore = new LevelDBStore(levelPath);
        this.backingStore = new AppendOnlyStore({
            baseStore: levelStore,
            wal: { path: walPath },
            checkpointInterval: 100
        });

        await this.backingStore.open();

        // Load Persistent State
        this.stateStore = await PersistentStateStore.load(this.backingStore);
        logger.info(`State loaded. Version: ${this.stateStore.version}, Root: ${bytesToHex(this.stateStore.root)}`);

        // 5. Initialize Executor
        let program = GENESIS_PROGRAM;
        if (this.config.programPath) {
            try {
                const programData = await fs.readFile(this.config.programPath, 'utf-8');
                program = JSON.parse(programData, (_, v) => {
                    // Handle BigInts in JSON
                    if (typeof v === 'string' && /^\d+$/.test(v) && v.length > 15) return BigInt(v);
                    return v;
                });
                logger.info(`Loaded contract: ${program.name}`);
            } catch (e: any) {
                logger.error(`Failed to load contract from ${this.config.programPath}: ${e.message}`);
                // Fallback to genesis? Or exit? Exit is better.
                throw e;
            }
        }

        this.executor = new ParallelExecutor(program, {
            poolSize: 4,
            backingStore: this.stateStore
        });

        // 6. Wire Sync Pipeline
        this.network.on('sync:blocks', this.handleSyncedBlocks.bind(this));

        // 7. Wire BFT Events
        this.network.on('bft:vote', (vote: Vote) => {
            // Ensure BigInt types
            vote.height = BigInt(vote.height);
            vote.round = BigInt(vote.round);
            const qc = this.gadget.addVote(vote);
            if (qc) {
                console.log(`[Node] Adding QC locally (Vote). Height: ${qc.height}`);
                // FORCE UPDATE to bypass potential BFTGadget staleness/bug
                if (!(this.gadget as any).highestQC || qc.height > (this.gadget as any).highestQC.height) {
                    (this.gadget as any).highestQC = qc;
                    console.log(`[Node] FORCED HighQC Update to ${qc.height}`);
                }
                this.gadget.addQC(qc);
                try {
                    this.network.broadcastQC(qc);
                } catch (e) {
                    logger.error('Failed to broadcast QC:', e);
                }
            }
        });

        this.network.on('bft:qc', (qc: QuorumCertificate) => {
            qc.height = BigInt(qc.height);
            qc.round = BigInt(qc.round);
            this.gadget.addQC(qc);
            this.resetRoundTimer();
        });

        this.network.on('bft:new_view', (nv: NewView) => {
            nv.round = BigInt(nv.round);
            if (nv.highestQC) {
                nv.highestQC.height = BigInt(nv.highestQC.height);
                nv.highestQC.round = BigInt(nv.highestQC.round);
            }
            const nextRound = this.gadget.handleNewView(nv);
            if (nextRound) {
                this.resetRoundTimer();
                this.checkProposer();
            }
        });

        this.network.on('bft:proposal', async (proposal: any) => {
            proposal.height = BigInt(proposal.height);
            proposal.round = BigInt(proposal.round);
            await this.handleBlockProposal(proposal);
        });

        // Initialize Sequencer for pending transactions
        this.sequencer = new SingleSequencer({
            chainId: toBytes32(hexToBytes(this.config.genesisHash.replace('0x', ''))) as any
        });
        await this.sequencer.start();

        // 8. Start Network
        await this.network.start(this.config.port);
        logger.success(`Node ${this.network.id} started on port ${this.config.port}`);

        // 9. Start RPC Server
        if (this.config.rpcEnabled !== false) {
            this.rpcServer = new RPCServer(this, {
                httpPort: this.config.rpcPort || 8545,
                wsPort: (this.config.rpcPort || 8545) + 1
            });
            await this.rpcServer.start();
        }

        this.resetRoundTimer();
        this.checkProposer();

        this.isStarted = true;
    }

    private resetRoundTimer() {
        if (this.roundTimer) clearTimeout(this.roundTimer);
        this.roundTimer = setTimeout(() => {
            this.handleRoundTimeout();
        }, 10000); // 10s timeout for view change
    }

    private handleRoundTimeout() {
        const nextRound = this.gadget.getCurrentRound() + 1n;
        logger.warn(`Round timeout. Moving to round ${nextRound}`);

        const hqc = this.gadget.getHighestQC();
        if (this.config.secretKey && hqc) {
            const secret = toBytes32(hexToBytes(this.config.secretKey));
            const nv: NewView = {
                round: nextRound,
                highestQC: hqc,
                author: getPublicKey(secret) as any,
                signature: sign(new TextEncoder().encode(`NEW_VIEW:${nextRound}`), secret) // Mock signature
            };
            this.network.broadcastNewView(nv);
            this.gadget.handleNewView(nv);
        }

        this.resetRoundTimer();
        this.checkProposer();
    }

    private async checkProposer() {
        if (!this.config.secretKey) return;
        const myId = getPublicKey(toBytes32(hexToBytes(this.config.secretKey)));
        if (this.gadget.isLeader(myId, this.gadget.getCurrentRound())) {
            const round = this.gadget.getCurrentRound();
            logger.info(`I am the leader for round ${round}. Proposing...`);

            // Pull pending transactions and propose a block
            const pendingTxs = await this.sequencer.getRange(0n, 100n);
            if (pendingTxs.length > 0 || round > 0n) {
                await this.proposeBlock(pendingTxs, round);
            }
        }
    }

    private async proposeBlock(txs: any[], round: bigint) {
        // Use BFT HighQC to build on the latest prepared block (unfinalized tip)
        const highQC = this.gadget.getHighestQC();
        console.log(`[Node] Proposing block. Round: ${round}. HighQC Height: ${highQC?.height}`);
        logger.info(`Proposing block. Round: ${round}. HighQC Height: ${highQC?.height}`);
        let parentHash: Bytes32;
        let newHeight: bigint;

        if (highQC && highQC.height >= 0n) {
            parentHash = highQC.blockHash;
            newHeight = highQC.height + 1n;
        } else {
            // Fallback to committed head (e.g. Genesis)
            const latest = await this.store.getLatest();
            if (latest && latest.metadata && (latest.metadata as any).hash) {
                parentHash = toBytes32(hexToBytes((latest.metadata as any).hash.replace('0x', '')));
                newHeight = latest.height + 1n;
            } else {
                // If checking genesis from config is hard, use 0s (usually wrong but safe for devnet start if genesis is 0)
                parentHash = toBytes32(new Uint8Array(32));
                newHeight = 1n;
            }
        }

        // Parent State Root is needed for execution context? 
        // Engine context needs parentHash.

        const blockHash = toBytes32(sha256(
            concat(
                new TextEncoder().encode(`block:${newHeight}:${round}`),
                parentHash
            )
        ));

        const proposal = {
            height: newHeight,
            round,
            prevHash: bytesToHex(parentHash),
            blockHash: bytesToHex(blockHash),
            txs: txs.map(t => t.transaction), // Ordered tx -> raw tx
            proposer: this.config.secretKey ? bytesToHex(getPublicKey(toBytes32(hexToBytes(this.config.secretKey)))) : '0x00'
        };

        // Add block to BFT tracking and broadcast proposal
        this.gadget.addBlock(blockHash, parentHash, newHeight);
        this.network.broadcastBlockProposal(proposal);

        // Self-process the proposal (vote for own block)
        await this.handleBlockProposal(proposal);
    }

    private async handleBlockProposal(proposal: any) {
        // Validate and execute proposed block, then vote if valid
        const blockHash = toBytes32(hexToBytes(proposal.blockHash.replace('0x', '')));
        const prevHash = toBytes32(hexToBytes(proposal.prevHash.replace('0x', '')));

        // Record block in BFT
        this.gadget.addBlock(blockHash, prevHash, proposal.height);

        // Store pending block body for execution upon finalization
        this.pendingBlocks.set(bytesToHex(blockHash), proposal);

        // Cast a vote if we're a validator
        if (this.config.secretKey) {
            const secret = toBytes32(hexToBytes(this.config.secretKey));
            const vote = this.createVote(blockHash, proposal.height, proposal.round, secret);
            const qc = this.gadget.addVote(vote);
            this.network.broadcastVote(vote);
            if (qc) {
                this.gadget.addQC(qc); // Update local highQC FIRST
                try {
                    this.network.broadcastQC(qc);
                } catch (e) {
                    logger.error('Failed to broadcast QC:', e);
                }
            }
        }
    }

    async stop() {
        if (!this.isStarted) return;
        logger.info('Stopping node...');
        if (this.rpcServer) await this.rpcServer.stop();
        if (this.network) await this.network.stop();
        await this.store.close();
        if (this.executor) this.executor.terminate();
        if (this.backingStore) await this.backingStore.close();
        this.isStarted = false;
        logger.success('Node stopped');
    }

    // Connect to a peer
    async connect(host: string, port: number) {
        await this.network.connect(host, port);
    }

    // BlockProvider Implementation
    async getBlocks(fromHeight: bigint, limit: number): Promise<any[]> {
        const toHeight = fromHeight + BigInt(limit) - 1n;
        const commits = await this.store.getRange(fromHeight, toHeight);

        return commits.map(c => {
            const header = [
                1,                                                  // version
                c.height,                                           // height
                '0x0000000000000000000000000000000000000000000000000000000000000000', // prevHash
                '0x' + Buffer.from(c.stateRoot).toString('hex'),    // stateRoot
                Math.floor(c.timestamp / 1000),                     // timestamp (s)
                0n                                                  // nonce
            ];
            const txs: any[] = [];
            return [header, txs];
        });
    }

    private async handleSyncedBlocks(blocks: any[]) {
        logger.info(`Processing ${blocks.length} synced blocks...`);

        for (const blockData of blocks) {
            const header = blockData[0];
            const rawTxs = blockData[1];
            const blockHeight = header[1];
            const prevHash = header[2];

            // 1. Compute block hash
            const blockHash = toBytes32(sha256(new TextEncoder().encode(`block:${blockHeight}`)));
            this.gadget.addBlock(blockHash, toBytes32(hexToBytes(prevHash.replace('0x', ''))), blockHeight);

            const engineBlockCtx = {
                height: blockHeight,
                timestamp: BigInt(header[4]),
                parentHash: prevHash as string
            };

            const txsToExec = rawTxs.map((txBytes: Uint8Array) => {
                try {
                    const tx = decodeTransaction(txBytes);
                    return {
                        functionName: tx.payload.function || 'unknown',
                        args: (tx.payload.args || []).map(mapPrimitiveToValue),
                        caller: bytesToHex(tx.publicKey) // Caller ID from public key
                    };
                } catch (e) {
                    logger.warn('Failed to decode tx:', e);
                    return {
                        functionName: 'unknown',
                        args: [],
                        caller: '0x00'
                    };
                }
            });

            try {
                // 2. Execute
                const { results, stats } = await this.executor.executeBlock(txsToExec, engineBlockCtx);
                const allBinaryChanges = results.flatMap((r: any) => {
                    logger.info(`Executed tx ${r.functionName}: status=${r.status} gas=${r.gasUsed}`);
                    if (r.status === 0) { // Success
                        logger.info('Tx Success Return:', r.returnValue);
                    } else {
                        logger.error('Tx Failed:', r.error);
                    }
                    return r.binaryChanges;
                });

                // 3. Apply changes
                this.stateStore = (await this.stateStore.apply(allBinaryChanges, blockHeight)) as PersistentStateStore;
                const newRoot = this.stateStore.root;

                // 4. Commit to Log
                const entry: CommitEntry = {
                    height: blockHeight,
                    stateRoot: newRoot as Uint8Array,
                    prevStateRoot: toBytes32(new Uint8Array(32)),
                    timestamp: Number(engineBlockCtx.timestamp) * 1000,
                    changeCount: allBinaryChanges.length,
                    walLSN: 0n,
                    metadata: { hash: bytesToHex(blockHash) }
                };

                await this.store.append(entry);

                // 5. Commit AppendOnlyStore
                await this.backingStore.commit(newRoot as Uint8Array, blockHeight);

                // 6. Update Network Height
                this.network.setHeight(blockHeight);

                // Update BFT State and Persist
                this.currentBFTState.lastVotedRound = 1n; // Placeholder
                await this.saveBFTState();

                // 7. Cast Vote if we are a validator
                if (this.config.secretKey) {
                    const secret = toBytes32(hexToBytes(this.config.secretKey));
                    const pubKey = getPublicKey(secret);
                    const myId = pubKey; // Use pubKey as ID for simplicity

                    const vote: Vote = {
                        blockHash: blockHash as Bytes32,
                        height: blockHeight,
                        round: 1n,
                        author: myId as any,
                        signature: sign(this.constructVoteMessage(blockHash as Bytes32, blockHeight, 1n), secret)
                    };

                    this.network.broadcastVote(vote);
                    this.gadget.addVote(vote);
                }

                if (stats.totalTransactions > 0) {
                    logger.debug(`Applied block ${blockHeight}. Txs: ${stats.totalTransactions}, Conflicts: ${stats.conflictsDetected}`);
                }

            } catch (e) {
                logger.error(`Failed to process block ${blockHeight}`, e);
                break;
            }
        }
    }

    private constructVoteMessage(blockHash: Bytes32, height: bigint, _round: bigint): Uint8Array {
        const message = concat(
            new TextEncoder().encode('VERA_BFT_V1:'),
            new TextEncoder().encode(this.config.networkId),
            Buffer.alloc(8),
            blockHash
        );
        const view = new DataView(message.buffer, 12 + this.config.networkId.length);
        view.setBigUint64(0, height, false);
        return message;
    }

    private createVote(blockHash: Bytes32, height: bigint, round: bigint, secret: Bytes32): Vote {
        return {
            blockHash,
            height,
            round,
            author: getPublicKey(secret) as any,
            signature: sign(this.constructVoteMessage(blockHash, height, round), secret)
        };
    }

    private async handleFinalizedBlock(hash: Bytes32, height: bigint) {
        const hexHash = bytesToHex(hash);
        const proposal = this.pendingBlocks.get(hexHash);
        if (!proposal) {
            logger.warn(`Finalized block ${hexHash} payload not found in pending cache`);
            return;
        }

        // Execute transactions
        const txs: Uint8Array[] = proposal.txs.map((tx: any) =>
            typeof tx === 'string' ? hexToBytes(tx.replace('0x', '')) :
                tx instanceof Uint8Array ? tx : new Uint8Array(tx)
        );

        this.pendingBlocks.delete(hexHash);

        const txsToExec = txs.map(tx => {
            try {
                const data = decodeTransaction(tx);
                return {
                    functionName: data.payload.function || 'unknown',
                    args: (data.payload.args || []).map(mapPrimitiveToValue),
                    caller: bytesToHex(data.publicKey)
                };
            } catch { return null; }
        }).filter(t => t !== null) as any[];

        const engineBlockCtx = {
            height: height,
            timestamp: BigInt(Date.now()),
            parentHash: bytesToHex(proposal.prevHash.replace('0x', ''))
        };

        let changeCount = 0;

        try {
            // Execute
            const { results, stats } = await this.executor.executeBlock(txsToExec, engineBlockCtx);

            // Apply changes
            const changes = results.flatMap((r: any) => r.binaryChanges);
            this.stateStore = (await this.stateStore.apply(changes, height)) as PersistentStateStore;
            changeCount = changes.length;

            if (stats.totalTransactions > 0) {
                logger.info(`Finalized Block ${height} Executed. Txs: ${txs.length}, Changes: ${changeCount}`);
            }
        } catch (e) {
            logger.error(`Execution failed for finalized block ${height}`, e);
        }

        // Update Store
        const entry: CommitEntry = {
            height,
            stateRoot: this.stateStore.root as Uint8Array,
            prevStateRoot: toBytes32(new Uint8Array(32)),
            timestamp: Number(engineBlockCtx.timestamp),
            changeCount: changeCount,
            walLSN: 0n,
            metadata: { hash: hexHash }
        };
        await this.store.append(entry);
        await this.backingStore.commit(this.stateStore.root as Uint8Array, height);
        this.network.setHeight(height);

        logger.info(`Committed finalized block ${height} (Hash: ${hexHash.slice(0, 8)})`);
    }
}

function mapPrimitiveToValue(val: any): any {
    if (typeof val === 'string') return stringValue(val);
    if (typeof val === 'number') return intValue(BigInt(val));
    if (typeof val === 'bigint') return intValue(val);
    if (typeof val === 'boolean') return boolValue(val);
    if (val === null || val === undefined) return nullValue();
    return nullValue(); // Fallback
}
