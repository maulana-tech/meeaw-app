import { expect } from "chai";
import hre from "hardhat";
import { toHex } from "viem";

const NOTE = toHex(1n, { size: 32 });
const VIEW = toHex(2n, { size: 32 });

async function expectRevert(promise: Promise<unknown>, error: string) {
  try {
    await promise;
  } catch (e) {
    expect(String((e as Error).message)).to.contain(error);
    return;
  }
  expect.fail(`expected revert ${error}`);
}

describe("MaweeRegistry", () => {
  async function deploy() {
    const [alice, bob] = await hre.viem.getWalletClients();
    const registry = await hre.viem.deployContract("MaweeRegistry");
    return { alice, bob, registry };
  }

  it("registers and resolves a username", async () => {
    const { alice, registry } = await deploy();
    await registry.write.register(["dinar", NOTE, VIEW], { account: alice.account });
    const account = await registry.read.resolve(["dinar"]);
    expect(account.owner.toLowerCase()).to.equal(alice.account.address.toLowerCase());
    expect(account.notePubkey).to.equal(NOTE);
    expect(account.viewPubkey).to.equal(VIEW);
    expect(await registry.read.usernameOf([alice.account.address])).to.equal("dinar");
  });

  it("enforces one username per name and per owner", async () => {
    const { alice, bob, registry } = await deploy();
    await registry.write.register(["dinar", NOTE, VIEW], { account: alice.account });
    await expectRevert(registry.write.register(["dinar", NOTE, VIEW], { account: bob.account }), "UsernameTaken");
    await expectRevert(
      registry.write.register(["second", NOTE, VIEW], { account: alice.account }),
      "OwnerHasUsername",
    );
  });

  it("validates length and charset", async () => {
    const { alice, registry } = await deploy();
    await expectRevert(registry.write.register(["ab", NOTE, VIEW], { account: alice.account }), "UsernameTooShort");
    await expectRevert(
      registry.write.register(["a".repeat(33), NOTE, VIEW], { account: alice.account }),
      "UsernameTooLong",
    );
    await expectRevert(
      registry.write.register(["Dinar", NOTE, VIEW], { account: alice.account }),
      "UsernameInvalidCharacter",
    );
  });

  it("only the owner can rotate keys, and both rotate together", async () => {
    const { alice, bob, registry } = await deploy();
    await registry.write.register(["dinar", NOTE, VIEW], { account: alice.account });
    const note2 = toHex(3n, { size: 32 });
    const view2 = toHex(4n, { size: 32 });
    await expectRevert(registry.write.setPubkeys(["dinar", note2, view2], { account: bob.account }), "UsernameNotFound");
    await registry.write.setPubkeys(["dinar", note2, view2], { account: alice.account });
    const account = await registry.read.resolve(["dinar"]);
    expect(account.notePubkey).to.equal(note2);
    expect(account.viewPubkey).to.equal(view2);
  });

  it("reports missing usernames", async () => {
    const { registry } = await deploy();
    await expectRevert(registry.read.resolve(["ghost"]), "UsernameNotFound");
  });
});
