pragma circom 2.1.6;

include "poseidon.circom";
include "bitify.circom";
include "comparators.circom";
include "merkle-proof.circom";

// Private note consolidation (2-input / 1-output). Proves that one owner holds
// two distinct notes under the same Merkle root, derives both nullifiers, and
// binds a single output note — owned by the same secret — whose amount is the
// exact sum of the inputs. Tokens never leave the pool; the contract only sees
// the root, two nullifiers and the hiding output commitment.
template Merge(depth) {
    // Public
    signal input root;
    signal input nullifierA;
    signal input nullifierB;
    signal input outCommitment;
    // Private
    signal input ownerSecret;
    signal input amounts[2];
    signal input salts[2];
    signal input pathElements[2][depth];
    signal input pathIndices[2][depth];
    signal input outSalt;

    // owner_pk = Poseidon([ownerSecret])
    component pk = Poseidon(1);
    pk.inputs[0] <== ownerSecret;

    component amountBits[2];
    component inCom[2];
    component mp[2];
    component leafIndices[2];
    component nf[2];
    for (var k = 0; k < 2; k++) {
        // Each input is a 64-bit amount, like every other note.
        amountBits[k] = Num2Bits(64);
        amountBits[k].in <== amounts[k];

        // commitment = Poseidon([amount, owner_pk, salt])
        inCom[k] = Poseidon(3);
        inCom[k].inputs[0] <== amounts[k];
        inCom[k].inputs[1] <== pk.out;
        inCom[k].inputs[2] <== salts[k];

        // Both inputs are members of the same public root.
        mp[k] = MerkleProof(depth);
        mp[k].leaf <== inCom[k].out;
        for (var i = 0; i < depth; i++) {
            mp[k].pathElements[i] <== pathElements[k][i];
            mp[k].pathIndices[i] <== pathIndices[k][i];
        }
        root === mp[k].root;

        // leaf_index = Σ pathIndices[i] * 2^i (bits are constrained in MerkleProof)
        leafIndices[k] = Bits2Num(depth);
        for (var i = 0; i < depth; i++) {
            leafIndices[k].in[i] <== pathIndices[k][i];
        }

        // nullifier = Poseidon([ownerSecret, leaf_index])
        nf[k] = Poseidon(2);
        nf[k].inputs[0] <== ownerSecret;
        nf[k].inputs[1] <== leafIndices[k].out;
    }
    nullifierA === nf[0].out;
    nullifierB === nf[1].out;

    // The same note can never be counted twice.
    component sameIndex = IsEqual();
    sameIndex.in[0] <== leafIndices[0].out;
    sameIndex.in[1] <== leafIndices[1].out;
    sameIndex.out === 0;
    component sameNullifier = IsEqual();
    sameNullifier.in[0] <== nullifierA;
    sameNullifier.in[1] <== nullifierB;
    sameNullifier.out === 0;

    // Exact conservation, and the merged note must still fit in 64 bits.
    signal combinedAmount;
    combinedAmount <== amounts[0] + amounts[1];
    component combinedBits = Num2Bits(64);
    combinedBits.in <== combinedAmount;

    // Output commitment owned by the same key.
    component outCom = Poseidon(3);
    outCom.inputs[0] <== combinedAmount;
    outCom.inputs[1] <== pk.out;
    outCom.inputs[2] <== outSalt;
    outCommitment === outCom.out;
}

component main {public [root, nullifierA, nullifierB, outCommitment]} = Merge(20);
