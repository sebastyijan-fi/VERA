/**
 * VERA Crypto Module - Public API
 */

// Hash functions
export {
    HashDomains,
    sha256,
    sha256WithDomain,
    doubleSha256,
    hashMerkleLeaf,
    hashMerkleInternal,
    hashStateValue,
    hashForSigning,
    hashConcat,
    hashString,
    hashBigInt,
    EMPTY_TREE_ROOT,
} from './hash.js';

// Signing and verification
export {
    type PrivateKey,
    type PublicKey,
    type KeyPair,
    generateKeyPair,
    getPublicKey,
    publicKeyToAddress,
    sign,
    signWithDomain,
    signTransaction,
    verify,
    verifyWithDomain,
    verifyTransactionSignature,
    verifyAllSignatures,
    isValidPublicKey,
    isValidPrivateKey,
    deriveKeyPairFromSeed,
} from './sign.js';

// Merkle tree
export {
    type LeafNode,
    type InternalNode,
    type EmptyNode,
    type MerkleNode,
    type MerkleEntry,
    createLeafNode,
    createInternalNode,
    createEmptyNode,
    MerkleTree,
    verifyMerkleProof,
    computeRootWithValue,
} from './merkle.js';
