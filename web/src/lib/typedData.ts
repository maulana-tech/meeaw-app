// EIP-712 type definitions shared by the browser (lib/chain.ts) and the
// contract tests (contracts/test/gasless.test.ts), so the struct the user signs
// is provably the struct MaweeRegistry/MaweePool verify. Keep dependency-free.

const registryFields = [
  { name: "owner", type: "address" },
  { name: "username", type: "string" },
  { name: "notePubkey", type: "bytes32" },
  { name: "viewPubkey", type: "bytes32" },
  { name: "nonce", type: "uint256" },
  { name: "deadline", type: "uint256" },
] as const;

export const registerTypes = { Register: registryFields } as const;
export const setPubkeysTypes = { SetPubkeys: registryFields } as const;

export const depositTypes = {
  Deposit: [
    { name: "payer", type: "address" },
    { name: "commitment", type: "bytes32" },
    { name: "amount", type: "uint256" },
    { name: "ephemeralPk", type: "bytes32" },
    { name: "ciphertextHash", type: "bytes32" },
    { name: "nonce", type: "uint256" },
    { name: "deadline", type: "uint256" },
  ],
} as const;

export const permitTypes = {
  Permit: [
    { name: "owner", type: "address" },
    { name: "spender", type: "address" },
    { name: "value", type: "uint256" },
    { name: "nonce", type: "uint256" },
    { name: "deadline", type: "uint256" },
  ],
} as const;

export const REGISTRY_DOMAIN_NAME = "MaweeRegistry";
export const POOL_DOMAIN_NAME = "MaweePool";
export const DOMAIN_VERSION = "1";

type Hex = `0x${string}`;

/** Payload for registerFor (rotate=false) or setPubkeysFor (rotate=true). */
export function registryTypedData(input: {
  rotate: boolean;
  chainId: number;
  registry: Hex;
  owner: Hex;
  username: string;
  notePubkey: Hex;
  viewPubkey: Hex;
  nonce: bigint;
  deadline: bigint;
}) {
  const domain = {
    name: REGISTRY_DOMAIN_NAME,
    version: DOMAIN_VERSION,
    chainId: input.chainId,
    verifyingContract: input.registry,
  };
  const message = {
    owner: input.owner,
    username: input.username,
    notePubkey: input.notePubkey,
    viewPubkey: input.viewPubkey,
    nonce: input.nonce,
    deadline: input.deadline,
  };
  // Both structs share one field list; primaryType picks which one is signed.
  const primaryType: "Register" | "SetPubkeys" = input.rotate
    ? "SetPubkeys"
    : "Register";
  return {
    domain,
    types: { ...registerTypes, ...setPubkeysTypes },
    primaryType,
    message,
  };
}

/** Payload for MaweePool.depositWithAuthorization. */
export function depositTypedData(input: {
  chainId: number;
  pool: Hex;
  payer: Hex;
  commitment: Hex;
  amount: bigint;
  ephemeralPk: Hex;
  ciphertextHash: Hex;
  nonce: bigint;
  deadline: bigint;
}) {
  return {
    domain: {
      name: POOL_DOMAIN_NAME,
      version: DOMAIN_VERSION,
      chainId: input.chainId,
      verifyingContract: input.pool,
    },
    types: depositTypes,
    primaryType: "Deposit",
    message: {
      payer: input.payer,
      commitment: input.commitment,
      amount: input.amount,
      ephemeralPk: input.ephemeralPk,
      ciphertextHash: input.ciphertextHash,
      nonce: input.nonce,
      deadline: input.deadline,
    },
  } as const;
}

/** EIP-2612 permit payload; `domain` comes from the token itself. */
export function permitTypedData(input: {
  domain: {
    name: string;
    version: string;
    chainId: number;
    verifyingContract: Hex;
  };
  owner: Hex;
  spender: Hex;
  value: bigint;
  nonce: bigint;
  deadline: bigint;
}) {
  return {
    domain: input.domain,
    types: permitTypes,
    primaryType: "Permit",
    message: {
      owner: input.owner,
      spender: input.spender,
      value: input.value,
      nonce: input.nonce,
      deadline: input.deadline,
    },
  } as const;
}
