import { getAddress, isAddress } from "viem";
import { z } from "zod";
import { usernameSchema } from "../usernames/usernames.schema";

const address = z
  .string()
  .refine((v) => isAddress(v, { strict: false }), "invalid EVM address")
  .transform((v) => getAddress(v));
const hex32 = z
  .string()
  .regex(
    /^0x[0-9a-fA-F]{64}$/,
    "must be 32 bytes of hex",
  ) as z.ZodType<`0x${string}`>;
// Encrypted notes are nonce(24) + ciphertext(48) + tag(16) = 88 bytes today;
// allow headroom without letting callers post arbitrarily large calldata.
const ciphertext = z
  .string()
  .regex(
    /^0x([0-9a-fA-F]{2}){1,512}$/,
    "invalid ciphertext",
  ) as z.ZodType<`0x${string}`>;
const signature = z
  .string()
  .regex(
    /^0x([0-9a-fA-F]{2}){65,2048}$/,
    "invalid signature",
  ) as z.ZodType<`0x${string}`>;
const uint = z
  .string()
  .regex(/^\d{1,78}$/, "must be a decimal integer")
  .transform((v) => BigInt(v));

export const proofInput = z.object({
  a: z.tuple([uint, uint]),
  b: z.tuple([z.tuple([uint, uint]), z.tuple([uint, uint])]),
  c: z.tuple([uint, uint]),
});

const noteOutput = z.object({
  commitment: hex32,
  ephemeralPk: hex32,
  ciphertext,
});

export const registerInput = z.object({
  username: usernameSchema,
  notePubkey: hex32,
  viewPubkey: hex32,
  deadline: uint,
  signature,
  /** true = rotate keys on an existing username (setPubkeysFor). */
  rotate: z.boolean().default(false),
});

export const depositInput = z.object({
  payer: address,
  commitment: hex32,
  amount: uint,
  proof: proofInput,
  ephemeralPk: hex32,
  ciphertext,
  deadline: uint,
  signature,
  permit: z
    .object({
      value: uint,
      deadline: uint,
      v: z.number().int().min(0).max(255),
      r: hex32,
      s: hex32,
    })
    .nullable(),
});

export const withdrawInput = z.object({
  // The note's pool (`${chainId}:${poolAddress}`); omitted means the active
  // pool. Only scopes in the deployment's manifest are accepted.
  pool: z
    .string()
    .regex(/^\d{1,16}:0x[0-9a-f]{40}$/)
    .optional(),
  recipient: address,
  amount: uint,
  root: hex32,
  nullifier: hex32,
  proof: proofInput,
});

export const transferInput = z.object({
  root: hex32,
  nullifier: hex32,
  proof: proofInput,
  recipientNote: noteOutput,
  changeNote: noteOutput,
});

export const txOutput = z.object({ txHash: z.string() });
export const depositOutput = txOutput.extend({ leafIndex: z.number().int() });
export const transferOutput = txOutput.extend({
  recipientIndex: z.number().int(),
  changeIndex: z.number().int(),
});
export const statusOutput = z.object({
  enabled: z.boolean(),
  testUsdcMintable: z.boolean(),
});

export type RegisterInput = z.infer<typeof registerInput>;
export type DepositInput = z.infer<typeof depositInput>;
export type WithdrawInput = z.infer<typeof withdrawInput>;
export type TransferInput = z.infer<typeof transferInput>;
