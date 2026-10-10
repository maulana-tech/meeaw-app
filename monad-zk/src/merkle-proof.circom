pragma circom 2.1.6;

include "poseidon.circom";
include "mux1.circom";

// Poseidon Merkle inclusion. Folds `leaf` up `depth` levels using the sibling
// `pathElements` and direction bits `pathIndices` (0 = leaf on the left at that
// level, 1 = leaf on the right). Node hash matches the contract's
// PoseidonT3.hash([left, right]).
//
// Byte-for-byte the same template as withdraw.circom/transfer.circom. Those two
// keep their inline copy so the shipped R1CS and proving keys stay unchanged;
// new circuits include this file instead.
template MerkleProof(depth) {
    signal input leaf;
    signal input pathElements[depth];
    signal input pathIndices[depth];
    signal output root;

    component hashers[depth];
    component muxL[depth];
    component muxR[depth];
    signal cur[depth + 1];
    cur[0] <== leaf;

    for (var i = 0; i < depth; i++) {
        // pathIndices[i] must be a bit.
        pathIndices[i] * (1 - pathIndices[i]) === 0;

        // left  = bit==0 ? cur : sibling
        muxL[i] = Mux1();
        muxL[i].c[0] <== cur[i];
        muxL[i].c[1] <== pathElements[i];
        muxL[i].s <== pathIndices[i];

        // right = bit==0 ? sibling : cur
        muxR[i] = Mux1();
        muxR[i].c[0] <== pathElements[i];
        muxR[i].c[1] <== cur[i];
        muxR[i].s <== pathIndices[i];

        hashers[i] = Poseidon(2);
        hashers[i].inputs[0] <== muxL[i].out;
        hashers[i].inputs[1] <== muxR[i].out;
        cur[i + 1] <== hashers[i].out;
    }

    root <== cur[depth];
}
