export type WithdrawInput = {
  root: string;
  nullifier: string;
  recipient: string;
  amount: string;
  ownerSecret: string;
  salt: string;
  pathElements: string[];
  pathIndices: (string | number)[];
};

export type TransferInput = {
  root: string;
  nullifier: string;
  outCommitmentRecipient: string;
  outCommitmentChange: string;
  inAmount: string;
  ownerSecret: string;
  inSalt: string;
  pathElements: string[];
  pathIndices: (string | number)[];
  recipientPk: string;
  recipientAmount: string;
  recipientSalt: string;
  changeAmount: string;
  changeSalt: string;
};

export type DepositInput = {
  commitment: string;
  amount: string;
  ownerPk: string;
  salt: string;
};

/// Groth16 proof in the layout the snarkjs-generated Solidity verifier expects:
/// G2 coordinates are (x1, x0), (y1, y0) — the reverse of snarkjs' JSON order.
export type EvmProof = {
  a: readonly [bigint, bigint];
  b: readonly [readonly [bigint, bigint], readonly [bigint, bigint]];
  c: readonly [bigint, bigint];
};

type SnarkProof = { pi_a: string[]; pi_b: string[][]; pi_c: string[] };

export function encodeProof(proof: SnarkProof): EvmProof {
  return {
    a: [BigInt(proof.pi_a[0]), BigInt(proof.pi_a[1])],
    b: [
      [BigInt(proof.pi_b[0][1]), BigInt(proof.pi_b[0][0])],
      [BigInt(proof.pi_b[1][1]), BigInt(proof.pi_b[1][0])],
    ],
    c: [BigInt(proof.pi_c[0]), BigInt(proof.pi_c[1])],
  };
}

export async function proveDeposit(
  input: DepositInput,
  artifactRoot = "/zk",
): Promise<{ proof: EvmProof; publicSignals: string[]; ms: number }> {
  const snarkjs = await import("snarkjs");
  const started = performance.now();
  const { proof, publicSignals } = await snarkjs.groth16.fullProve(
    input,
    `${artifactRoot}/deposit.wasm`,
    `${artifactRoot}/deposit.zkey`,
  );
  return {
    proof: encodeProof(proof as SnarkProof),
    publicSignals,
    ms: performance.now() - started,
  };
}

export async function proveWithdraw(
  input: WithdrawInput,
): Promise<{ proof: EvmProof; publicSignals: string[]; ms: number }> {
  const snarkjs = await import("snarkjs");
  const started = performance.now();
  const { proof, publicSignals } = await snarkjs.groth16.fullProve(
    input,
    "/zk/withdraw.wasm",
    "/zk/withdraw.zkey",
  );
  return {
    proof: encodeProof(proof as SnarkProof),
    publicSignals,
    ms: performance.now() - started,
  };
}

export async function proveTransfer(
  input: TransferInput,
  artifactRoot = "/zk",
): Promise<{ proof: EvmProof; publicSignals: string[]; ms: number }> {
  const snarkjs = await import("snarkjs");
  const started = performance.now();
  const { proof, publicSignals } = await snarkjs.groth16.fullProve(
    input,
    `${artifactRoot}/transfer.wasm`,
    `${artifactRoot}/transfer.zkey`,
  );
  return {
    proof: encodeProof(proof as SnarkProof),
    publicSignals,
    ms: performance.now() - started,
  };
}

export type MergeInput={root:string;nullifierA:string;nullifierB:string;outCommitment:string;ownerSecret:string;amounts:readonly [string,string];salts:readonly [string,string];pathElements:readonly [readonly string[],readonly string[]];pathIndices:readonly [readonly number[],readonly number[]];outSalt:string};
export async function proveMerge(input:MergeInput,artifactRoot="/zk"):Promise<{proof:EvmProof;publicSignals:string[];ms:number}>{
  const snarkjs=await import("snarkjs"),started=performance.now();
  const {proof,publicSignals}=await snarkjs.groth16.fullProve(input,`${artifactRoot}/merge.wasm`,`${artifactRoot}/merge.zkey`);
  return {proof:encodeProof(proof as SnarkProof),publicSignals,ms:performance.now()-started};
}
