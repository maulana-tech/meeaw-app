import path from "node:path";
import { expect } from "chai";
import hre from "hardhat";
import { type Hex, hexToSignature, keccak256, toHex } from "viem";
// The exact builders the browser uses (web/src/lib/chain.ts) — if they drift
// from what the contracts verify, these tests fail.
import {
  depositTypedData,
  permitTypedData,
  registryTypedData,
} from "../../web/src/lib/typedData";

// Relayed (gasless) entry points: the relayer account submits, the owner/payer
// only signs. Proofs use the same browser artifacts as pool.test.ts.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const snarkjs = require("snarkjs");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { buildPoseidon } = require("circomlibjs");

const ZK = path.join(__dirname, "../../web/public/zk");
const CHAIN_ID = 31337;
const b32 = (x: bigint) => toHex(x, { size: 32 });
const NOTE = b32(1n);
const VIEW = b32(2n);

let poseidonFn: any;
async function H(inputs: bigint[]): Promise<bigint> {
  if (!poseidonFn) poseidonFn = await buildPoseidon();
  return poseidonFn.F.toObject(poseidonFn(inputs));
}

async function expectRevert(promise: Promise<unknown>, error: string) {
  try {
    await promise;
  } catch (e) {
    expect(String((e as Error).message)).to.contain(error);
    return;
  }
  expect.fail(`expected revert ${error}`);
}

async function deadline(offset = 3600n) {
  const client = await hre.viem.getPublicClient();
  const block = await client.getBlock();
  return block.timestamp + offset;
}

describe("MaweeRegistry gasless", () => {
  async function deploy() {
    const [relayer, alice, mallory] = await hre.viem.getWalletClients();
    const registry = await hre.viem.deployContract("MaweeRegistry");
    return { relayer, alice, mallory, registry };
  }

  it("registers for an owner who only signs, and the relayer pays", async () => {
    const { relayer, alice, registry } = await deploy();
    const dl = await deadline();
    const signature = await alice.signTypedData(
      registryTypedData({
        rotate: false,
        chainId: CHAIN_ID,
        registry: registry.address,
        owner: alice.account.address,
        username: "dinar",
        notePubkey: NOTE,
        viewPubkey: VIEW,
        nonce: 0n,
        deadline: dl,
      }),
    );
    await registry.write.registerFor([alice.account.address, "dinar", NOTE, VIEW, dl, signature], {
      account: relayer.account,
    });
    const account = await registry.read.resolve(["dinar"]);
    expect(account.owner.toLowerCase()).to.equal(alice.account.address.toLowerCase());
    expect(await registry.read.nonces([alice.account.address])).to.equal(1n);

    // Replaying the same signature fails: the nonce was consumed.
    await expectRevert(
      registry.write.registerFor([alice.account.address, "dinar", NOTE, VIEW, dl, signature], {
        account: relayer.account,
      }),
      "InvalidSignature",
    );
  });

  it("rejects a signature from someone other than the owner", async () => {
    const { relayer, alice, mallory, registry } = await deploy();
    const dl = await deadline();
    const forged = await mallory.signTypedData(
      registryTypedData({
        rotate: false,
        chainId: CHAIN_ID,
        registry: registry.address,
        owner: alice.account.address,
        username: "dinar",
        notePubkey: NOTE,
        viewPubkey: VIEW,
        nonce: 0n,
        deadline: dl,
      }),
    );
    await expectRevert(
      registry.write.registerFor([alice.account.address, "dinar", NOTE, VIEW, dl, forged], {
        account: relayer.account,
      }),
      "InvalidSignature",
    );
  });

  it("rejects a signature whose fields were altered", async () => {
    const { relayer, alice, registry } = await deploy();
    const dl = await deadline();
    const signature = await alice.signTypedData(
      registryTypedData({
        rotate: false,
        chainId: CHAIN_ID,
        registry: registry.address,
        owner: alice.account.address,
        username: "dinar",
        notePubkey: NOTE,
        viewPubkey: VIEW,
        nonce: 0n,
        deadline: dl,
      }),
    );
    // Relayer tries to swap in its own viewing key.
    await expectRevert(
      registry.write.registerFor([alice.account.address, "dinar", NOTE, b32(99n), dl, signature], {
        account: relayer.account,
      }),
      "InvalidSignature",
    );
  });

  it("rejects an expired signature", async () => {
    const { relayer, alice, registry } = await deploy();
    const dl = (await deadline(0n)) - 1n;
    const signature = await alice.signTypedData(
      registryTypedData({
        rotate: false,
        chainId: CHAIN_ID,
        registry: registry.address,
        owner: alice.account.address,
        username: "dinar",
        notePubkey: NOTE,
        viewPubkey: VIEW,
        nonce: 0n,
        deadline: dl,
      }),
    );
    await expectRevert(
      registry.write.registerFor([alice.account.address, "dinar", NOTE, VIEW, dl, signature], {
        account: relayer.account,
      }),
      "SignatureExpired",
    );
  });

  it("rotates keys for the owner via setPubkeysFor", async () => {
    const { relayer, alice, registry } = await deploy();
    await registry.write.register(["dinar", NOTE, VIEW], { account: alice.account });
    const dl = await deadline();
    const note2 = b32(3n);
    const view2 = b32(4n);
    const signature = await alice.signTypedData(
      registryTypedData({
        rotate: true,
        chainId: CHAIN_ID,
        registry: registry.address,
        owner: alice.account.address,
        username: "dinar",
        notePubkey: note2,
        viewPubkey: view2,
        nonce: 0n,
        deadline: dl,
      }),
    );
    await registry.write.setPubkeysFor([alice.account.address, "dinar", note2, view2, dl, signature], {
      account: relayer.account,
    });
    const account = await registry.read.resolve(["dinar"]);
    expect(account.notePubkey).to.equal(note2);
    expect(account.viewPubkey).to.equal(view2);
  });
});

