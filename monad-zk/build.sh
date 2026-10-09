set -euo pipefail
cd "$(dirname "$0")"

mkdir -p build

# `bash monad-zk/build.sh merge` builds only the Merge circuit with its own
# powers-of-tau file, so the shipped deposit/withdraw/transfer keys are never
# regenerated. Merge has ~11.4k constraints at --O2; 2^15 leaves headroom.
build_merge() {
  echo "==> compiling merge circuit"
  circom src/merge.circom --O2 --r1cs --wasm --sym -l node_modules/circomlib/circuits -o build
  cd build
  if [ ! -f pot_merge_final.ptau ]; then
    echo "==> powers of tau for merge (2^15, dev ceremony)"
    npx snarkjs powersoftau new bn128 15 pot_merge_0.ptau
    npx snarkjs powersoftau contribute pot_merge_0.ptau pot_merge_1.ptau --name=mawee-merge -e="mawee merge $(date +%s%N)"
    npx snarkjs powersoftau prepare phase2 pot_merge_1.ptau pot_merge_final.ptau
  fi
  if [ ! -f merge_final.zkey ]; then
    echo "==> groth16 setup (merge)"
    npx snarkjs groth16 setup merge.r1cs pot_merge_final.ptau merge_0.zkey
    npx snarkjs zkey contribute merge_0.zkey merge_final.zkey --name=mawee-merge2 -e="mawee merge $(date +%s%N)"
  fi
  npx snarkjs zkey export verificationkey merge_final.zkey verification_key_merge.json

  echo "==> test vector (merge)"
  node ../gen_merge_input.mjs
  npx snarkjs groth16 fullprove input_merge.json merge_js/merge.wasm merge_final.zkey proof_merge.json public_merge.json
  npx snarkjs groth16 verify verification_key_merge.json public_merge.json proof_merge.json

  echo "==> staging merge proving assets"
  mkdir -p ../../web/public/zk
  cp merge_js/merge.wasm ../../web/public/zk/merge.wasm
  cp merge_final.zkey ../../web/public/zk/merge.zkey
  cp verification_key_merge.json ../../web/public/zk/verification_key_merge.json
  node ../write_artifacts_manifest.mjs
  echo "==> regenerating Solidity verifiers"
  (cd ../.. && pnpm --filter contracts verifiers)
  echo "merge circuit build complete"
}

if [ "${1:-}" = "merge" ]; then
  build_merge
  exit 0
fi

echo "==> compiling circuits"
circom src/withdraw.circom --r1cs --wasm --sym -l node_modules/circomlib/circuits -o build
circom src/transfer.circom --r1cs --wasm --sym -l node_modules/circomlib/circuits -o build
circom src/deposit.circom --r1cs --wasm --sym -l node_modules/circomlib/circuits -o build

cd build
if [ ! -f pot_final.ptau ]; then
  echo "==> powers of tau (2^15, dev ceremony)"
  npx snarkjs powersoftau new bn128 15 pot_0.ptau
  npx snarkjs powersoftau contribute pot_0.ptau pot_1.ptau --name=mawee -e="mawee $(date +%s%N)"
  npx snarkjs powersoftau prepare phase2 pot_1.ptau pot_final.ptau
fi

if [ ! -f withdraw_final.zkey ]; then
  echo "==> groth16 setup (withdraw)"
  npx snarkjs groth16 setup withdraw.r1cs pot_final.ptau withdraw_0.zkey
  npx snarkjs zkey contribute withdraw_0.zkey withdraw_final.zkey --name=mawee2 -e="mawee $(date +%s%N)"
fi
npx snarkjs zkey export verificationkey withdraw_final.zkey verification_key.json

if [ ! -f transfer_final.zkey ]; then
  echo "==> groth16 setup (transfer)"
  npx snarkjs groth16 setup transfer.r1cs pot_final.ptau transfer_0.zkey
  npx snarkjs zkey contribute transfer_0.zkey transfer_final.zkey --name=mawee2 -e="mawee $(date +%s%N)"
fi
npx snarkjs zkey export verificationkey transfer_final.zkey verification_key_transfer.json

if [ ! -f deposit_final.zkey ]; then
  echo "==> groth16 setup (deposit)"
  npx snarkjs groth16 setup deposit.r1cs pot_final.ptau deposit_0.zkey
  npx snarkjs zkey contribute deposit_0.zkey deposit_final.zkey --name=mawee2 -e="mawee deposit"
fi
npx snarkjs zkey export verificationkey deposit_final.zkey verification_key_deposit.json

echo "==> test vector + fixture (withdraw)"
node ../gen_input.mjs
npx snarkjs groth16 fullprove input.json withdraw_js/withdraw.wasm withdraw_final.zkey proof.json public.json
npx snarkjs groth16 verify verification_key.json public.json proof.json

echo "==> test vector + fixture (transfer)"
node ../gen_transfer_input.mjs
npx snarkjs groth16 fullprove input_transfer.json transfer_js/transfer.wasm transfer_final.zkey proof_transfer.json public_transfer.json
npx snarkjs groth16 verify verification_key_transfer.json public_transfer.json proof_transfer.json

echo "==> test vector + fixture (deposit)"
node ../gen_deposit_input.mjs
npx snarkjs groth16 fullprove input_deposit.json deposit_js/deposit.wasm deposit_final.zkey proof_deposit.json public_deposit.json
npx snarkjs groth16 fullprove input_deposit_wd.json deposit_js/deposit.wasm deposit_final.zkey proof_deposit_wd.json public_deposit_wd.json
npx snarkjs groth16 verify verification_key_deposit.json public_deposit.json proof_deposit.json

echo "==> staging web proving assets"
mkdir -p ../../web/public/zk
cp withdraw_js/withdraw.wasm ../../web/public/zk/withdraw.wasm
cp withdraw_final.zkey ../../web/public/zk/withdraw.zkey
cp verification_key.json ../../web/public/zk/verification_key.json
cp transfer_js/transfer.wasm ../../web/public/zk/transfer.wasm
cp transfer_final.zkey ../../web/public/zk/transfer.zkey
cp verification_key_transfer.json ../../web/public/zk/verification_key_transfer.json
cp deposit_js/deposit.wasm ../../web/public/zk/deposit.wasm
cp deposit_final.zkey ../../web/public/zk/deposit.zkey
cp verification_key_deposit.json ../../web/public/zk/verification_key_deposit.json
echo "==> regenerating Solidity verifiers"
(cd ../.. && pnpm --filter contracts verifiers)
cd ..
build_merge
echo "circuit build complete"
