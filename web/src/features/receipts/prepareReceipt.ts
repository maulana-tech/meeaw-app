import { commitment, ownerPk } from "../../lib/crypto";
import { buildDisclosure } from "../../lib/disclosure";
import type { LocalAccount, MyNote, ScanResult } from "../../lib/notes";
import { resolvePool } from "../../lib/pools";
import type { LoadReceiptSnapshot } from "./receiptChainTypes";
import type { ReceiptV2 } from "./receiptTypes";
import { verifyReceipt } from "./receiptVerification";
export async function prepareReceipt(params: {
  acct: LocalAccount;
  scan: ScanResult;
  note: MyNote;
  username?: string | null;
  load: LoadReceiptSnapshot;
  isCurrent?: () => boolean;
}): Promise<ReceiptV2> {
  const { scan, note, acct } = params,
    current = params.isCurrent ?? (() => true),
    pool = resolvePool(scan.scope),
    snapshot = scan.snapshot;
  const fail = () => {
    throw new Error("Receipt could not be verified. Refresh and retry.");
  };
  if (!snapshot)
    throw new Error("Receipt snapshot is missing. Refresh and retry.");
  if (
    !current() ||
    scan.health !== "healthy" ||
    !Number.isSafeInteger(snapshot.blockNumber) ||
    snapshot.blockNumber < pool.deployBlock ||
    snapshot.leafCount < 1 ||
    scan.leaves.length !== snapshot.leafCount ||
    note.scope !== pool.scope ||
    note.leafIndex < 0 ||
    note.leafIndex >= snapshot.leafCount
  )
    fail();
  for (let i = 0; i < scan.leaves.length; i++)
    if (typeof scan.leaves[i] !== "bigint") fail();
  if (
    scan.leaves[note.leafIndex] !==
    (await commitment(note.amount, await ownerPk(acct.ownerSecret), note.salt))
  )
    fail();
  const legacy = await buildDisclosure({
    acct,
    scan,
    note,
    username: params.username,
  });
  if (!current()) fail();
  const outcome = await params.load({
    pool: pool.scope,
    blockNumber: snapshot.blockNumber,
  });
  if (!current()) fail();
  if (outcome.status !== "available")
    throw new Error("Receipt chain data is unavailable. Retry.");
  const bundle: ReceiptV2 = {
    ...legacy,
    version: 2,
    network: `eip155:${pool.chainId}`,
    asset: pool.asset,
    tokenDecimals: pool.tokenDecimals,
    anchor: {
      blockNumber: snapshot.blockNumber,
      blockHash: outcome.snapshot.blockHash,
      leafCount: snapshot.leafCount,
    },
  };
  const checked = await verifyReceipt(
    bundle,
    pool,
    async () => outcome,
    current,
  );
  if (checked.status !== "verified" || !current()) fail();
  return bundle;
}