describe("MaweePool gasless deposit", () => {
  async function deploy() {
    const [admin, relayer, payer] = await hre.viem.getWalletClients();
    const poseidon = await hre.viem.deployContract("poseidon-solidity/PoseidonT3.sol:PoseidonT3");
    const usdc = await hre.viem.deployContract("MockUSDC");
    const dv = await hre.viem.deployContract("DepositVerifier");
    const wv = await hre.viem.deployContract("WithdrawVerifier");
    const tv = await hre.viem.deployContract("TransferVerifier");
    const mv = await hre.viem.deployContract("MergeVerifier");
    const pool = await hre.viem.deployContract(
      "MaweePool",
      [admin.account.address, usdc.address, dv.address, wv.address, tv.address, mv.address],
      { libraries: { "poseidon-solidity/PoseidonT3.sol:PoseidonT3": poseidon.address } },
    );
    await usdc.write.mint([payer.account.address, 100_000_000n]);
    return { relayer, payer, usdc, pool };
  }

  async function note(amount: bigint) {
    const ownerPk = await H([4242n]);
    const salt = 777n;
    const commitment = await H([amount, ownerPk, salt]);
    const { proof } = await snarkjs.groth16.fullProve(
      {
        commitment: commitment.toString(),
        amount: amount.toString(),
        ownerPk: ownerPk.toString(),
        salt: salt.toString(),
      },
      path.join(ZK, "deposit.wasm"),
      path.join(ZK, "deposit.zkey"),
    );
    return {
      commitment: b32(commitment),
      proof: {
        a: [BigInt(proof.pi_a[0]), BigInt(proof.pi_a[1])] as [bigint, bigint],
        b: [
          [BigInt(proof.pi_b[0][1]), BigInt(proof.pi_b[0][0])],
          [BigInt(proof.pi_b[1][1]), BigInt(proof.pi_b[1][0])],
        ] as [[bigint, bigint], [bigint, bigint]],
        c: [BigInt(proof.pi_c[0]), BigInt(proof.pi_c[1])] as [bigint, bigint],
      },
    };
  }

  async function signAll(
    ctx: Awaited<ReturnType<typeof deploy>>,
    commitment: Hex,
    amount: bigint,
    ciphertext: Hex,
  ) {
    const { payer, usdc, pool } = ctx;
    const dl = await deadline();
    const ephemeralPk = b32(5n);
    const signature = await payer.signTypedData(
      depositTypedData({
        chainId: CHAIN_ID,
        pool: pool.address,
        payer: payer.account.address,
        commitment,
        amount,
        ephemeralPk,
        ciphertextHash: keccak256(ciphertext),
        nonce: await pool.read.nonces([payer.account.address]),
        deadline: dl,
      }),
    );
    // Same discovery the browser does: the permit domain comes from the token.
    const [, name, version, chainId, verifyingContract] = await usdc.read.eip712Domain();
    const permitSig = await payer.signTypedData(
      permitTypedData({
        domain: { name, version, chainId: Number(chainId), verifyingContract },
        owner: payer.account.address,
        spender: pool.address,
        value: amount,
        nonce: await usdc.read.nonces([payer.account.address]),
        deadline: dl,
      }),
    );
    const { v, r, s } = hexToSignature(permitSig);
    const permit = { value: amount, deadline: dl, v: Number(v), r, s };
    return { dl, ephemeralPk, signature, permit };
  }

  it("pulls the payer's USDC via permit while the relayer pays gas", async () => {
    const ctx = await deploy();
    const { relayer, payer, usdc, pool } = ctx;
    const n = await note(25_000_000n);
    const ciphertext = "0xc1c2c3" as Hex;
    const s = await signAll(ctx, n.commitment, 25_000_000n, ciphertext);

    const payerGasBefore = await (await hre.viem.getPublicClient()).getBalance({ address: payer.account.address });
    await pool.write.depositWithAuthorization(
      [payer.account.address, n.commitment, 25_000_000n, n.proof, s.ephemeralPk, ciphertext, s.dl, s.signature, s.permit],
      { account: relayer.account },
    );
    const payerGasAfter = await (await hre.viem.getPublicClient()).getBalance({ address: payer.account.address });

    expect(await usdc.read.balanceOf([pool.address])).to.equal(25_000_000n);
    expect(payerGasAfter).to.equal(payerGasBefore); // the payer spent no gas
    const [event] = await pool.getEvents.Deposit();
    expect(event.args.ciphertext).to.equal(ciphertext);
  });

  it("rejects a relayer that swaps the commitment for its own note", async () => {
    const ctx = await deploy();
    const n = await note(10_000_000n);
    const attacker = await note(10_000_000n); // different salt would still be a different leaf
    const s = await signAll(ctx, n.commitment, 10_000_000n, "0x01");
    const otherCommitment = b32(BigInt(attacker.commitment) + 1n);
    await expectRevert(
      ctx.pool.write.depositWithAuthorization(
        [ctx.payer.account.address, otherCommitment, 10_000_000n, n.proof, s.ephemeralPk, "0x01", s.dl, s.signature, s.permit],
        { account: ctx.relayer.account },
      ),
      "InvalidSignature",
    );
  });

  it("rejects a relayer that replaces the encrypted note", async () => {
    const ctx = await deploy();
    const n = await note(10_000_000n);
    const s = await signAll(ctx, n.commitment, 10_000_000n, "0x01");
    await expectRevert(
      ctx.pool.write.depositWithAuthorization(
        [ctx.payer.account.address, n.commitment, 10_000_000n, n.proof, s.ephemeralPk, "0x02", s.dl, s.signature, s.permit],
        { account: ctx.relayer.account },
      ),
      "InvalidSignature",
    );
  });

  it("cannot replay an authorization", async () => {
    const ctx = await deploy();
    const n = await note(10_000_000n);
    const s = await signAll(ctx, n.commitment, 10_000_000n, "0x01");
    const args = [
      ctx.payer.account.address,
      n.commitment,
      10_000_000n,
      n.proof,
      s.ephemeralPk,
      "0x01",
      s.dl,
      s.signature,
      s.permit,
    ] as const;
    await ctx.pool.write.depositWithAuthorization(args, { account: ctx.relayer.account });
    await expectRevert(
      ctx.pool.write.depositWithAuthorization(args, { account: ctx.relayer.account }),
      "InvalidSignature",
    );
  });

  it("still succeeds when someone front-runs the permit", async () => {
    const ctx = await deploy();
    const n = await note(10_000_000n);
    const s = await signAll(ctx, n.commitment, 10_000_000n, "0x01");
    // Griefer submits the permit first; the allowance it sets is what we need.
    await ctx.usdc.write.permit(
      [ctx.payer.account.address, ctx.pool.address, s.permit.value, s.permit.deadline, s.permit.v, s.permit.r, s.permit.s],
      { account: ctx.relayer.account },
    );
    await ctx.pool.write.depositWithAuthorization(
      [ctx.payer.account.address, n.commitment, 10_000_000n, n.proof, s.ephemeralPk, "0x01", s.dl, s.signature, s.permit],
      { account: ctx.relayer.account },
    );
    expect(await ctx.usdc.read.balanceOf([ctx.pool.address])).to.equal(10_000_000n);
  });
});
